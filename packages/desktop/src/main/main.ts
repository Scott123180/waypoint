import { app, globalShortcut } from "electron";
import { join } from "node:path";

import {
  AreaService,
  CaptureService,
  ProjectService,
  RetrospectiveService,
  ReviewService,
  ShutdownService,
  SortService,
  TopThreeService,
  WaitingService,
  SuggestionService,
  catalogOf,
  createDefaultIntelligence,
  createDefaultPolicy,
  parseIntelligenceConfig,
  INTELLIGENCE_PATH,
  type InboxWriteError,
  type Transport,
} from "@waypoint/core";

import { FsInboxStore } from "./adapters/fs-inbox-store";
import { FsInboxDocument } from "./adapters/fs-inbox-document";
import { FsVaultStore } from "./adapters/fs-vault-store";
import { FsSortJournal } from "./adapters/fs-sort-journal";
import { InboxMutex } from "./inbox-mutex";
import { InboxChanged } from "./inbox-changed";
import { VaultChanged } from "./vault-changed";
import { WhisperAdapter } from "./adapters/whisper-adapter";
import { CommandTransport } from "./adapters/command-transport";
import { CertificateTransport } from "./adapters/certificate-transport";
import { CaptureWindow } from "./capture-window";
import { SortWindow } from "./sort-window";
import { ProjectsWindow } from "./projects-window";
import { TopThreeWindow } from "./top-three-window";
import { ReviewWindow } from "./review-window";
import { RetrospectiveWindow } from "./retrospective-window";
import { ShutdownWindow } from "./shutdown-window";
import { configFilePath, currentEnv, loadConfig, sortJournalPath } from "./config";
import { registerHotkeys, type Notice } from "./hotkey";
import {
  registerIpc,
  registerProjectsIpc,
  registerRetrospectiveIpc,
  registerReviewIpc,
  registerShutdownIpc,
  registerSuggestIpc,
  registerTopThreeIpc,
} from "./ipc";
import { whisperBinaryName, whisperResourcesDir } from "./resources";
import { createTray, type TrayHandle } from "./tray";

let tray: TrayHandle | undefined;

