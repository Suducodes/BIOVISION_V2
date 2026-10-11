"""Step 3: mesh the chamber casts and septa with marching cubes, locate the four
valves, and export heart_interior.glb + interior.json (all in the app's
normalised specimen space)."""
import numpy as np, json, trimesh, fast_simplification
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
d = np.load('vox.npz'); inside = d['inside']; lo = d['lo']; h = float(d['h']); depth = d['depth']
lab = np.load('labels.npy'); F = np.load('fields.npy').astype(np.float32)
names = json.load(open('label_names.json')); spec = json.load(open('chamber_spec.json'))
I = {n: i for i, n in enumerate(names)}

def largest(m):
    L, k = ndi.label(m)
    if k <= 1: return m
    s = np.bincount(L.ravel()); s[0] = 0
    return L == s.argmax()

def mesh_of(mask, faces, sigma=1.1):
    v = ndi.gaussian_filter(mask.astype(np.float32), sigma)
    verts, tris, _, _ = marching_cubes(v, 0.5, spacing=(h, h, h))
    verts = verts + lo
    m = trimesh.Trimesh(verts, tris, process=True)
    trimesh.smoothing.filter_taubin(m, iterations=12)
    if len(m.faces) > faces:
        vs, fs = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), target_reduction=1 - faces / len(m.faces))
        m = trimesh.Trimesh(vs, fs, process=True)
    m.fix_normals()
    return m

meshes, info = {}, {'chambers': {}, 'septa': {}, 'valves': {}}
for n in names:
    mask = lab == I[n] + 1
    m = mesh_of(mask, 5000)
    meshes[n] = m
    c = lo + h * np.argwhere(mask).mean(0)
    info['chambers'][n] = {'centroid': c.round(3).tolist(), 'volume': round(float(mask.sum() * h**3), 4), 'faces': len(m.faces)}
    print(n, len(m.faces), 'faces, watertight', m.is_watertight)

def band(a, b, sep, reach=0.05):
    fa, fb = F[I[a]], F[I[b]]
    m = inside & (lab == 0) & (depth > 0.015) & (np.maximum(fa, fb) < reach) & (np.abs(fa - fb) <= sep + 0.012)
    return largest(m)

seps = spec['sep']
for name, (a, b) in {'ivs': ('lv', 'rv'), 'ias': ('ra', 'la')}.items():
    m = band(a, b, seps.get(f'{a}-{b}', seps.get(f'{b}-{a}')), reach=0.06)
    meshes[name] = mesh_of(m, 2500, sigma=0.9)
    c = lo + h * np.argwhere(m).mean(0)
    info['septa'][name] = {'centroid': c.round(3).tolist(), 'faces': len(meshes[name].faces)}
    print(name, m.sum(), 'vox', c.round(3))

def plane_fit(pts, toward):
    c = pts.mean(0)
    u, s, vt = np.linalg.svd(pts - c, full_matrices=False)
    n = vt[2]
    if np.dot(n, toward) < 0: n = -n
    inplane = (pts - c) - np.outer((pts - c) @ n, n)
    r = float(np.sqrt((inplane ** 2).sum(1).mean()) * 1.25)
    return c, n, r

for name, (a, b) in {'tricuspid': ('ra', 'rv'), 'mitral': ('la', 'lv')}.items():
    m = band(a, b, seps.get(f'{a}-{b}', seps.get(f'{b}-{a}')))
    pts = lo + h * np.argwhere(m)
    ca, cb = np.array(info['chambers'][a]['centroid']), np.array(info['chambers'][b]['centroid'])
    c, n, r = plane_fit(pts, cb - ca)
    info['valves'][name] = {'centre': c.round(3).tolist(), 'normal': n.round(3).tolist(), 'radius': round(min(r, 0.15), 3)}
    print(name, info['valves'][name], len(pts))

# Semilunar valves sit at the tip of each outflow tract, facing along it.
for name, ch in {'aortic': 'lv', 'pulmonary': 'rv'}.items():
    part = [p for p in spec['chambers'][ch]['parts'] if p['type'] == 'seg'][0]
    a, b = np.array(part['a']), np.array(part['b'])
    u = (b - a) / np.linalg.norm(b - a)
    pts = lo + h * np.argwhere(lab == I[ch] + 1)
    proj = (pts - a) @ u
    tip = pts[proj > proj.max() - 0.035]
    c = tip.mean(0) + u * 0.03
    inplane = (tip - tip.mean(0)) - np.outer((tip - tip.mean(0)) @ u, u)
    r = float(np.sqrt((inplane ** 2).sum(1).mean()) * 1.3)
    info['valves'][name] = {'centre': c.round(3).tolist(), 'normal': u.round(3).tolist(), 'radius': round(min(max(r, 0.06), 0.12), 3)}
    print(name, info['valves'][name])

scene = trimesh.Scene()
for n, m in meshes.items():
    scene.add_geometry(m, node_name=n, geom_name=n)
scene.export('heart_interior.glb')
json.dump(info, open('interior.json', 'w'), indent=1)
import os; print('glb bytes', os.path.getsize('heart_interior.glb'))
