"""Blood-flow paths through the cavity: hand waypoints, smoothed with a
Catmull-Rom spline, nudged off the walls along the depth gradient, then checked."""
import numpy as np, json
from scipy import ndimage as ndi
d = np.load('vox.npz'); inside = d['inside']; lo = d['lo']; h = float(d['h']); depth = d['depth'].astype(np.float32)
depth_s = ndi.gaussian_filter(depth, 1.0)
grad = np.stack(np.gradient(depth_s, h), -1)
I = json.load(open('interior.json'))
V = {k: np.array(v['centre']) for k, v in I['valves'].items()}
C = {k: np.array(v['centroid']) for k, v in I['chambers'].items()}

def at(field, p):
    ijk = np.clip(np.round((p - lo) / h).astype(int), 0, np.array(depth.shape) - 1)
    return field[ijk[0], ijk[1], ijk[2]]

def catmull(P, n_per=14):
    P = np.array(P, float); P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, n_per, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2]); return np.array(out)

def relax(S, target=0.05, iters=25):
    S = S.copy()
    for _ in range(iters):
        T = np.gradient(S, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
        for i in range(1, len(S) - 1):
            dp = at(depth, S[i])
            if dp >= target: continue
            g = at(grad, S[i]); g = g - T[i] * (g @ T[i])
            n = np.linalg.norm(g)
            if n > 1e-6: S[i] += g / n * h * 0.5
    return S

v = lambda k: V[k].tolist()
PATHS = {
 'venous_lpa': [[-0.385, 0.89, 0.195], [-0.33, 0.74, 0.11], [-0.30, 0.6, 0.05], [-0.34, 0.42, 0.0], C['ra'].tolist(),
                [-0.38, 0.15, 0.06], v('tricuspid'), [-0.28, -0.05, 0.2], [-0.2, -0.3, 0.25], [-0.06, -0.42, 0.27],
                [0.0, -0.2, 0.32], [0.03, 0.08, 0.31], v('pulmonary'), [0.21, 0.43, 0.21], [0.31, 0.48, 0.14],
                [0.45, 0.48, 0.1], [0.55, 0.47, 0.05], [0.63, 0.43, 0.0]],
 'venous_rpa': [[0.21, 0.43, 0.21], [0.2, 0.46, 0.07], [0.12, 0.5, -0.06], [0.09, 0.58, -0.15], [-0.01, 0.65, -0.22],
                [-0.12, 0.71, -0.2], [-0.24, 0.78, -0.17], [-0.35, 0.85, -0.11]],
 'arterial_right_pv': [[-0.2, 0.25, -0.46], [-0.05, 0.27, -0.36], C['la'].tolist()],
 'arterial_desc': [[0.32, 0.3, -0.45], [0.22, 0.29, -0.33], C['la'].tolist(), [0.13, 0.21, -0.22], v('mitral'),
                   [0.15, -0.05, -0.13], [0.17, -0.35, -0.1], [0.18, -0.62, -0.06], [0.1, -0.45, 0.0], [0.05, -0.15, 0.02],
                   [0.02, 0.1, 0.05], [-0.03, 0.25, 0.1], v('aortic'), [-0.1, 0.45, 0.13], [-0.04, 0.55, 0.15],
                   [0.0, 0.64, 0.12], [0.05, 0.71, 0.05], [0.11, 0.74, -0.03], [0.18, 0.74, -0.13], [0.23, 0.75, -0.22],
                   [0.3, 0.71, -0.32], [0.36, 0.64, -0.41], [0.41, 0.6, -0.47]],
 'arterial_bct': [[0.08, 0.73, 0.0], [0.13, 0.78, -0.07], [0.15, 0.85, -0.08], [0.13, 0.95, -0.085]],
 'arterial_lcca': [[0.2, 0.75, -0.16], [0.26, 0.84, -0.22], [0.3, 0.95, -0.25]],
 'arterial_lsa': [[0.29, 0.73, -0.3], [0.35, 0.8, -0.36], [0.39, 0.89, -0.41]],
}
out = {}
for name, wp in PATHS.items():
    S = relax(catmull(wp))
    dep = np.array([at(depth, p) for p in S])
    bad = (dep < 0.02).sum()
    print(f'{name:18s} n={len(S):3d} min depth {dep.min():.3f}  shallow<0.02: {bad}  len {np.linalg.norm(np.diff(S, axis=0), axis=1).sum():.2f}')
    out[name] = {'p': S.round(3).tolist(), 'r': np.clip(dep * 0.5, 0.012, 0.07).round(3).tolist()}
json.dump(out, open('flows.json', 'w'))
