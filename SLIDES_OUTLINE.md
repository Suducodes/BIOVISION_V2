# SurgiLearn — 5-Slide Submission Deck Outline

**2026 IEEE Metaverse Grand Challenge for Simulation-Based Learning**
Theme 1 — Healthcare Applications in Digital Learning

---

## Criteria coverage map

Every criterion has a primary slide that owns it and a secondary slide that
reinforces it, so no weighted category depends on a single moment of the pitch.

| Criterion | Weight | Primary | Reinforced on |
| --- | --- | --- | --- |
| Simulation-Based Learning Effectiveness | 25% | **Slide 2** | Slide 4 |
| Creativity & Innovation | 20% | **Slide 3** | Slide 1 |
| Educational Impact | 20% | **Slide 4** | Slide 2 |
| UI/UX & Engagement | 15% | **Slide 5** | Slide 2 |
| AI / Gamification / Adaptive Learning | 10% | **Slide 4** | Slide 5 |
| Sustainability / Accessibility / Ethics | 10% | **Slide 5** | Slide 1 |

Slide time budget for a 10-minute pitch: **1 · 1.5 min — 2 · 2.5 min —
3 · 2 min — 4 · 2 min — 5 · 2 min.**

---

## Slide 1 — The gap, and the machine that closes it

**Headline:** *Surgical anatomy is taught on hardware most schools cannot buy.*

**Body**

- Cadaveric dissection: scarce, expensive, ethically constrained, not repeatable.
- VR simulators: £2–20k per seat, a headset per student, an IT procurement cycle,
  and a room to use them in.
- Result: the students who most need repetition get the least of it.
- **SurgiLearn runs in a browser tab.** No install, no headset, no login, no
  server. A laptop with a webcam is the entire hardware requirement.
- Built on **Bio-Vision**, a peer-reviewed monocular gesture-controlled anatomy
  platform (EMBC 2026): **60 Hz render, ~30 fps hand tracking, sub-50 ms input
  latency on an Intel i3 with no discrete GPU.**

**Visual:** split frame — left, a photo-style block captioned "£12,000 / seat,
1 student at a time"; right, a browser window on a low-end laptop captioned
"£0 / seat, every student at once". Live telemetry HUD visible in the right pane.

**Speaker note:** open by naming the constraint, not the technology. The
performance numbers are the credibility anchor — they are on screen live
throughout the demo, so the claim is demonstrated rather than asserted.

---

## Slide 2 — The simulation loop *(Simulation-Based Learning Effectiveness — 25%)*

**Headline:** *A case, not a model viewer.*

**Body — the four-step loop, shown as a cycle diagram**

1. **Read the case.** "65M, chest pain on exertion, referred to the cath lab.
   Identify the culprit vessel." A clinical vignette, not a label quiz.
2. **Orient.** Rotate the specimen into the **RAO or LAO angiographic working
   view** — the real projections a cath-lab operator angulates to — with a live
   degrees-off gauge and a hold requirement.
3. **Identify.** Hold your **index fingertip** over the vessel for two seconds.
   The reticle ring closes, the vessel glows, and only *then* is it named. No
   click, no controller, no answer given away early.
4. **Decide.** Grade the lesion `NORMAL / MILD / MODERATE / SEVERE` — the
   decision that actually drives management.

**Why it transfers**

- Three cases escalate: normal baseline → mild mid-LAD plaque → **anomalous RCA
  origin from the left coronary sinus with an interarterial course**, the lesion
  that kills young athletes.
- Each case is timed, scored, and repeatable to convergence. Deliberate practice
  needs a tight loop; this one is about 60 seconds long.

**Visual:** the four-step cycle, with a screenshot of the mission panel mid-run —
one objective ticked, one charging, the orientation gauge reading "12° OFF".

**Speaker note:** the strongest single line here is *"the vessel is not named
until the dwell completes"* — it is the difference between assessment and a
labelled diagram.

---

## Slide 3 — What is new here *(Creativity & Innovation — 20%)*

**Headline:** *Three things that did not exist before this build.*

**1 · Dwell-to-identify as an assessment primitive**
Monocular hand tracking already gave us move / rotate / zoom. SurgiLearn adds a
*read-only* fingertip cursor: pointing at anatomy never disturbs manipulation, so
one hand does both. Identification becomes the gesture an examiner actually asks
for — "show me the LAD" — instead of a mouse click.

**2 · Procedurally generated pathological anatomy**
The coronary tree is generated in the browser from parametric centrelines, with
the **lumen radius as a function of arc length**. A stenosis is therefore a
*genuine geometric narrowing with plaque shoulders*, not a coloured marker —
measured from the vertex buffer at **−35% diameter** (Case 2) and **−75%**
(Case 3). Case 3 re-routes the RCA ostium to the left sinus with an interarterial
course. Cases can be authored as parameters, not modelled by hand.

**3 · Zero-asset deployability**
Patient-derived GLBs drop into `/models/coronary/` and take over automatically.
Until they do, the procedural tree plays every objective. **The curriculum ships
before the data does** — which is what lets a teaching hospital pilot it in an
afternoon.

