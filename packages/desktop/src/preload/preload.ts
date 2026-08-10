import { contextBridge, ipcRenderer } from "electron";

export type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

export interface Notice {
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

  dismiss(): void {
    ipcRenderer.send("capture:dismiss");
  },

  onReset(callback: () => void): void {
    ipcRenderer.on("capture:reset", () => callback());
  },

  onNotice(callback: (notice: Notice) => void): void {
    ipcRenderer.on("capture:notice", (_event, notice: Notice) => callback(notice));
  },
};

contextBridge.exposeInMainWorld("waypoint", api);

export type WaypointApi = typeof api;
