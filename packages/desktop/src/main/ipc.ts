import { ipcMain } from "electron";

import { CaptureService, EmptyCaptureError } from "@waypoint/core";

import { toWhisperWav } from "./audio-encode";
import type { CaptureWindow } from "./capture-window";

export type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

/**
 * Thin pass-throughs to the core.
 *
 * Deliberately absent: any channel that would let the renderer set a
 * timestamp, write the inbox directly, or store a transcript unseen. The
 * client cannot hold domain logic it has no way to express.
 */
export function registerIpc(service: CaptureService, window: CaptureWindow): void {
  ipcMain.handle(
    "capture:transcribe",
    async (_event, samples: Float32Array, sampleRate: number) => {
      // Encoding happens here rather than in the renderer so the client stays
      // thin and the conversion is covered by the fast test suite.
      const wav = toWhisperWav(Float32Array.from(samples), sampleRate);
      return service.transcribe(wav);
    },
  );

  ipcMain.handle(
    "capture:submit",
    async (_event, text: string, source: "typed" | "dictated"): Promise<SubmitResponse> => {
      try {
        const result = await service.submit(text, source);
        return { ok: true, id: result.id };
      } catch (err) {
        if (err instanceof EmptyCaptureError) {
          return { ok: false, error: "empty" };
        }
        throw err;
      }
    },
  );

  ipcMain.handle("capture:undo", async (_event, id: string) => {
    return service.undo(id);
  });

  ipcMain.on("capture:notice-ack", (_event, id: string) => {
    window.acknowledgeNotice(id);
  });

  ipcMain.on("capture:dismiss", () => {
    // Deliberately does NOT expire the undo window. Submitting closes the box
    // via this same channel, and expiring here would destroy the undo window
    // the moment it was created. The window expires when the next capture
    // begins, which submit() handles.
    window.hide();
  });
}
