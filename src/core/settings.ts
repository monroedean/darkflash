import type { MonitorSettings, PersistedSettings } from "./types.js";

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  minimumBrightness: 20,
  maximumBrightness: 80,
  effectStrength: 1,
  responseSpeed: 0.5,
};

export function validateMonitorSettings(settings: MonitorSettings): void {
  const brightnessValues = [
    settings.minimumBrightness,
    settings.maximumBrightness,
  ];
  if (
    brightnessValues.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 100,
    )
  ) {
    throw new Error("Brightness values must be between 0 and 100");
  }
  if (settings.minimumBrightness > settings.maximumBrightness) {
    throw new Error("Minimum brightness cannot exceed maximum brightness");
  }
  if (
    !Number.isFinite(settings.effectStrength) ||
    settings.effectStrength < 0 ||
    settings.effectStrength > 1
  ) {
    throw new Error("Effect strength must be between 0 and 1");
  }
  if (
    !Number.isFinite(settings.responseSpeed) ||
    settings.responseSpeed < 0 ||
    settings.responseSpeed > 1
  ) {
    throw new Error("Response speed must be between 0 and 1");
  }
}

export function parsePersistedSettings(value: unknown): PersistedSettings {
  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw new Error("Expected an enabled flag");
  }
  if (!isRecord(value.monitors)) {
    throw new Error("Expected per-monitor settings");
  }

  const monitors: Record<string, MonitorSettings> = {};
  for (const [monitorId, monitorValue] of Object.entries(value.monitors)) {
    if (!isMonitorSettings(monitorValue)) {
      throw new Error(`Invalid settings for monitor ${monitorId}`);
    }
    validateMonitorSettings(monitorValue);
    monitors[monitorId] = monitorValue;
  }
  return { enabled: value.enabled, monitors };
}

export function isMonitorSettings(value: unknown): value is MonitorSettings {
  if (!isRecord(value)) return false;
  return (
    typeof value.minimumBrightness === "number" &&
    typeof value.maximumBrightness === "number" &&
    typeof value.effectStrength === "number" &&
    typeof value.responseSpeed === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
