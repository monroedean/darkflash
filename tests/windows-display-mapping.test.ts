import { describe, expect, it } from "vitest";

import {
  mapDisplayDiscoveryFailure,
  mapNativeMonitorsToDisplays,
  matchNativeMonitorToDisplay,
} from "../src/main/windows/display-mapping.js";

describe("Windows display mapping contract", () => {
  it("matches a physical monitor to the Electron display with the largest native-pixel overlap", () => {
    const displays = [
      {
        id: 1,
        label: "Left",
        nativeOrigin: { x: -1920, y: 0 },
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      {
        id: 2,
        label: "Right",
        nativeOrigin: { x: 0, y: 0 },
        bounds: { x: 0, y: 0, width: 1280, height: 720 },
        size: { width: 1280, height: 720 },
        scaleFactor: 1.5,
      },
    ];

    const match = matchNativeMonitorToDisplay(
      { bounds: { left: 0, top: 0, right: 1920, bottom: 1080 } },
      displays,
    );

    expect(match?.id).toBe(2);
  });

  it("keeps an Electron display visible when no physical DDC endpoint maps to it", () => {
    const displays = [
      {
        id: 1,
        label: "External",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      {
        id: 2,
        label: "Laptop panel",
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      },
    ];
    const devices = mapNativeMonitorsToDisplays(
      [
        {
          id: "external-id",
          endpointId: "external-endpoint",
          name: "External",
          deviceName: "\\\\.\\DISPLAY1",
          bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
          hdr: false,
        },
      ],
      displays,
    );

    expect(devices).toEqual([
      {
        id: "external-id",
        displayId: "1",
        control: { kind: "ddc", endpointId: "external-endpoint" },
        name: "External",
      },
      {
        id: "unsupported-2",
        displayId: "2",
        control: { kind: "unsupported" },
        name: "Laptop panel",
      },
    ]);
  });

  it("models a discovery failure as retryable instead of unsupported", () => {
    const devices = mapDisplayDiscoveryFailure(
      [
        {
          id: 2,
          label: "Laptop panel",
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          size: { width: 1920, height: 1080 },
          scaleFactor: 1,
        },
      ],
      new Error("Windows monitor discovery timed out"),
    );

    expect(devices).toEqual([
      {
        id: "discovery-error-2",
        displayId: "2",
        control: {
          kind: "discovery-error",
          message: "Windows monitor discovery timed out",
        },
        name: "Laptop panel",
      },
    ]);
  });

  it("keeps a healthy display controllable when another display fails discovery", () => {
    const displays = [
      {
        id: 1,
        label: "Healthy",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      },
      {
        id: 2,
        label: "Broken",
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      },
    ];
    const devices = mapNativeMonitorsToDisplays(
      [
        {
          id: "healthy-id",
          endpointId: "healthy-endpoint",
          name: "Healthy",
          deviceName: "\\\\.\\DISPLAY1",
          bounds: { left: 0, top: 0, right: 1920, bottom: 1080 },
          hdr: false,
        },
      ],
      displays,
      [
        {
          bounds: { left: 1920, top: 0, right: 3840, bottom: 1080 },
          message: "Could not open physical monitor endpoints",
        },
      ],
    );

    expect(devices).toEqual([
      {
        id: "healthy-id",
        displayId: "1",
        control: { kind: "ddc", endpointId: "healthy-endpoint" },
        name: "Healthy",
      },
      {
        id: "discovery-error-2",
        displayId: "2",
        control: {
          kind: "discovery-error",
          message: "Could not open physical monitor endpoints",
        },
        name: "Broken",
      },
    ]);
  });
});
