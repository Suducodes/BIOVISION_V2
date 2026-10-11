import numpy as np, json, sys
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d = np.load('vox.npz'); inside = d['inside']; lo = d['lo']; h = float(d['h']); near = d['near']; depth = d['depth']
lab = np.load(sys.argv[1]) if len(sys.argv) > 1 else None
cols = plt.cm.tab20(np.arange(20))
chcols = np.array([[0,0,0,0],[0.25,0.45,1,1],[0.1,0.25,0.9,1],[1,0.3,0.3,1],[0.85,0.1,0.15,1],[1,0.85,0.4,1],[0.9,0.6,1,1],[0.5,1,0.6,1],[1,1,1,1]])
planes = [('y', 1, v) for v in (0.75, 0.55, 0.4, 0.25, 0.1, -0.05, -0.3, -0.6)] + \
         [('z', 2, v) for v in (0.35, 0.15, -0.05, -0.25)] + [('x', 0, v) for v in (-0.35, -0.1, 0.15, 0.4)]
fig, axs = plt.subplots(4, 4, figsize=(20, 20))
for ax, (name, axis, value) in zip(axs.ravel(), planes):
    k = int(round((value - lo[axis]) / h))
    sl = [slice(None)] * 3; sl[axis] = k; sl = tuple(sl)
    ins = inside[sl]; nr = near[sl]
    other = [i for i in range(3) if i != axis]
    img = np.ones(ins.shape + (4,))
    img[ins] = cols[nr[ins] % 20] * 0.55 + 0.45
    if lab is not None:
        L = lab[sl]
        img[L > 0] = chcols[L[L > 0]]
    ext = [lo[other[0]], lo[other[0]] + h * ins.shape[0], lo[other[1]], lo[other[1]] + h * ins.shape[1]]
    ax.imshow(np.transpose(img, (1, 0, 2)), origin='lower', extent=ext)
    ax.contour(np.linspace(ext[0], ext[1], ins.shape[0]), np.linspace(ext[2], ext[3], ins.shape[1]), depth[sl].T, levels=[0.05, 0.1, 0.2], colors='k', linewidths=0.4)
    ax.set_title(f'{name} = {value}  (h={"xyz"[other[0]]}, v={"xyz"[other[1]]})'); ax.grid(alpha=.3)
plt.tight_layout(); plt.savefig(sys.argv[2] if len(sys.argv) > 2 else 'cavity.png', dpi=55)
