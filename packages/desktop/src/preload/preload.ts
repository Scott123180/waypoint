import { contextBridge, ipcRenderer } from "electron";

export type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

export interface Notice {
  id?: string;
  level: "info" | "error";
  message: string;
  recoverableText?: string;
}

/**
 * The entire surface the renderer can reach. Nothing else crosses the bridge.
 */
export type TranscribeResponse =
  | { status: "ok"; text: string }
  | { status: "no-speech" }
  | { status: "failed"; message: string };

const api = {
  submit(text: string, source: "typed" | "dictated"): Promise<SubmitResponse> {
    return ipcRenderer.invoke("capture:submit", text, source);
  },

  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResponse> {
    return ipcRenderer.invoke("capture:transcribe", samples, sampleRate);
  },

  /** Test seam: lets the E2E suite drive dictation without a microphone. */
  onFakeDictation(callback: (result: TranscribeResponse) => void): void {
    ipcRenderer.on("capture:fake-dictation", (_event, result: TranscribeResponse) =>
      callback(result),
    );
  },

  undo(id: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke("capture:undo", id);
  },

  ackNotice(id: string): void {
    ipcRenderer.send("capture:notice-ack", id);
  },

  dismiss(): void {
    ipcRenderer.send("capture:dismiss");
  },

  onReset(callback: (mode: "type" | "dictate") => void): void {
    ipcRenderer.on("capture:reset", (_event, mode: "type" | "dictate" = "type") => callback(mode));
  },

  /** Dictation asked for on a box that was already open, so nothing is reset. */
  onStartDictation(callback: () => void): void {
    ipcRenderer.on("capture:start-dictation", () => callback());
  },

  onNotice(callback: (notice: Notice) => void): void {
    ipcRenderer.on("capture:notice", (_event, notice: Notice) => callback(notice));
  },
};

/**
 * Sort channels. Pass-throughs only — the renderer has no way to express what
 * a destination *is*, only which one the user picked.
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */
export interface ItemRef {
  start: number;
  end: number;
  raw: string;
}

export type SortDecision =
  | { to: "project"; slug: string }
  | { to: "project"; createTitle: string }
  | { to: "area"; slug: string }
  | { to: "area"; createTitle: string }
  | { to: "waiting"; owner: string }
  | { to: "calendar" }
  | { to: "trash" };

export type SortNextResponse =
  | { item: { text: string; capturedAt: string | null; ref: ItemRef } }
  | { item: null };

export type SortDecideResponse =
  | { ok: true; destination: string }
  | { ok: false; reason: string; message: string };

const sortApi = {
  next(): Promise<SortNextResponse> {
    return ipcRenderer.invoke("sort:next");
  },

  destinations(): Promise<{
    projects: { slug: string; title: string }[];
    areas: { slug: string; title: string }[];
  }> {
    return ipcRenderer.invoke("sort:destinations");
  },

  count(): Promise<number> {
    return ipcRenderer.invoke("sort:count");
  },

  decide(ref: ItemRef, decision: SortDecision): Promise<SortDecideResponse> {
    return ipcRenderer.invoke("sort:decide", ref, decision);
  },

  dismiss(): void {
    ipcRenderer.send("sort:dismiss");
  },

  onRefresh(callback: () => void): void {
    ipcRenderer.on("sort:refresh", () => callback());
  },

  /**
   * The inbox changed while this view was open.
   *
   * The channel is `inbox:changed`, not `sort:something`: it is named for the
   * file, so capture, undo, sort, and any client added later all raise the one
   * event, and a future view subscribes to it without a new channel.
   */
  onInboxChanged(callback: () => void): void {
    ipcRenderer.on("inbox:changed", () => callback());
  },

  onRecovered(callback: (report: { completed: number; abandoned: number }) => void): void {
    ipcRenderer.on("sort:recovered", (_event, report) => callback(report));
  },

  onNotice(callback: (notice: Notice) => void): void {
    ipcRenderer.on("sort:notice", (_event, notice: Notice) => callback(notice));
  },
};

contextBridge.exposeInMainWorld("waypoint", { ...api, sort: sortApi });

export type WaypointApi = typeof api & { sort: typeof sortApi };
export type WaypointSortApi = typeof sortApi;
