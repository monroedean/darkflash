const koffi: typeof import("koffi", {
  with: { "resolution-mode": "require" },
}) = require("koffi");

import type { DisplaySafetyState } from "../../core/types.js";

type NativeFunction = (...args: any[]) => any;

interface RectValue {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface MonitorInfoValue {
  cbSize: number;
  rcMonitor?: RectValue;
  szDevice?: string;
}

interface InspectedWindow {
  readonly deviceName: string;
  readonly displayAffinity: number;
  readonly affinityKnown: boolean;
  readonly fullscreen: boolean;
}

export interface WindowSafetySnapshot {
  readonly protectedDeviceNames: readonly string[];
  readonly unsupportedFullscreenDeviceName?: string;
}

interface WindowBindings {
  readonly MONITORINFOEXW: ReturnType<typeof koffi.struct>;
  readonly EnumWindows: NativeFunction;
  readonly GetForegroundWindow: NativeFunction;
  readonly GetWindowDisplayAffinity: NativeFunction;
  readonly GetWindowRect: NativeFunction;
  readonly IsIconic: NativeFunction;
  readonly IsWindowVisible: NativeFunction;
  readonly MonitorFromWindow: NativeFunction;
  readonly GetMonitorInfoW: NativeFunction;
}

let cachedBindings: WindowBindings | undefined;

export function classifyWindowSafety(
  targetDeviceName: string,
  snapshot: WindowSafetySnapshot,
): DisplaySafetyState {
  const normalizedTarget = targetDeviceName.toUpperCase();
  if (
    snapshot.protectedDeviceNames.some(
      (deviceName) => deviceName.toUpperCase() === normalizedTarget,
    )
  ) {
    return { kind: "paused", reason: "protected-content" };
  }
  if (
    snapshot.unsupportedFullscreenDeviceName?.toUpperCase() ===
    normalizedTarget
  ) {
    return { kind: "paused", reason: "unsupported-fullscreen" };
  }
  return { kind: "available" };
}

export function inspectWindowSafety(): WindowSafetySnapshot {
  if (process.platform !== "win32") return { protectedDeviceNames: [] };

  const api = bindings();
  const protectedDeviceNames = new Set<string>();
  const enumerated = api.EnumWindows((window: bigint) => {
    if (!api.IsWindowVisible(window) || api.IsIconic(window)) return true;
    const inspected = inspectWindow(api, window, false);
    if (
      inspected !== null &&
      inspected.affinityKnown &&
      inspected.displayAffinity !== 0
    ) {
      protectedDeviceNames.add(inspected.deviceName);
    }
    return true;
  }, 0);
  if (!enumerated) {
    throw new Error("Windows could not inspect visible protected windows");
  }

  const foregroundWindow = api.GetForegroundWindow() as bigint | null;
  const foreground =
    foregroundWindow === null
      ? null
      : inspectWindow(api, foregroundWindow, true);
  const unsupportedFullscreenDeviceName =
    foreground !== null && foreground.fullscreen && !foreground.affinityKnown
      ? foreground.deviceName
      : undefined;

  return {
    protectedDeviceNames: [...protectedDeviceNames],
    ...(unsupportedFullscreenDeviceName === undefined
      ? {}
      : { unsupportedFullscreenDeviceName }),
  };
}

function inspectWindow(
  api: WindowBindings,
  window: bigint,
  inspectBounds: boolean,
): InspectedWindow | null {
  const monitor = api.MonitorFromWindow(window, 0) as bigint | null;
  if (monitor === null) return null;
  const monitorInfo: MonitorInfoValue = {
    cbSize: koffi.sizeof(api.MONITORINFOEXW),
  };
  if (!api.GetMonitorInfoW(monitor, monitorInfo)) return null;

  const affinity = [0];
  const affinityKnown = Boolean(
    api.GetWindowDisplayAffinity(window, affinity),
  );
  const windowRect: Partial<RectValue> = {};
  const windowRectKnown =
    inspectBounds && Boolean(api.GetWindowRect(window, windowRect));
  const monitorRect = monitorInfo.rcMonitor;
  return {
    deviceName: monitorInfo.szDevice ?? "",
    displayAffinity: affinityKnown ? (affinity[0] ?? 0) : 0,
    affinityKnown,
    fullscreen:
      windowRectKnown &&
      monitorRect !== undefined &&
      rectanglesMatch(windowRect, monitorRect),
  };
}

function rectanglesMatch(
  windowRect: Partial<RectValue>,
  monitorRect: RectValue,
): boolean {
  const tolerance = 2;
  return (
    windowRect.left !== undefined &&
    windowRect.top !== undefined &&
    windowRect.right !== undefined &&
    windowRect.bottom !== undefined &&
    Math.abs(windowRect.left - monitorRect.left) <= tolerance &&
    Math.abs(windowRect.top - monitorRect.top) <= tolerance &&
    Math.abs(windowRect.right - monitorRect.right) <= tolerance &&
    Math.abs(windowRect.bottom - monitorRect.bottom) <= tolerance
  );
}

function bindings(): WindowBindings {
  if (cachedBindings !== undefined) return cachedBindings;

  const user32 = koffi.load("user32.dll");
  const HANDLE = koffi.pointer("WINDOW_SAFETY_HANDLE", koffi.opaque());
  const HWND = koffi.alias("WINDOW_SAFETY_HWND", HANDLE);
  const HMONITOR = koffi.alias("WINDOW_SAFETY_HMONITOR", HANDLE);
  const DWORD = koffi.alias("WINDOW_SAFETY_DWORD", "uint32_t");
  const RECT = koffi.struct("WINDOW_SAFETY_RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t",
  });
  const MONITORINFOEXW = koffi.struct("WINDOW_SAFETY_MONITORINFOEXW", {
    cbSize: DWORD,
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: DWORD,
    szDevice: koffi.array("char16_t", 32, "String"),
  });
  const windowEnumProc = koffi.proto(
    "__stdcall",
    "WindowSafetyEnumProc",
    "bool",
    [HWND, "intptr_t"],
  );

  cachedBindings = {
    MONITORINFOEXW,
    EnumWindows: user32.func(
      "__stdcall",
      "EnumWindows",
      "bool",
      [koffi.pointer(windowEnumProc), "intptr_t"],
    ),
    GetForegroundWindow: user32.func(
      "__stdcall",
      "GetForegroundWindow",
      HWND,
      [],
    ),
    GetWindowDisplayAffinity: user32.func(
      "__stdcall",
      "GetWindowDisplayAffinity",
      "bool",
      [HWND, koffi.out(koffi.pointer(DWORD))],
    ),
    GetWindowRect: user32.func(
      "__stdcall",
      "GetWindowRect",
      "bool",
      [HWND, koffi.out(koffi.pointer(RECT))],
    ),
    IsIconic: user32.func(
      "__stdcall",
      "IsIconic",
      "bool",
      [HWND],
    ),
    IsWindowVisible: user32.func(
      "__stdcall",
      "IsWindowVisible",
      "bool",
      [HWND],
    ),
    MonitorFromWindow: user32.func(
      "__stdcall",
      "MonitorFromWindow",
      HMONITOR,
      [HWND, DWORD],
    ),
    GetMonitorInfoW: user32.func(
      "__stdcall",
      "GetMonitorInfoW",
      "bool",
      [HMONITOR, koffi.inout(koffi.pointer(MONITORINFOEXW))],
    ),
  };
  return cachedBindings;
}
