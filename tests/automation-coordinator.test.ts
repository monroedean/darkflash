import { describe, expect, it } from "vitest";

import { AutomationCoordinator } from "../src/core/automation-coordinator.js";
import type {
  AutomationDependencies,
  BrightnessCapability,
  DisplayDevice,
  DisplaySafetyState,
  MonitorSettings,
  PersistedSettings,
  RgbFrame,
} from "../src/core/types.js";

class TestClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(milliseconds: number): void {
    this.time += milliseconds;
  }
}

function solidFrame(value: number): RgbFrame {
  return {
    width: 8,
    height: 8,
    rgba: new Uint8Array(8 * 8 * 4).fill(value).map((channel, index) =>
      index % 4 === 3 ? 255 : channel,
    ),
  };
}

function frameWithRegion(
  background: number,
  region: { x: number; y: number; width: number; height: number; value: number },
): RgbFrame {
  const frame = solidFrame(background);
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * frame.width + x) * 4;
      frame.rgba[offset] = region.value;
      frame.rgba[offset + 1] = region.value;
      frame.rgba[offset + 2] = region.value;
    }
  }
  return frame;
}

function createHarness(
  frame: RgbFrame,
  monitorSettings?: MonitorSettings,
  safetyState: DisplaySafetyState = { kind: "available" },
): {
  coordinator: AutomationCoordinator;
  clock: TestClock;
  commands: number[];
  savedSettings: PersistedSettings[];
  setFrame(frame: RgbFrame): void;
  setSafetyState(state: DisplaySafetyState): void;
  setPhysicalBrightness(brightness: number): void;
} {
  const clock = new TestClock();
  const commands: number[] = [];
  const savedSettings: PersistedSettings[] = [];
  let currentFrame = frame;
  let currentSafetyState = safetyState;
  let physicalBrightness = 50;
  const display: DisplayDevice = {
    id: "monitor-1",
    displayId: "display-1",
    control: { kind: "ddc", endpointId: "endpoint-1" },
    name: "Test monitor",
  };
  const capability: BrightnessCapability = {
    minimum: 0,
    current: 50,
    maximum: 100,
  };

  const dependencies: AutomationDependencies = {
    clock,
    displays: { enumerate: async () => [display] },
    capture: { capture: async () => currentFrame },
    safety: { inspect: async () => currentSafetyState },
    brightness: {
      probe: async () => capability,
      read: async () => physicalBrightness,
      set: async (_endpointId, brightness) => {
        commands.push(brightness);
        physicalBrightness = brightness;
      },
    },
    settings: {
      load: async () => ({
        enabled: true,
        monitors:
          monitorSettings === undefined
            ? {}
            : { [display.id]: monitorSettings },
      }),
      save: async (settings) => {
        savedSettings.push(settings);
      },
    },
  };

  return {
    coordinator: new AutomationCoordinator(dependencies),
    clock,
    commands,
    savedSettings,
    setFrame: (nextFrame) => {
      currentFrame = nextFrame;
    },
    setSafetyState: (state) => {
      currentSafetyState = state;
    },
    setPhysicalBrightness: (brightness) => {
      physicalBrightness = brightness;
    },
  };
}

