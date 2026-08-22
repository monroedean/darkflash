import { desktopCapturer, type DesktopCapturerSource } from "electron";

import type { CapturePort, RgbFrame } from "../core/types.js";
import { bgraToRgba } from "./bitmap.js";

const CAPTURE_WIDTH = 96;
const CAPTURE_HEIGHT = 54;

export class ElectronCaptureAdapter implements CapturePort {
  private currentCapture: Promise<DesktopCapturerSource[]> | undefined;

  async capture(displayId: string): Promise<RgbFrame> {
    this.currentCapture ??= desktopCapturer
      .getSources({
        types: ["screen"],
        thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        fetchWindowIcons: false,
      })
      .finally(() => {
        this.currentCapture = undefined;
      });
    const sources = await this.currentCapture;
    const source = sources.find(({ display_id: id }) => id === displayId);
    if (source === undefined || source.thumbnail.isEmpty()) {
      throw new Error("Screen capture is unavailable for this display");
    }
    const { width, height } = source.thumbnail.getSize();
    const bitmap = source.thumbnail.toBitmap();
    if (width <= 0 || height <= 0 || bitmap.length !== width * height * 4) {
      throw new Error("Screen capture returned an incomplete frame");
    }
    return { width, height, rgba: bgraToRgba(bitmap) };
  }
}
