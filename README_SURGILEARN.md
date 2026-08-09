# SurgiLearn

**A simulation-based surgical learning layer for Bio-Vision.**
2026 IEEE Metaverse Grand Challenge for Simulation-Based Learning — Theme 1: Healthcare Applications in Digital Learning.

SurgiLearn turns Bio-Vision's zero-footprint anatomy viewer into an assessed
clinical exercise. A student loads a coronary case, reads the vignette, rotates
the specimen into the correct angiographic working view, identifies the culprit
vessel by holding their fingertip over it, grades the lesion, and receives an AI
clinical debrief — all in a browser tab, with no install, no headset, and no
account.

---

## Contents

- [What was added](#what-was-added)
- [Running it](#running-it)
- [How to add GLB files](#how-to-add-glb-files)
- [Configuring the Claude API key](#configuring-the-claude-api-key)
- [How the scoring system works](#how-the-scoring-system-works)
- [Architecture](#architecture)
- [Deliberate design decisions](#deliberate-design-decisions)
- [Known limits](#known-limits)

---

## What was added

Everything new lives under [`src/surgilearn/`](src/surgilearn/). Nothing in the
original render, gesture, or interaction pipeline was rewritten.

### 1. Case library and model selector

The existing specimen switcher gains three coronary cases alongside Heart and
Lungs, so the model selector is the control the user already knows:

| Case | Specimen | Clinical picture | Correct grade |
| --- | --- | --- | --- |
| **Case 1** | `case_182` CTA segmentation | 58F, atypical chest pain — normal anatomy baseline | `NORMAL` |
| **Case 2** | `case_193` CTA segmentation | 65M, exertional chest pain — mid-LAD plaque | `MILD` |
| **Case 3** | procedural | 47M athlete, exertional syncope — anomalous RCA origin from the left sinus with a severe proximal lesion | `SEVERE` |

Each case loads `public/models/coronary/caseN.glb`. **If the GLB is not
present, the case still plays** — see [How to add GLB files](#how-to-add-glb-files).

> ⚠️ **The clinical content of Cases 1 and 2 has not been matched to the scans.**
> The vignettes, lesion positions and answer keys were authored against the
> procedural reference anatomy before the patient segmentations arrived. Someone
> who can read the studies needs to confirm what `case_182` and `case_193`
> actually show and correct `brief`, `answer`, `lesion` and `teaching` in
> `src/surgilearn/cases.ts`. Case 3 is fully procedural and internally
> consistent.

### 2. EXPLORE ↔ CHALLENGE mode toggle

A segmented switch in the top bar, beside the telemetry HUD.

- **EXPLORE MODE** — the original Bio-Vision platform, unchanged. No scoring
  state exists: the challenge engine is not constructed, the hover probe does
  not raycast, and all specimen materials are the ones the loader produced.
- **CHALLENGE MODE** — constructs the engine, mounts the mission panel, and
  activates the touchless identification cursor. Leaving the mode tears all of
  it down and restores every material it touched.

Entering CHALLENGE mode from the Heart or Lungs automatically loads Case 1;
selecting a non-coronary specimen while in CHALLENGE mode drops back to EXPLORE.

### 3. Mission panel

Left rail, collapsible and draggable, same chrome as the specimen log:

- Case title and clinical vignette
- Objective checklist with a progress fill behind each row
- Live **orientation gauge** showing degrees off the target working view
- Severity grading buttons (`NORMAL` / `MILD` / `MODERATE` / `SEVERE`)
- Count-up timer and live score

### 4. Mesh region labelling and touchless identification

Regions `LAD`, `LCX`, `RCA` and `STENOSIS` are bound to meshes and raycast
against a screen-space cursor driven by **the index fingertip** (or the mouse
pointer when no camera is enabled). Holding the cursor on a region for **2
seconds**:

- closes the reticle's progress ring as the dwell accumulates,
- pulses the region with a cyan glow (orange for a confirmed stenosis),
- shows a label popup with the region name and its clinical description,
- ticks the matching objective — or flags an amber *misidentification* if the
  mission never asked for that vessel.

The vessel is deliberately **not** named on hover, only once the dwell
completes. Naming it earlier would hand the student the answer.

### 5. AI clinical debrief

A terminal-styled console panel with score, time, per-task breakdown, penalty
accounting, and the AI debrief typed in character by character. `RETRY →`
restarts the same case; `NEXT CASE →` advances (and becomes `START OVER →` on
the last case). Without a configured key the console shows the placeholder plus
an offline teaching point.

### 6. Progress dashboard

Behind the 📊 button: learner name, competency level, a four-axis Chart.js radar
of best runs, the badge cabinet, and a per-case local leaderboard.

### 7. Gamification

Badges — **First Case**, **Perfect Score**, **Speed Surgeon** (<60 s),
**Anomaly Hunter** (Case 3) — unlock with a two-second full-screen flash and
persist in `localStorage`.

### 8. Local leaderboard

Top 5 scores per case, sorted by score then by time, attributed to the name
entered on first entry into CHALLENGE mode.

---

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. `npm run build` produces the static bundle;
`npm run lint` typechecks without emitting.

---

## How to add GLB files

Drop the files into `public/models/coronary/`:

```
public/models/coronary/case1.glb
public/models/coronary/case2.glb
public/models/coronary/case3.glb
```

No code change is needed. See
[`public/models/coronary/README.md`](public/models/coronary/README.md) for the
full reference.

### The fallback is a real model, not a placeholder

When a GLB is missing, SurgiLearn builds a **procedural coronary tree** in the
browser. It is not a stand-in cube:

- The LAD, LCX and RCA follow their actual epicardial courses — the anterior
  interventricular groove, the left AV groove, the right AV groove — with
  diagonal, obtuse marginal and PDA branches.
- The lumen radius is a function of arc length, so a stenosis is a **genuine
  geometric narrowing** with plaque shoulders, not a painted-on marker. Case 2's
  mid-LAD lesion measures a 35% diameter reduction against the local taper;
  Case 3's proximal RCA lesion measures 75%.
- Case 3 re-routes the RCA ostium to the **left coronary sinus** with an
  interarterial course between the aorta and pulmonary trunk — the anatomy that
  makes the case dangerous.

Every objective is scoreable with or without a GLB, so the platform is
demonstrable on a fresh clone.

### Binding regions to a specimen

Regions resolve in three tiers, best first.

**1 · Mesh names in the GLB.** Matched case-insensitively:

| Region | Matches |
| --- | --- |
| LAD | `LAD`, `left anterior descending`, `anterior interventricular` |
| LCX | `LCX`, `circumflex` |
| RCA | `RCA`, `right coronary` |
| Stenosis | any name containing `stenos`, `plaque`, `lesion`, `narrow` |

**2 · Placed anchors.** A CTA segmentation names nothing — `case_182` and
`case_193` each arrive as one unnamed mesh (`geometry_0`) with no materials,
fragmented into 30 and 62 disconnected islands in raw scanner millimetres. No
heuristic recovers which island is the LAD: fitting the reference centrelines to
the bounding box put them on the real surface **0% / 0% / 11%** of the time
(measured, `case_182`). So a real specimen is labelled once, by hand:

1. Load the case and enter CHALLENGE mode. The mission panel says which vessels
   are unlabelled and offers **📍 LABEL VESSELS** (or open the app with
   `?anchors=1`).
2. Click a region in the picker, then click that vessel on the model.
3. Repeat for each region. Anchors save to `localStorage` immediately and the
   case is playable at once.
4. Press **COPY FOR cases.ts** and paste the snippet into the case definition to
   make it permanent for everyone:

   ```ts
   regionAnchors: {
     LAD: { at: [-0.540, -0.214, 0.002], radius: 0.16 },
     RCA: { at: [0.408, -0.494, 0.346], radius: 0.16 },
   },
   ```

   Coordinates are in the **normalised pivot frame** (longest model axis = 2
   units), not scanner millimetres, so they survive any rescaling of the asset.

**3 · Reference proxies.** Anything still unaccounted for falls back to
invisible tubes built from the reference centrelines. On the procedural specimen
that is exact — it *is* those centrelines. On a real scan it is a guess, so the
mission panel says so in amber rather than marking a student wrong for pointing
at the right vessel.

---

## Configuring the Claude API key

1. Copy the template:

   ```bash
   cp config.example.js public/config.js
   ```

2. Put your key in `public/config.js`:

   ```js
   window.SURGILEARN_CONFIG = {
     anthropicApiKey: 'sk-ant-...',
     model: 'claude-opus-5',
   };
   ```

`public/config.js` is gitignored. Without it the platform runs normally and the
debrief console shows `[ AI CLINICAL DEBRIEF WILL APPEAR HERE ]`. A `404` for
`config.js` in the console when unconfigured is expected and harmless.

### Security — read this before deploying with a key

A key in `config.js` is **served to the browser and readable by anyone who loads
the page**. That is fine for a local demo or a judged walkthrough on your own
machine. For a shared or public deployment, do not ship a key: stand up a small
proxy that holds the key server-side and forwards to `/v1/messages`, and point
`ENDPOINT` in [`src/surgilearn/tutor.ts`](src/surgilearn/tutor.ts) at it. If you
do use a browser key, use a throwaway one with a hard spend limit.

The request is a direct `fetch` to the Messages API with the
`anthropic-dangerous-direct-browser-access` header, on `claude-opus-5` at `low`
effort. It is a raw `fetch` rather than the Anthropic SDK deliberately: the
platform ships as a static bundle to GitHub Pages with no build-time secrets and
no npm dependencies beyond three.js, and one JSON POST does not justify breaking
either property.

---

## How the scoring system works

### Per-case score

Every case starts at **100**.

| Event | Cost |
| --- | --- |
| Each completed 10 seconds | −2 |
| Each incorrect severity grade | −10 |

The score is clamped to `0…100`. An incorrect grade does **not** close the
objective — the student grades again until they are right, paying 10 points each
time. The case completes only when every objective is done.

Off-target identifications (dwelling on a vessel the mission never asked about)
cost no points but do reduce the Identification axis on the radar, so precision
shows up in the profile rather than the headline number.

### Competency axes

| Axis | Formula |
| --- | --- |
| **Speed** | `100 − max(0, seconds − 45) × 1.5` |
| **Accuracy** | the final score |
| **Identification** | `100 − offTargetIdentifications × 12` |
| **Classification** | `100 − wrongGrades × 25` |

All clamped to `0…100`. The radar plots the mean of each axis across the
learner's **best** run per case.

### Competency level

Mean of the best score per attempted case:

| Average | Level |
| --- | --- |
| < 60 | `NOVICE` |
| 60 – 79 | `INTERMEDIATE` |
| ≥ 80 | `PROFICIENT` |

### Badges

| Badge | Unlocked by |
| --- | --- |
| **First Case** | completing any case |
| **Perfect Score** | finishing on 100/100 |
| **Speed Surgeon** | finishing in under 60 seconds |
| **Anomaly Hunter** | completing Case 3 |

### Storage

Everything lives in `localStorage` under `surgilearn.progress.v1` — player name,
attempt history, and unlocked badges. Nothing leaves the browser.

---

## Architecture

```
src/surgilearn/
  cases.ts             Case library, objectives, region metadata
  coronaryModel.ts     Procedural coronary tree + variable-radius tube geometry
  specimenLoader.ts    GLB load with procedural fallback
  regions.ts           Region binding, name matching, highlight state
  hoverProbe.ts        Screen-space cursor, raycast, 2 s dwell, reticle
  engine.ts            Objectives, timer, score, metrics — the state machine
  store.ts             localStorage: attempts, badges, leaderboard, competency
  tutor.ts             Claude Messages API call + prompt
  index.ts             Orchestrator: mode state, wiring, lifecycle
  surgilearn.css       Styling, built entirely from style.css's own variables
  ui/
    panel.ts           Shared collapsible + draggable panel chrome
    modeBar.ts         EXPLORE/CHALLENGE switch + dashboard button
    missionPanel.ts    Vignette, checklist, orientation gauge, grading, score
    feedback.ts        Region label popup, badge flash
    debriefPanel.ts    Score breakdown + AI debrief console
    dashboard.ts       Radar, badges, leaderboard, competency
```

### Changes to existing files

Kept to the minimum that made the layer possible:

| File | Change |
| --- | --- |
| `src/organs.ts` | two optional fields on `OrganDef` (`group`, `caseId`) |
| `src/ui/organSwitcher.ts` | emits `data-group`; new `setActiveOrgan()` export |
| `src/gesture/types.ts` | optional `indexTip` on `GestureSignals` |
| `src/gesture/gestureClassifier.ts` | populates `indexTip` (read-only; nothing else consumes it) |
| `src/main.ts` | appends the case library, routes case loads through the SurgiLearn loader, constructs the layer, ticks it in the render loop |
| `index.html` | one `<script src="./config.js">` tag |

The manipulation pipeline — `interactionController`, `gestureMapper`,
`modelLoader`, `scene` — was not touched.

### Verified behaviour

Checked in-browser against the running dev server:

- Case 1 full run: view objective, two identifications, one wrong grade
  (−10), correct grade, debrief, attempt persisted, two badges unlocked.
- Stenosis geometry measured directly from the vertex buffer: Case 2 mid-LAD
  0.0204 vs 0.0314 expected on the taper (−35%); Case 3 proximal RCA 0.0092
  (−75%). Case 3 ostium at `x = +0.117`, i.e. the left sinus.
- Off-target dwell flags amber and ticks nothing.
- Leaving CHALLENGE mode restores `emissive` to `0x000000` and
  `emissiveIntensity` to `1` — the values the loader produced.
- Layout free of overlap and horizontal overflow at 375, 768, 1024 and 1280 px.

---

## Performance

Hover detection is the only thing in the challenge layer that costs real time,
and the first implementation raycast the display geometry on every rendered
frame. `THREE.Raycaster` has no acceleration structure: once a ray clears a
mesh's bounding sphere it tests every triangle. Measured in-browser:

| Path | Before | After |
| --- | ---: | ---: |
| EXPLORE mode | 0.001 ms | 0.001 ms |
| CHALLENGE, cursor on a vessel | **1.31 ms** | **0.07 – 0.22 ms** |
| Scene render, for scale | 0.48 – 1.32 ms | unchanged |

At 1.31 ms the challenge layer cost more per frame than the entire 3D render,
and a 234k-triangle patient scan would have been far worse. Three changes:

1. **Coarse colliders.** Identification raycasts against ~320-triangle
   stand-ins built from the same centrelines, never drawn
   (`material.visible = false` keeps them raycastable). Two orders of magnitude
   fewer triangle tests, identical hit at the tolerance a fingertip can hold.
2. **Throttled casting.** The raycast runs at ~30 Hz instead of every frame. The
   dwell it feeds is two seconds long, and dwell time still accumulates on the
   true frame delta, so the ring fills smoothly.
3. **No per-frame layout reads.** `getBoundingClientRect()` ran twice per frame
   inside the render loop, interleaved with the panel's own DOM writes — the
   textbook layout-thrash pattern. The container is full-window, so the rect is
   cached and refreshed on resize.

---

## Deliberate design decisions

**Angiographic working views, not arbitrary camera angles.** The "navigate to
view" objective targets the RAO and LAO projections a cath-lab operator actually
uses, with a live degrees-off gauge. Rotating the heart becomes a rehearsal of
projection geometry rather than a camera puzzle.

**Identification is a dwell, not a click.** The platform's whole interaction
model is touchless, so identifying a vessel means holding a fingertip on it —
exactly what an examiner asks for at the bedside. The mouse drives the same code
path so the challenge is playable without a camera.

**The severity scale has four grades, not three.** The brief specified
`MILD/MODERATE/SEVERE`; a `NORMAL` option was added because Case 1 is a normal
study and a three-way scale would force a clinically wrong answer.

**Panel styling follows the live site, not the spec sheet.** The brief quoted
approximate panel colours; the actual tokens in `style.css`
(`--panel`, `--edge`, `--cyan`) were used instead so the new panels are
indistinguishable from the existing ones.

**The name prompt appears on first entry to CHALLENGE mode**, not at boot. A
blocking modal on load would have degraded the existing explore-mode demo for a
value only the leaderboard needs. The name is editable in the dashboard.

**Chart.js loads on demand.** It is fetched from the CDN the first time the
dashboard opens, so the offline-first payload is unchanged for anyone who never
opens it. If the CDN is unreachable — an offline teaching lab being exactly the
target environment — the radar degrades to a labelled bar read-out carrying the
same four numbers.

**Telemetry reflows on phones.** Below 700 px the HUD becomes a four-cell strip
instead of a 180 px stacked block that the existing layout pushed off the right
edge. All four metrics and their units stay live.

---

## Known limits

- **A browser-held API key is visible to the page.** Use the proxy pattern for
  anything shared. Flagged above and in `config.example.js`.
- **Gesture rotation springs back.** Withdrawing the second hand returns the
  specimen to upright, by original design — so the view objective must be held
  (0.6 s) while still in two-hand ROTATE mode. Mouse drag persists and is the
  easier path for that objective.
- **The leaderboard is per-device.** `localStorage` only; there is no server, by
  design.
- **Region proxies for unnamed GLBs are generic.** They are scaled to the
  model's bounding box from reference centrelines, so on an unusual heart the
  hover targets will be approximate. Naming the meshes binds them exactly.
- **No screenshots in this document.** The verification above was performed
  programmatically against the live DOM and WebGL scene; the browser pane was
  not compositing frames in the environment used, so no rendered image could be
  captured.

---

## Provenance

Built on Bio-Vision, the zero-footprint virtual dissection platform whose
performance envelope — 60 Hz render, ~30 fps monocular hand tracking, sub-50 ms
input latency on an Intel i3 with no discrete GPU — is reported in the EMBC 2026
submission. Those figures are the reason a simulation-based surgical curriculum
can run on the hardware a medical school already owns, and they are displayed
live in the telemetry HUD during any demonstration.
