# Coronary case models

**All three cases currently render procedurally — this directory is
intentionally empty of GLBs.**

| File | Case | Present | Source |
| --- | --- | --- | --- |
| `case1.glb` | Case 1 | — | procedural (normal anatomical baseline) |
| `case2.glb` | Case 2 | — | procedural (mid-LAD stenosis) |
| `case3.glb` | Case 3 | — | procedural (anomalous RCA origin) |

## Why the real scans were withdrawn

Two patient CTA segmentations (`case_182`, `case_193`) were previously wired to
Cases 1 and 2. They now live in [`_unused-assets/real-cta-scans/`](../../../_unused-assets/real-cta-scans/),
outside `public/` so they don't ship in the build.

They are trimesh exports: a single unnamed mesh (`geometry_0`), no materials,
fragmented into 30 and 62 disconnected islands in scanner millimetres. Nothing
in them identifies which island is the LAD, the LCX or the RCA — so hover
identification and lesion grading had to be scored against *reference*
centrelines overlaid as an educated guess, which the mission panel had to
disclose with a "hover targets are reference anatomy" warning. That is honest,
but it means the thing being taught and the thing being shown are not the same
object.

Procedurally, they are: the vignette, the answer key, the lesion position and
the geometry a student actually points at all derive from one source of truth.
To reintroduce a real scan, drop its GLB back here as `caseN.glb`, place region
anchors for it (see "Binding regions to a specimen" in
[`README_SURGILEARN.md`](../../../README_SURGILEARN.md)), and have someone who
can read the study correct that case's `brief`, `answer`, `lesion` and
`teaching` in `src/surgilearn/cases.ts` to match what the scan actually shows.

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
