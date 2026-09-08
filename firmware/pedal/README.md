# Wireless pedal — XIAO ESP32-S3 + FSR

Two interchangeable firmware/transport pairs, same sensor circuit, same
`{"pedal": 0.0-1.0}` payload shape, same dead-man's-switch semantics on the
browser side — gesture control is live only while the reading stays above
~0.5, and drops the instant it falls back below ~0.3. Neither firmware makes
that decision; they only report an honest, reasonably clean 0..1 reading.

- **`pedal_ble.ino`** — BLE, the recommended default. A direct link to the
  browser that never touches the venue's WiFi at all, so it isn't affected by
  bad conference/demo WiFi. Requires Chrome or Edge (Web Bluetooth isn't
  supported in Safari or Firefox).
- **`pedal.ino`** — WiFi/WebSocket, the fallback for browsers without Web
  Bluetooth. Needs the XIAO and the laptop on the same WiFi network.

The app ([`src/main.ts`](../../src/main.ts)) offers both as separate connect
buttons in the pedal panel; connecting either one automatically disconnects
the other, so only one is ever driving gesture control at a time.

## Wiring — identical for both firmwares, two wires, no discrete resistor

```
XIAO 3V3 ──[FSR]── D0
```

- FSR leg 1 → **3V3**
- FSR leg 2 → **D0**

`D0` is set `INPUT_PULLDOWN` in both sketches, so the chip's own internal
pulldown resistor completes the voltage divider — one fewer physical part
than a discrete resistor, at the cost of a higher, less predictable divider
resistance. That's why both sketches calibrate a `baseline` at boot instead
of assuming fixed raw-ADC bounds.

**Power**: LiPo red → **VUSB**, black → **GND**. This powers the board
directly off the battery. Worth knowing: it bypasses the XIAO's onboard JST
charge-management circuit, so the battery won't recharge through this wiring
even with USB-C also plugged in — charge it separately (via the JST
connector, or swap it out) if it runs low.

## Flashing — BLE (`pedal_ble.ino`, recommended)

1. Arduino IDE 2.x, with the `esp32` board package installed (Boards Manager
   URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`).
2. Board: **XIAO_ESP32S3**. Port: whatever it enumerates as over USB-C.
3. No extra library needed — "ESP32 BLE Arduino" ships with the esp32 board
   package. No WiFi credentials involved, so `pedal_ble.ino` has nothing
   secret in it and is committed to the repo as-is (unlike `pedal.ino`,
   below).
4. Upload `pedal_ble.ino` directly.
5. Open the Serial Monitor at 115200 baud. It prints `Baseline: <n>` (the
   resting reading it just calibrated — make sure nothing was touching the
   pedal while it booted), then starts advertising as **"BioVision Pedal"**.

## Flashing — WiFi fallback (`pedal.ino`)

1. Same Arduino IDE / board package / board selection as above.
2. Library: **WebSockets** by Markus Sattler / Links2004 (Library Manager).
3. **Copy `pedal.ino.example` to `pedal.ino`** and fill in your real WiFi
   SSID/password there — `pedal.ino` is gitignored specifically so a real
   password never lands in the (public) repo; `.example` is the only version
   that's ever committed. Upload `pedal.ino`.
4. Open the Serial Monitor at 115200 baud. It prints `Baseline: <n>` and then
   the assigned IP address. That IP is what goes in the app's "pedal IP"
   field.

## Connecting the app to it

**BLE:**
1. Start the dev server, open the app in **Chrome or Edge**.
2. Power on the pedal, then click **Connect Bluetooth** in the pedal panel.
   The browser's device chooser appears — pick **"BioVision Pedal"**.
   (This first pairing needs a real click; Web Bluetooth won't let a page
   trigger it automatically. Once granted, the app reconnects to the same
   device on its own if the link drops mid-demo.)
3. The indicator should read **PEDAL LIVE (BT)**.

**WiFi:**
1. In the pedal panel, type the XIAO's IP (the one the Serial Monitor
   printed — no `ws://`, no port, just the IP) and click **Connect**.
2. The indicator should read **PEDAL LIVE (WiFi)**.

**Either way:** press and hold the pedal — **GESTURE PAUSED** should switch
to **GESTURE LIVE** for as long as you keep pressure on it, and drop back to
**GESTURE PAUSED** the moment you lift your foot. It's a dead-man's switch,
not a toggle: nothing about gesture control should outlast the actual press.

## Troubleshooting

- **Baseline calibration seems off / pedal never reads fully "unpressed"** —
  something was touching the pedal when it booted. Power-cycle with it clear.
  Applies to both firmwares.
- **"Connect Bluetooth" is greyed out** — the browser has no Web Bluetooth
  support. Use Chrome or Edge, or fall back to the WiFi connection below it.
- **BLE device chooser doesn't list "BioVision Pedal"** — confirm the XIAO
  actually finished booting (check the Serial Monitor for the "BLE
  advertising…" line) and that it's within a few meters — unlike WiFi, BLE
  range is short by design.
- **App shows "PEDAL CONNECTING… (WiFi)" forever** — confirm the XIAO and
  the laptop are on the *same* WiFi network (not the laptop on a separate
  5GHz or guest network the XIAO doesn't join). Check the Serial Monitor
  actually printed an IP before assuming it's a browser-side problem. This
  is exactly the failure mode BLE avoids — if it keeps happening on-site,
  switch to `pedal_ble.ino` rather than debugging the venue's network.
- **Presses feel sluggish to register** — that's the firmware's own
  `smoothing`/`deadband` blend, not the browser side; tighten `smoothing`
  (higher = snappier) or loosen `deadband` in whichever `.ino` is flashed if
  it feels too slow.
- **Gesture control flickers on/off despite a steady press, or never
  activates at all** — that's the browser-side `PRESS_THRESHOLD`/
  `RELEASE_THRESHOLD` (in `pedalController.ts` for WiFi, `blePedalController.ts`
  for BLE), not the firmware.
