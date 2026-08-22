import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { afterAll, describe, expect, it } from "vitest";

const outputDirectory = mkdtempSync(join(tmpdir(), "darkflash-renderer-build-"));

afterAll(() => rmSync(outputDirectory, { recursive: true, force: true }));

describe("renderer build", () => {
  it("runs as a browser script without CommonJS globals", () => {
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.build.json",
        "--outDir",
        outputDirectory,
      ],
      { cwd: resolve("."), stdio: "pipe" },
    );

    const source = readFileSync(
      join(outputDirectory, "renderer/app.js"),
      "utf8",
    );
    const pendingSnapshot = new Promise(() => undefined);
    const browserContext = {
      document: {
        getElementById: () => ({ innerHTML: "" }),
      },
      window: {
        darkflash: {
          getSnapshot: () => pendingSnapshot,
          onSnapshot: () => () => undefined,
        },
      },
    };

    expect(() =>
      runInNewContext(source, browserContext),
    ).not.toThrow();
    expect(
      runInNewContext(
        'formatSettingValue("responseSpeed", 0.5)',
        browserContext,
      ),
    ).toBe("Balanced");
    expect(
      runInNewContext(
        'formatSettingValue("responseSpeed", 0.9)',
        browserContext,
      ),
    ).toBe("Very fast");
  });
});
