import type { DarkflashApi } from "../preload.js";

declare global {
  type AutomationSnapshot = import("../core/types.js").AutomationSnapshot;
  type MonitorSettings = import("../core/types.js").MonitorSettings;
  type MonitorSnapshot = import("../core/types.js").MonitorSnapshot;
  type MonitorStatus = import("../core/types.js").MonitorStatus;

  interface Window {
    readonly darkflash: DarkflashApi;
  }
}

export {};
