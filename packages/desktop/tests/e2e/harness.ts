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
    async captureBox() {
      return app.firstWindow();
    },
    async isBoxVisible() {
      return app.evaluate(() => {
        return (globalThis as Record<string, any>)["__waypoint"].isCaptureVisible();
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
