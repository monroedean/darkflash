import type {
  AutomationDependencies,
  AutomationSnapshot,
  BrightnessCapability,
  DisplayDevice,
  MonitorSettings,
  PersistedSettings,
  RgbFrame,
  MonitorStatus,
} from "./types.js";
import {
  DEFAULT_MONITOR_SETTINGS,
  validateMonitorSettings,
} from "./settings.js";

interface MonitorRuntime {
  readonly device: DisplayDevice;
  capability: BrightnessCapability | null;
  settings: MonitorSettings;
  smoothedBrightness: number;
  lastTickAt: number;
  status: MonitorStatus;
  lastCommand?: number;
  lastCommandAt?: number;
  lastVerificationAt: number;
  consecutiveFailures: number;
  nextAttemptAt: number;
  needsReassert: boolean;
}

export class AutomationCoordinator {
  private settings: PersistedSettings = { enabled: false, monitors: {} };
  private readonly monitors = new Map<string, MonitorRuntime>();
  private discoveryFailures = 0;
  private nextDiscoveryAttemptAt = 0;

  constructor(private readonly dependencies: AutomationDependencies) {}

  async start(): Promise<void> {
    this.settings = await this.dependencies.settings.load();
    await this.refreshDisplays();
  }

  async refreshDisplays(): Promise<void> {
    const displays = await this.dependencies.displays.enumerate();
    const now = this.dependencies.clock.now();
    const discovered = await Promise.all(
      displays.map(async (device) => {
        let capability: BrightnessCapability | null;
        let probeError: unknown;
        if (device.control.kind === "ddc") {
          try {
            capability = await this.dependencies.brightness.probe(
              device.control.endpointId,
            );
          } catch (error) {
            capability = null;
            probeError = error;
          }
        } else {
          capability = null;
        }
        const runtime: MonitorRuntime = {
          device,
          capability,
          settings:
            this.settings.monitors[device.id] ?? DEFAULT_MONITOR_SETTINGS,
          smoothedBrightness: capability?.current ?? 0,
          lastTickAt: now,
          status:
            device.control.kind === "discovery-error"
              ? { kind: "error", message: device.control.message }
              : device.control.kind === "unsupported"
              ? {
                  kind: "unsupported",
                  message: "Physical brightness control is unavailable",
                }
              : probeError
                ? { kind: "error", message: errorMessage(probeError) }
                : capability === null
                  ? {
                      kind: "unsupported",
                      message: "Physical brightness control is unavailable",
                    }
                  : this.settings.enabled
                    ? { kind: "active" }
                    : { kind: "disabled" },
          ...(capability === null
            ? {}
            : { lastCommand: capability.current, lastCommandAt: now }),
          lastVerificationAt: now,
          consecutiveFailures: 0,
          nextAttemptAt: 0,
          needsReassert: false,
        };
        if (probeError) scheduleRetry(runtime, now);
        return [device.id, runtime] as const;
      }),
    );
    this.monitors.clear();
    for (const [id, runtime] of discovered) this.monitors.set(id, runtime);
    if (
      displays.some(({ control }) => control.kind === "discovery-error")
    ) {
      this.discoveryFailures += 1;
      this.nextDiscoveryAttemptAt =
        now + retryDelay(this.discoveryFailures);
    } else {
      this.discoveryFailures = 0;
      this.nextDiscoveryAttemptAt = 0;
    }
  }

