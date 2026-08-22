import { describe, expect, it } from "vitest";

import { bgraToRgba } from "../src/main/bitmap.js";

describe("Electron capture bitmap contract", () => {
  it("converts Electron's native BGRA bytes to the core RGBA frame format", () => {
    expect(bgraToRgba(Uint8Array.from([30, 20, 10, 255]))).toEqual(
      Uint8Array.from([10, 20, 30, 255]),
    );
  });
});
