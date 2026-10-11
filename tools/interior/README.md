# Schematic heart interior

The heart model is a surface shell with nothing inside it. These scripts build
the schematic interior that x-ray mode shows. Run in order, from this folder,
with Python 3 + numpy, scipy, trimesh, scikit-image, fast-simplification,
networkx, matplotlib:

1. `heart_analyse.py <heart.glb> heart_loops.json` — normalise the shell into the
   app's space (bbox-centred, longest axis 2) → `heart_loops_norm.ply`.
2. `slices.py` — label the shell's 13 edge-connected pieces → `face_labels.npy`.
3. `interior_vox.py` — voxelise the shell (h = 0.0125), flood-fill the outside,
   keep the enclosed cavity and its depth below the shell → `vox.npz`.
4. `chambers.py` — carve four chambers from `chamber_spec.json`: smooth unions of
   ellipsoids, kept a wall-thickness below the shell and a septum's width from
   each other → `labels.npy`, `fields.npy`.
5. `build_interior.py` — marching cubes on each chamber and septum, Taubin
   smoothing, quadric decimation; valve rings from the gaps between chambers
   → `heart_interior.glb`, `interior.json`.
6. `flows.py` — blood paths: Catmull-Rom splines through waypoints, nudged off
   the walls along the depth gradient → `flows.json`.
7. `gen_ts.py` — writes `src/anatomy/heartInteriorData.ts`. Copy the GLB to
   `public/models/heart_interior.glb`.

`parcel2.py` renders the 18-part surface parcellation offline (same rule as
`src/render/segmentHighlight.ts`) for checking site placement.
`cavity_slices.py` plots cavity cross-sections, optionally with chamber labels.
