import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The weekly top three: this week's commitment, and every week before it.
 *
 * Follows `projects-window.ts` exactly — not latency-critical, hides rather
 * than closes, and re-reads on open so a hand-edit made while it was hidden is
 * picked up without a restart.
 */
export class TopThreeWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 640,
      height: 560,
      show: false,
      title: "Top three",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "top-three.html"));

    // Every edit is already durable, so hiding is always safe.
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
    // A hand-edit made while this was hidden is invisible to any in-process
    // signal, so opening is the moment to re-read from disk.
    this.window?.webContents.send("top-three:refresh");
  }

  hide(): void {
    this.window?.hide();
  }

  /**
   * Something wrote a file in the vault.
   *
   * The same generic signal the projects view uses, carrying no payload and
   * naming no writer. `top-three.md` is written through the same `VaultStore`,
   * so this arrives without any new wiring — including for a write made from
   * another window, or later from the local API (research R9).
   */
  vaultChanged(): void {
    this.window?.webContents.send("vault:changed");
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }
}
