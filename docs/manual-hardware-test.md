# Manual Windows hardware test

Run this pass on a Windows 10 SDR desktop before publishing a build. Record the Windows build, GPU/driver, connection type, monitor model, and whether DDC/CI is enabled in the monitor menu.

## Basic compatibility

1. Launch Darkflash and confirm it opens only in the system tray.
2. Open Settings and verify every physical monitor has the correct name.
3. Confirm a DDC/CI monitor reports Active after automation is enabled.
4. Confirm an internal or non-DDC display reports Unsupported and that gamma, color, and rendered pixels remain unchanged.
5. Set a narrow range such as 35–45. Switch between a full white page and a dark page; confirm white trends toward 35 and dark trends toward 45 without exceeding the range.

## Stability and authority

1. Scroll, open a small white notification over a dark desktop, and play letterboxed SDR video. Confirm brightness does not jump or chatter.
2. Change the monitor's brightness manually while automation is enabled. Within the next verification cycle, confirm Darkflash reasserts its target.
3. Disable automation, change brightness manually, and wait at least 15 seconds. Confirm Darkflash leaves it untouched.
4. Try slow and fast response settings and confirm both remain gradual, with fast converging sooner.

## Multiple monitors and lifecycle

1. Put bright content on one monitor and dark content on another. Confirm each monitor moves independently.
2. Give the monitors different ranges, restart Darkflash, and confirm both settings return to the correct device.
3. Disconnect and reconnect one monitor. Confirm the stale endpoint is not controlled and the reconnected monitor restores its settings.
4. Exercise sleep/wake and, if practical, a dock disconnect/reconnect.

## Safety and failure handling

1. Lock the Windows session. Confirm commands stop and the status becomes Paused. Unlock and confirm brightness resumes gradually rather than jumping.
2. Enable HDR for one display. Confirm that display pauses while unaffected SDR displays continue.
3. Open protected video or an exclusive full-screen path that capture cannot access. Confirm Darkflash pauses or preserves a stable value; it must not react to blank or stale capture.
4. Disable DDC/CI or unplug a monitor during a command. Confirm the UI stays responsive, the affected monitor reports an error, other monitors continue, and retries back off.

## Resource and privacy check

1. Leave Darkflash active for 30 minutes while using the desktop. Check Task Manager for stable memory and modest background CPU/GPU use.
2. Confirm physical brightness writes occur no faster than the configured command limit.
3. Inspect the settings directory and logs. Confirm there are no screenshots, pixel buffers, or telemetry artifacts.