describe("content-responsive automation", () => {
  it("commands lower physical brightness for white content than black content", async () => {
    const white = createHarness(solidFrame(255));
    const black = createHarness(solidFrame(0));

    await white.coordinator.start();
    await black.coordinator.start();
    white.clock.advance(10_000);
    black.clock.advance(10_000);
    await white.coordinator.tick();
    await black.coordinator.tick();

    expect(white.commands).toHaveLength(1);
    expect(black.commands).toHaveLength(1);
    expect(white.commands[0]).toBeLessThan(black.commands[0] ?? 0);
  });

  it("compresses compensation around the configured envelope midpoint", async () => {
    const settings: MonitorSettings = {
      minimumBrightness: 20,
      maximumBrightness: 80,
      effectStrength: 0.5,
      responseSpeed: 1,
    };
    const white = createHarness(solidFrame(255), settings);
    const black = createHarness(solidFrame(0), settings);

    await white.coordinator.start();
    await black.coordinator.start();
    white.clock.advance(10_000);
    black.clock.advance(10_000);
    await white.coordinator.tick();
    await black.coordinator.tick();

    expect(white.commands).toEqual([35]);
    expect(black.commands).toEqual([65]);
  });

  it("resists a small bright notification near the display edge", async () => {
    const baseline = createHarness(solidFrame(128));
    const notification = createHarness(
      frameWithRegion(128, {
        x: 6,
        y: 0,
        width: 2,
        height: 2,
        value: 255,
      }),
    );

    await baseline.coordinator.start();
    await notification.coordinator.start();
    baseline.clock.advance(10_000);
    notification.clock.advance(10_000);
    await baseline.coordinator.tick();
    await notification.coordinator.tick();

    expect(Math.abs((notification.commands[0] ?? 0) - (baseline.commands[0] ?? 0))).toBeLessThanOrEqual(1);
  });

  it("limits the influence of a white sidebar beside dark content", async () => {
    const dark = createHarness(solidFrame(0));
    const sidebar = createHarness(
      frameWithRegion(0, { x: 0, y: 0, width: 2, height: 8, value: 255 }),
    );

    await dark.coordinator.start();
    await sidebar.coordinator.start();
    dark.clock.advance(10_000);
    sidebar.clock.advance(10_000);
    await dark.coordinator.tick();
    await sidebar.coordinator.tick();

    expect((dark.commands[0] ?? 0) - (sidebar.commands[0] ?? 0)).toBeLessThanOrEqual(13);
  });

  it("gives central content more influence than an equal-sized edge region", async () => {
    const center = createHarness(
      frameWithRegion(0, { x: 2, y: 2, width: 4, height: 4, value: 255 }),
    );
    const edge = createHarness(
      frameWithRegion(0, { x: 0, y: 0, width: 2, height: 8, value: 255 }),
    );

    await center.coordinator.start();
    await edge.coordinator.start();
    center.clock.advance(10_000);
    edge.clock.advance(10_000);
    await center.coordinator.tick();
    await edge.coordinator.tick();

    expect((center.commands[0] ?? 100) + 5).toBeLessThan(
      edge.commands[0] ?? 0,
    );
  });

  it("discounts dark sidebars compared with an equal dark center band", async () => {
    const sidebars = createHarness(
      frameWithRegion(255, { x: 0, y: 0, width: 2, height: 8, value: 0 }),
    );
    const centerBand = createHarness(
      frameWithRegion(255, { x: 3, y: 0, width: 2, height: 8, value: 0 }),
    );

    await sidebars.coordinator.start();
    await centerBand.coordinator.start();
    sidebars.clock.advance(10_000);
    centerBand.clock.advance(10_000);
    await sidebars.coordinator.tick();
    await centerBand.coordinator.tick();

    expect(sidebars.commands[0]).toBeLessThan(centerBand.commands[0] ?? 0);
  });

  it("discounts letterbox bars compared with an equal dark center band", async () => {
    const letterbox = createHarness(
      frameWithRegion(255, { x: 0, y: 0, width: 8, height: 2, value: 0 }),
    );
    const centerBand = createHarness(
      frameWithRegion(255, { x: 0, y: 3, width: 8, height: 2, value: 0 }),
    );

    await letterbox.coordinator.start();
    await centerBand.coordinator.start();
    letterbox.clock.advance(10_000);
    centerBand.clock.advance(10_000);
    await letterbox.coordinator.tick();
    await centerBand.coordinator.tick();

    expect(letterbox.commands[0]).toBeLessThan(centerBand.commands[0] ?? 0);
  });

  it("does not chatter when the requested brightness has not meaningfully changed", async () => {
    const harness = createHarness(solidFrame(255));

    await harness.coordinator.start();
    harness.clock.advance(10_000);
    await harness.coordinator.tick();
    harness.clock.advance(100);
    await harness.coordinator.tick();

    expect(harness.commands).toHaveLength(1);
  });

  it("moves faster when response speed is increased", async () => {
    const slow = createHarness(solidFrame(255), {
      minimumBrightness: 20,
      maximumBrightness: 80,
      effectStrength: 1,
      responseSpeed: 0,
    });
    const fast = createHarness(solidFrame(255), {
      minimumBrightness: 20,
      maximumBrightness: 80,
      effectStrength: 1,
      responseSpeed: 1,
    });

    await slow.coordinator.start();
    await fast.coordinator.start();
    slow.clock.advance(1_000);
    fast.clock.advance(1_000);
    await slow.coordinator.tick();
    await fast.coordinator.tick();

    expect(fast.commands[0]).toBeLessThan(slow.commands[0] ?? 0);
    expect(fast.commands[0]).toBeGreaterThanOrEqual(20);
  });

  it("responds promptly at the balanced speed setting", async () => {
    const harness = createHarness(solidFrame(255));

    await harness.coordinator.start();
    harness.clock.advance(1_000);
    await harness.coordinator.tick();

    expect(harness.commands).toEqual([39]);
  });

  it("never sends brightness commands less than 750 ms apart", async () => {
    const harness = createHarness(solidFrame(255), {
      minimumBrightness: 20,
      maximumBrightness: 80,
      effectStrength: 1,
      responseSpeed: 1,
    });
    await harness.coordinator.start();

    harness.clock.advance(1_000);
    await harness.coordinator.tick();
    expect(harness.commands).toHaveLength(1);

    harness.setFrame(solidFrame(0));
    harness.clock.advance(749);
    await harness.coordinator.tick();
    expect(harness.commands).toHaveLength(1);

    harness.clock.advance(1);
    await harness.coordinator.tick();
    expect(harness.commands).toHaveLength(2);
  });

  it("rejects invalid ranges and persists valid per-monitor settings", async () => {
    const harness = createHarness(solidFrame(128));
    await harness.coordinator.start();

    await expect(
      harness.coordinator.updateMonitorSettings("monitor-1", {
        minimumBrightness: 80,
        maximumBrightness: 20,
        effectStrength: 1,
        responseSpeed: 0.5,
      }),
    ).rejects.toThrow("Minimum brightness cannot exceed maximum brightness");

    const valid: MonitorSettings = {
      minimumBrightness: 10,
      maximumBrightness: 60,
      effectStrength: 0.75,
      responseSpeed: 0.25,
    };
    await harness.coordinator.updateMonitorSettings("monitor-1", valid);

    expect(harness.savedSettings).toEqual([
      { enabled: true, monitors: { "monitor-1": valid } },
    ]);
  });

  it("pauses without changing brightness when HDR is active", async () => {
    const harness = createHarness(solidFrame(255), undefined, {
      kind: "paused",
      reason: "hdr",
    });

    await harness.coordinator.start();
    harness.clock.advance(10_000);
    await harness.coordinator.tick();

    expect(harness.commands).toEqual([]);
    expect(harness.coordinator.getSnapshot().monitors[0]?.status).toEqual({
      kind: "paused",
      reason: "hdr",
    });
  });

  it.each(["protected-content", "unsupported-fullscreen"] as const)(
    "holds brightness during %s safety states",
    async (reason) => {
      const harness = createHarness(solidFrame(0), undefined, {
        kind: "paused",
        reason,
      });

      await harness.coordinator.start();
      harness.clock.advance(10_000);
      await harness.coordinator.tick();

      expect(harness.commands).toEqual([]);
      expect(harness.coordinator.getSnapshot().monitors[0]?.status).toEqual({
        kind: "paused",
        reason,
      });
    },
  );

  it("re-enters smoothing instead of jumping when a paused display resumes", async () => {
    const harness = createHarness(solidFrame(255), undefined, {
      kind: "paused",
      reason: "session-locked",
    });

    await harness.coordinator.start();
    harness.clock.advance(60_000);
    await harness.coordinator.tick();
    harness.setSafetyState({ kind: "available" });
    await harness.coordinator.tick();

    expect(harness.commands).toEqual([]);

    harness.clock.advance(1_000);
    await harness.coordinator.tick();
    expect(harness.commands[0]).toBeGreaterThan(20);
    expect(harness.commands[0]).toBeLessThan(50);
  });

  it("leaves manual brightness untouched after automation is disabled", async () => {
    const harness = createHarness(solidFrame(255));
    await harness.coordinator.start();
    harness.clock.advance(10_000);
    await harness.coordinator.tick();
    expect(harness.commands).toHaveLength(1);

    await harness.coordinator.setEnabled(false);
    harness.clock.advance(10_000);
    await harness.coordinator.tick();

    expect(harness.commands).toHaveLength(1);
    expect(harness.coordinator.getSnapshot().enabled).toBe(false);
    expect(harness.coordinator.getSnapshot().monitors[0]?.status).toEqual({
      kind: "disabled",
    });
    expect(harness.savedSettings.at(-1)?.enabled).toBe(false);
  });

  it("reasserts its target after a manual change while automation remains enabled", async () => {
    const harness = createHarness(solidFrame(255), {
      minimumBrightness: 20,
      maximumBrightness: 80,
      effectStrength: 1,
      responseSpeed: 1,
    });
    await harness.coordinator.start();
    harness.clock.advance(10_000);
    await harness.coordinator.tick();
    expect(harness.commands).toEqual([20]);

    harness.setPhysicalBrightness(70);
    harness.clock.advance(5_000);
    await harness.coordinator.tick();

    expect(harness.commands).toEqual([20, 20]);
  });

  it("drives simultaneous monitors independently from their own content", async () => {
    const clock = new TestClock();
    const commands = new Map<string, number>();
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => [
          {
            id: "left",
            displayId: "left-display",
            control: { kind: "ddc", endpointId: "left-endpoint" },
            name: "Left",
          },
          {
            id: "right",
            displayId: "right-display",
            control: { kind: "ddc", endpointId: "right-endpoint" },
            name: "Right",
          },
        ],
      },
      capture: {
        capture: async (displayId) =>
          displayId === "left-display" ? solidFrame(255) : solidFrame(0),
      },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => ({ minimum: 0, current: 50, maximum: 100 }),
        read: async () => 50,
        set: async (endpointId, brightness) => {
          commands.set(endpointId, brightness);
        },
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    clock.advance(10_000);
    await coordinator.tick();

    expect(commands.get("left-endpoint")).toBeLessThan(
      commands.get("right-endpoint") ?? 0,
    );
  });

  it("serializes physical monitor capability probes", async () => {
    let activeProbes = 0;
    let maximumActiveProbes = 0;
    const displays: DisplayDevice[] = [
      {
        id: "left",
        displayId: "left-display",
        control: { kind: "ddc", endpointId: "left-endpoint" },
        name: "Left",
      },
      {
        id: "right",
        displayId: "right-display",
        control: { kind: "ddc", endpointId: "right-endpoint" },
        name: "Right",
      },
    ];
    const coordinator = new AutomationCoordinator({
      clock: new TestClock(),
      displays: { enumerate: async () => displays },
      capture: { capture: async () => solidFrame(0) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => {
          activeProbes += 1;
          maximumActiveProbes = Math.max(maximumActiveProbes, activeProbes);
          await new Promise((resolve) => setImmediate(resolve));
          activeProbes -= 1;
          return { minimum: 0, current: 50, maximum: 100 };
        },
        read: async () => 50,
        set: async () => undefined,
      },
      settings: {
        load: async () => ({ enabled: false, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();

    expect(maximumActiveProbes).toBe(1);
    expect(coordinator.getSnapshot().monitors).toHaveLength(2);
  });

  it("isolates capture failures per monitor and backs off retries", async () => {
    const clock = new TestClock();
    const displays: DisplayDevice[] = [
      {
        id: "broken",
        displayId: "display-broken",
        control: { kind: "ddc", endpointId: "endpoint-broken" },
        name: "Broken capture",
      },
      {
        id: "healthy",
        displayId: "display-healthy",
        control: { kind: "ddc", endpointId: "endpoint-healthy" },
        name: "Healthy monitor",
      },
    ];
    const commands: string[] = [];
    let brokenCaptureAttempts = 0;
    const coordinator = new AutomationCoordinator({
      clock,
      displays: { enumerate: async () => displays },
      capture: {
        capture: async (displayId) => {
          if (displayId === "display-broken") {
            brokenCaptureAttempts += 1;
            throw new Error("Capture failed");
          }
          return solidFrame(0);
        },
      },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => ({ minimum: 0, current: 50, maximum: 100 }),
        read: async () => 50,
        set: async (endpointId) => {
          commands.push(endpointId);
        },
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    clock.advance(10_000);
    await expect(coordinator.tick()).resolves.toBeUndefined();

    expect(commands).toEqual(["endpoint-healthy"]);
    expect(
      coordinator.getSnapshot().monitors.find(({ id }) => id === "broken")
        ?.status,
    ).toEqual({ kind: "paused", reason: "capture-unavailable" });

    clock.advance(500);
    await coordinator.tick();
    expect(brokenCaptureAttempts).toBe(1);
  });

  it("retries a failed DDC capability probe with exponential backoff", async () => {
    const clock = new TestClock();
    let probeAttempts = 0;
    const commands: number[] = [];
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => [
          {
            id: "monitor-1",
            displayId: "display-1",
            control: { kind: "ddc", endpointId: "endpoint-1" },
            name: "Recovering monitor",
          },
        ],
      },
      capture: { capture: async () => solidFrame(255) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => {
          probeAttempts += 1;
          if (probeAttempts < 3) throw new Error("DDC bus unavailable");
          return { minimum: 0, current: 50, maximum: 100 };
        },
        read: async () => 50,
        set: async (_endpointId, brightness) => {
          commands.push(brightness);
        },
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    expect(probeAttempts).toBe(1);
    expect(coordinator.getSnapshot().monitors[0]?.status.kind).toBe("error");

    clock.advance(999);
    await coordinator.tick();
    expect(probeAttempts).toBe(1);

    clock.advance(1);
    await coordinator.tick();
    expect(probeAttempts).toBe(2);

    clock.advance(1_999);
    await coordinator.tick();
    expect(probeAttempts).toBe(2);

    clock.advance(1);
    await coordinator.tick();
    expect(probeAttempts).toBe(3);
    expect(coordinator.getSnapshot().monitors[0]?.status.kind).toBe("active");

    clock.advance(10_000);
    await coordinator.tick();
    expect(commands).toHaveLength(1);
  });

  it("caps repeated retry delays at 30 seconds", async () => {
    const clock = new TestClock();
    let probeAttempts = 0;
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => [
          {
            id: "monitor-1",
            displayId: "display-1",
            control: { kind: "ddc", endpointId: "endpoint-1" },
            name: "Unresponsive monitor",
          },
        ],
      },
      capture: { capture: async () => solidFrame(0) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => {
          probeAttempts += 1;
          throw new Error("DDC bus unavailable");
        },
        read: async () => 50,
        set: async () => undefined,
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const attemptsBeforeDelay = probeAttempts;
      clock.advance(delay - 1);
      await coordinator.tick();
      expect(probeAttempts).toBe(attemptsBeforeDelay);
      clock.advance(1);
      await coordinator.tick();
      expect(probeAttempts).toBe(attemptsBeforeDelay + 1);
    }
  });

  it("reconciles a transient display-discovery error with backoff", async () => {
    const clock = new TestClock();
    let enumerationAttempts = 0;
    let probeAttempts = 0;
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => {
          enumerationAttempts += 1;
          if (enumerationAttempts < 3) {
            return [
              {
                id: "discovery-error-1",
                displayId: "display-1",
                control: {
                  kind: "discovery-error" as const,
                  message: "Windows monitor discovery timed out",
                },
                name: "Display 1",
              },
            ];
          }
          return [
            {
              id: "stable-monitor-id",
              displayId: "display-1",
              control: { kind: "ddc" as const, endpointId: "endpoint-1" },
              name: "Recovered monitor",
            },
          ];
        },
      },
      capture: { capture: async () => solidFrame(128) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => {
          probeAttempts += 1;
          return { minimum: 0, current: 50, maximum: 100 };
        },
        read: async () => 50,
        set: async () => undefined,
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    expect(coordinator.getSnapshot().monitors[0]?.status.kind).toBe("error");
    await expect(
      coordinator.updateMonitorSettings("discovery-error-1", {
        minimumBrightness: 10,
        maximumBrightness: 60,
        effectStrength: 0.5,
        responseSpeed: 0.5,
      }),
    ).rejects.toThrow("Settings are unavailable");

    clock.advance(999);
    await coordinator.tick();
    expect(enumerationAttempts).toBe(1);

    clock.advance(1);
    await coordinator.tick();
    expect(enumerationAttempts).toBe(2);

    clock.advance(2_000);
    await coordinator.tick();
    expect(enumerationAttempts).toBe(3);
    expect(probeAttempts).toBe(1);
    expect(coordinator.getSnapshot().monitors[0]).toMatchObject({
      id: "stable-monitor-id",
      status: { kind: "active" },
    });
  });

  it("continues controlling a healthy monitor while another retries discovery", async () => {
    const clock = new TestClock();
    const commands: string[] = [];
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => [
          {
            id: "healthy",
            displayId: "display-healthy",
            control: { kind: "ddc", endpointId: "endpoint-healthy" },
            name: "Healthy",
          },
          {
            id: "discovery-error-broken",
            displayId: "display-broken",
            control: {
              kind: "discovery-error",
              message: "Could not open physical monitor endpoints",
            },
            name: "Broken",
          },
        ],
      },
      capture: { capture: async () => solidFrame(255) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => ({ minimum: 0, current: 50, maximum: 100 }),
        read: async () => 50,
        set: async (endpointId) => {
          commands.push(endpointId);
        },
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    clock.advance(1_000);
    await coordinator.tick();
    clock.advance(1_000);
    await coordinator.tick();

    expect(commands).toEqual(["endpoint-healthy"]);
    expect(
      coordinator.getSnapshot().monitors.find(({ id }) => id === "healthy")
        ?.status.kind,
    ).toBe("active");
    expect(
      coordinator.getSnapshot().monitors.find(({ id }) =>
        id.startsWith("discovery-error"),
      )?.status.kind,
    ).toBe("error");
  });

  it("keeps unsupported monitors visible without using a software fallback", async () => {
    const coordinator = new AutomationCoordinator({
      clock: new TestClock(),
      displays: {
        enumerate: async () => [
          {
            id: "unsupported",
            displayId: "display-unsupported",
            control: { kind: "unsupported" },
            name: "Laptop panel",
          },
        ],
      },
      capture: {
        capture: async () => {
          throw new Error("Capture should not be attempted");
        },
      },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => {
          throw new Error("Probe should not be attempted");
        },
        read: async () => {
          throw new Error("Read should not be attempted");
        },
        set: async () => {
          throw new Error("Write should not be attempted");
        },
      },
      settings: {
        load: async () => ({ enabled: true, monitors: {} }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    await coordinator.tick();

    expect(coordinator.getSnapshot().monitors).toEqual([
      {
        id: "unsupported",
        name: "Laptop panel",
        settingsEditable: false,
        settings: {
          minimumBrightness: 20,
          maximumBrightness: 80,
          effectStrength: 1,
          responseSpeed: 0.5,
        },
        status: {
          kind: "unsupported",
          message: "Physical brightness control is unavailable",
        },
      },
    ]);
  });

  it("drops disconnected devices and restores settings by stable monitor identity", async () => {
    const clock = new TestClock();
    const knownMonitor: DisplayDevice = {
      id: "edid-acme-1234",
      displayId: "display-7",
      control: { kind: "ddc", endpointId: "endpoint-7" },
      name: "Acme 27-inch",
    };
    let connected: readonly DisplayDevice[] = [knownMonitor];
    const restoredSettings: MonitorSettings = {
      minimumBrightness: 12,
      maximumBrightness: 63,
      effectStrength: 0.4,
      responseSpeed: 0.8,
    };
    const coordinator = new AutomationCoordinator({
      clock,
      displays: { enumerate: async () => connected },
      capture: { capture: async () => solidFrame(128) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => ({ minimum: 0, current: 40, maximum: 100 }),
        read: async () => 40,
        set: async () => undefined,
      },
      settings: {
        load: async () => ({
          enabled: true,
          monitors: { [knownMonitor.id]: restoredSettings },
        }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    expect(coordinator.getSnapshot().monitors[0]?.settings).toEqual(
      restoredSettings,
    );

    connected = [];
    await coordinator.refreshDisplays();
    expect(coordinator.getSnapshot().monitors).toEqual([]);

    connected = [{ ...knownMonitor, displayId: "display-11" }];
    await coordinator.refreshDisplays();
    expect(coordinator.getSnapshot().monitors[0]?.settings).toEqual(
      restoredSettings,
    );
  });

  it("never requests a value outside the physical monitor's reported range", async () => {
    const clock = new TestClock();
    const commands: number[] = [];
    const coordinator = new AutomationCoordinator({
      clock,
      displays: {
        enumerate: async () => [
          {
            id: "limited-monitor",
            displayId: "limited-display",
            control: { kind: "ddc", endpointId: "limited-endpoint" },
            name: "Limited monitor",
          },
        ],
      },
      capture: { capture: async () => solidFrame(255) },
      safety: { inspect: async () => ({ kind: "available" }) },
      brightness: {
        probe: async () => ({ minimum: 30, current: 50, maximum: 70 }),
        read: async () => 50,
        set: async (_endpointId, value) => {
          commands.push(value);
        },
      },
      settings: {
        load: async () => ({
          enabled: true,
          monitors: {
            "limited-monitor": {
              minimumBrightness: 20,
              maximumBrightness: 80,
              effectStrength: 1,
              responseSpeed: 1,
            },
          },
        }),
        save: async () => undefined,
      },
    });

    await coordinator.start();
    clock.advance(10_000);
    await coordinator.tick();

    expect(commands).toEqual([30]);
  });
});
