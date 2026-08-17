import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The retrospective: what was finished between two dates.
 *
 * Follows `top-three-window.ts` in shape, and departs from it in one way that
 * matters. Every other window re-reads when the vault changes, because every
 * other window shows current state. This one shows *a reading* — an answer to a
 * question, taken at a moment — and re-rendering it under the user while they
 * are copying text out of it would break both the copy in their clipboard and
 * the promise that an export is what they were looking at (006 FR-010a).
 *
 * So `vaultChanged` here sends a notice rather than a refresh. The renderer
 * shows it and offers to re-read; nothing re-reads on its own.
 *
 * It also opens with no range chosen and reads nothing until one is submitted:
 * the system never runs a retrospective the user did not ask for (FR-057).
 *
 * See specs/006-retrospective-view/contracts/retrospective-api.md
 */
export class RetrospectiveWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 820,
      height: 720,
      show: false,
      title: "Retrospective",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "retrospective.html"));

    // Nothing here is unsaved, because nothing here is ever written.
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
  }

  hide(): void {
    this.window?.hide();
  }

  /**
   * Something wrote a file in the vault.
   *
   * Deliberately **not** a refresh. The reading on screen stays exactly as it
   * is; the renderer surfaces a notice and the user chooses when to re-read.
   * A stale reading is still a true account of what the files said when it was
   * taken, and it remains readable and exportable as one (FR-010b, FR-010d).
   */
  vaultChanged(): void {
    this.window?.webContents.send("retrospective:changed");
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }
}
