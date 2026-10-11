import numpy as np, json, trimesh
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
mesh = trimesh.load('heart_loops_norm.ply', process=True)
flab = np.load('face_labels.npy')
S = json.load(open('parcel_sites.json'))
CLAIMS = {'svc': [1, 6], 'ra': [1], 'rauricle': [1], 'ascAorta': [3], 'arch': [3], 'bct': [3, 11], 'lcca': [3, 9],
          'lsa': [3, 12], 'descAorta': [3, 8], 'pt': [4], 'lpa': [4, 7], 'rpa': [5, 10], 'la': [0], 'lauricle': [0],
          'pv': [0, 1], 'rv': [2, 0], 'lv': [2, 0], 'apex': [2, 0]}
names = list(S)
vpiece = np.full(len(mesh.vertices), -1)
for fi, f in enumerate(mesh.faces): vpiece[f] = flab[fi]
B = 0.035
W = np.zeros((len(mesh.vertices), len(names)))
for i, v in enumerate(mesh.vertices):
    P = vpiece[i]
    best = []
    for k, n in enumerate(names):
        if P in CLAIMS[n]:
            for s in S[n]: best.append((np.linalg.norm(np.array(s) - v), k))
    if not best:
        for k, n in enumerate(names):
            for s in S[n]: best.append((np.linalg.norm(np.array(s) - v), k))
    d = np.array([b[0] for b in best]); ks = np.array([b[1] for b in best])
    w = np.exp(-(d - d.min()) / B); np.add.at(W[i], ks, w)
W /= W.sum(1, keepdims=True); own = W.argmax(1)
cols = plt.cm.tab20(np.linspace(0, 1, 20))
V = mesh.vertices
fig, axs = plt.subplots(1, 4, figsize=(28, 10))
for ax, (name, rot) in zip(axs, [('front', 0), ('patient-left side', -90), ('back', 180), ('patient-right side', 90)]):
    a = np.radians(rot); R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    P = V @ R.T; o = np.argsort(P[:, 2])
    ax.scatter(P[o, 0], P[o, 1], c=cols[(own[o] * 7) % 20], s=3)
    front = P[:, 2] > 0
    for k, n in enumerate(names):
        m = (own == k) & front
        if m.sum() > 15:
            c = np.median(P[m], 0); ax.text(c[0], c[1], n, fontsize=12, weight='bold', ha='center', bbox=dict(fc='w', alpha=.6, lw=0))
    ax.set_title(name); ax.set_aspect('equal')
plt.tight_layout(); plt.savefig('parcel.png', dpi=45)
print({n: int((own == k).sum()) for k, n in enumerate(names)})
