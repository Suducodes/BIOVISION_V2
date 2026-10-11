"""Step 2: carve schematic chamber casts out of the cavity. Each chamber is a
smooth union of ellipsoids; a voxel joins a chamber when it is inside that
chamber's field, deeper than the chamber's wall thickness, and clearly closer
to it than to any neighbour (the gap left between two neighbours is the septum
or valve ring). Saves labels.npy (0 none, 1 RA, 2 RV, 3 LA, 4 LV)."""
import numpy as np, json
from scipy import ndimage as ndi
d = np.load('vox.npz'); inside = d['inside']; lo = d['lo']; h = float(d['h']); depth = d['depth']
shape = inside.shape
g = np.stack(np.meshgrid(*[lo[i] + h * np.arange(shape[i]) for i in range(3)], indexing='ij'), -1).astype(np.float32)

def frame(axis):
    y = np.array(axis, float); y /= np.linalg.norm(y)
    x = np.array([1.0, 0, 0]) - y[0] * y; x /= np.linalg.norm(x)
    z = np.cross(x, y)
    return np.stack([x, y, z], 1)  # columns = local axes

def ell(c, r, axis=(0, 1, 0)):
    R = frame(axis)
    q = (g - np.array(c, np.float32)) @ R.astype(np.float32)
    k = np.sqrt(((q / np.array(r, np.float32)) ** 2).sum(-1))
    return (k - 1) * min(r)

def smin(a, b, k=0.06):
    hh = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - hh) + a * hh - k * hh * (1 - hh)

def seg(a, b, ra, rb):
    """Tapered capsule from a to b."""
    a = np.array(a, np.float32); b = np.array(b, np.float32)
    ab = b - a; t = np.clip(((g - a) @ ab) / (ab @ ab), 0, 1)
    p = a + t[..., None] * ab
    return np.linalg.norm(g - p, axis=-1) - (ra + (rb - ra) * t)

C = json.load(open('chamber_spec.json'))
fields = {}
for name, spec in C['chambers'].items():
    f = None
    for part in spec['parts']:
        if part['type'] == 'ell':
            fp = ell(part['c'], part['r'], part.get('axis', (0, 1, 0)))
        else:
            fp = seg(part['a'], part['b'], part['ra'], part['rb'])
        f = fp if f is None else smin(f, fp, spec.get('blend', 0.06))
    fields[name] = f
names = list(C['chambers'])
F = np.stack([fields[n] for n in names])
lab = np.zeros(shape, np.uint8)
for i, n in enumerate(names):
    spec = C['chambers'][n]
    ok = inside & (F[i] < 0) & (depth > spec['wall'])
    for j, m in enumerate(names):
        if j == i: continue
        sep = C['sep'].get(f'{n}-{m}', C['sep'].get(f'{m}-{n}', C['sep']['default']))
        ok &= F[i] + sep <= F[j]
    # keep the largest connected piece
    L, k = ndi.label(ok)
    if k > 1:
        sizes = np.bincount(L.ravel()); sizes[0] = 0
        ok = L == sizes.argmax()
    lab[ok] = i + 1
    vox = ok.sum()
    print(f'{n}: {vox} vox, vol {vox * h**3:.4f}, centroid {(lo + h * np.argwhere(ok).mean(0)).round(3)}')
np.save("labels.npy", lab); np.save("fields.npy", F.astype(np.float16))
json.dump(names, open('label_names.json', 'w'))
