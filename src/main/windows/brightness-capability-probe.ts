import type { BrightnessCapability } from "../../core/types.js";

const MONITOR_CAPABILITY_BRIGHTNESS = 0x2;

interface CapabilityQueryResult {
  readonly succeeded: boolean;
  readonly flags: number;
}

export interface BrightnessCapabilityProbeOperations {
  readonly queryCapabilities: () => CapabilityQueryResult;
  readonly readBrightness: () => BrightnessCapability;
  readonly writeBrightness: (brightness: number) => void;
}

export function probeBrightnessCapability(
  operations: BrightnessCapabilityProbeOperations,
): BrightnessCapability | null {
  const capabilities = operations.queryCapabilities();
  if (
    capabilities.succeeded &&
    (capabilities.flags & MONITOR_CAPABILITY_BRIGHTNESS) === 0
  ) {
    return null;
  }

  const brightness = operations.readBrightness();
  operations.writeBrightness(brightness.current);
  return brightness;
}
