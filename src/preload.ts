import { contextBridge, ipcRenderer } from "electron";

import type {
  AutomationSnapshot,
  MonitorSettings,
} from "./core/types.js";

export interface DarkflashApi {
  getSnapshot(): Promise<AutomationSnapshot>;
  setEnabled(enabled: boolean): Promise<AutomationSnapshot>;
  updateMonitorSettings(
    monitorId: string,
    settings: MonitorSettings,
  ): Promise<AutomationSnapshot>;
  refreshDisplays(): Promise<AutomationSnapshot>;
  onSnapshot(listener: (snapshot: AutomationSnapshot) => void): () => void;
}

const api: DarkflashApi = {
  getSnapshot: async () =>
    (await ipcRenderer.invoke("darkflash:get-snapshot")) as AutomationSnapshot,
  setEnabled: async (enabled) =>
    (await ipcRenderer.invoke(
      "darkflash:set-enabled",
      enabled,
    )) as AutomationSnapshot,
  updateMonitorSettings: async (monitorId, settings) =>
    (await ipcRenderer.invoke(
      "darkflash:update-monitor-settings",
      monitorId,
      settings,
    )) as AutomationSnapshot,
  refreshDisplays: async () =>
    (await ipcRenderer.invoke(
      "darkflash:refresh-displays",
    )) as AutomationSnapshot,
  onSnapshot: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AutomationSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on("darkflash:snapshot", handler);
    return () => ipcRenderer.removeListener("darkflash:snapshot", handler);
  },
};

contextBridge.exposeInMainWorld("darkflash", api);
