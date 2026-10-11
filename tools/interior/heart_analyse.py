"""Find the open boundary loops (cut vessel ends) of the heart shell, in the
same normalised space the app uses: bbox-centred, longest axis = 2 units."""
import sys, json
import numpy as np
import trimesh

src = sys.argv[1]
out = sys.argv[2]

scene = trimesh.load(src, force='scene')
mesh = scene.dump(concatenate=True)
mesh.merge_vertices()          # glTF splits vertices at UV seams; join them
v = mesh.vertices.copy()
lo, hi = v.min(0), v.max(0)
centre = (lo + hi) / 2
scale = 2.0 / (hi - lo).max()
v = (v - centre) * scale
mesh.vertices = v
print('normalised extent', np.round(v.min(0), 3), np.round(v.max(0), 3))
print('faces', len(mesh.faces), 'verts', len(v), 'watertight', mesh.is_watertight)

# boundary edges: used by exactly one face
edges = np.sort(mesh.edges, axis=1)
uniq, counts = np.unique(edges, axis=0, return_counts=True)
boundary = uniq[counts == 1]
print('boundary edges', len(boundary))

# chain boundary edges into loops
adj = {}
for a, b in boundary:
    adj.setdefault(a, []).append(b)
    adj.setdefault(b, []).append(a)
seen = set()
loops = []
for start in adj:
    if start in seen:
        continue
    comp, stack = [], [start]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        comp.append(n)
        stack.extend(adj[n])
    loops.append(comp)

mesh_centre = v.mean(0)
info = []
for comp in loops:
    p = v[comp]
    c = p.mean(0)
    # plane fit: normal = smallest principal axis
    u, s, vt = np.linalg.svd(p - c)
    n = vt[2]
    if np.dot(n, c - mesh_centre) < 0:
        n = -n
    r = np.linalg.norm(p - c, axis=1).mean()
    info.append({'n_verts': len(comp), 'centre': np.round(c, 3).tolist(),
                 'normal': np.round(n, 3).tolist(), 'radius': round(float(r), 3)})
info.sort(key=lambda d: -d['radius'])
for i, d in enumerate(info):
    print(i, d)
json.dump({'loops': info, 'centre': centre.tolist(), 'scale': scale}, open(out, 'w'), indent=1)
mesh.export(out.replace('.json', '_norm.ply'))
