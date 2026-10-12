# DueNext CYD display

Optional USB calendar display for the [DueNext dashboard](../planner/README.md).
Firmware: [`DueNextCYD/DueNextCYD.ino`](DueNextCYD/DueNextCYD.ino).

## Connect

1. Connect an ESP32-2432S028R CYD with a USB data cable.
2. Open DueNext in desktop Chrome or Edge, then **Connections → Connect CYD**.
3. Select the USB serial device. Up to 48 unfinished dated items are sent.
4. Tap the left/right sides to browse the agenda.

Changes sync while the app is open and USB is connected, with a heartbeat every
30 seconds. Provider credentials are never sent to the board. The display retains
its last calendar in flash; reconnect after full power loss to set its clock.
This firmware uses USB updates. Safari and mobile browsers do not support this flow.

## Hardware and build

ESP32-2432S028R, 320×240 landscape, ILI9341 and XPT2046 resistive touch.
Display SPI: SCK 14, MISO 12, MOSI 13, CS 15, DC 2, backlight 21.
Touch SPI: SCK 25, MISO 39, MOSI 32, CS 33, IRQ 36.

Install Arduino CLI and ESP32 Arduino core 3.3.10. Libraries used: Adafruit
ILI9341 1.6.3, Adafruit GFX 1.12.6, XPT2046_Touchscreen 1.4.0, ArduinoJson 7.4.3.
The config stores local libraries in the ignored `.arduino-libraries/` folder.
From the repository root, compile with:

```sh
arduino-cli --config-file cyd/arduino-cli.yaml compile \
  --fqbn esp32:esp32:esp32 --output-dir cyd/build cyd/DueNextCYD
```

Compilation does not flash the device. Use 115200 baud for uploads.
`backup_device.py` requires esptool; `check_device.py` requires pyserial. Both
helpers use `/dev/cu.wchusbserial210`; change that port to your own device.
The hardware check replaces the saved calendar with test items and clears them
afterwards. Flash backups may contain private device settings; keep them private.

## Protocol

Newline-delimited JSON at 115200 baud. `hello` identifies firmware version 1;
`calendar` carries a Unix clock, UTC offset, and up to 48 bounded event records.
Firmware acknowledges accepted and saved events. `status` reports count and first
title. Invalid input preserves the last calendar.
`{"type":"clear","version":1}` removes the saved calendar.

References: [CYD board documentation](https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display),
[Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial).
