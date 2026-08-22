# Darkflash

Darkflash is a Windows 10 system-tray utility that adapts each external monitor's physical brightness to its own on-screen content. Bright pages move brightness toward your configured minimum; dark content moves it toward your maximum.

Darkflash controls real monitor brightness through DDC/CI. It never substitutes a dimming overlay, GPU gamma change, or color-pipeline adjustment when DDC/CI is unavailable.

## What it does

- Samples a 96×54 image of each display once per second and discards it immediately after local analysis.
- Uses linear-light perceptual luminance, center weighting, and outlier resistance so a small notification, sidebar, or letterbox has limited influence.
- Smooths changes, ignores tiny movements, rate-limits monitor commands, and backs off after failures.
- Keeps minimum, maximum, effect strength, and response speed settings per stable physical-monitor identity.
- Pauses on a locked or suspended session, HDR output, protected content, unsupported full-screen windows, or unavailable capture while preserving the last stable physical brightness.
- Isolates every monitor's DDC/CI calls in a bounded worker so an unresponsive device cannot freeze the tray UI.
- Stores settings locally and includes no telemetry or network path.

## Requirements

- Windows 10 or newer, 64-bit.
- An external monitor with DDC/CI brightness support. DDC/CI may need to be enabled in the monitor's on-screen menu.
- Ordinary SDR desktop output. HDR and capture paths Electron cannot safely sample are paused, not guessed at.

Internal laptop panels commonly use a different brightness interface and will normally appear as unsupported. Monitor DDC/CI implementations vary; validate real hardware before relying on automation.

## Development

Install Node.js 22.12 or newer, then run:

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run dev` starts the tray app. Platform-independent control-loop tests run on any supported Node platform; physical control runs only on Windows.

To create an unpacked 64-bit Windows application:

```sh
npm run package:win
```

The result is written to `release/Darkflash-win32-x64`. A polished installer and code signing are intentionally outside the first release.

## Architecture

The `AutomationCoordinator` owns policy and depends only on boundaries for display inventory, capture, safety state, time, settings, and brightness I/O. Tests drive that complete seam with synthetic frames and fake hardware. Electron supplies the tray, settings window, low-resolution capture, and session events. A Koffi-based Windows adapter calls `user32.dll` and `Dxva2.dll` from per-monitor worker threads.

See [the manual hardware test](docs/manual-hardware-test.md) before publishing a build.
The direct dependency [license review](docs/dependency-licenses.md) records the first release's reuse decision.

## Privacy

Captured pixels stay in memory, are reduced to one luminance measurement, and are then released. Darkflash does not write frames to disk, log pixel content, transmit data, or include telemetry.

## License

MIT
