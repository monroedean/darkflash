export interface RgbFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface DisplayIdentity {
  readonly id: string;
  readonly displayId: string;
  readonly name: string;
}

export type DisplayDevice = DisplayIdentity & {
  readonly control:
    | { readonly kind: "ddc"; readonly endpointId: string }
    | { readonly kind: "unsupported" }
    | { readonly kind: "discovery-error"; readonly message: string };
};

export interface BrightnessCapability {
  readonly minimum: number;
  readonly current: number;
  readonly maximum: number;
}

export interface MonitorSettings {
  readonly minimumBrightness: number;
  readonly maximumBrightness: number;
  readonly effectStrength: number;
  readonly responseSpeed: number;
}

export interface PersistedSettings {
  readonly enabled: boolean;
  readonly monitors: Readonly<Record<string, MonitorSettings>>;
}

export type PauseReason =
  | "capture-unavailable"
  | "hdr"
  | "protected-content"
  | "session-locked"
  | "unsupported-fullscreen";

export type DisplaySafetyState =
  | { readonly kind: "available" }
  | { readonly kind: "paused"; readonly reason: PauseReason };

export interface Clock {
  now(): number;
}

export interface DisplayPort {
  enumerate(): Promise<readonly DisplayDevice[]>;
}

export interface CapturePort {
  capture(displayId: string): Promise<RgbFrame>;
}

export interface SafetyPort {
  inspect(displayId: string): Promise<DisplaySafetyState>;
}

export interface BrightnessPort {
  probe(endpointId: string): Promise<BrightnessCapability | null>;
  read(endpointId: string): Promise<number>;
  set(endpointId: string, brightness: number): Promise<void>;
}

export interface SettingsPort {
  load(): Promise<PersistedSettings>;
  save(settings: PersistedSettings): Promise<void>;
}

export interface AutomationDependencies {
  readonly clock: Clock;
  readonly displays: DisplayPort;
  readonly capture: CapturePort;
  readonly safety: SafetyPort;
  readonly brightness: BrightnessPort;
  readonly settings: SettingsPort;
}

export type MonitorStatus =
  | { readonly kind: "active" }
  | { readonly kind: "disabled" }
  | { readonly kind: "paused"; readonly reason: PauseReason }
  | { readonly kind: "unsupported"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface MonitorSnapshot {
  readonly id: string;
  readonly name: string;
  readonly settingsEditable: boolean;
  readonly settings: MonitorSettings;
  readonly status: MonitorStatus;
}

export interface AutomationSnapshot {
  readonly enabled: boolean;
  readonly monitors: readonly MonitorSnapshot[];
}
