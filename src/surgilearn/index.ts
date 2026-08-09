import type * as THREE from 'three';
import type { Stage } from '../render/scene';
import type { OrganDef } from '../organs';
import { CASES, findCase, type CoronaryCase, type RegionId, type Severity } from './cases';
import { ChallengeEngine, type CaseResult } from './engine';
import { HoverProbe } from './hoverProbe';
import { bindRegions, type RegionSet } from './regions';
import { ProgressStore } from './store';
import { Dashboard } from './ui/dashboard';
import { DebriefPanel } from './ui/debriefPanel';
import { BadgeFlash, RegionLabel } from './ui/feedback';
import { MissionPanel } from './ui/missionPanel';
import { ModeBar, type Mode } from './ui/modeBar';
import { AnchorPicker } from './ui/anchorPicker';
import { element } from './ui/panel';
import './surgilearn.css';

export { CORONARY_SPECIMENS, CASES } from './cases';

export interface SurgiLearnHost {
  stage: Stage;
  /** Root element the panels are appended to. */
  root: HTMLElement;
  /** Element the top bar lives in, for the mode switch. */
  topBar: HTMLElement;
  /** Asks the app to load a specimen by id; resolves once it is on screen. */
  requestSpecimen(id: string): Promise<void>;
}

/**
 * The SurgiLearn layer.
 *
 * Owns every piece of challenge state. Explore mode holds none of it: the
 * engine is constructed on entry to challenge mode and torn down on exit, the
 * hover probe only raycasts while a challenge is running, and region highlights
 * are restored to the specimen's original materials when the mode ends. That
 * separation is what keeps the original Bio-Vision behaviour byte-for-byte
 * intact when the toggle is set to EXPLORE.
 */
export class SurgiLearn {
  private readonly store = new ProgressStore();
  private readonly probe: HoverProbe;
  private readonly mission: MissionPanel;
  private readonly dashboard: Dashboard;
  private readonly debrief: DebriefPanel;
  private readonly label: RegionLabel;
  private readonly badges: BadgeFlash;
  private readonly modeBar: ModeBar;

  private readonly picker: AnchorPicker;

  private mode: Mode = 'EXPLORE';
  private engine: ChallengeEngine | undefined;
  private regions: RegionSet | undefined;
  private activeCase: CoronaryCase | undefined;
  private specimen: THREE.Object3D | undefined;
  private specimenOrigin: 'glb' | 'procedural' = 'procedural';
  private foundRegions = new Set<RegionId>();
  private switching = false;

