"""Cross-sections of the normalised heart shell, coloured by edge-connected piece,
with candidate chamber ellipsoids overlaid. Writes slices.png."""
import sys, json
import numpy as np
import trimesh
from trimesh import intersections, graph
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

mesh = trimesh.load('heart_loops_norm.ply', process=True)
print('faces', len(mesh.faces), 'verts', len(mesh.vertices))
labels = graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
sizes = np.bincount(labels)
order = np.argsort(-sizes)
remap = np.empty_like(order); remap[order] = np.arange(len(order))
labels = remap[labels]
print('pieces', len(sizes), sorted(sizes)[::-1])
cent = [mesh.triangles_center[labels == k].mean(0).round(3).tolist() for k in range(len(sizes))]
for k, c in enumerate(cent): print(k, (labels == k).sum(), c)
np.save('face_labels.npy', labels)

chambers = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {}
cols = plt.cm.tab20(np.arange(20))

def ell_section(ch, axis, value):
    # sample ellipsoid surface points near the plane
    c = np.array(ch['c']); R = np.array(ch['R']); r = np.array(ch['r'])
    u, v = np.meshgrid(np.linspace(0, 2*np.pi, 160), np.linspace(0, np.pi, 80))
    p = np.stack([np.cos(u)*np.sin(v), np.sin(u)*np.sin(v), np.cos(v)], -1).reshape(-1, 3) * r
    p = p @ R.T + c
    near = np.abs(p[:, axis] - value) < 0.012
    return p[near]

planes = [('y', 1, v) for v in (0.75, 0.55, 0.35, 0.15, -0.05, -0.25, -0.45, -0.65)] + \
         [('z', 2, v) for v in (0.35, 0.15, -0.05, -0.25)] + [('x', 0, v) for v in (-0.35, -0.1, 0.15, 0.4)]
fig, axs = plt.subplots(4, 4, figsize=(20, 20))
for ax, (name, axis, value) in zip(axs.ravel(), planes):
    normal = np.zeros(3); normal[axis] = 1
    origin = normal * value
    segs, fidx = intersections.mesh_plane(mesh, normal, origin, return_faces=True)
    other = [i for i in range(3) if i != axis]
    for s, f in zip(segs, fidx):
        ax.plot(s[:, other[0]], s[:, other[1]], color=cols[labels[f] % 20], lw=1.4)
    for name2, ch in chambers.items():
        p = ell_section(ch, axis, value)
        if len(p):
            ax.scatter(p[:, other[0]], p[:, other[1]], s=1, color=ch.get('col', 'k'))
    ax.set_title(f'{name} = {value}   (h={"xyz"[other[0]]}, v={"xyz"[other[1]]})')
    ax.set_aspect('equal'); ax.grid(alpha=0.3)
    ax.set_xlim(-1.05, 1.05) if other[0] == 1 else ax.set_xlim(-0.75, 0.75)
    ax.set_ylim(-1.05, 1.05) if other[1] == 1 else ax.set_ylim(-0.62, 0.62)
handles = [plt.Line2D([], [], color=cols[k % 20], label=f'piece {k}') for k in range(len(sizes))]
fig.legend(handles=handles, loc='lower center', ncol=13)
plt.tight_layout(rect=(0, 0.03, 1, 1))
plt.savefig('slices.png', dpi=60)
