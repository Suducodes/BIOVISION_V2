/**
 * Wireless foot-pedal over BLE — same XIAO ESP32-S3 + FSR, same
 * `{"pedal": 0.0-1.0}` payload and dead-man's-switch semantics as
 * pedalController.ts's WiFi transport, just carried over a GATT
 * notify characteristic instead of a WebSocket. This exists because a
 * conference/demo WiFi network is exactly the kind of thing that can go
 * bad mid-talk — BLE is a direct point-to-point link that doesn't touch the
 * venue network at all. WiFi stays available as a fallback (pedalController.ts,
 * unchanged) for anyone whose browser lacks Web Bluetooth support (Chrome/Edge
 * only — no Safari, no Firefox) or who'd rather not deal with pairing.
 *
 * Web Bluetooth requires a real user gesture (a click) to call
 * `requestDevice()` the first time — that's why `connect()` here can only be
 * invoked from a button handler, never auto-triggered at boot the way the
 * WiFi controller's saved-IP auto-connect is. Once paired, though, the
 * `BluetoothDevice` object is kept in memory and `gatt.connect()` can be
 * retried without another prompt, which is what the reconnect loop uses.
 */

import type { PedalHandlers } from './pedalController';

const PRESS_THRESHOLD = 0.5;
const RELEASE_THRESHOLD = 0.3;
const RECONNECT_DELAY_MS = 2000;

// Randomly generated, just needs to match the firmware's BLEService/
// BLECharacteristic UUIDs in firmware/pedal/pedal_ble.ino.
export const PEDAL_SERVICE_UUID = 'b91d7b50-2ec1-4dd4-8078-3a0f827c1a3e';
export const PEDAL_CHARACTERISTIC_UUID = 'b91d7b51-2ec1-4dd4-8078-3a0f827c1a3e';

export class BlePedalController {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private pressed = false;
  private reconnectTimer: number | null = null;
  private generation = 0;
  private readonly onValueChanged = (event: Event) => {
    const target = event.currentTarget as BluetoothRemoteGATTCharacteristic;
    this.handleValue(target.value);
  };
  private readonly onGattDisconnected = () => this.handleDisconnect(this.generation);

  constructor(private readonly handlers: PedalHandlers) {}

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!navigator.bluetooth;
  }

  /** Must be called from a user-gesture handler (a click) — see file header. */
  async connect(): Promise<void> {
    if (!BlePedalController.isSupported()) {
      this.handlers.onConnectionChange(false);
      return;
    }

    this.generation++;
    const gen = this.generation;
    this.teardown();

    try {
      const device = await navigator.bluetooth!.requestDevice({
        filters: [{ services: [PEDAL_SERVICE_UUID] }],
      });
      if (gen !== this.generation) return; // superseded while the chooser was open
      this.device = device;
      device.addEventListener('gattserverdisconnected', this.onGattDisconnected);
      await this.openGatt(gen);
    } catch {
      // User cancelled the device chooser, or no matching device found —
      // not a failure worth retrying automatically.
      if (gen === this.generation) this.handlers.onConnectionChange(false);
    }
  }

  disconnect(): void {
    this.generation++;
    this.teardown();
    this.handlers.onConnectionChange(false);
  }

  private async openGatt(gen: number): Promise<void> {
    if (!this.device?.gatt) return;
    try {
      const server = await this.device.gatt.connect();
      if (gen !== this.generation) {
        server.disconnect();
        return;
      }
      const service = await server.getPrimaryService(PEDAL_SERVICE_UUID);
      const characteristic = await service.getCharacteristic(PEDAL_CHARACTERISTIC_UUID);
      if (gen !== this.generation) return;
      this.characteristic = characteristic;
      characteristic.addEventListener('characteristicvaluechanged', this.onValueChanged);
      await characteristic.startNotifications();
      if (gen !== this.generation) return;
      this.handlers.onConnectionChange(true);
    } catch {
      if (gen !== this.generation) return;
      this.handlers.onConnectionChange(false);
      this.scheduleReconnect(gen);
    }
  }

  private handleDisconnect(gen: number): void {
    if (gen !== this.generation) return;
    if (this.pressed) {
      this.pressed = false;
      this.handlers.onPressChange(false);
    }
    this.handlers.onConnectionChange(false);
    this.scheduleReconnect(gen);
  }

  private scheduleReconnect(gen: number): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (gen !== this.generation) return;
      void this.openGatt(gen);
    }, RECONNECT_DELAY_MS);
  }

  private teardown(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.characteristic) {
      this.characteristic.removeEventListener('characteristicvaluechanged', this.onValueChanged);
      this.characteristic = null;
    }
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
      if (this.device.gatt?.connected) this.device.gatt.disconnect();
      this.device = null;
    }
    if (this.pressed) {
      this.pressed = false;
      this.handlers.onPressChange(false);
    }
  }

  private handleValue(value: DataView | undefined): void {
    if (!value) return;
    const raw = new TextDecoder().decode(value.buffer);
    let pedal: number;
    try {
      const parsed = JSON.parse(raw) as { pedal?: unknown };
      if (typeof parsed.pedal !== 'number' || !Number.isFinite(parsed.pedal)) return;
      pedal = parsed.pedal;
    } catch {
      return; // a malformed notification shouldn't take the connection down
    }

    if (!this.pressed && pedal > PRESS_THRESHOLD) {
      this.pressed = true;
      this.handlers.onPressChange(true);
    } else if (this.pressed && pedal < RELEASE_THRESHOLD) {
      this.pressed = false;
      this.handlers.onPressChange(false);
    }
  }
}
