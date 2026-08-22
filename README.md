# Darkflash

Darkflash is a Windows tray app that adjusts each external monitor's physical brightness based on what's on that monitor. Bright pages push the brightness toward your configured minimum. Dark content pushes it toward your maximum.

It changes the monitor's actual brightness through DDC/CI. If DDC/CI isn't available, Darkflash won't fake it with a dimming overlay, GPU gamma change, or color-pipeline adjustment.

## What it does

- Once a second, Darkflash samples a 96×54 image of each display. It analyzes the image locally and immediately discards it.
- It calculates brightness with linear-light perceptual luminance, gives the center more weight, and resists outliers. A small notification, sidebar, or letterbox won't have much influence.
- It smooths changes, ignores tiny movements, limits how often it sends monitor commands, and backs off after failures.

## Requirements

- 64-bit Windows 10 or newer.
- An external monitor that supports DDC/CI brightness. You may need to enable DDC/CI in the monitor's on-screen menu.
- Normal SDR desktop output. Darkflash pauses for HDR and for capture paths Electron can't safely sample. It doesn't guess.

Internal laptop panels usually use a different brightness interface, so Darkflash will normally show them as unsupported. DDC/CI support varies between monitors, so test with the actual hardware before you rely on the automation.

## Privacy

Captured pixels stay in memory just long enough to produce one luminance measurement. Darkflash then releases them. It doesn't write frames to disk, log pixel content, send data anywhere, or include telemetry.

## License

Copyright © 2026 Dean Monroe.

Darkflash is free software licensed under the [GNU General Public License version 3 only](LICENSE). It comes with no warranty.
