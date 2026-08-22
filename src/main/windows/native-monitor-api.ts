const koffi: typeof import("koffi", {
  with: { "resolution-mode": "require" },
}) = require("koffi");

import type { BrightnessCapability } from "../../core/types.js";
import type {
  NativeBounds,
  NativeMonitorDiscoveryFailure,
  NativeMonitorDiscoveryResult,
  NativeMonitorDescriptor,
} from "./ddc-protocol.js";
import { probeBrightnessCapability } from "./brightness-capability-probe.js";

type NativeFunction = (...args: any[]) => any;
type KoffiType = ReturnType<typeof koffi.struct>;

interface RectValue {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface LuidValue {
  readonly LowPart: number;
  readonly HighPart: number;
}

interface PathSourceInfoValue {
  readonly adapterId: LuidValue;
  readonly id: number;
}

interface PathTargetInfoValue {
  readonly adapterId: LuidValue;
  readonly id: number;
}

interface PathInfoValue {
  readonly sourceInfo: PathSourceInfoValue;
  readonly targetInfo: PathTargetInfoValue;
}

interface MonitorInfoValue {
  cbSize: number;
  rcMonitor?: RectValue;
  szDevice?: string;
}

interface DisplayDeviceValue {
  cb: number;
  DeviceString?: string;
  DeviceID?: string;
  DeviceKey?: string;
}

interface PhysicalMonitorValue {
  readonly hPhysicalMonitor: bigint | null;
  readonly szPhysicalMonitorDescription: string;
}

interface PhysicalMonitorGroup {
  readonly count: number;
  readonly buffer: Buffer;
}

interface EnumeratedMonitor extends NativeMonitorDescriptor {
  readonly handle: bigint | null;
  readonly group: PhysicalMonitorGroup;
}

interface EnumeratedDiscovery {
  readonly monitors: EnumeratedMonitor[];
  readonly failures: NativeMonitorDiscoveryFailure[];
}

interface Bindings {
  readonly RECT: KoffiType;
  readonly MONITORINFOEXW: KoffiType;
  readonly DISPLAY_DEVICEW: KoffiType;
  readonly PHYSICAL_MONITOR: KoffiType;
  readonly DISPLAYCONFIG_PATH_INFO: KoffiType;
  readonly DISPLAYCONFIG_SOURCE_DEVICE_NAME: KoffiType;
  readonly DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO: KoffiType;
  readonly EnumDisplayMonitors: NativeFunction;
  readonly GetMonitorInfoW: NativeFunction;
  readonly EnumDisplayDevicesW: NativeFunction;
  readonly GetNumberOfPhysicalMonitorsFromHMONITOR: NativeFunction;
  readonly GetPhysicalMonitorsFromHMONITOR: NativeFunction;
  readonly DestroyPhysicalMonitors: NativeFunction;
  readonly GetMonitorCapabilities: NativeFunction;
  readonly GetMonitorBrightness: NativeFunction;
  readonly SetMonitorBrightness: NativeFunction;
  readonly GetDisplayConfigBufferSizes: NativeFunction;
  readonly QueryDisplayConfig: NativeFunction;
  readonly DisplayConfigGetSourceName: NativeFunction;
  readonly DisplayConfigGetAdvancedColorInfo: NativeFunction;
  readonly GetLastError: NativeFunction;
}

let cachedBindings: Bindings | undefined;

export function discoverNativeMonitors(): NativeMonitorDiscoveryResult {
  const discovery = enumerateMonitors();
  try {
    return {
      monitors: discovery.monitors.map(
        ({ group: _group, handle: _handle, ...descriptor }) => descriptor,
      ),
      failures: discovery.failures,
    };
  } finally {
    destroyMonitorGroups(discovery.monitors);
  }
}

export function probeNativeMonitor(
  endpointId: string,
): BrightnessCapability | null {
  return withMonitor(endpointId, (monitor, api) =>
    probeBrightnessCapability({
      queryCapabilities: () => {
        const capabilities = [0];
        const temperatures = [0];
        return {
          succeeded: Boolean(
            api.GetMonitorCapabilities(
              monitor.handle,
              capabilities,
              temperatures,
            ),
          ),
          flags: capabilities[0] ?? 0,
        };
      },
      readBrightness: () => readBrightness(monitor, api),
      writeBrightness: (brightness) => {
        if (!api.SetMonitorBrightness(monitor.handle, brightness)) {
          throw win32Error(api, "The monitor rejected the DDC/CI write probe");
        }
      },
    }),
  );
}

export function readNativeBrightness(endpointId: string): number {
  return withMonitor(endpointId, (monitor, api) =>
    readBrightness(monitor, api).current,
  );
}

export function setNativeBrightness(
  endpointId: string,
  brightness: number,
): void {
  withMonitor(endpointId, (monitor, api) => {
    const range = readBrightness(monitor, api);
    const bounded = Math.round(
      Math.min(range.maximum, Math.max(range.minimum, brightness)),
    );
    if (!api.SetMonitorBrightness(monitor.handle, bounded)) {
      throw win32Error(api, "The monitor rejected the brightness command");
    }
  });
}

function withMonitor<T>(
  endpointId: string,
  action: (monitor: EnumeratedMonitor, api: Bindings) => T,
): T {
  const discovery = enumerateMonitors();
  try {
    const monitor = discovery.monitors.find(
      ({ endpointId: id }) => id === endpointId,
    );
    if (monitor === undefined) {
      throw new Error("The physical monitor is no longer connected");
    }
    return action(monitor, bindings());
  } finally {
    destroyMonitorGroups(discovery.monitors);
  }
}

function readBrightness(
  monitor: EnumeratedMonitor,
  api: Bindings,
): BrightnessCapability {
  const minimum = [0];
  const current = [0];
  const maximum = [0];
  if (
    !api.GetMonitorBrightness(
      monitor.handle,
      minimum,
      current,
      maximum,
    )
  ) {
    throw win32Error(api, "Could not read physical monitor brightness");
  }
  return {
    minimum: minimum[0] ?? 0,
    current: current[0] ?? 0,
    maximum: maximum[0] ?? 100,
  };
}

function enumerateMonitors(): EnumeratedDiscovery {
  if (process.platform !== "win32") {
    throw new Error("Physical monitor control is available only on Windows");
  }
  const api = bindings();
  const monitorHandles: bigint[] = [];
  const success = api.EnumDisplayMonitors(
    null,
    null,
    (monitor: bigint) => {
      monitorHandles.push(monitor);
      return true;
    },
    0,
  );
  if (!success) throw win32Error(api, "Could not enumerate Windows displays");

  const hdrState = readHdrDeviceNames(api);
  const monitors: EnumeratedMonitor[] = [];
  const failures: NativeMonitorDiscoveryFailure[] = [];
  for (const monitorHandle of monitorHandles) {
    const currentGroups: PhysicalMonitorGroup[] = [];
    try {
      const monitorInfo: MonitorInfoValue = {
        cbSize: koffi.sizeof(api.MONITORINFOEXW),
      };
      if (!api.GetMonitorInfoW(monitorHandle, monitorInfo)) {
        throw win32Error(api, "Could not identify a Windows display");
      }
      const deviceName = monitorInfo.szDevice;
      const bounds = monitorInfo.rcMonitor;
      if (deviceName === undefined || bounds === undefined) {
        throw new Error("Windows returned incomplete display information");
      }
      const displayMonitors = enumeratePhysicalMonitor(
        api,
        monitorHandle,
        deviceName,
        bounds,
        hdrState,
        currentGroups,
      );
      monitors.push(...displayMonitors);
    } catch (error) {
      destroyPhysicalMonitorGroups(currentGroups);
      const monitorInfo: MonitorInfoValue = {
        cbSize: koffi.sizeof(api.MONITORINFOEXW),
      };
      const hasBounds = Boolean(
        api.GetMonitorInfoW(monitorHandle, monitorInfo) && monitorInfo.rcMonitor,
      );
      failures.push({
        message: errorMessage(error),
        ...(hasBounds && monitorInfo.rcMonitor !== undefined
          ? { bounds: toNativeBounds(monitorInfo.rcMonitor) }
          : {}),
      });
    }
  }
  return { monitors, failures };
}

function enumeratePhysicalMonitor(
  api: Bindings,
  monitorHandle: bigint,
  deviceName: string,
  bounds: RectValue,
  hdrState: {
    readonly deviceNames: ReadonlySet<string>;
    readonly trustworthy: boolean;
  },
  acquiredGroups: PhysicalMonitorGroup[],
): EnumeratedMonitor[] {
  const count = [0];
  if (!api.GetNumberOfPhysicalMonitorsFromHMONITOR(monitorHandle, count)) {
    throw win32Error(api, "Could not enumerate physical monitors");
  }
  if ((count[0] ?? 0) === 0) return [];

  const device = readDisplayDevice(api, deviceName);
  const physicalCount = count[0] ?? 0;
  const buffer = Buffer.alloc(
    physicalCount * koffi.sizeof(api.PHYSICAL_MONITOR),
  );
  if (
    !api.GetPhysicalMonitorsFromHMONITOR(
      monitorHandle,
      physicalCount,
      buffer,
    )
  ) {
    throw win32Error(api, "Could not open physical monitor endpoints");
  }
  const group = { count: physicalCount, buffer };
  acquiredGroups.push(group);
  const physicalMonitors = koffi.decode(
    buffer,
    api.PHYSICAL_MONITOR,
    physicalCount,
  ) as PhysicalMonitorValue[];
  return physicalMonitors.map((physical, index) => {
    // Dxva2 monitor handles are opaque; Windows can allocate zero as a valid
    // value, so only the API result determines whether enumeration succeeded.
    const description = physical.szPhysicalMonitorDescription.trim();
    const identity =
      device.DeviceID?.trim() ||
      device.DeviceKey?.trim() ||
      `${deviceName}:${description}`;
    const id = `${identity.toUpperCase()}#${index}`;
    return {
      id,
      endpointId: id,
      name: description || device.DeviceString?.trim() || deviceName,
      deviceName,
      bounds: toNativeBounds(bounds),
      hdr:
        !hdrState.trustworthy ||
        hdrState.deviceNames.has(deviceName.toUpperCase()),
      handle: physical.hPhysicalMonitor,
      group,
    };
  });
}

function readDisplayDevice(
  api: Bindings,
  deviceName: string,
): DisplayDeviceValue {
  const device: DisplayDeviceValue = {
    cb: koffi.sizeof(api.DISPLAY_DEVICEW),
  };
  if (!api.EnumDisplayDevicesW(deviceName, 0, device, 0x1)) {
    throw win32Error(api, "Could not read a stable monitor identity");
  }
  return device;
}

function destroyMonitorGroups(monitors: readonly EnumeratedMonitor[]): void {
  const groups = new Set(monitors.map(({ group }) => group));
  destroyPhysicalMonitorGroups(groups);
}

function destroyPhysicalMonitorGroups(
  groups: Iterable<PhysicalMonitorGroup>,
): void {
  const api = bindings();
  for (const group of groups) {
    api.DestroyPhysicalMonitors(group.count, group.buffer);
  }
}

function readHdrDeviceNames(api: Bindings): {
  readonly deviceNames: ReadonlySet<string>;
  readonly trustworthy: boolean;
} {
  const deviceNames = new Set<string>();
  const pathCount = [0];
  const modeCount = [0];
  const activePathsOnly = 0x2;
  if (
    api.GetDisplayConfigBufferSizes(
      activePathsOnly,
      pathCount,
      modeCount,
    ) !== 0
  ) {
    return { deviceNames, trustworthy: false };
  }
  const pathBuffer = Buffer.alloc(
    (pathCount[0] ?? 0) * koffi.sizeof(api.DISPLAYCONFIG_PATH_INFO),
  );
  const modeBuffer = Buffer.alloc((modeCount[0] ?? 0) * 128);
  if (
    api.QueryDisplayConfig(
      activePathsOnly,
      pathCount,
      pathBuffer,
      modeCount,
      modeBuffer,
      null,
    ) !== 0
  ) {
    return { deviceNames, trustworthy: false };
  }
  const paths = koffi.decode(
    pathBuffer,
    api.DISPLAYCONFIG_PATH_INFO,
    pathCount[0] ?? 0,
  ) as PathInfoValue[];
  let trustworthy = true;
  for (const path of paths) {
    const sourceName = {
      header: {
        type: 1,
        size: koffi.sizeof(api.DISPLAYCONFIG_SOURCE_DEVICE_NAME),
        adapterId: path.sourceInfo.adapterId,
        id: path.sourceInfo.id,
      },
    };
    const advancedColor = {
      header: {
        type: 9,
        size: koffi.sizeof(api.DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO),
        adapterId: path.targetInfo.adapterId,
        id: path.targetInfo.id,
      },
    };
    const sourceResult = api.DisplayConfigGetSourceName(sourceName);
    const colorResult = api.DisplayConfigGetAdvancedColorInfo(advancedColor);
    if (sourceResult !== 0 || colorResult !== 0) {
      trustworthy = false;
      continue;
    }
    if ((((advancedColor as { value?: number }).value ?? 0) & 0x2) !== 0) {
      const name = (sourceName as { viewGdiDeviceName?: string })
        .viewGdiDeviceName;
      if (name) deviceNames.add(name.toUpperCase());
    }
  }
  return { deviceNames, trustworthy };
}

function toNativeBounds(rect: RectValue): NativeBounds {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function win32Error(api: Bindings, message: string): Error {
  return new Error(`${message} (Windows error ${String(api.GetLastError())})`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bindings(): Bindings {
  if (cachedBindings !== undefined) return cachedBindings;

  const user32 = koffi.load("user32.dll");
  const dxva2 = koffi.load("Dxva2.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
  const HMONITOR = koffi.alias("HMONITOR", HANDLE);
  const HDC = koffi.alias("HDC", HANDLE);
  const DWORD = koffi.alias("DWORD", "uint32_t");
  const LONG = koffi.alias("LONG", "int32_t");
  const LUID = koffi.struct("LUID", {
    LowPart: "uint32_t",
    HighPart: "int32_t",
  });
  const RECT = koffi.struct("RECT", {
    left: "int32_t",
    top: "int32_t",
    right: "int32_t",
    bottom: "int32_t",
  });
  const MONITORINFOEXW = koffi.struct("MONITORINFOEXW", {
    cbSize: DWORD,
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: DWORD,
    szDevice: koffi.array("char16_t", 32, "String"),
  });
  const DISPLAY_DEVICEW = koffi.struct("DISPLAY_DEVICEW", {
    cb: DWORD,
    DeviceName: koffi.array("char16_t", 32, "String"),
    DeviceString: koffi.array("char16_t", 128, "String"),
    StateFlags: DWORD,
    DeviceID: koffi.array("char16_t", 128, "String"),
    DeviceKey: koffi.array("char16_t", 128, "String"),
  });
  const PHYSICAL_MONITOR = koffi.struct("PHYSICAL_MONITOR", {
    hPhysicalMonitor: HANDLE,
    szPhysicalMonitorDescription: koffi.array(
      "char16_t",
      128,
      "String",
    ),
  });
  const DISPLAYCONFIG_PATH_SOURCE_INFO = koffi.struct(
    "DISPLAYCONFIG_PATH_SOURCE_INFO",
    {
      adapterId: LUID,
      id: "uint32_t",
      modeInfoIdx: "uint32_t",
      statusFlags: "uint32_t",
    },
  );
  const DISPLAYCONFIG_RATIONAL = koffi.struct("DISPLAYCONFIG_RATIONAL", {
    Numerator: "uint32_t",
    Denominator: "uint32_t",
  });
  const DISPLAYCONFIG_PATH_TARGET_INFO = koffi.struct(
    "DISPLAYCONFIG_PATH_TARGET_INFO",
    {
      adapterId: LUID,
      id: "uint32_t",
      modeInfoIdx: "uint32_t",
      outputTechnology: "uint32_t",
      rotation: "uint32_t",
      scaling: "uint32_t",
      refreshRate: DISPLAYCONFIG_RATIONAL,
      scanLineOrdering: "uint32_t",
      targetAvailable: "int32_t",
      statusFlags: "uint32_t",
    },
  );
  const DISPLAYCONFIG_PATH_INFO = koffi.struct("DISPLAYCONFIG_PATH_INFO", {
    sourceInfo: DISPLAYCONFIG_PATH_SOURCE_INFO,
    targetInfo: DISPLAYCONFIG_PATH_TARGET_INFO,
    flags: "uint32_t",
  });
  const DISPLAYCONFIG_DEVICE_INFO_HEADER = koffi.struct(
    "DISPLAYCONFIG_DEVICE_INFO_HEADER",
    {
      type: "uint32_t",
      size: "uint32_t",
      adapterId: LUID,
      id: "uint32_t",
    },
  );
  const DISPLAYCONFIG_SOURCE_DEVICE_NAME = koffi.struct(
    "DISPLAYCONFIG_SOURCE_DEVICE_NAME",
    {
      header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
      viewGdiDeviceName: koffi.array("char16_t", 32, "String"),
    },
  );
  const DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO = koffi.struct(
    "DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO",
    {
      header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
      value: "uint32_t",
      colorEncoding: "uint32_t",
      bitsPerColorChannel: "uint32_t",
    },
  );
  const monitorEnumProc = koffi.proto(
    "__stdcall",
    "MonitorEnumProc",
    "bool",
    [HMONITOR, HDC, koffi.pointer(RECT), "intptr_t"],
  );

  cachedBindings = {
    RECT,
    MONITORINFOEXW,
    DISPLAY_DEVICEW,
    PHYSICAL_MONITOR,
    DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME,
    DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO,
    EnumDisplayMonitors: user32.func(
      "__stdcall",
      "EnumDisplayMonitors",
      "bool",
      [HDC, koffi.pointer(RECT), koffi.pointer(monitorEnumProc), "intptr_t"],
    ),
    GetMonitorInfoW: user32.func(
      "__stdcall",
      "GetMonitorInfoW",
      "bool",
      [HMONITOR, koffi.inout(koffi.pointer(MONITORINFOEXW))],
    ),
    EnumDisplayDevicesW: user32.func(
      "__stdcall",
      "EnumDisplayDevicesW",
      "bool",
      [
        "char16_t *",
        DWORD,
        koffi.inout(koffi.pointer(DISPLAY_DEVICEW)),
        DWORD,
      ],
    ),
    GetNumberOfPhysicalMonitorsFromHMONITOR: dxva2.func(
      "__stdcall",
      "GetNumberOfPhysicalMonitorsFromHMONITOR",
      "bool",
      [HMONITOR, koffi.out(koffi.pointer(DWORD))],
    ),
    GetPhysicalMonitorsFromHMONITOR: dxva2.func(
      "__stdcall",
      "GetPhysicalMonitorsFromHMONITOR",
      "bool",
      [HMONITOR, DWORD, "void *"],
    ),
    DestroyPhysicalMonitors: dxva2.func(
      "__stdcall",
      "DestroyPhysicalMonitors",
      "bool",
      [DWORD, "void *"],
    ),
    GetMonitorCapabilities: dxva2.func(
      "__stdcall",
      "GetMonitorCapabilities",
      "bool",
      [
        HANDLE,
        koffi.out(koffi.pointer(DWORD)),
        koffi.out(koffi.pointer(DWORD)),
      ],
    ),
    GetMonitorBrightness: dxva2.func(
      "__stdcall",
      "GetMonitorBrightness",
      "bool",
      [
        HANDLE,
        koffi.out(koffi.pointer(DWORD)),
        koffi.out(koffi.pointer(DWORD)),
        koffi.out(koffi.pointer(DWORD)),
      ],
    ),
    SetMonitorBrightness: dxva2.func(
      "__stdcall",
      "SetMonitorBrightness",
      "bool",
      [HANDLE, DWORD],
    ),
    GetDisplayConfigBufferSizes: user32.func(
      "__stdcall",
      "GetDisplayConfigBufferSizes",
      LONG,
      [
        "uint32_t",
        koffi.out(koffi.pointer("uint32_t")),
        koffi.out(koffi.pointer("uint32_t")),
      ],
    ),
    QueryDisplayConfig: user32.func(
      "__stdcall",
      "QueryDisplayConfig",
      LONG,
      [
        "uint32_t",
        koffi.inout(koffi.pointer("uint32_t")),
        "void *",
        koffi.inout(koffi.pointer("uint32_t")),
        "void *",
        "void *",
      ],
    ),
    DisplayConfigGetSourceName: user32.func(
      "__stdcall",
      "DisplayConfigGetDeviceInfo",
      LONG,
      [
        koffi.inout(
          koffi.pointer(DISPLAYCONFIG_SOURCE_DEVICE_NAME),
        ),
      ],
    ),
    DisplayConfigGetAdvancedColorInfo: user32.func(
      "__stdcall",
      "DisplayConfigGetDeviceInfo",
      LONG,
      [
        koffi.inout(
          koffi.pointer(DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO),
        ),
      ],
    ),
    GetLastError: kernel32.func(
      "__stdcall",
      "GetLastError",
      DWORD,
      [],
    ),
  };
  return cachedBindings;
}