  constructor(private readonly host: SurgiLearnHost) {
    // Measured and mounted against #app rather than #viewport: the viewport
    // owns a stacking context and paints a vignette over its own children, so
    // a reticle parented there would be dimmed at the edges of the frame.
    this.probe = new HoverProbe(host.stage.camera, host.root);

    this.mission = new MissionPanel(host.root, (answer) => this.onClassify(answer));
    this.dashboard = new Dashboard(host.root, this.store);
    this.debrief = new DebriefPanel(host.root, {
      onNext: () => void this.nextCase(),
      onRetry: () => this.retry(),
      onClose: () => this.debrief.hide(),
    });
    this.label = new RegionLabel(host.root);
    this.badges = new BadgeFlash(host.root);
    this.modeBar = new ModeBar(host.topBar, {
      onMode: (mode) => void this.setMode(mode),
      onDashboard: () => this.dashboard.toggle(),
    });
    this.picker = new AnchorPicker(
      host.root,
      host.stage.camera,
      () => this.specimen,
      host.stage.pivot,
      () => this.rebindRegions(),
    );

    // The top bar wraps on narrow screens, so its height is only knowable at
    // runtime. Publishing it as a custom property lets the left-rail panels
    // anchor below whatever it actually became instead of guessing.
    const publishTopBarHeight = () => {
      host.root.style.setProperty(
        '--sl-topbar-h',
        `${Math.round(host.topBar.getBoundingClientRect().height)}px`,
      );
    };
    new ResizeObserver(publishTopBarHeight).observe(host.topBar);
    publishTopBarHeight();

    const canvas = host.stage.renderer.domElement;
    canvas.addEventListener('pointermove', (event) => {
      if (this.mode === 'CHALLENGE') this.probe.setPointer(event.clientX, event.clientY);
    });
    canvas.addEventListener('pointerleave', () => this.probe.clearPointer());
    canvas.addEventListener('click', (event) => {
      if (!this.picker.isArmed) return;
      const rect = canvas.getBoundingClientRect();
      this.picker.handleClick(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    });
  }

  /** Latest index-fingertip position from the gesture pipeline, if any. */
  setGestureTip(tip: { x: number; y: number } | undefined): void {
    if (this.mode === 'CHALLENGE') this.probe.setGestureTip(tip);
  }

  /** Called by the app after every specimen swap. */
  onSpecimenLoaded(organ: OrganDef, root: THREE.Object3D, origin: 'glb' | 'procedural'): void {
    this.regions?.dispose();
    this.regions = undefined;
    this.foundRegions.clear();
    this.specimen = root;
    this.specimenOrigin = origin;

    const def = findCase(organ.caseId);
    this.activeCase = def;
    this.picker.hide();

    if (!def) {
      // A non-coronary specimen has no mission, so challenge mode cannot apply.
      if (this.mode === 'CHALLENGE') void this.setMode('EXPLORE');
      return;
    }

    this.picker.mount(def);
    this.regions = bindRegions(def, this.host.stage.pivot, origin);
    if (new URLSearchParams(location.search).has('anchors')) this.picker.show();
    if (this.mode === 'CHALLENGE') this.startChallenge(def);
  }

  /** Re-derives hover regions after anchors were placed or cleared. */
  private rebindRegions(): void {
    if (!this.activeCase) return;
    this.regions?.dispose();
    this.foundRegions.clear();
    this.regions = bindRegions(this.activeCase, this.host.stage.pivot, this.specimenOrigin);
    this.applyMappingNotice();
  }

  /**
   * A real scan scored against reference centrelines would mark a student wrong
   * for pointing at the right vessel, so say so rather than let it slide.
   */
  private applyMappingNotice(): void {
    if (this.mode !== 'CHALLENGE' || !this.regions?.unmapped) {
      this.mission.setNotice(null);
      return;
    }
    this.mission.setNotice(
      `${this.regions.synthesised.join(', ')} not yet labelled on this scan — ` +
        'hover targets are reference anatomy.',
      { label: '📍 LABEL VESSELS', run: () => this.picker.toggle() },
    );
  }

  /** @param deltaMs milliseconds since the previous rendered frame */
  update(deltaMs: number): void {
    this.regions?.update(deltaMs / 1000);

    if (this.mode !== 'CHALLENGE' || !this.engine) {
      this.probe.hide();
      return;
    }

    const hover = this.probe.update(deltaMs, this.regions);
    const rotation = this.host.stage.pivot.rotation;
    const snapshot = this.engine.update(deltaMs, {
      yaw: rotation.y,
      pitch: rotation.x,
      hover,
    });

    this.paintRegions(hover.region, hover.progress);
    this.mission.render(snapshot);
  }

  private async setMode(mode: Mode): Promise<void> {
    if (mode === this.mode || this.switching) return;

    if (mode === 'EXPLORE') {
      this.mode = 'EXPLORE';
      this.modeBar.setMode('EXPLORE');
      this.teardownChallenge();
      return;
    }

    this.mode = 'CHALLENGE';
    this.modeBar.setMode('CHALLENGE');
    this.promptForName();

    if (!this.activeCase) {
      // Entering the challenge from the heart or lungs drops the learner into
      // the first coronary case rather than asking them to find it.
      await this.loadCase(CASES[0]!.id);
      return;
    }
    this.startChallenge(this.activeCase);
  }

  private startChallenge(def: CoronaryCase): void {
    this.teardownEngine();
    this.foundRegions.clear();
    this.regions?.clear();
    this.label.hide();
    this.debrief.hide();

    // The specimen log occupies the mission panel's slot; collapse it so the
    // two never fight for the left rail.
    document.getElementById('notes')?.classList.add('collapsed');
    document.getElementById('notes-head')?.setAttribute('aria-expanded', 'false');

    this.engine = new ChallengeEngine(def, {
      onObjective: (objective) => {
        if (objective.kind !== 'identify') return;
        const region = def.objectives.find(
          (o) => o.kind === 'identify' && o.id === objective.id,
        );
        if (region && region.kind === 'identify') {
          this.foundRegions.add(region.region);
          this.label.show(region.region, 'correct');
        }
      },
      onOffTarget: (region) => this.label.show(region, 'off-target'),
      onComplete: (result) => this.finish(result),
    });

    this.mission.mount(def);
    this.mission.show();
    this.applyMappingNotice();
    this.debrief.setNextLabel(this.isLastCase(def) ? 'START OVER →' : 'NEXT CASE →');
  }

  private teardownChallenge(): void {
    this.teardownEngine();
    this.mission.setNotice(null);
    this.mission.hide();
    this.debrief.hide();
    this.label.hide();
    this.probe.hide();
    this.regions?.clear();
    this.foundRegions.clear();
  }

  private teardownEngine(): void {
    this.engine = undefined;
  }

  private onClassify(answer: Severity): void {
    if (!this.engine) return;
    if (this.engine.classify(answer)) this.mission.markCorrect(answer);
    else this.mission.markWrong(answer);
  }

  private finish(result: CaseResult): void {
    const unlocked = this.store.record(result);
    this.probe.hide();
    this.label.hide();
    if (unlocked.length > 0) this.badges.enqueue(unlocked);
    if (this.dashboard.visible) this.dashboard.refresh();
    void this.debrief.present(result);
  }

  private retry(): void {
    this.debrief.hide();
    if (this.activeCase) this.startChallenge(this.activeCase);
  }

  private async nextCase(): Promise<void> {
    this.debrief.hide();
    const index = this.activeCase ? CASES.findIndex((c) => c.id === this.activeCase!.id) : -1;
    const next = CASES[(index + 1) % CASES.length]!;
    await this.loadCase(next.id);
  }

  private async loadCase(id: string): Promise<void> {
    this.switching = true;
    try {
      await this.host.requestSpecimen(id);
    } finally {
      this.switching = false;
    }
  }

  private isLastCase(def: CoronaryCase): boolean {
    return CASES[CASES.length - 1]?.id === def.id;
  }

  /**
   * Highlight bookkeeping: found regions hold a steady glow (orange for a
   * lesion), the region under the cursor pulses while the dwell accumulates,
   * everything else stays as the specimen shipped.
   */
  private paintRegions(hovered: RegionId | null, progress: number): void {
    if (!this.regions) return;
    for (const region of this.regions.regions) {
      if (this.foundRegions.has(region.id)) {
        region.setState(region.id === 'STENOSIS' ? 'lesion' : 'found');
      } else if (region.id === hovered && progress > 0) {
        region.setState('dwell');
      } else {
        region.setState('none');
      }
    }
  }

  /** First run only: the leaderboard needs something to attribute scores to. */
  private promptForName(): void {
    if (this.store.player) return;

    const overlay = element('div', 'sl-name-prompt');
    const card = element('form', 'sl-name-card');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.placeholder = 'e.g. A. Vasanthakumar';
    input.autocomplete = 'off';
    const submit = element('button', 'sl-button primary', 'BEGIN →');
    submit.type = 'submit';

    card.append(
      element('h2', undefined, 'IDENTIFY YOURSELF'),
      element('p', undefined, 'Your name labels your scores on this device. Nothing leaves the browser.'),
      input,
      submit,
    );
    card.addEventListener('submit', (event) => {
      event.preventDefault();
      this.store.setPlayer(input.value || 'GUEST');
      overlay.remove();
    });

    overlay.append(card);
    this.host.root.append(overlay);
    input.focus();
  }
}
