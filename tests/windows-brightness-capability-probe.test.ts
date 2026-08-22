import { describe, expect, it, vi } from "vitest";

import { probeBrightnessCapability } from "../src/main/windows/brightness-capability-probe.js";

describe("Windows brightness capability probe", () => {
  it("uses actual brightness I/O when the monitor returns malformed capabilities metadata", () => {
    const readBrightness = vi.fn(() => ({
      minimum: 0,
      current: 20,
      maximum: 50,
    }));
    const writeBrightness = vi.fn();

    const capability = probeBrightnessCapability({
      queryCapabilities: () => ({ succeeded: false, flags: 0 }),
      readBrightness,
      writeBrightness,
    });

    expect(capability).toEqual({ minimum: 0, current: 20, maximum: 50 });
    expect(readBrightness).toHaveBeenCalledOnce();
    expect(writeBrightness).toHaveBeenCalledWith(20);
  });

  it("does not write when valid capabilities metadata excludes brightness support", () => {
    const readBrightness = vi.fn();
    const writeBrightness = vi.fn();

    const capability = probeBrightnessCapability({
      queryCapabilities: () => ({ succeeded: true, flags: 0 }),
      readBrightness,
      writeBrightness,
    });

    expect(capability).toBeNull();
    expect(readBrightness).not.toHaveBeenCalled();
    expect(writeBrightness).not.toHaveBeenCalled();
  });
});
