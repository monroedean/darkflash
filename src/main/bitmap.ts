export function bgraToRgba(bitmap: Uint8Array): Uint8Array {
  const rgba = Uint8Array.from(bitmap);
  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    const blue = rgba[offset] ?? 0;
    rgba[offset] = rgba[offset + 2] ?? 0;
    rgba[offset + 2] = blue;
  }
  return rgba;
}
