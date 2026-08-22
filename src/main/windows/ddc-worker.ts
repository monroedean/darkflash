import { parentPort, workerData } from "node:worker_threads";

import type {
  DdcRequest,
  DdcResponse,
  DiscoveryResponse,
} from "./ddc-protocol.js";
import {
  discoverNativeMonitors,
  probeNativeMonitor,
  readNativeBrightness,
  setNativeBrightness,
} from "./native-monitor-api.js";

const port = parentPort;
if (port === null) throw new Error("The DDC worker requires a parent port");

const data = workerData as
  | { readonly mode: "discover" }
  | { readonly mode: "endpoint"; readonly endpointId: string };

if (data.mode === "discover") {
  let response: DiscoveryResponse;
  try {
    response = { ok: true, value: discoverNativeMonitors() };
  } catch (error) {
    response = { ok: false, error: errorMessage(error) };
  }
  port.postMessage(response);
  port.close();
} else {
  port.on("message", (request: DdcRequest) => {
    let response: DdcResponse;
    try {
      switch (request.operation) {
        case "probe":
          response = {
            id: request.id,
            ok: true,
            value: probeNativeMonitor(data.endpointId),
          };
          break;
        case "read":
          response = {
            id: request.id,
            ok: true,
            value: readNativeBrightness(data.endpointId),
          };
          break;
        case "set":
          setNativeBrightness(data.endpointId, request.value);
          response = { id: request.id, ok: true, value: undefined };
          break;
      }
    } catch (error) {
      response = { id: request.id, ok: false, error: errorMessage(error) };
    }
    port.postMessage(response);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown DDC/CI error";
}
