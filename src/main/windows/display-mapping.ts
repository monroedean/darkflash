import type {
  NativeBounds,
  NativeMonitorDiscoveryFailure,
  NativeMonitorDescriptor,
} from "./ddc-protocol.js";
import type { DisplayDevice } from "../../core/types.js";

export interface DisplayGeometry {
  readonly id: number;
  readonly label: string;
  readonly nativeOrigin?: { readonly x: number; readonly y: number };
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly size: { readonly width: number; readonly height: number };
  readonly scaleFactor: number;
}

export function matchNativeMonitorToDisplay(
  monitor: Pick<NativeMonitorDescriptor, "bounds">,
  displays: readonly DisplayGeometry[],
): DisplayGeometry | undefined {
  let best: { readonly display: DisplayGeometry; readonly overlap: number } | undefined;
  for (const display of displays) {
    const displayBounds = nativeBoundsForDisplay(display);
    const overlap = intersectionArea(monitor.bounds, displayBounds);
    if (best === undefined || overlap > best.overlap) {
      best = { display, overlap };
    }
  }
  return best?.overlap === 0 ? undefined : best?.display;
}

export function mapNativeMonitorsToDisplays(
  monitors: readonly NativeMonitorDescriptor[],
  displays: readonly DisplayGeometry[],
  failures: readonly NativeMonitorDiscoveryFailure[] = [],
): readonly DisplayDevice[] {
  const matchedDisplayIds = new Set<number>();
  const supported = monitors.flatMap((monitor) => {
    const display = matchNativeMonitorToDisplay(monitor, displays);
    if (display === undefined) return [];
    matchedDisplayIds.add(display.id);
    return [
      {
        id: monitor.id,
        displayId: String(display.id),
        control: { kind: "ddc" as const, endpointId: monitor.endpointId },
        name: monitor.name,
      },
    ];
  });
  const failuresByDisplayId = new Map<number, string>();
  let hasUnlocalizedFailure = false;
  for (const failure of failures) {
    const display =
      failure.bounds === undefined
        ? undefined
        : matchNativeMonitorToDisplay({ bounds: failure.bounds }, displays);
    if (display === undefined) {
      hasUnlocalizedFailure = true;
    } else if (!matchedDisplayIds.has(display.id)) {
      failuresByDisplayId.set(display.id, failure.message);
    }
  }
  const unavailable = displays
    .filter(({ id }) => !matchedDisplayIds.has(id))
    .map((display) => {
      const failure = failuresByDisplayId.get(display.id);
      if (failure !== undefined || hasUnlocalizedFailure) {
        return discoveryErrorDisplay(
          display,
          failure ?? "Windows could not identify this display",
        );
      }
      return {
        id: `unsupported-${display.id}`,
        displayId: String(display.id),
        control: { kind: "unsupported" as const },
        name: display.label || `Display ${display.id}`,
      };
    });
  return [...supported, ...unavailable];
}

export function mapDisplayDiscoveryFailure(
  displays: readonly DisplayGeometry[],
  error: unknown,
): readonly DisplayDevice[] {
  const message = error instanceof Error ? error.message : String(error);
  return displays.map((display) => discoveryErrorDisplay(display, message));
}

function discoveryErrorDisplay(
  display: DisplayGeometry,
  message: string,
): DisplayDevice {
  return {
    id: `discovery-error-${display.id}`,
    displayId: String(display.id),
    control: { kind: "discovery-error" as const, message },
    name: display.label || `Display ${display.id}`,
  };
}

function nativeBoundsForDisplay(display: DisplayGeometry): NativeBounds {
  const left = display.nativeOrigin?.x ?? display.bounds.x * display.scaleFactor;
  const top = display.nativeOrigin?.y ?? display.bounds.y * display.scaleFactor;
  return {
    left,
    top,
    right: left + display.size.width * display.scaleFactor,
    bottom: top + display.size.height * display.scaleFactor,
  };
}

function intersectionArea(left: NativeBounds, right: NativeBounds): number {
  const width = Math.max(
    0,
    Math.min(left.right, right.right) - Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top),
  );
  return width * height;
}
