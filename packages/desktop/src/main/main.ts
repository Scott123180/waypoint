import { app, globalShortcut, type Tray } from "electron";
import { join } from "node:path";

import { CaptureService, type InboxWriteError } from "@waypoint/core";

import { FsInboxStore } from "./adapters/fs-inbox-store";
import { WhisperAdapter } from "./adapters/whisper-adapter";
import { CaptureWindow } from "./capture-window";
import { configFilePath, currentEnv, loadConfig } from "./config";
import { registerHotkey, type Notice } from "./hotkey";
import { registerIpc } from "./ipc";
import { createTray } from "./tray";

let tray: Tray | undefined;

function whisperBinaryPath(): string {
  // Packaged builds carry the binary in extraResources; dev uses the repo copy.
  const base = app.isPackaged
    ? join(process.resourcesPath, "whisper")
    : join(__dirname, "..", "..", "..", "..", "..", "resources", "whisper");
  return join(base, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
}

function start(): void {
  const env = currentEnv();
  const path = process.env["WAYPOINT_CONFIG_PATH"] ?? configFilePath(env);
  const { config, problem } = loadConfig(path, env);

  const captureWindow = new CaptureWindow();
  const emitNotice = (notice: Notice): void => captureWindow.notify(notice);

  const e2e = process.env["WAYPOINT_E2E"] === "1";

  // Under E2E the whisper *subprocess* is stubbed — CI has no microphone and no
  // 500MB model — while the real core rules and renderer path still run. The
  // subprocess wiring itself is covered by the fake-binary contract tests.
  const stubTranscript = { value: "" };
  const transcription = e2e
    ? { async transcribe(): Promise<string> { return stubTranscript.value; } }
    : new WhisperAdapter({
        binaryPath: whisperBinaryPath(),
        modelPath: config.whisperModelPath,
      });

  const service = new CaptureService({
    inbox: new FsInboxStore(config.inboxPath),
    transcription,
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

  const undoLatest = async (): Promise<{ ok: boolean; reason?: string }> => {
    const id = service.undoableId();
    if (!id) return { ok: false, reason: "expired" };

    const lastText = service.undoableText() ?? "";
    const outcome = await service.undo(id);

    if (!outcome.ok && outcome.reason === "file-changed") {
      // Refusing is the safe answer, but the thought must stay recoverable, so
      // bring the box forward with the captured text visible.
      captureWindow.show();
      emitNotice({
        level: "error",
        message:
          "Your inbox changed since that was saved, so it was left alone. " +
          "Here is what was captured:",
        recoverableText: lastText,
      });
    }
    return outcome;
  };

  const hotkey = registerHotkey(config.hotkey, showCapture, globalShortcut, emitNotice);
  tray = createTray({
    onCapture: showCapture,
    onUndo: () => void undoLatest(),
    canUndo: () => service.undoableId() !== undefined,
  });

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
      undoableId: () => service.undoableId(),
      undoLatest,
      // CI has no microphone, so the suite feeds a canned result through the
      // real transcribe → insert path instead of capturing audio.
      fakeDictation: async (input: { text?: string; error?: string }) => {
        let result;
        if (input.error) {
          result = { status: "failed" as const, message: input.error };
        } else {
          stubTranscript.value = input.text ?? "";
          // Real core logic: trimming, the no-speech mapping, and the guarantee
          // that a transcript never reaches the inbox on its own.
          result = await service.transcribe(new Uint8Array(0));
        }
        captureWindow.browserWindow?.webContents.send("capture:fake-dictation", result);
      },
    };
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(start);
}
