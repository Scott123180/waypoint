import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CaptureService } from "@waypoint/core";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { InboxMutex } from "../src/main/inbox-mutex";

/**
 * Undo behaves here exactly as it behaves at the capture surface (FR-049) —
 * **which, for a typed capture, means no undo window opens at all.**
 *
 * This is worth writing down carefully, because the task list and the plan both
 * read as though an undo affordance belonged on this screen, and building one
 * would have been a Principle VII breach found only by a user noticing the
 * shutdown offered something the capture box does not.
 *
 * Feature 1 scoped undo to *dictated* captures (001 FR-009, FR-018): `submit`
 * opens an undo window only when `source === "dictated"`, and the affordance
 * lives in the **tray**, not in any window — the capture box renders none
 * either. The shutdown captures typed text on the same channel with the same
 * arguments, so it inherits that exactly: no window opens, `undoableId()` stays
 * undefined, and the tray entry stays disabled.
 *
 * So the assertion is symmetry, not the presence of a button. The three tests in
 * the last block are the ones that would fail if someone added one.
 */

let dir: string;
let inboxPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-shutdown-undo-"));
  inboxPath = join(dir, "inbox.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function service(): CaptureService {
  return new CaptureService({
    inbox: new FsInboxStore(inboxPath, new InboxMutex()),
    transcription: { transcribe: () => Promise.resolve("") },
  });
}

function inbox(): string {
  return existsSync(inboxPath) ? readFileSync(inboxPath, "utf8") : "";
}

describe("a typed capture, from either surface", () => {
  test("opens no undo window", async () => {
    const capture = service();

    await capture.submit("a thought from the shutdown", "typed");
    await capture.flush();

    assert.equal(capture.undoableId(), undefined, "typed captures are not undoable, anywhere");
  });

  test("so the tray entry has nothing to enable", async () => {
    const capture = service();

    await capture.submit("a thought", "typed");
    await capture.flush();

    // `canUndo` in `tray.ts` reads exactly this.
    assert.equal(capture.undoableId() !== undefined, false);
  });

  test("and an undo attempt is refused rather than removing something", async () => {
    const capture = service();

    const submitted = await capture.submit("a thought", "typed");
    await capture.flush();
    const before = inbox();

    const outcome = await capture.undo(submitted.id);

    assert.equal(outcome.ok, false);
    assert.equal(inbox(), before, "a refused undo leaves the file alone");
  });
});

describe("a dictated capture is the one that is undoable", () => {
  test("and it still is — this feature changed nothing about undo", async () => {
    const capture = service();

    const submitted = await capture.submit("a dictated thought", "dictated");
    await capture.flush();
    assert.equal(capture.undoableId(), submitted.id);

    const outcome = await capture.undo(submitted.id);

    assert.equal(outcome.ok, true);
    assert.equal(inbox(), "", "the capture is gone from the inbox");
  });

  test("a later typed capture closes that window, as it always did", async () => {
    const capture = service();

    const dictated = await capture.submit("a dictated thought", "dictated");
    await capture.flush();
    assert.equal(capture.undoableId(), dictated.id);

    await capture.submit("then something typed", "typed");
    await capture.flush();

    assert.equal(capture.undoableId(), undefined, "every capture closes the previous window");
  });
});

describe("the shutdown offers no undo of its own", () => {
  const SRC = join(__dirname, "..", "..", "src");
  const PRELOAD = readFileSync(join(SRC, "preload", "preload.ts"), "utf8");
  const RENDERER = readFileSync(join(SRC, "renderer", "shutdown.ts"), "utf8");
  const HTML = readFileSync(join(SRC, "renderer", "shutdown.html"), "utf8");

  const BRIDGE = /const shutdownApi = \{([\s\S]*?)\n\};/.exec(PRELOAD)?.[1] ?? "";

  test("no bridge method reaches `capture:undo`", () => {
    assert.ok(
      !BRIDGE.includes("capture:undo"),
      "an undo method here would be surface no other window has (Principle VII)",
    );
  });

  test("the renderer draws no undo control", () => {
    assert.ok(!/undo/i.test(RENDERER), "the capture box renders none either — undo lives in the tray");
    assert.ok(!/undo/i.test(HTML));
  });

  test("the tray's undo entry is untouched by this feature", () => {
    const TRAY = readFileSync(join(SRC, "main", "tray.ts"), "utf8");

    assert.match(TRAY, /\{ label: "Undo last capture", click: actions\.onUndo, enabled: actions\.canUndo\(\) \}/);
    assert.match(TRAY, /\{ label: "Daily shutdown", click: actions\.onShutdown \}/);
  });

  test("and the shipped `capture:undo` handler still refreshes it, whichever surface undid", () => {
    const IPC = readFileSync(join(SRC, "main", "ipc.ts"), "utf8");

    assert.match(
      IPC,
      /ipcMain\.handle\("capture:undo", async \(_event, id: string\) => \{[\s\S]*?onUndoableChange\?\.\(\)/,
    );
  });
});
