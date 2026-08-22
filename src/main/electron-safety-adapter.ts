import { powerMonitor } from "electron";

import type { DisplaySafetyState, SafetyPort } from "../core/types.js";
import type { WindowsMonitorAdapter } from "./windows/windows-monitor-adapter.js";

export class ElectronSafetyAdapter implements SafetyPort {
  private sessionUnavailable = false;
  private readonly onLock = (): void => {
    this.sessionUnavailable = true;
  };
  private readonly onUnlock = (): void => {
    this.sessionUnavailable = false;
  };

  constructor(private readonly monitors: WindowsMonitorAdapter) {
    powerMonitor.on("lock-screen", this.onLock);
    powerMonitor.on("suspend", this.onLock);
    powerMonitor.on("unlock-screen", this.onUnlock);
    powerMonitor.on("resume", this.onUnlock);
  }

  async inspect(displayId: string): Promise<DisplaySafetyState> {
    if (this.sessionUnavailable) {
      return { kind: "paused", reason: "session-locked" };
    }
    await this.monitors.refreshHdrState();
    if (this.monitors.isHdr(displayId)) {
      return { kind: "paused", reason: "hdr" };
    }
    return this.monitors.inspectDisplaySafety(displayId);
  }

  dispose(): void {
    powerMonitor.removeListener("lock-screen", this.onLock);
    powerMonitor.removeListener("suspend", this.onLock);
    powerMonitor.removeListener("unlock-screen", this.onUnlock);
    powerMonitor.removeListener("resume", this.onUnlock);
  }
}
