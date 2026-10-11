"""Step 1: voxelise the normalised heart shell, find the enclosed cavity, its depth
below the shell, and which shell piece each cavity voxel is nearest. Saves vox.npz."""
import numpy as np, trimesh, time
from trimesh import graph
from scipy import ndimage as ndi

t0 = time.time()
mesh = trimesh.load('heart_loops_norm.ply', process=True)
labels = np.load('face_labels.npy')
h = 0.0125
lo = mesh.bounds[0] - 0.06
hi = mesh.bounds[1] + 0.06
shape = np.ceil((hi - lo) / h).astype(int) + 1
print('grid', shape, shape.prod())

pts, fidx = trimesh.sample.sample_surface(mesh, 1_500_000, seed=1)
pts = np.vstack([pts, mesh.vertices]); 
vf = mesh.vertex_faces[:, 0]
fidx = np.concatenate([fidx, vf])
ijk = np.round((pts - lo) / h).astype(int)
surf = np.zeros(shape, bool)
surf[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
piece = np.full(shape, -1, np.int16)
piece[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = labels[fidx]
print('surface voxels', surf.sum(), time.time() - t0)

sealed = ndi.binary_dilation(surf, iterations=1)
free_lab, n = ndi.label(~sealed)
border = set(np.unique(np.concatenate([free_lab[0].ravel(), free_lab[-1].ravel(), free_lab[:, 0].ravel(),
                                        free_lab[:, -1].ravel(), free_lab[:, :, 0].ravel(), free_lab[:, :, -1].ravel()])))
sizes = np.bincount(free_lab.ravel())
print('free regions', n, 'border', border, 'sizes', sorted(sizes[1:])[::-1][:6])
inside = (free_lab > 0) & ~np.isin(free_lab, list(border))
print('inside voxels', inside.sum(), 'volume', inside.sum() * h**3)
# depth below the shell (surface voxels are distance 0; +h for the dilation ring)
dist, ind = ndi.distance_transform_edt(~surf, return_indices=True)
depth = np.where(inside, dist * h, 0.0)
near_piece = piece[ind[0], ind[1], ind[2]]
np.savez_compressed('vox.npz', inside=inside, depth=depth.astype(np.float32), near=near_piece, lo=lo, h=h)
print('done', time.time() - t0)
