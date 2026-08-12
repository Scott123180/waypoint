import { ipcMain } from "electron";

import {
  CaptureService,
  EmptyCaptureError,
  type ItemRef,
  type SortDecision,
  type SortService,
} from "@waypoint/core";

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
export function registerIpc(
  service: CaptureService,
  window: CaptureWindow,
  sort?: SortService,
  hideSort?: () => void,
  /**
   * Called whenever something may have opened or closed the undo window, so the
   * tray menu can follow. Linux never gets a menu-open event to refresh on, so
   * the change has to be pushed from here.
   */
  onUndoableChange?: () => void,
): void {
  if (sort) registerSortIpc(sort, service, hideSort, onUndoableChange);

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
        onUndoableChange?.();
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
    const outcome = await service.undo(id);
    onUndoableChange?.();
    return outcome;
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

/**
 * Sort channels. Every one is a pass-through to `SortService`.
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */
function registerSortIpc(
  sort: SortService,
  capture: CaptureService,
  hideSort?: () => void,
  onUndoableChange?: () => void,
): void {
  ipcMain.on("sort:dismiss", () => hideSort?.());

  ipcMain.handle("sort:next", async () => {
    const item = await sort.next();
    if (!item) return { item: null };
    return {
      item: {
        text: item.text,
        // Crosses as a string; null stays null so the renderer shows no
        // timestamp rather than inventing today's date (FR-027a).
        capturedAt: item.capturedAt ? item.capturedAt.toISOString() : null,
        ref: item.ref,
      },
    };
  });

  ipcMain.handle("sort:destinations", async () => sort.destinations());

  ipcMain.handle("sort:count", async () => sort.count());

  ipcMain.handle("sort:decide", async (_event, ref: ItemRef, decision: SortDecision) => {
    const outcome = await sort.sort(ref, decision);

    if (outcome.ok) {
      // The inbox has been spliced, so any open capture undo window now points
      // at stale offsets. performUndo already refuses safely in that state
      // (research R4b); expiring it turns a confusing refusal into no
      // affordance at all.
      capture.expireUndoWindow();
      onUndoableChange?.();
    }

    return outcome;
  });
}
