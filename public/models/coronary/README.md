# Coronary case models

Drop the case GLB files here:

| File | Case | Expected anatomy |
| --- | --- | --- |
| `case1.glb` | Case 1 — Normal anatomy | Healthy left and right systems |
| `case2.glb` | Case 2 — Mild stenosis | Mid-LAD plaque, roughly 35–40% |
| `case3.glb` | Case 3 — Severe + anomaly | Anomalous RCA origin from the left sinus, severe proximal lesion |

**Nothing here is required to run the platform.** When a file is missing,
SurgiLearn renders a procedural coronary tree for that case instead: the LAD,
LCX and RCA follow their real epicardial courses, the lesion is a genuine
geometric narrowing of the lumen, and Case 3 re-routes the RCA ostium to the
left coronary sinus with an interarterial course. Every challenge objective is
scoreable either way.

## Naming meshes so regions bind directly

If your GLB names its meshes after the arteries, SurgiLearn binds hover regions
straight to them — the names are matched case-insensitively:

| Region | Matches |
| --- | --- |
| LAD | `LAD`, `left anterior descending`, `anterior interventricular` |
| LCX | `LCX`, `circumflex`, `left circumflex` |
| RCA | `RCA`, `right coronary` |
| Stenosis | any name containing `stenos`, `plaque`, `lesion` or `narrow` |

Anything the file does not name is filled in with invisible proxy tubes
generated from the same reference centrelines and scaled to the model's own
bounding box, so a case still plays with an unlabelled asset. The console logs
exactly which regions had to be synthesised.

## Format

Standard glTF binary. Draco compression is supported — the decoder is
self-hosted under `public/draco/`, so compressed assets still work fully
offline.
