import { BrowserWindow } from "electron";
import { join } from "node:path";

/**
 * The daily shutdown: four readings taken at one moment.
 *
 * Follows `top-three-window.ts` in shape — not latency-critical, hides rather
 * than closes — with **one deliberate difference, and it is the whole design of
 * this window**: it subscribes to no change signal.
 *
 * Every other view in this app re-reads when the vault changes, and that is
 * right for them: they are windows onto a file, and the file is the only account
 * of itself that can be trusted. This one is a *reading*, taken at the moment it
 * was opened, and its membership is fixed there (FR-010a, FR-011a). Rows updating
 * under someone halfway through a two-minute pass would move the thing they were
 * about to click and reopen a question they had already answered.
 *
 * So there is no `vaultChanged()` here, no `inboxChanged()`, and no
 * `shutdown:changed` channel to carry one. What *is* here is `shutdown:opened`,
 * sent on every show: this window hides rather than closes, so without it a
 * second opening would redisplay the first opening's answer. That signal is what
 * makes the second opening a cold one (FR-010c, research R8).
 *
 * Writes made from this screen still reach every other open view, because they
 * go through the shipped services and `FsVaultStore` raises the change signal
 * from its own write path. Nothing has to be remembered here for that to work.
 */
export class ShutdownWindow {
  private window: BrowserWindow | undefined;

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }

  create(): void {
    const window = new BrowserWindow({
      width: 760,
      height: 720,
      show: false,
      title: "Daily shutdown",
      webPreferences: {
        preload: join(__dirname, "..", "preload", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void window.loadFile(join(__dirname, "..", "renderer", "shutdown.html"));

    // Nothing is in progress, ever, so hiding is always safe. There is no
    // partial state to lose because there is no state at all — closing halfway
    // through leaves nothing unfinished (FR-004, FR-005, FR-010c).
    window.on("close", (event) => {
      event.preventDefault();
      window.hide();
    });

    this.window = window;
  }

  /**
   * Opened only by the user, and always from cold.
   *
   * The signal is sent unconditionally — including when the window already
   * exists and was merely hidden — because that is the case a re-read is *for*.
   * A first `create()` also loads the page, whose script reads on load; the
   * signal is harmless there and load-bearing every time after.
   */
  show(): void {
    if (!this.window) this.create();
    this.window?.show();
    this.window?.focus();
    this.window?.webContents.send("shutdown:opened");
  }

  hide(): void {
    this.window?.hide();
  }

  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }
}
