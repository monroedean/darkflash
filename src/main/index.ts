import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray,
} from "electron";

import { AutomationCoordinator } from "../core/automation-coordinator.js";
import { isMonitorSettings } from "../core/settings.js";
import type { AutomationSnapshot, MonitorStatus } from "../core/types.js";
import { ElectronCaptureAdapter } from "./electron-capture-adapter.js";
import { ElectronSafetyAdapter } from "./electron-safety-adapter.js";
import { JsonSettingsStore } from "./json-settings-store.js";
import { WindowsMonitorAdapter } from "./windows/windows-monitor-adapter.js";

const TICK_INTERVAL_MS = 1_000;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let coordinator: AutomationCoordinator | undefined;
let monitors: WindowsMonitorAdapter | undefined;
let safety: ElectronSafetyAdapter | undefined;
let tickTimer: NodeJS.Timeout | undefined;
let tickInProgress = false;
let quitting = false;
let lastPublishedSnapshot = "";

app.setName("Darkflash");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showSettings());
  void app.whenReady().then(startApplication).catch(showFatalError);
}

app.on("window-all-closed", () => {
  // Darkflash lives in the system tray.
});

app.on("before-quit", () => {
  quitting = true;
  if (tickTimer !== undefined) clearInterval(tickTimer);
  safety?.dispose();
  void monitors?.dispose();
});

async function startApplication(): Promise<void> {
  monitors = new WindowsMonitorAdapter();
  safety = new ElectronSafetyAdapter(monitors);
  coordinator = new AutomationCoordinator({
    clock: { now: () => Date.now() },
    displays: monitors,
    capture: new ElectronCaptureAdapter(),
    safety,
    brightness: monitors,
    settings: new JsonSettingsStore(
      join(app.getPath("userData"), "settings.json"),
    ),
  });

  await coordinator.start();
  createSettingsWindow();
  createTray();
  registerIpc();
  registerDisplayLifecycle();
  publishSnapshot(true);

  tickTimer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
  await runTick();
}

function createSettingsWindow(): void {
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 620,
    minHeight: 500,
    show: false,
    backgroundColor: "#111318",
    autoHideMenuBar: true,
    title: "Darkflash settings",
    webPreferences: {
      preload: join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void settingsWindow.loadFile(join(__dirname, "../renderer/index.html"));
  settingsWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      settingsWindow?.hide();
    }
  });
}

function createTray(): void {
  tray = new Tray(createStatusIcon({ kind: "disabled" }));
  tray.setToolTip("Darkflash");
  tray.on("double-click", showSettings);
  rebuildTrayMenu();
}

function registerIpc(): void {
  ipcMain.handle("darkflash:get-snapshot", () => requiredCoordinator().getSnapshot());
  ipcMain.handle("darkflash:set-enabled", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Enabled must be a boolean");
    await requiredCoordinator().setEnabled(enabled);
    publishSnapshot(true);
    return requiredCoordinator().getSnapshot();
  });
  ipcMain.handle(
    "darkflash:update-monitor-settings",
    async (_event, monitorId: unknown, settingsValue: unknown) => {
      if (typeof monitorId !== "string" || !isMonitorSettings(settingsValue)) {
        throw new Error("Invalid monitor settings request");
      }
      await requiredCoordinator().updateMonitorSettings(
        monitorId,
        settingsValue,
      );
      publishSnapshot(true);
      return requiredCoordinator().getSnapshot();
    },
  );
  ipcMain.handle("darkflash:refresh-displays", async () => {
    await refreshDisplays();
    return requiredCoordinator().getSnapshot();
  });
}

function registerDisplayLifecycle(): void {
  const refresh = (): void => void refreshDisplays();
  screen.on("display-added", refresh);
  screen.on("display-removed", refresh);
  screen.on("display-metrics-changed", refresh);
  powerMonitor.on("resume", refresh);
}

