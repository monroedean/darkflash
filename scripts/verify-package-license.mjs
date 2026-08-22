import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory =
  process.argv[2] ?? join("release", "Darkflash-win32-x64");
const applicationDirectory = join(releaseDirectory, "resources", "app");

const [projectLicense, releaseLicense] = await Promise.all([
  readFile("LICENSE", "utf8"),
  readFile(join(releaseDirectory, "LICENSE"), "utf8"),
]);

assert.ok(
  releaseLicense === projectLicense,
  "The release-root LICENSE must contain Darkflash's GPL license",
);

const [electronLicense, packagedApplicationLicense, packagedManifest] =
  await Promise.all([
    readFile(join(releaseDirectory, "LICENSE.electron.txt"), "utf8"),
    readFile(join(applicationDirectory, "LICENSE"), "utf8"),
    readFile(join(applicationDirectory, "package.json"), "utf8"),
  ]);
assert.ok(
  packagedApplicationLicense === projectLicense,
  "The packaged application must contain Darkflash's GPL license",
);
assert.match(
  electronLicense,
  /Electron contributors/,
  "The renamed Electron license must retain its copyright notice",
);
assert.equal(
  JSON.parse(packagedManifest).license,
  "GPL-3.0-only",
  "The packaged application metadata must use GPL-3.0-only",
);

console.log("Packaged Darkflash and Electron licenses are correctly identified.");
