/**
 * Bio-Vision wireless pedal — BLE transport, XIAO ESP32-S3 + FSR.
 *
 * Same sensor circuit, same calibration/smoothing/deadband logic, and the
 * same {"pedal": 0.0-1.0} payload shape as pedal.ino's WiFi version — only
 * the transport changes, from a WebSocket to a BLE GATT notify
 * characteristic. Use this one when the venue's WiFi can't be trusted for a
 * live demo: BLE is a direct link to the browser that never touches the
 * network at all. No WiFi credentials involved, so unlike pedal.ino this
 * file has nothing secret in it and is committed as-is.
 *
 * Library required: "ESP32 BLE Arduino" — bundled with the esp32 board
 * package (Boards Manager), nothing extra to install via Library Manager.
 *
 * Wiring — identical to pedal.ino:
 *   XIAO 3V3 -> FSR leg 1
 *   FSR leg 2 -> XIAO D0
 * D0 is INPUT_PULLDOWN below, using the chip's internal pulldown resistor
 * instead of a discrete one to complete the voltage divider.
 *
 * Power: LiPo red -> VUSB, black -> GND (bypasses the onboard JST charge
 * circuit — charge the battery separately if it runs low).
 *
 * Pairing: the browser side (src/input/blePedalController.ts) filters by
 * SERVICE_UUID below, so it must match exactly on both sides.
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "b91d7b50-2ec1-4dd4-8078-3a0f827c1a3e"
#define CHARACTERISTIC_UUID "b91d7b51-2ec1-4dd4-8078-3a0f827c1a3e"

BLEServer* server = nullptr;
BLECharacteristic* pedalCharacteristic = nullptr;
bool deviceConnected = false;

const int fsrPin = D0;
int baseline = 0;

float smoothed = 0;
const float smoothing = 0.08;
const float deadband = 0.03;

unsigned long lastSample = 0;
const int sampleIntervalMs = 30;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    deviceConnected = true;
    Serial.println("client connected");
  }
  void onDisconnect(BLEServer* s) override {
    deviceConnected = false;
    Serial.println("client disconnected — advertising again");
    s->getAdvertising()->start(); // resume advertising so the app can reconnect
  }
};

void setup() {
  Serial.begin(115200);
  analogSetAttenuation(ADC_11db);
  pinMode(fsrPin, INPUT_PULLDOWN);

  // Baseline calibration on boot: assumes the pedal is untouched at power-on,
  // same caveat as pedal.ino — power-cycle with it clear if it never reads
  // "unpressed" after connecting.
  long sum = 0;
  for (int i = 0; i < 20; i++) { sum += analogRead(fsrPin); delay(20); }
  baseline = sum / 20;
  Serial.print("Baseline: ");
  Serial.println(baseline);

  BLEDevice::init("BioVision Pedal");
  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  pedalCharacteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pedalCharacteristic->addDescriptor(new BLE2902()); // required for notify subscriptions
  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();
  Serial.println("BLE advertising as \"BioVision Pedal\"");
}

void loop() {
  if (!deviceConnected) return;

  unsigned long now = millis();
  if (now - lastSample >= sampleIntervalMs) {
    lastSample = now;

    int raw = analogRead(fsrPin);
    float pedal = (float)(raw - baseline) / (4095 - baseline);
    pedal = constrain(pedal, 0.0f, 1.0f);

    float diff = pedal - smoothed;
    if (abs(diff) > deadband) {
      smoothed = smoothed + smoothing * diff;
    }

    char msg[32];
    snprintf(msg, sizeof(msg), "{\"pedal\":%.3f}", smoothed);
    pedalCharacteristic->setValue((uint8_t*)msg, strlen(msg));
    pedalCharacteristic->notify();
  }
}
