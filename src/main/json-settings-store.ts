import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { parsePersistedSettings } from "../core/settings.js";
import type { PersistedSettings, SettingsPort } from "../core/types.js";

const DEFAULT_SETTINGS: PersistedSettings = { enabled: false, monitors: {} };

export class JsonSettingsStore implements SettingsPort {
  constructor(private readonly path: string) {}

  async load(): Promise<PersistedSettings> {
    try {
      const contents = await readFile(this.path, "utf8");
      return parsePersistedSettings(JSON.parse(contents) as unknown);
    } catch (error) {
      if (isMissingFile(error)) return DEFAULT_SETTINGS;
      throw new Error(
        `settings.json contains invalid monitor settings: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async save(settings: PersistedSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
