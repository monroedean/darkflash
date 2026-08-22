import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const outputDirectory = "release";
const electronCache = join(tmpdir(), "darkflash-electron-cache");
const applicationDirectory = join(
  outputDirectory,
  "Darkflash-win32-x64",
  "resources",
  "app",
);

await run(npm, ["run", "build"]);
await run(
  npm,
  [
    "exec",
    "--",
    "electron-packager",
    ".",
    "Darkflash",
    "--platform=win32",
    "--arch=x64",
    `--out=${outputDirectory}`,
    "--overwrite",
    "--prune=true",
    "--no-asar",
    "--ignore=^/(release|tests|\\.scratch|\\.git)",
    `--download.cacheRoot=${electronCache}`,
  ],
  {
    ELECTRON_CACHE: electronCache,
    electron_config_cache: electronCache,
    XDG_CACHE_HOME: tmpdir(),
  },
);
await run(npm, [
  "install",
  `--prefix=${applicationDirectory}`,
  "--no-save",
  "--no-package-lock",
  "--omit=dev",
  "--ignore-scripts",
  "--force",
  "--os=win32",
  "--cpu=x64",
  "@koromix/koffi-win32-x64@3.1.6",
]);

function run(command, arguments_, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: "inherit",
      env: { ...process.env, ...extraEnvironment },
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