async function refreshDisplays(): Promise<void> {
  try {
    await requiredCoordinator().refreshDisplays();
    publishSnapshot(true);
  } catch (error) {
    showNonfatalError(error);
  }
}

async function runTick(): Promise<void> {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    await requiredCoordinator().tick();
    publishSnapshot(false);
  } catch (error) {
    showNonfatalError(error);
  } finally {
    tickInProgress = false;
  }
}

function publishSnapshot(force: boolean): void {
  const snapshot = requiredCoordinator().getSnapshot();
  const serialized = JSON.stringify(snapshot);
  if (!force && serialized === lastPublishedSnapshot) return;
  lastPublishedSnapshot = serialized;
  settingsWindow?.webContents.send("darkflash:snapshot", snapshot);
  updateTray(snapshot);
}

function updateTray(snapshot: AutomationSnapshot): void {
  const status = overallStatus(snapshot);
  tray?.setImage(createStatusIcon(status));
  tray?.setToolTip(`Darkflash — ${statusLabel(status)}`);
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  const snapshot = coordinator?.getSnapshot();
  const status = snapshot === undefined ? { kind: "disabled" as const } : overallStatus(snapshot);
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusLabel(status), enabled: false },
      { type: "separator" },
      {
        label: "Enable automation",
        type: "checkbox",
        checked: snapshot?.enabled ?? false,
        click: (item) => {
          void requiredCoordinator()
            .setEnabled(item.checked)
            .then(() => publishSnapshot(true))
            .catch(showNonfatalError);
        },
      },
      { label: "Settings…", click: showSettings },
      { type: "separator" },
      {
        label: "Quit Darkflash",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function showSettings(): void {
  if (settingsWindow === undefined) return;
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
}

function overallStatus(snapshot: AutomationSnapshot): MonitorStatus {
  if (!snapshot.enabled) return { kind: "disabled" };
  if (snapshot.monitors.length === 0) {
    return { kind: "unsupported", message: "No displays detected" };
  }
  const statuses = snapshot.monitors.map(({ status }) => status);
  return (
    statuses.find(({ kind }) => kind === "error") ??
    statuses.find(({ kind }) => kind === "paused") ??
    (statuses.every(({ kind }) => kind === "unsupported")
      ? (statuses[0] ?? {
          kind: "unsupported",
          message: "No displays detected",
        })
      : { kind: "active" })
  );
}

function statusLabel(status: MonitorStatus): string {
  switch (status.kind) {
    case "active":
      return "Automation active";
    case "disabled":
      return "Automation disabled";
    case "paused":
      return `Paused — ${status.reason.replaceAll("-", " ")}`;
    case "unsupported":
      return `Unavailable — ${status.message}`;
    case "error":
      return `Error — ${status.message}`;
  }
}

function createStatusIcon(status: MonitorStatus): Electron.NativeImage {
  const size = 32;
  const bitmap = Buffer.alloc(size * size * 4);
  const color =
    status.kind === "active"
      ? [73, 214, 151]
      : status.kind === "paused"
        ? [76, 174, 255]
        : status.kind === "error"
          ? [95, 99, 238]
          : [148, 155, 166];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - 15.5, y - 15.5);
      const ring = distance >= 8 && distance <= 13;
      const ray =
        (Math.abs(x - 15.5) < 1.5 || Math.abs(y - 15.5) < 1.5) &&
        distance >= 3 &&
        distance <= 7;
      if (!ring && !ray) continue;
      const offset = (y * size + x) * 4;
      bitmap[offset] = color[2] ?? 0;
      bitmap[offset + 1] = color[1] ?? 0;
      bitmap[offset + 2] = color[0] ?? 0;
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
}

function requiredCoordinator(): AutomationCoordinator {
  if (coordinator === undefined) throw new Error("Darkflash has not started");
  return coordinator;
}

function showNonfatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  tray?.displayBalloon({
    iconType: "error",
    title: "Darkflash error",
    content: message,
    noSound: true,
    respectQuietTime: true,
  });
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("Darkflash could not start", message);
  app.quit();
}