  async tick(): Promise<void> {
    const tickStartedAt = this.dependencies.clock.now();
    if (
      tickStartedAt >= this.nextDiscoveryAttemptAt &&
      [...this.monitors.values()].some(
        ({ device }) => device.control.kind === "discovery-error",
      )
    ) {
      await this.refreshDisplays();
    }
    if (!this.settings.enabled) return;

    await Promise.all(
      [...this.monitors.values()].map(async (monitor) => {
        const tickStartedAt = this.dependencies.clock.now();
        if (tickStartedAt < monitor.nextAttemptAt) return;
        if (monitor.capability === null) {
          if (
            monitor.status.kind === "error" &&
            monitor.device.control.kind === "ddc"
          ) {
            await this.retryCapabilityProbe(monitor, tickStartedAt);
          }
          return;
        }

        let safety;
        try {
          safety = await this.dependencies.safety.inspect(
            monitor.device.displayId,
          );
        } catch {
          this.pauseAfterCaptureFailure(monitor, tickStartedAt);
          return;
        }
        if (safety.kind === "paused") {
          monitor.status = { kind: "paused", reason: safety.reason };
          monitor.lastTickAt = tickStartedAt;
          clearFailures(monitor);
          return;
        }
        monitor.status = { kind: "active" };

        let frame: RgbFrame;
        try {
          frame = await this.dependencies.capture.capture(
            monitor.device.displayId,
          );
        } catch {
          this.pauseAfterCaptureFailure(monitor, tickStartedAt);
          return;
        }
        const configuredTarget = mapLuminanceToBrightness(
          estimateLuminance(frame),
          monitor.settings,
        );
        const target = Math.min(
          monitor.capability.maximum,
          Math.max(monitor.capability.minimum, configuredTarget),
        );
        const now = this.dependencies.clock.now();
        const elapsedSeconds = Math.max(0, now - monitor.lastTickAt) / 1_000;
        const timeConstantSeconds = 8 - monitor.settings.responseSpeed * 7.5;
        const smoothing = 1 - Math.exp(-elapsedSeconds / timeConstantSeconds);
        monitor.smoothedBrightness +=
          (target - monitor.smoothedBrightness) * smoothing;
        monitor.lastTickAt = now;

        const requestedBrightness = Math.round(monitor.smoothedBrightness);
        if (now - monitor.lastVerificationAt >= 5_000) {
          if (monitor.device.control.kind !== "ddc") return;
          let physicalBrightness: number;
          try {
            physicalBrightness = await this.dependencies.brightness.read(
              monitor.device.control.endpointId,
            );
          } catch (error) {
            this.errorAfterBrightnessFailure(monitor, now, error);
            return;
          }
          monitor.lastVerificationAt = now;
          monitor.needsReassert ||=
            monitor.lastCommand !== undefined &&
            Math.abs(physicalBrightness - monitor.lastCommand) >= 2;
        }
        if (
          !monitor.needsReassert &&
          monitor.lastCommand !== undefined &&
          Math.abs(requestedBrightness - monitor.lastCommand) < 2
        ) {
          clearFailures(monitor);
          return;
        }
        if (
          monitor.lastCommandAt !== undefined &&
          now - monitor.lastCommandAt < 750
        ) {
          clearFailures(monitor);
          return;
        }

        try {
          if (monitor.device.control.kind !== "ddc") return;
          await this.dependencies.brightness.set(
            monitor.device.control.endpointId,
            requestedBrightness,
          );
        } catch (error) {
          this.errorAfterBrightnessFailure(monitor, now, error);
          return;
        }
        monitor.lastCommand = requestedBrightness;
        monitor.lastCommandAt = now;
        monitor.needsReassert = false;
        clearFailures(monitor);
      }),
    );
  }

