import { BrowserWindow } from "electron";
import { join } from "node:path";

import type { Notice } from "./hotkey";
import { NoticeQueue } from "./notice-queue";

const TRACE = process.env["WAYPOINT_TRACE_LATENCY"] === "1";

/** Which hotkey opened the box: one starts typing, the other starts listening. */
export type CaptureMode = "type" | "dictate";

/**
 * The capture surface.
 *
 * Created once at startup and kept loaded but hidden, because building a window
 * on demand costs hundreds of milliseconds and would blow the <100ms budget on
 * the common cold trigger. Showing an already-loaded window is a few ms.
 */
export class CaptureWindow {
  private window: BrowserWindow | undefined;
  private readonly notices = new NoticeQueue();

  /**
   * Dictation is in flight: the microphone is open, or a transcript is still on
   * its way back. Reported by the renderer, which owns the state machine.
   */
  private dictating = false;

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

    window.on("blur", () => this.blurred());

    this.window = window;
  }

  /**
   * The box lost focus — the user clicked another window.
   *
   * Dismissing by clicking away should behave like Escape, not like quitting.
   * Except while dictation is in flight, when it must not happen at all: hiding
   * does not stop the recording, so it used to leave the microphone live on a
   * window nobody could see, and the next open sent `capture:reset`, silently
   * discarding everything said before the click. Staying visible keeps the box
   * as its own indicator that the app is listening, which is exactly what the
   * Escape path already refuses to leave behind.
   *
   * Separate from the listener that calls it so the E2E suite can drive this
   * decision directly, for the same reason it calls `show()` rather than
   * pressing the global hotkey: window focus is the window manager's to give,
   * and a headless runner never grants it.
   */
  blurred(): void {
    if (this.dictating) return;
    this.hide();
  }

  /**
   * Shows the box, or brings it forward without disturbing it if already open.
   *
   * The no-op on an open box is the point: a second hotkey press while the user
   * is midway through typing must not clear what they have written (FR-003a).
   * Dictation is the one thing that may still be started on an already-open
   * box, because recording neither clears nor replaces in-progress input.
   */
  show(mode: CaptureMode = "type"): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;

    if (window.isVisible()) {
      // Brought forward, not reopened: nothing is reset, so a half-typed
      // thought and a live recording both survive. Focus is the point — a box
      // pinned open by dictation has lost focus by definition, and Enter and
      // Escape only reach it once it has focus back. Without this, a recording
      // that lost focus could not be stopped from the keyboard at all.
      window.focus();
      if (mode === "dictate") window.webContents.send("capture:start-dictation");
      return;
    }

    const started = TRACE ? Date.now() : 0;

    // The reset the renderer is about to act on tears any recording down, so
    // the flag it set is stale from here rather than from whenever its reply
    // arrives.
    this.dictating = false;
    window.webContents.send("capture:reset", mode);
    window.show();
    window.focus();

    // Replayed after the reset so the box clearing itself cannot wipe them.
    for (const notice of this.notices.onShow()) {
      window.webContents.send("capture:notice", notice);
    }

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

  /**
   * The renderer started or finished dictating.
   *
   * Main cannot see the dictation state machine and must not keep a second copy
   * of it — it needs one fact, and only to answer one question: may this window
   * be taken away right now? Escape and submit still hide the box while
   * dictating, because both stop the recording first.
   */
  setDictating(active: boolean): void {
    this.dictating = active;
  }

  /** Whether the box is currently pinned open by a live dictation. */
  isDictating(): boolean {
    return this.dictating;
  }

  /**
   * Shows a notice, or holds it until the box is next opened.
   *
   * Sending straight to a hidden window would lose it, and a notice carrying
   * recoverable text is the only remaining copy of a thought whose write failed.
   */
  notify(notice: Notice): void {
    for (const deliverable of this.notices.push(notice, this.isVisible())) {
      this.window?.webContents.send("capture:notice", deliverable);
    }
  }

  /** The user has read a sticky notice; stop replaying it. */
  acknowledgeNotice(id: string): void {
    this.notices.acknowledge(id);
  }

  get browserWindow(): BrowserWindow | undefined {
    return this.window;
  }
}
