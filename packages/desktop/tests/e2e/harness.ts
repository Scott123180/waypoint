import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAIN = resolve(__dirname, "../../dist/src/main/main.js");

export interface Harness {
  app: ElectronApplication;
  inboxPath: string;
  /** Invokes exactly what the global hotkey handler invokes. */
  trigger(): Promise<void>;
  /** Invokes exactly what the tray icon's click handler invokes. */
  triggerFromTray(): Promise<void>;
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
export async function launch(options: { hotkey?: string } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-e2e-"));
  const inboxPath = join(dir, "inbox.md");
  const configPath = join(dir, "config.json");

  writeFileSync(
    configPath,
    JSON.stringify({
      inboxPath,
      hotkey: options.hotkey ?? "CommandOrControl+Shift+F24",
    }),
  );

  const app = await electron.launch({
    args: [MAIN, "--no-sandbox"],
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
    async triggerFromTray() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].trayClick();
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
