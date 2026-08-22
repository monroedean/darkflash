import { cp, mkdir } from "node:fs/promises";

const source = new URL("../src/renderer", import.meta.url);
const destination = new URL("../dist/renderer", import.meta.url);

await mkdir(destination, { recursive: true });
await cp(source, destination, {
  recursive: true,
  filter: (path) => !path.endsWith(".ts"),
});
