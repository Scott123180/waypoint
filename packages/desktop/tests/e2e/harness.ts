import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAIN = resolve(__dirname, "../../dist/src/main/main.js");

export interface Harness {
  app: ElectronApplication;
  inboxPath: string;
  /** Invokes exactly what the capture (typing) hotkey handler invokes. */
  trigger(): Promise<void>;
  /** Invokes exactly what the dictate hotkey handler invokes. */
  triggerDictate(): Promise<void>;
  /** Invokes exactly what the tray icon's click handler invokes. */
  triggerFromTray(): Promise<void>;
  /** What the stubbed transcriber will return for the next real dictation. */
  setTranscript(text: string): Promise<void>;
  /** Holds the stubbed transcriber open, so the transcribing state is observable. */
  setTranscriptionDelay(ms: number): Promise<void>;
  /** Makes getUserMedia reject, without depending on the host having no microphone. */
  breakMicrophone(): Promise<void>;
  /** Drives the dictation path with a canned transcript, bypassing the microphone. */
  dictate(transcript: string): Promise<void>;
  /** Drives the dictation path to a transcription failure. */
  dictateFailure(message: string): Promise<void>;
  /** Undoes the currently undoable capture, as the undo affordance would. */
  undo(): Promise<{ ok: boolean; reason?: string }>;
  undoableId(): Promise<string | undefined>;
  captureBox(): Promise<Page>;
  isBoxVisible(): Promise<boolean>;
  inbox(): string;
  close(): Promise<void>;
}

/**
 * Launches the real app against a throwaway config and inbox.
 *
 * A note on the global hotkey: Playwright cannot deliver an OS-level global
 * shortcut, so these tests call the same `showCapture()` the hotkey handler
 * calls. That the accelerator is actually wired to it is covered separately by
 * the hotkey unit test.
 */
export async function launch(
  options: {
    hotkey?: string;
    unwritableInbox?: boolean;
    /**
     * Gives the renderer Chromium's synthetic capture device, so the real
     * getUserMedia → AudioContext → level-meter path runs against genuine
     * audio samples instead of a stub.
     */
    fakeMicrophone?: boolean;
  } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-e2e-"));
  let inboxPath = join(dir, "inbox.md");
  const configPath = join(dir, "config.json");

  if (options.unwritableInbox) {
    // Put the inbox "inside" a regular file so creating its parent directory
    // fails, forcing a real InboxWriteError rather than a simulated one.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    inboxPath = join(blocker, "inbox.md");
  }

  writeFileSync(
    configPath,
    JSON.stringify({
      inboxPath,
      // Bindings no real keyboard layout produces, so a test run cannot steal a
      // combination from the machine it happens to be running on.
      hotkey: options.hotkey ?? "CommandOrControl+Shift+F24",
      dictateHotkey: "CommandOrControl+Alt+F24",
    }),
  );

  const app = await electron.launch({
    args: [
      MAIN,
      "--no-sandbox",
      // Electron's single-instance lock is scoped to the user data directory.
      // Sharing the default one means a running `npm run dev` silently causes
      // every test in the suite to fail with "browser has been closed".
      `--user-data-dir=${join(dir, "electron-data")}`,
      ...(options.fakeMicrophone
        ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
        : []),
    ],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "",
      WAYPOINT_CONFIG_PATH: configPath,
      WAYPOINT_E2E: "1",
    },
  });

  // Wait until the renderer module has run and registered its listeners.
  // Without this, a message sent immediately after launch can arrive before
  // there is anything listening for it.
  const firstWindow = await app.firstWindow();
  await firstWindow.waitForFunction(
    () => typeof (window as unknown as Record<string, unknown>)["waypoint"] === "object",
  );

  const harness: Harness = {
    app,
    inboxPath,
    async trigger() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showCapture();
      });
    },
    async triggerDictate() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showCaptureDictating();
      });
    },
    async triggerFromTray() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].trayClick();
      });
    },
    async setTranscript(text: string) {
      await app.evaluate((_electron, value) => {
        (globalThis as Record<string, any>)["__waypoint"].setStubTranscript(value);
      }, text);
    },
    async setTranscriptionDelay(ms: number) {
      await app.evaluate((_electron, value) => {
        (globalThis as Record<string, any>)["__waypoint"].setStubTranscriptionDelay(value);
      }, ms);
    },
    async breakMicrophone() {
      const page = await app.firstWindow();
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () =>
          Promise.reject(new DOMException("Requested device not found", "NotFoundError"));
      });
    },
    async dictate(transcript: string) {
      // CI runners have no microphone, so the audio capture step is bypassed and
      // a canned transcript is fed through the real transcribe → insert path.
      await app.evaluate(async (_electron, text) => {
        await (globalThis as Record<string, any>)["__waypoint"].fakeDictation({ text });
      }, transcript);
      await new Promise((r) => setTimeout(r, 150));
    },
    async dictateFailure(message: string) {
      await app.evaluate(async (_electron, msg) => {
        await (globalThis as Record<string, any>)["__waypoint"].fakeDictation({ error: msg });
      }, message);
      await new Promise((r) => setTimeout(r, 150));
    },
    async captureBox() {
      return app.firstWindow();
    },
    async isBoxVisible() {
      return app.evaluate(() => {
        return (globalThis as Record<string, any>)["__waypoint"].isCaptureVisible();
      });
    },
    async undo() {
      return app.evaluate(async () => {
        return (globalThis as Record<string, any>)["__waypoint"].undoLatest();
      });
    },
    async undoableId() {
      return app.evaluate(() => {
        return (globalThis as Record<string, any>)["__waypoint"].undoableId();
      });
    },
    inbox() {
      return existsSync(inboxPath) ? readFileSync(inboxPath, "utf8") : "";
    },
    async close() {
      await app.close();
    },
  };

  return harness;
}

/** Waits until the app reports the capture box hidden, or times out. */
export async function waitForHidden(h: Harness, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await h.isBoxVisible())) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("capture box did not hide within timeout");
}

/** Waits until the inbox file contains `text`. */
export async function waitForInbox(h: Harness, text: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = h.inbox();
    if (content.includes(text)) return content;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`inbox never contained ${JSON.stringify(text)}; got ${JSON.stringify(h.inbox())}`);
}
