import { describe, expect, it } from "vitest";

import { classifyWindowSafety } from "../src/main/windows/window-safety.js";

describe("Windows window-safety classification", () => {
  it("pauses protected content anywhere on the target display", () => {
    expect(
      classifyWindowSafety("\\\\.\\DISPLAY1", {
        protectedDeviceNames: ["\\\\.\\display1"],
      }),
    ).toEqual({ kind: "paused", reason: "protected-content" });
  });

  it("pauses fullscreen capture paths on the target display", () => {
    expect(
      classifyWindowSafety("\\\\.\\DISPLAY1", {
        protectedDeviceNames: [],
        unsupportedFullscreenDeviceName: "\\\\.\\DISPLAY1",
      }),
    ).toEqual({ kind: "paused", reason: "unsupported-fullscreen" });
  });

  it("does not pause a different display", () => {
    expect(
      classifyWindowSafety("\\\\.\\DISPLAY2", {
        protectedDeviceNames: ["\\\\.\\DISPLAY1"],
        unsupportedFullscreenDeviceName: "\\\\.\\DISPLAY1",
      }),
    ).toEqual({ kind: "available" });
  });
});
