import { BrowserWindow } from "electron";
import { join } from "node:path";

import type { Notice } from "./hotkey";

const TRACE = process.env["WAYPOINT_TRACE_LATENCY"] === "1";

/**
 * The capture surface.
 *
 * Created once at startup and kept loaded but hidden, because building a window
 * on demand costs hundreds of milliseconds and would blow the <100ms budget on
 * the common cold trigger. Showing an already-loaded window is a few ms.
 */
export class CaptureWindow {
  private window: BrowserWindow | undefined;

  create(): void {
    const window = new BrowserWindow({
      width: 620,
      height: 180,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A hidden window is normally throttled; that would reintroduce latency
      // on the very path this class exists to keep fast.
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "index.html"));

    // Reaching the box from a fullscreen app must not force a Space switch.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Dismissing by clicking away should behave like Escape, not like quitting.
    window.on("blur", () => this.hide());

    this.window = window;
  }

  /**
   * Shows the box, or does nothing if it is already open.
   *
   * The no-op is the point: a second hotkey press while the user is midway
   * through typing must not clear what they have written (FR-003a).
   */
  show(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isVisible()) return;

    const started = TRACE ? Date.now() : 0;

    window.webContents.send("capture:reset");
    window.show();
    window.focus();

    if (TRACE) {
      console.log(`[waypoint] trigger -> shown in ${Date.now() - started}ms`);
    }
  }

  hide(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (!window.isVisible()) return;
    window.hide();
  }

  isVisible(): boolean {
    const window = this.window;
    return Boolean(window && !window.isDestroyed() && window.isVisible());
  }

  notify(notice: Notice): void {
    this.window?.webContents.send("capture:notice", notice);
  }

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }
}
