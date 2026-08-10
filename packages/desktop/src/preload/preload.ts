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
const api = {
  submit(text: string, source: "typed" | "dictated"): Promise<SubmitResponse> {
    return ipcRenderer.invoke("capture:submit", text, source);
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
