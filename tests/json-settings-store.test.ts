import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonSettingsStore } from "../src/main/json-settings-store.js";
import type { PersistedSettings } from "../src/core/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("JSON settings persistence", () => {
  it("restores valid per-monitor configuration across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darkflash-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    const settings: PersistedSettings = {
      enabled: true,
      monitors: {
        "stable-monitor-id": {
          minimumBrightness: 15,
          maximumBrightness: 72,
          effectStrength: 0.6,
          responseSpeed: 0.4,
        },
      },
    };

    await new JsonSettingsStore(path).save(settings);
    const restored = await new JsonSettingsStore(path).load();

    expect(restored).toEqual(settings);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(settings);
  });

  it("rejects a corrupted brightness range with a user-facing error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darkflash-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    await writeFile(
      path,
      JSON.stringify({
        enabled: true,
        monitors: {
          monitor: {
            minimumBrightness: 90,
            maximumBrightness: 10,
            effectStrength: 1,
            responseSpeed: 0.5,
          },
        },
      }),
      "utf8",
    );

    await expect(new JsonSettingsStore(path).load()).rejects.toThrow(
      "settings.json contains invalid monitor settings",
    );
  });
});