// Async because the intelligence configuration is read from the vault before
// the sort window is built: whether the `suggest` bridge is attached at all is
// decided here, and a window created first would have to be told afterwards.
async function start(): Promise<void> {
  // Binary and model both resolve from here, so they cannot drift apart.
  const resourcesDir = whisperResourcesDir({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: __dirname,
  });

  const env = { ...currentEnv(), resourcesDir };
  const path = process.env["WAYPOINT_CONFIG_PATH"] ?? configFilePath(env);
  const { config, problem } = loadConfig(path, env);

  const captureWindow = new CaptureWindow();
  const emitNotice = (notice: Notice): void => captureWindow.notify(notice);

  const e2e = process.env["WAYPOINT_E2E"] === "1";

  // Under E2E the whisper *subprocess* is stubbed — CI has no microphone and no
  // 500MB model — while the real core rules and renderer path still run. The
  // subprocess wiring itself is covered by the fake-binary contract tests.
  const stubTranscript = { value: "", delayMs: 0 };
  const transcription = e2e
    ? {
        async transcribe(): Promise<string> {
          // The delay exists so the transcribing state is observable at all: a
          // stub that returns instantly cannot show that a real 3-5s wait is
          // being reported to the user.
          if (stubTranscript.delayMs > 0) {
            await new Promise((r) => setTimeout(r, stubTranscript.delayMs));
          }
          return stubTranscript.value;
        },
      }
    : new WhisperAdapter({
        binaryPath: join(resourcesDir, whisperBinaryName(process.platform)),
        modelPath: config.whisperModelPath,
      });

  // One lock, shared by both inbox writers. Sort rebuilds the file and renames
  // it into place, which orphans the inode capture appends to — without this,
  // a capture made during a sort is destroyed silently (research R4a).
  const inboxMutex = new InboxMutex();

  // One signal for the whole file, raised by the adapters every writer goes
  // through. A client added later — the local API, the LLM organization layer —
  // raises it by writing through the same adapters, with nothing to remember.
  const inboxChanged = new InboxChanged();
  const raiseInboxChanged = (): void => inboxChanged.raise();

  const service = new CaptureService({
    inbox: new FsInboxStore(config.inboxPath, inboxMutex, raiseInboxChanged),
    transcription,
    onError: (error: InboxWriteError) =>
      emitNotice({
        level: "error",
        message: error.message,
        recoverableText: error.recoverableText,
      }),
  });

  // The counterpart for project and area files. Separate from the inbox signal
  // because that one fires on every capture, which is noise here (research R7).
  const vaultChanged = new VaultChanged();

  // One vault store, shared by sort and by project structure: both write the
  // same files, and a second instance would be a second set of assumptions
  // about them — including about who gets told when one of them changes.
  const vaultStore = new FsVaultStore(config.vaultRoot, () => vaultChanged.raise());

  const sortService = new SortService({
    inbox: new FsInboxDocument(config.inboxPath, inboxMutex, raiseInboxChanged),
    vault: vaultStore,
    journal: new FsSortJournal(sortJournalPath(env)),
  });

  const projectService = new ProjectService({ vault: vaultStore });
  const areaService = new AreaService({ vault: vaultStore });
  // Same vault store again: the top three lives in the same directory, and
  // sharing the store is what makes its writes raise the change signal every
  // other view already listens to.
  const topThreeService = new TopThreeService({ vault: vaultStore });
  // The same vault store once more. `waiting.md` is written by sort today and
  // by the review from now on, and sharing the store is what makes both writes
  // raise the one change signal every open view listens to.
  const waitingService = new WaitingService({ vault: vaultStore });

  // The review changes nothing itself: it drives the services that already own
  // each verb, so the same decision points fire and no behaviour exists only
  // inside the ritual. The same vault store again, so its writes raise the
  // change signal every other view already listens to.
  //
  // **No summary provider is supplied**, which is the shipped configuration:
  // the review completes normally with none, nothing leaves the machine, and no
  // summary affordance is shown at all (FR-103, FR-110).
  const reviewService = new ReviewService({
    vault: vaultStore,
    projects: projectService,
    topThree: topThreeService,
    inbox: sortService,
    waiting: waitingService,
  });

  // Reads three sources and writes none. Its dependencies are narrowed so that
  // no write verb is reachable from it — `projectService` arrives as a source of
  // `listDetailed` alone, and the vault as `list` and `read` (006 FR-051).
  const retrospectiveService = new RetrospectiveService({
    projects: projectService,
    vault: vaultStore,
  });

  /**
   * The daily shutdown: four readings composed into one screen.
   *
   * Reads five sources and writes none. Its dependencies are narrowed so that
   * no write verb is reachable from it — the three services arrive as sources of
   * one read verb each, and the vault as `read` alone (009 FR-053). The policy
   * module is the shipped one, consulted for staleness and for nothing else; it
   * is passed explicitly rather than defaulted because this service has no vault
   * it could build one from.
   */
  const shutdownService = new ShutdownService({
    projects: projectService,
    topThree: topThreeService,
    waiting: waitingService,
    vault: vaultStore,
    policy: createDefaultPolicy(vaultStore),
  });

  /**
   * 008: the intelligence layer, off unless `intelligence.md` says otherwise.
   *
   * Read from the vault — never probed. No `PATH` check, no scan for a
   * listening local model, no environment variable, no editor-host detection.
   * A machine with a CLI tool installed and a model listening, and no
   * `intelligence.md`, has this **off**, because auto-detection makes the
   * application behave differently on two machines for reasons the user cannot
   * see (FR-052).
   */
  const intelligenceConfig = parseIntelligenceConfig(
    // `.catch(() => null)` is load-bearing, not defensive habit. `read` only
    // treats ENOENT as "absent"; a vault root that is unreadable — wrong
    // permissions, a broken mount, or a misconfigured path that is not a
    // directory at all — throws. Letting that propagate would mean a file this
    // feature owns could stop capture and sorting from starting at all, which
    // is the exact opposite of FR-055. Unreadable is treated as absent: the
    // layer goes off, silently, and everything else starts normally.
    await vaultStore.read(INTELLIGENCE_PATH).catch(() => null),
  );

  // A closed `switch` over the two values that ship. No fallback, no lookup,
  // no default case that could resolve something unexpected: an unrecognised
  // value was already turned into a `problem` by the parser (FR-057).
  const transport = ((): Transport | null => {
    switch (intelligenceConfig.kind) {
      case "command":
        return new CommandTransport({
          command: intelligenceConfig.command,
          args: intelligenceConfig.args,
        });
      case "certificate":
        return new CertificateTransport({
          endpoint: intelligenceConfig.endpoint,
          certificate: intelligenceConfig.certificate,
          key: intelligenceConfig.key,
          ca: intelligenceConfig.ca,
        });
      case "off":
      case "problem":
        return null;
    }
  })();

  const suggestionService =
    transport === null
      ? null
      : new SuggestionService({
          // The only read source, and it cannot name a file — so `identity.md`,
          // `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, and `log/`
          // are not reachable from here (research R6).
          catalog: catalogOf(vaultStore),
          intelligence: createDefaultIntelligence(transport),
        });

  const sortWindow = new SortWindow(suggestionService !== null);
  const showSort = (): void => sortWindow.show();

  const projectsWindow = new ProjectsWindow();
  const showProjects = (): void => projectsWindow.show();

  const topThreeWindow = new TopThreeWindow();
  const showTopThree = (): void => topThreeWindow.show();

  const reviewWindow = new ReviewWindow();
  const showReview = (): void => reviewWindow.show();

  const retrospectiveWindow = new RetrospectiveWindow();
  const showRetrospective = (): void => retrospectiveWindow.show();

  const shutdownWindow = new ShutdownWindow();
  const showShutdown = (): void => shutdownWindow.show();

  // The sort view, and the review — whose inbox step reports a count it has to
  // re-derive after the user goes and sorts. Subscribers gather here rather
  // than each writer learning who is listening.
  inboxChanged.subscribe(() => sortWindow.inboxChanged());
  inboxChanged.subscribe(() => reviewWindow.inboxChanged());

  // Both views subscribe to the same generic signal. A top-three write and a
  // project write are both "a vault file changed", and neither view needs to
  // know which — they re-read, which is the only account of the file that can
  // be trusted anyway.
  vaultChanged.subscribe(() => projectsWindow.vaultChanged());
  vaultChanged.subscribe(() => topThreeWindow.vaultChanged());
  vaultChanged.subscribe(() => reviewWindow.vaultChanged());
  // The retrospective subscribes to the same signal and does something
  // different with it: the other views re-read, this one raises a notice and
  // waits. A reading is an answer taken at a moment, and re-rendering it under
  // the user would break the copy in their clipboard (006 FR-010a).
  vaultChanged.subscribe(() => retrospectiveWindow.vaultChanged());
  // **The shutdown deliberately subscribes to neither signal.** Its membership
  // is fixed when it opens, and a row moving under someone mid-pass would reopen
  // a question they had already answered (009 FR-010a, FR-011a, research R7).
  // Writes made *from* it still reach every view above, because they go through
  // the same services and `FsVaultStore` raises the signal from its write path.

  captureWindow.create();
  registerIpc(service, captureWindow, sortService, () => sortWindow.hide(), () =>
    tray?.refresh(),
  );
  registerProjectsIpc(projectService, areaService, () => projectsWindow.hide());
  registerTopThreeIpc(topThreeService, () => topThreeWindow.hide());
  registerReviewIpc(reviewService, () => reviewWindow.hide(), showSort);
  registerRetrospectiveIpc(retrospectiveService, () => retrospectiveWindow.hide());
  registerShutdownIpc(shutdownService, waitingService, () => shutdownWindow.hide());

  // 008: registered **only** when a transport is configured. With none, no
  // `suggest:*` channel exists at all — not a disabled one (FR-060).
  if (suggestionService) registerSuggestIpc(suggestionService);

  // Finish anything that was in flight when the process last stopped, before
  // the user can see a half-committed state (FR-020d, FR-024).
  void sortService.recover().then((report) => {
    if (report.completed > 0 || report.abandoned > 0) sortWindow.recovered(report);
  });

  const showCapture = (): void => captureWindow.show("type");
  const showCaptureDictating = (): void => captureWindow.show("dictate");

  const undoLatest = async (): Promise<{ ok: boolean; reason?: string }> => {
    const id = service.undoableId();
    if (!id) return { ok: false, reason: "expired" };

    const lastText = service.undoableText() ?? "";
    const outcome = await service.undo(id);
    tray?.refresh();

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

  const hotkeys = registerHotkeys(
    { capture: config.hotkey, dictate: config.dictateHotkey },
    { onCapture: showCapture, onDictate: showCaptureDictating },
    globalShortcut,
    emitNotice,
  );
  tray = createTray({
    onCapture: showCapture,
    onDictate: showCaptureDictating,
    onUndo: () => void undoLatest(),
    onSort: showSort,
    onProjects: showProjects,
    onTopThree: showTopThree,
    onReview: showReview,
    onRetrospective: showRetrospective,
    onShutdown: showShutdown,
    canUndo: () => service.undoableId() !== undefined,
  });

  if (problem) {
    emitNotice({ level: "error", message: problem });
  }

  // The vault's configuration problem, reported beside the application's own
  // and for the same reason it is reported here rather than where it is found.
  //
  // The capture box holds **one** notice at a time: `showNotice` replaces the
  // element's text, so of several notices replayed on the first open, the last
  // delivered is the one the user reads. Raising this where the file is parsed
  // — before the hotkeys register — put it behind any startup notice that came
  // after it, and a problem the user never sees is not "reported plainly"
  // (FR-055). Emitting it here, with the other configuration problem, is what
  // makes `suggest-absent.spec.ts`'s reporting assertion hold.
  if (intelligenceConfig.kind === "problem") {
    emitNotice({ level: "error", message: intelligenceConfig.message });
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
      showCaptureDictating,
      hideCapture: () => captureWindow.hide(),
      // Clicking another window is the trigger in real use. The suite calls the
      // same handler that event calls, because a test runner has no window
      // manager to take focus away with — the same reason `showCapture` stands
      // in for the global hotkey.
      blurCapture: () => captureWindow.blurred(),
      isCaptureDictating: () => captureWindow.isDictating(),
      trayClick: showCapture,
      isCaptureVisible: () => captureWindow.isVisible(),
      hotkeyRegistered: () => hotkeys.capture,
      dictateHotkeyRegistered: () => hotkeys.dictate,
      undoableId: () => service.undoableId(),
      showSort,
      hideSort: () => sortWindow.hide(),
      isSortVisible: () => sortWindow.isVisible(),
      showProjects,
      hideProjects: () => projectsWindow.hide(),
      isProjectsVisible: () => projectsWindow.isVisible(),
      showTopThree,
      hideTopThree: () => topThreeWindow.hide(),
      isTopThreeVisible: () => topThreeWindow.isVisible(),
      showReview,
      showRetrospective,
      hideReview: () => reviewWindow.hide(),
      isReviewVisible: () => reviewWindow.isVisible(),
      showShutdown,
      hideShutdown: () => shutdownWindow.hide(),
      isShutdownVisible: () => shutdownWindow.isVisible(),
      undoLatest,
      setStubTranscript: (text: string) => {
        stubTranscript.value = text;
      },
      setStubTranscriptionDelay: (ms: number) => {
        stubTranscript.delayMs = ms;
      },
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
