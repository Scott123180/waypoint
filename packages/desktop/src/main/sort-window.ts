import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The sort view.
 *
 * Unlike the capture box this is not pre-warmed and not latency-critical:
 * sorting is a deliberate sit-down activity, and the budget that matters is
 * decision-to-next-item (SC-002a), not open-the-window.
 */
export class SortWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 720,
      height: 520,
      show: false,
      title: "Sort inbox",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "sort.html"));

    // Closing the sort view must not quit a background agent, and every
    // decision is already durable, so hiding is always safe (FR-024).
    window.on("close", (event) => {
      event.preventDefault();
      window.hide();
    });

    this.window = window;
  }

  show(): void {
    if (!this.window) this.create();
    this.window?.show();
    this.window?.focus();
    // Re-reads the inbox from disk, so a hand-edit made while the window was
    // hidden is picked up without a restart.
    this.window?.webContents.send("sort:refresh");
  }

  hide(): void {
    this.window?.hide();
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  notify(payload: unknown): void {
    this.window?.webContents.send("sort:notice", payload);
  }

  recovered(report: { completed: number; abandoned: number }): void {
    this.window?.webContents.send("sort:recovered", report);
  }
}
