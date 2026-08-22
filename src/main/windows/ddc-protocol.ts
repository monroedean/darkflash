import type { BrightnessCapability } from "../../core/types.js";

export interface NativeBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface NativeMonitorDescriptor {
  readonly id: string;
  readonly endpointId: string;
  readonly name: string;
  readonly deviceName: string;
  readonly bounds: NativeBounds;
  readonly hdr: boolean;
}

export interface NativeMonitorDiscoveryFailure {
  readonly message: string;
  readonly bounds?: NativeBounds;
}

export interface NativeMonitorDiscoveryResult {
  readonly monitors: readonly NativeMonitorDescriptor[];
  readonly failures: readonly NativeMonitorDiscoveryFailure[];
}

export type DdcRequestPayload =
  | { readonly operation: "probe" }
  | { readonly operation: "read" }
  | { readonly operation: "set"; readonly value: number };

export type DdcRequest = DdcRequestPayload & { readonly id: number };

export type DdcResult = BrightnessCapability | number | null | undefined;

export type DdcResponse =
  | { readonly id: number; readonly ok: true; readonly value: DdcResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

export type DiscoveryResponse =
  | {
      readonly ok: true;
      readonly value: NativeMonitorDiscoveryResult;
    }
  | { readonly ok: false; readonly error: string };
