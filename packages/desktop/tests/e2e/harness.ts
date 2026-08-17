import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  /** Seeds inbox.md directly, the way capture or a hand-edit would. */
  writeInbox(content: string): void;
  /** Reads any vault file, e.g. "waiting.md" or "projects/roof.md". */
  vaultFile(relPath: string): string;
  /** Lists a vault directory, sorted. Empty when it does not exist — which is a state worth asserting. */
  vaultDir(relPath: string): string[];
  /** Writes a vault file, creating parent directories. */
  writeVaultFile(relPath: string, content: string): void;
  /** Opens the sort view, as the tray entry does. */
  openSort(): Promise<void>;
  isSortVisible(): Promise<boolean>;
  sortView(): Promise<Page>;
  /** Opens the projects view, as the tray entry does. */
  openProjects(): Promise<void>;
  openTopThree(): Promise<void>;
  topThreeView(): Promise<Page>;
  /** Opens the weekly review, as the tray entry does. Never opened for the user. */
  openReview(): Promise<void>;
  reviewView(): Promise<Page>;
  /** Opens the retrospective, as the tray entry does. Never opened for the user. */
  openRetrospective(): Promise<void>;
  retrospectiveView(): Promise<Page>;
  /** Hides it, as closing the window does. Reopening re-reads from disk. */
  closeProjects(): Promise<void>;
  isProjectsVisible(): Promise<boolean>;
  projectsView(): Promise<Page>;
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
    /**
     * Reuse an existing vault instead of a fresh one, so a test can quit the
     * app and relaunch against the same files (US3).
     */
    inboxPath?: string;
  } = {},
): Promise<Harness> {
  const dir = options.inboxPath ? dirname(options.inboxPath) : mkdtempSync(join(tmpdir(), "waypoint-e2e-"));
  let inboxPath = options.inboxPath ?? join(dir, "inbox.md");
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
      `--user-data-dir=${join(dir, `electron-data-${process.pid}-${Date.now()}`)}`,
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
    writeInbox(content: string) {
      writeFileSync(inboxPath, content, "utf8");
    },
    vaultFile(relPath: string) {
      const p = join(dirname(inboxPath), relPath);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    },
    vaultDir(relPath: string) {
      const p = join(dirname(inboxPath), relPath);
      return existsSync(p) ? readdirSync(p).sort() : [];
    },
    writeVaultFile(relPath: string, content: string) {
      const p = join(dirname(inboxPath), relPath);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
    },
    async openSort() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showSort();
      });
      await new Promise((r) => setTimeout(r, 200));
    },
    async isSortVisible() {
      return app.evaluate(() => {
        return (globalThis as Record<string, any>)["__waypoint"].isSortVisible();
      });
    },
    async sortView() {
      for (const page of app.windows()) {
        if (page.url().includes("sort.html")) return page;
      }
      return app.waitForEvent("window", (p) => p.url().includes("sort.html"));
    },
    async openProjects() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showProjects();
      });
      const view = await harness.projectsView();
      // The view renders from disk asynchronously on open; without this a first
      // assertion can race the initial paint.
      await view.waitForSelector("#sidebar");
      await new Promise((r) => setTimeout(r, 150));
    },
    async closeProjects() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].hideProjects();
      });
    },
    async isProjectsVisible() {
      return app.evaluate(() => {
        return (globalThis as Record<string, any>)["__waypoint"].isProjectsVisible();
      });
    },
    async projectsView() {
      for (const page of app.windows()) {
        if (page.url().includes("projects.html")) return page;
      }
      return app.waitForEvent("window", (p) => p.url().includes("projects.html"));
    },
    async openTopThree() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showTopThree();
      });
      const view = await harness.topThreeView();
      // Same reason as the projects view: the first paint reads from disk
      // asynchronously, so an assertion can otherwise race it.
      //
      // Waits on the week heading rather than `#current`, which is an empty
      // `<ul>` on an empty week and therefore never "visible" — the common
      // case for this view, and the one most worth testing.
      await view.waitForFunction(() => {
        const el = document.getElementById("week-id");
        return el !== null && (el.textContent ?? "").length > 0;
      });
      await new Promise((r) => setTimeout(r, 150));
    },
    async topThreeView() {
      for (const page of app.windows()) {
        if (page.url().includes("top-three.html")) return page;
      }
      return app.waitForEvent("window", (p) => p.url().includes("top-three.html"));
    },
    async openReview() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showReview();
      });
      const view = await harness.reviewView();
      // The first paint reads the log from disk asynchronously, so waiting on
      // the week line rather than a fixed delay is what keeps this from racing.
      // On a vault with no review started, that line says so — which is itself
      // the state most worth being able to assert.
      await view.waitForFunction(() => {
        const el = document.getElementById("week-id");
        return el !== null && (el.textContent ?? "").length > 0;
      });
      await new Promise((r) => setTimeout(r, 150));
    },
    async openRetrospective() {
      await app.evaluate(() => {
        (globalThis as Record<string, any>)["__waypoint"].showRetrospective();
      });
      const view = await harness.retrospectiveView();
      // It reads nothing on open, so the thing to wait for is the controls
      // being present — not any content, of which there is deliberately none.
      await view.waitForSelector("#run");
      return undefined;
    },
    async retrospectiveView() {
      for (const page of app.windows()) {
        if (page.url().includes("retrospective.html")) return page;
      }
      return app.waitForEvent("window", (p) => p.url().includes("retrospective.html"));
    },
    async reviewView() {
      for (const page of app.windows()) {
        if (page.url().includes("review.html")) return page;
      }
      return app.waitForEvent("window", (p) => p.url().includes("review.html"));
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
