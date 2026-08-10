import { app, globalShortcut, type Tray } from "electron";

import { CaptureService, type InboxWriteError } from "@waypoint/core";

import { FsInboxStore } from "./adapters/fs-inbox-store";
import { CaptureWindow } from "./capture-window";
import { configFilePath, currentEnv, loadConfig } from "./config";
import { registerHotkey, type Notice } from "./hotkey";
import { registerIpc } from "./ipc";
import { createTray } from "./tray";

// Placeholder until the whisper adapter lands in User Story 2. Voice is not
// wired up yet; text capture does not depend on it.
const notYetTranscribing = {
  async transcribe(): Promise<string> {
    throw new Error("Voice capture arrives in User Story 2");
  },
};

let tray: Tray | undefined;

function start(): void {
  const env = currentEnv();
  const path = process.env["WAYPOINT_CONFIG_PATH"] ?? configFilePath(env);
  const { config, problem } = loadConfig(path, env);

  const captureWindow = new CaptureWindow();
  const emitNotice = (notice: Notice): void => captureWindow.notify(notice);

  const service = new CaptureService({
    inbox: new FsInboxStore(config.inboxPath),
    transcription: notYetTranscribing,
    onError: (error: InboxWriteError) =>
      emitNotice({
        level: "error",
        message: error.message,
        recoverableText: error.recoverableText,
      }),
  });

  captureWindow.create();
  registerIpc(service, captureWindow);

  const showCapture = (): void => captureWindow.show();

  const hotkey = registerHotkey(config.hotkey, showCapture, globalShortcut, emitNotice);
  tray = createTray(showCapture);

  if (problem) {
    emitNotice({ level: "error", message: problem });
  }

  // No dock icon: this is a background agent summoned by hotkey or tray.
  app.dock?.hide();

  app.on("activate", showCapture);
  app.on("second-instance", showCapture);

  // Hiding the last window must not quit a background agent.
  app.on("window-all-closed", () => {});

  app.on("before-quit", async (event) => {
    // Drain queued writes so a normal quit never loses a captured thought.
    event.preventDefault();
    globalShortcut.unregisterAll();
    await service.flush();
    tray?.destroy();
    app.exit(0);
  });

  if (process.env["WAYPOINT_E2E"] === "1") {
    // Test seam: Playwright cannot deliver an OS-level global shortcut, so the
    // suite drives the same functions the hotkey and tray handlers call.
    (globalThis as Record<string, unknown>)["__waypoint"] = {
      showCapture,
      hideCapture: () => captureWindow.hide(),
      trayClick: showCapture,
      isCaptureVisible: () => captureWindow.isVisible(),
      hotkeyRegistered: () => hotkey.registered,
    };
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(start);
}
