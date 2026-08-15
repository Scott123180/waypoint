import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The weekly review: four steps, in order, once a week.
 *
 * Follows `top-three-window.ts` exactly — not latency-critical, hides rather
 * than closes, and re-reads on open so a hand-edit made while it was hidden is
 * picked up without a restart.
 *
 * Hiding is safe at any point because every decision is already on disk: the
 * in-progress review *is* its log file, so there is no unsaved state a close
 * could lose (research R2).
 */
export class ReviewWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 720,
      height: 640,
      show: false,
      title: "Weekly review",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "review.html"));

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
    // Opening is the moment to re-read: a hand-edit, or a sort done in another
    // window, is invisible to any in-process signal.
    this.window?.webContents.send("review:refresh");
  }

  hide(): void {
    this.window?.hide();
  }

  /**
   * Something wrote a file in the vault.
   *
   * The same generic signal the projects and top-three views use, carrying no
   * payload and naming no writer. The review reads projects, the top three, and
   * `waiting.md`, all written through the same `VaultStore` — so a change to
   * any of them arrives here with no new wiring.
   */
  vaultChanged(): void {
    this.window?.webContents.send("vault:changed");
  }

  /**
   * Something wrote `inbox.md`.
   *
   * A second signal because the inbox is not in the vault store — it has its
   * own adapter and its own write path, so a vault change never fires for it.
   * The review needs it for one reason: the inbox step offers "go sort these",
   * which shows Feature 2's window **without hiding the review**, so `show()`
   * never runs again and the `review:refresh` it sends never arrives. Sorting
   * items to trash writes nothing but `inbox.md`, and without this the step
   * goes on naming the count the user just went and changed (FR-016).
   */
  inboxChanged(): void {
    this.window?.webContents.send("inbox:changed");
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }
}
