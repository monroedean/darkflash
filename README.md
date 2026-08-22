# Darkflash

Darkflash is a Windows tray app that adjusts each external monitor's physical brightness based on what's on that monitor. Bright pages push the brightness toward your configured minimum. Dark content pushes it toward your maximum.

It changes the monitor's actual brightness through DDC/CI. If DDC/CI isn't available, Darkflash won't fake it with a dimming overlay, GPU gamma change, or color-pipeline adjustment.

## What it does

- Once a second, Darkflash samples a 96×54 image of each display. It analyzes the image locally and immediately discards it.
- It calculates brightness with linear-light perceptual luminance, gives the center more weight, and resists outliers. A small notification, sidebar, or letterbox won't have much influence.
- It smooths changes, ignores tiny movements, limits how often it sends monitor commands, and backs off after failures.
- It saves the minimum, maximum, effect strength, and response speed for each stable physical-monitor identity.
- It pauses when the session is locked or suspended, HDR is on, content is protected, a full-screen window isn't supported, or capture isn't available. The monitor stays at its last stable physical brightness.
- It runs each monitor's DDC/CI calls in a bounded worker, so an unresponsive device can't freeze the tray UI.
- It keeps all settings local. There's no telemetry or network path.

## Requirements

- 64-bit Windows 10 or newer.
- An external monitor that supports DDC/CI brightness. You may need to enable DDC/CI in the monitor's on-screen menu.
- Normal SDR desktop output. Darkflash pauses for HDR and for capture paths Electron can't safely sample. It doesn't guess.

Internal laptop panels usually use a different brightness interface, so Darkflash will normally show them as unsupported. DDC/CI support varies between monitors, so test with the actual hardware before you rely on the automation.

## Development

Install Node.js 22.12 or newer, then run these commands:

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run dev` starts the tray app. You can run the platform-independent control-loop tests anywhere Node supports. Physical monitor control only works on Windows.

To build an unpacked 64-bit Windows app:

```sh
npm run package:win
```

The build goes to `release/Darkflash-win32-x64`. An installer and code signing aren't part of the first release.

## Architecture

The `AutomationCoordinator` handles policy. It only depends on boundaries for display inventory, capture, safety state, time, settings, and brightness I/O. Tests cover that full seam with synthetic frames and fake hardware.

Electron provides the tray, settings window, low-resolution capture, and session events. A Koffi-based Windows adapter calls `user32.dll` and `Dxva2.dll` from a worker thread for each monitor.

Run [the manual hardware test](docs/manual-hardware-test.md) before publishing a build. The direct dependency [license review](docs/dependency-licenses.md) explains the reuse decision for the first release.

## Privacy

Captured pixels stay in memory just long enough to produce one luminance measurement. Darkflash then releases them. It doesn't write frames to disk, log pixel content, send data anywhere, or include telemetry.

## License

Copyright © 2026 Dean Monroe.

Darkflash is free software licensed under the [GNU General Public License version 3 only](LICENSE). It comes with no warranty.