**Visual:** three panels — a hand with a reticle closing on a vessel; a
cross-section diagram of the narrowing lumen with the measured radii annotated;
a folder icon with `case2.glb` dropping in and the model swapping.

**Speaker note:** if time is short, lead with #2 — it is the claim judges are
least likely to have seen elsewhere, and it is measurable on screen.

---

## Slide 4 — From score to understanding *(Educational Impact — 20% · AI & Gamification — 10%)*

**Headline:** *A score tells you that you missed. A tutor tells you why it mattered.*

**The debrief**
On completion, the case is sent to **Claude (`claude-opus-5`)** with the
vignette, the tasks completed and missed, the time, the score and the grade
given. It returns a three-paragraph clinical debrief: what the student did well,
what they missed **and why it matters clinically**, and one key anatomical
learning point for that case. It renders as a console read-out, typed in live.

**Transparent, teachable scoring**
100 points. **−2 per 10 seconds. −10 per incorrect grade.** Visible on the panel
as it happens, so the student can see the cost of hesitation and of guessing.

**A competency profile, not a leaderboard rank**

| Axis | What it exposes |
| --- | --- |
| Speed | hesitation under time pressure |
| Accuracy | overall case performance |
| **Identification** | precision — dwelling on vessels the case never asked about |
| **Classification** | grading judgement, separated from everything else |

Radar chart over best runs → **NOVICE → INTERMEDIATE → PROFICIENT**. A student
who is fast but grades badly and one who is slow but precise get *different*
shapes, and different advice.

**Gamification with a purpose:** First Case, Perfect Score, Speed Surgeon
(< 60 s), **Anomaly Hunter** — the last of which exists specifically to pull
students into the hardest, rarest, most clinically consequential case.

**Visual:** debrief panel with real Claude output on the left; radar chart with
two contrasting student profiles overlaid on the right.

**Speaker note:** the two-overlaid-profiles graphic is the argument — it shows
the platform diagnosing *how* a student is weak, not just *that* they are.

---

## Slide 5 — Designed to be used, and to be shared *(UI/UX — 15% · Sustainability, Accessibility & Ethics — 10%)*

**Headline:** *The accessibility argument is the architecture.*

**UI/UX & engagement**

- One visual language throughout: monospace, `#030710`, cyan accent. The
  challenge panels are indistinguishable from the platform they extend.
- Every panel is **collapsible and draggable** — a HUD over a 3D scene must get
  out of the way.
- Feedback is continuous, never binary: dwell rings close, objective rows charge,
  the orientation gauge counts down degrees. The student always knows the system
  has registered them.
- Verified free of overlap and horizontal overflow at **375 / 768 / 1024 /
  1280 px**; on phones the telemetry reflows to a four-cell strip with every
  metric still live.

**Sustainability**

- No headset to manufacture, ship, or replace. No per-seat hardware.
- One static bundle on GitHub Pages; the marginal cost of the next student is a
  page load. Runs on hardware schools already own — the i3-with-no-GPU figure is
  a sustainability claim as much as a performance one.

**Accessibility**

- Works on any device with a browser and a webcam; mouse input drives the same
  code path when there is no camera.
- Zero install and zero login removes the IT-procurement and account-provisioning
  barriers that keep tools out of under-resourced institutions.
- Chart.js degrades to a text read-out when offline — an offline teaching lab is
  a target environment, not an edge case.

**Ethics**

- **All learner data stays in the browser.** Names, scores and attempt history
  live in `localStorage`; nothing is transmitted. No account, no tracking, no
  data-processing agreement — a student's mistakes never leave the machine they
  made them on.
- The only outbound request is the debrief, and it carries case performance —
  never identity.
- Reduces reliance on cadaveric material for repetitive identification practice.

**Roadmap:** patient-derived CTA cases from the author's own segmentation
pipeline · adaptive case selection driven by the weakest radar axis · instructor
cohort view built from exported local records.

**Visual:** full-bleed screenshot of the platform mid-challenge with the
telemetry HUD legible, and a three-icon strip — *no headset · no install · no
data leaves the device*.

**Speaker note:** close on the ethics line. "Nothing leaves the browser" is a
one-sentence answer to the question every institution asks before adopting an
educational tool, and it is a property of the architecture rather than a policy.

---

## Appendix — figures to prepare

| # | Figure | Source |
| --- | --- | --- |
| A | Mission panel mid-run, one objective charging | Live capture, Case 2 |
| B | Reticle dwell sequence, three frames | Live capture |
| C | Lumen radius vs arc length, with measured stenosis | Plot from the vertex-buffer measurements in `README_SURGILEARN.md` |
| D | Case 3 anomalous RCA course, annotated | Live capture, RAO view |
| E | Debrief console with real Claude output | Live capture with a key configured |
| F | Radar chart, two contrasting learner profiles | Dashboard, two seeded histories |
| G | Telemetry HUD at 60 Hz / 30 fps / <50 ms | Live capture on the i3 test machine |

## Appendix — one-line pitch

> *SurgiLearn turns a browser tab and a webcam into a coronary cath-lab
> simulator: read the case, angulate to the working view, point at the culprit
> vessel, grade the lesion, and get an AI clinical debrief — with no headset, no
> install, and no student data ever leaving the device.*
