import type { DarkflashApi } from "../preload.js";

declare global {
  interface Window {
    readonly darkflash: DarkflashApi;
  }
}

export {};
