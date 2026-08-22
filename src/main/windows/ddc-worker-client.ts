import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type {
  BrightnessCapability,
  BrightnessPort,
} from "../../core/types.js";
import type {
  DdcRequest,
  DdcRequestPayload,
  DdcResponse,
  DdcResult,
  DiscoveryResponse,
  NativeMonitorDiscoveryResult,
} from "./ddc-protocol.js";

const REQUEST_TIMEOUT_MS = 2_000;
const DISCOVERY_TIMEOUT_MS = 3_000;

interface PendingRequest {
  readonly resolve: (value: DdcResult) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

export class DdcWorkerClient implements BrightnessPort {
  private readonly workers = new Map<string, EndpointWorker>();

  async discover(): Promise<NativeMonitorDiscoveryResult> {
    if (process.platform !== "win32") {
      return { monitors: [], failures: [] };
    }
    const worker = new Worker(workerPath(), {
      workerData: { mode: "discover" },
    });
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new Error("Windows monitor discovery timed out"));
      }, DISCOVERY_TIMEOUT_MS);
      worker.once("message", (response: DiscoveryResponse) => {
        clearTimeout(timeout);
        void worker.terminate();
        if (response.ok) resolve(response.value);
        else reject(new Error(response.error));
      });
      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async probe(endpointId: string): Promise<BrightnessCapability | null> {
    if (process.platform !== "win32") return null;
    const value = await this.request(endpointId, { operation: "probe" });
    return value as BrightnessCapability | null;
  }

  async read(endpointId: string): Promise<number> {
    const value = await this.request(endpointId, { operation: "read" });
    if (typeof value !== "number") {
      throw new Error("The DDC/CI worker returned an invalid brightness value");
    }
    return value;
  }

  async set(endpointId: string, brightness: number): Promise<void> {
    await this.request(endpointId, {
      operation: "set",
      value: brightness,
    });
  }

  async dispose(): Promise<void> {
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.all(workers.map(async (worker) => worker.dispose()));
  }

  private async request(
    endpointId: string,
    request: DdcRequestPayload,
  ): Promise<DdcResult> {
    let worker = this.workers.get(endpointId);
    if (worker === undefined) {
      worker = new EndpointWorker(endpointId, () => {
        this.workers.delete(endpointId);
      });
      this.workers.set(endpointId, worker);
    }
    return await worker.request(request);
  }
}

class EndpointWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private stopped = false;

  constructor(
    endpointId: string,
    private readonly onStopped: () => void,
  ) {
    this.worker = new Worker(workerPath(), {
      workerData: { mode: "endpoint", endpointId },
    });
    this.worker.on("message", (response: DdcResponse) => {
      const pending = this.pending.get(response.id);
      if (pending === undefined) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.error));
    });
    this.worker.on("error", (error) => this.stop(error));
    this.worker.on("exit", (code) => {
      if (!this.stopped && code !== 0) {
        this.stop(new Error(`The DDC/CI worker exited with code ${code}`));
      }
    });
  }

  async request(request: DdcRequestPayload): Promise<DdcResult> {
    if (this.stopped) throw new Error("The DDC/CI worker is unavailable");
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop(new Error("The monitor did not respond before the timeout"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      const message: DdcRequest = { id, ...request };
      this.worker.postMessage(message);
    });
  }

  async dispose(): Promise<void> {
    this.stop(new Error("The DDC/CI worker was stopped"));
    await this.worker.terminate();
  }

  private stop(error: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.onStopped();
    void this.worker.terminate();
  }
}

function workerPath(): string {
  return join(__dirname, "ddc-worker.js");
}
