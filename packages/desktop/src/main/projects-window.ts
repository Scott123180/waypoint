import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The projects view: the list, one project at a time, and areas.
 *
 * Follows `sort-window.ts` — not latency-critical, hides rather than closes,
 * and re-reads on open so a hand-edit made while it was hidden is picked up
 * without a restart.
 */
export class ProjectsWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 860,
      height: 640,
      show: false,
      title: "Projects",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "projects.html"));

    // Every edit is already durable, so hiding is always safe (FR-030).
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
    // Redraw everything: a hand-edit made while this was hidden is invisible to
    // any in-process signal, so opening is the moment to re-read from disk.
    this.window?.webContents.send("projects:refresh");
  }

  hide(): void {
    this.window?.hide();
  }

  /**
   * Something wrote a project or area file.
   *
   * Deliberately carries no payload and names no writer — the view re-reads
   * from disk, which is the only account of the file that can be trusted
   * anyway. Distinct from `projects:refresh`, which arrives on open and should
   * redraw everything; this arrives mid-session and must not disturb what the
   * user is currently typing (research R7).
   */
  vaultChanged(): void {
    this.window?.webContents.send("vault:changed");
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }
}