  async updateMonitorSettings(
    monitorId: string,
    settings: MonitorSettings,
  ): Promise<void> {
    validateMonitorSettings(settings);
    const monitor = this.monitors.get(monitorId);
    if (monitor === undefined) {
      throw new Error(`Unknown monitor: ${monitorId}`);
    }
    if (monitor.device.control.kind !== "ddc") {
      throw new Error("Settings are unavailable until monitor discovery succeeds");
    }

    const nextSettings: PersistedSettings = {
      ...this.settings,
      monitors: { ...this.settings.monitors, [monitorId]: settings },
    };
    await this.dependencies.settings.save(nextSettings);
    this.settings = nextSettings;
    monitor.settings = settings;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.settings.enabled) return;
    const nextSettings: PersistedSettings = { ...this.settings, enabled };
    await this.dependencies.settings.save(nextSettings);
    this.settings = nextSettings;
    const now = this.dependencies.clock.now();
    for (const monitor of this.monitors.values()) {
      if (monitor.capability !== null) {
        monitor.status = enabled ? { kind: "active" } : { kind: "disabled" };
      }
      monitor.lastTickAt = now;
    }
  }

  getSnapshot(): AutomationSnapshot {
    return {
      enabled: this.settings.enabled,
      monitors: [...this.monitors.values()].map((monitor) => ({
        id: monitor.device.id,
        name: monitor.device.name,
        settingsEditable: monitor.device.control.kind === "ddc",
        settings: monitor.settings,
        status: monitor.status,
      })),
    };
  }

  private pauseAfterCaptureFailure(
    monitor: MonitorRuntime,
    now: number,
  ): void {
    monitor.status = { kind: "paused", reason: "capture-unavailable" };
    monitor.lastTickAt = now;
    scheduleRetry(monitor, now);
  }

  private errorAfterBrightnessFailure(
    monitor: MonitorRuntime,
    now: number,
    error: unknown,
  ): void {
    monitor.status = { kind: "error", message: errorMessage(error) };
    scheduleRetry(monitor, now);
  }

  private async retryCapabilityProbe(
    monitor: MonitorRuntime,
    now: number,
  ): Promise<void> {
    if (monitor.device.control.kind !== "ddc") return;
    try {
      const capability = await this.dependencies.brightness.probe(
        monitor.device.control.endpointId,
      );
      if (capability === null) {
        monitor.status = {
          kind: "unsupported",
          message: "Physical brightness control is unavailable",
        };
        clearFailures(monitor);
        return;
      }

      monitor.capability = capability;
      monitor.smoothedBrightness = capability.current;
      monitor.lastCommand = capability.current;
      monitor.lastCommandAt = now;
      monitor.lastVerificationAt = now;
      monitor.lastTickAt = now;
      monitor.status = { kind: "active" };
      clearFailures(monitor);
    } catch (error) {
      this.errorAfterBrightnessFailure(monitor, now, error);
    }
  }
}

function scheduleRetry(monitor: MonitorRuntime, now: number): void {
  monitor.consecutiveFailures += 1;
  const delay = retryDelay(monitor.consecutiveFailures);
  monitor.nextAttemptAt = now + delay;
}

function retryDelay(failureCount: number): number {
  return Math.min(30_000, 1_000 * 2 ** (failureCount - 1));
}

function clearFailures(monitor: MonitorRuntime): void {
  monitor.consecutiveFailures = 0;
  monitor.nextAttemptAt = 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Brightness control failed";
}

function estimateLuminance(frame: RgbFrame): number {
  const pixels = frame.width * frame.height;
  if (pixels === 0) return 0;

  const samples: Array<{ luminance: number; weight: number }> = [];
  let totalWeight = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const red = srgbToLinear((frame.rgba[offset] ?? 0) / 255);
    const green = srgbToLinear((frame.rgba[offset + 1] ?? 0) / 255);
    const blue = srgbToLinear((frame.rgba[offset + 2] ?? 0) / 255);
    const x = pixel % frame.width;
    const y = Math.floor(pixel / frame.width);
    const horizontalDistance = Math.abs((x + 0.5) / frame.width - 0.5) * 2;
    const verticalDistance = Math.abs((y + 0.5) / frame.height - 0.5) * 2;
    const edgeDistance = Math.max(horizontalDistance, verticalDistance);
    const weight = 1 - 0.75 * edgeDistance ** 1.5;
    samples.push({
      luminance: 0.2126 * red + 0.7152 * green + 0.0722 * blue,
      weight,
    });
    totalWeight += weight;
  }

  samples.sort((left, right) => left.luminance - right.luminance);
  const lower = weightedQuantile(samples, totalWeight * 0.1);
  const upper = weightedQuantile(samples, totalWeight * 0.9);
  const weightedTotal = samples.reduce(
    (total, sample) =>
      total + Math.min(upper, Math.max(lower, sample.luminance)) * sample.weight,
    0,
  );
  return weightedTotal / totalWeight;
}

function weightedQuantile(
  samples: ReadonlyArray<{ luminance: number; weight: number }>,
  threshold: number,
): number {
  let cumulative = 0;
  for (const sample of samples) {
    cumulative += sample.weight;
    if (cumulative >= threshold) return sample.luminance;
  }
  return samples.at(-1)?.luminance ?? 0;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function mapLuminanceToBrightness(
  luminance: number,
  settings: MonitorSettings,
): number {
  const midpoint =
    (settings.minimumBrightness + settings.maximumBrightness) / 2;
  const fullResponse =
    settings.maximumBrightness -
    luminance *
      (settings.maximumBrightness - settings.minimumBrightness);
  return midpoint + settings.effectStrength * (fullResponse - midpoint);
}
