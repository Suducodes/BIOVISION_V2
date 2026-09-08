/**
 * Wireless foot-pedal — a Seeed XIAO ESP32-S3 + FSR broadcasting
 * `{"pedal": 0.0-1.0}` over a WebSocket on port 81, roughly every 30ms.
 *
 * A dead-man's switch, not a toggle — the same convention as a real
 * electrocautery or fluoroscopy pedal: gesture control is live only while
 * the foot is actually down, not flipped on by one press and left running
 * until a second one. `onPressChange` reports that held/released state
 * directly, debounced by hysteresis — two thresholds with a gap between
 * them, rather than one, so a reading sitting right at a single boundary
 * can't flicker the state on noise alone.
 *
 * A `generation` counter (rather than nulling out event handlers) is what
 * keeps reconnects race-free: every `connect()`/`disconnect()` call bumps
 * it, and every handler closure checks its own captured generation against
 * the current one before acting. A `close` event from a socket that's since
 * been superseded — by a fresh `connect()` to a new IP, or an explicit
 * `disconnect()` — is a stale event, not a real disconnection, and this is
 * what stops it from scheduling a reconnect that fights the new connection.
 */

const PRESS_THRESHOLD = 0.5;
const RELEASE_THRESHOLD = 0.3;
const RECONNECT_DELAY_MS = 2000;
const STORAGE_KEY = 'bio-vision.pedalIp';

export interface PedalHandlers {
  /** Fires only on a genuine held/released transition, not every message. */
  onPressChange: (pressed: boolean) => void;
  onConnectionChange: (connected: boolean) => void;
}

export class PedalController {
  private ws: WebSocket | null = null;
  private pressed = false;
  private reconnectTimer: number | null = null;
  private generation = 0;

  constructor(private readonly handlers: PedalHandlers) {}

  /** Empty string disconnects without scheduling a reconnect. */
  connect(ip: string): void {
    this.generation++;
    const gen = this.generation;
    this.teardown();

    if (!ip) {
      this.handlers.onConnectionChange(false);
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, ip);
    } catch {
      /* private mode or quota — the IP just won't be remembered next visit */
    }
    this.open(ip, gen);
  }

  disconnect(): void {
    this.generation++;
    this.teardown();
    this.handlers.onConnectionChange(false);
  }

  static savedIp(): string {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private teardown(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // Every path that tears down a connection — an unexpected drop, a
    // manual disconnect, a connect() to a different IP mid-press — must
    // leave "released" behind, or the app could keep believing the foot is
    // still down against a socket that no longer exists to say otherwise.
    if (this.pressed) {
      this.pressed = false;
      this.handlers.onPressChange(false);
    }
  }

  private open(ip: string, gen: number): void {
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://${ip}:81/`);
    } catch {
      // Malformed IP, or the browser refused to construct the socket at
      // all (e.g. mixed-content on an https:// page) — same recovery path
      // as a connection that opened and then dropped.
      this.scheduleReconnect(ip, gen);
      return;
    }
    this.ws = socket;

    socket.addEventListener('open', () => {
      if (gen !== this.generation) return;
      this.handlers.onConnectionChange(true);
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (gen !== this.generation) return;
      this.handleMessage(event.data);
    });

    // 'error' on a browser WebSocket carries no usable detail (by design,
    // for security) and is always immediately followed by 'close' — so
    // 'close' alone is the complete, silent recovery path this needs.
    socket.addEventListener('close', () => {
      if (gen !== this.generation) return;
      // A drop mid-press must not leave the app believing the foot is still
      // down once the connection recovers — force back to "released" and
      // tell the caller, rather than silently trusting stale state.
      if (this.pressed) {
        this.pressed = false;
        this.handlers.onPressChange(false);
      }
      this.handlers.onConnectionChange(false);
      this.scheduleReconnect(ip, gen);
    });
  }

  private scheduleReconnect(ip: string, gen: number): void {
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (gen !== this.generation) return;
      this.open(ip, gen);
    }, RECONNECT_DELAY_MS);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let value: number;
    try {
      const parsed = JSON.parse(raw) as { pedal?: unknown };
      if (typeof parsed.pedal !== 'number' || !Number.isFinite(parsed.pedal)) return;
      value = parsed.pedal;
    } catch {
      return; // a malformed frame shouldn't take the connection down
    }

    if (!this.pressed && value > PRESS_THRESHOLD) {
      this.pressed = true;
      this.handlers.onPressChange(true);
    } else if (this.pressed && value < RELEASE_THRESHOLD) {
      this.pressed = false;
      this.handlers.onPressChange(false);
    }
  }
}
