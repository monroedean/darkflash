import { screen } from "electron";

import type {
  BrightnessCapability,
  BrightnessPort,
  DisplayDevice,
  DisplayPort,
  DisplaySafetyState,
} from "../../core/types.js";
import type {
  NativeMonitorDescriptor,
  NativeMonitorDiscoveryResult,
} from "./ddc-protocol.js";
import { DdcWorkerClient } from "./ddc-worker-client.js";
import {
  mapDisplayDiscoveryFailure,
  mapNativeMonitorsToDisplays,
  matchNativeMonitorToDisplay,
} from "./display-mapping.js";
import {
  classifyWindowSafety,
  inspectWindowSafety,
} from "./window-safety.js";
import type { WindowSafetySnapshot } from "./window-safety.js";

export class WindowsMonitorAdapter implements DisplayPort, BrightnessPort {
  private readonly hdrByDisplayId = new Map<string, boolean>();
  private readonly deviceNamesByDisplayId = new Map<string, Set<string>>();
  private hdrRefreshedAt = 0;
  private hdrRefresh: Promise<void> | undefined;
  private windowSafetySnapshot: WindowSafetySnapshot = {
    protectedDeviceNames: [],
  };
  private windowSafetyInspectedAt = 0;

  constructor(private readonly ddc = new DdcWorkerClient()) {}

  async enumerate(): Promise<readonly DisplayDevice[]> {
    const electronDisplays = screen.getAllDisplays();
    if (process.platform !== "win32") {
      this.hdrByDisplayId.clear();
      return electronDisplays.map((display) => ({
        id: `unsupported-${display.id}`,
        displayId: String(display.id),
        control: { kind: "unsupported" as const },
        name: display.label || `Display ${display.id}`,
      }));
    }

    let discovery: NativeMonitorDiscoveryResult;
    try {
      discovery = await this.ddc.discover();
    } catch (error) {
      return mapDisplayDiscoveryFailure(electronDisplays, error);
    }
    this.updateHdrState(discovery.monitors, electronDisplays);
    const devices = mapNativeMonitorsToDisplays(
      discovery.monitors,
      electronDisplays,
      discovery.failures,
    );
    this.pauseDiscoveryFailures(devices);
    return devices;
  }

  isHdr(displayId: string): boolean {
    return this.hdrByDisplayId.get(displayId) ?? false;
  }

  inspectDisplaySafety(displayId: string): DisplaySafetyState {
    if (Date.now() - this.windowSafetyInspectedAt >= 250) {
      this.windowSafetySnapshot = inspectWindowSafety();
      this.windowSafetyInspectedAt = Date.now();
    }
    const deviceNames = this.deviceNamesByDisplayId.get(displayId);
    if (deviceNames === undefined) return { kind: "available" };
    for (const deviceName of deviceNames) {
      const result = classifyWindowSafety(
        deviceName,
        this.windowSafetySnapshot,
      );
      if (result.kind === "paused") return result;
    }
    return { kind: "available" };
  }

  async refreshHdrState(): Promise<void> {
    if (
      process.platform !== "win32" ||
      Date.now() - this.hdrRefreshedAt < 5_000
    ) {
      return;
    }
    this.hdrRefresh ??= this.ddc
      .discover()
      .then((discovery) => {
        const electronDisplays = screen.getAllDisplays();
        this.updateHdrState(discovery.monitors, electronDisplays);
        this.pauseDiscoveryFailures(
          mapNativeMonitorsToDisplays(
            discovery.monitors,
            electronDisplays,
            discovery.failures,
          ),
        );
      })
      .catch(() => {
        for (const displayId of this.deviceNamesByDisplayId.keys()) {
          this.hdrByDisplayId.set(displayId, true);
        }
        this.hdrRefreshedAt = Date.now();
      })
      .finally(() => {
        this.hdrRefresh = undefined;
      });
    await this.hdrRefresh;
  }

  async probe(endpointId: string): Promise<BrightnessCapability | null> {
    return await this.ddc.probe(endpointId);
  }

  async read(endpointId: string): Promise<number> {
    return await this.ddc.read(endpointId);
  }

  async set(endpointId: string, brightness: number): Promise<void> {
    await this.ddc.set(endpointId, brightness);
  }

  async dispose(): Promise<void> {
    await this.ddc.dispose();
  }

  private updateHdrState(
    nativeMonitors: readonly NativeMonitorDescriptor[],
    electronDisplays: ReturnType<typeof screen.getAllDisplays>,
  ): void {
    this.hdrByDisplayId.clear();
    this.deviceNamesByDisplayId.clear();
    for (const monitor of nativeMonitors) {
      const display = matchNativeMonitorToDisplay(monitor, electronDisplays);
      if (display === undefined) continue;
      const displayId = String(display.id);
      const deviceNames = this.deviceNamesByDisplayId.get(displayId) ?? new Set();
      deviceNames.add(monitor.deviceName);
      this.deviceNamesByDisplayId.set(displayId, deviceNames);
      this.hdrByDisplayId.set(
        displayId,
        (this.hdrByDisplayId.get(displayId) ?? false) || monitor.hdr,
      );
    }
    this.hdrRefreshedAt = Date.now();
  }

  private pauseDiscoveryFailures(devices: readonly DisplayDevice[]): void {
    for (const device of devices) {
      if (device.control.kind === "discovery-error") {
        this.hdrByDisplayId.set(device.displayId, true);
      }
    }
  }
}
