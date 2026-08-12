import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CaptureService } from "@waypoint/core";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { InboxMutex } from "../src/main/inbox-mutex";
import { InboxChanged } from "../src/main/inbox-changed";

/**
 * The inbox-changed signal.
 *
 * The property that matters everywhere else is the timing: a listener's only
 * job is to re-read the file, so the signal is worthless — worse than absent,
 * because it teaches the listener to re-check — if it can arrive while the
 * file still holds the state from before the write.
 */

let dir: string;
let inboxPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-changed-"));
  inboxPath = join(dir, "inbox.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("InboxChanged", () => {
  test("delivers to every subscriber", () => {
    const changed = new InboxChanged();
    let a = 0;
    let b = 0;
    changed.subscribe(() => a++);
    changed.subscribe(() => b++);

    changed.raise();

    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  test("a throwing listener neither escapes nor starves the others", () => {
    const changed = new InboxChanged();
    let reached = 0;
    changed.subscribe(() => {
      throw new Error("a view failed to refresh");
    });
    changed.subscribe(() => reached++);

    assert.doesNotThrow(() => changed.raise());
    assert.equal(reached, 1);
  });
});

describe("FsInboxStore raises the signal", () => {
  test("only once the appended bytes are readable on disk", async () => {
    const seen: string[] = [];
    const store = new FsInboxStore(inboxPath, new InboxMutex(), () => {
      seen.push(readFileSync(inboxPath, "utf8"));
    });

    await store.append("- a thought\n");

    assert.deepEqual(seen, ["- a thought\n"]);
  });

  test("after a truncate, so undo moves a view too", async () => {
    writeFileSync(inboxPath, "- kept\n- undone\n");
    let raised = 0;
    const store = new FsInboxStore(inboxPath, new InboxMutex(), () => raised++);

    await store.truncate("- kept\n".length);

    assert.equal(raised, 1);
    assert.equal(readFileSync(inboxPath, "utf8"), "- kept\n");
  });

  test("never for a write that failed", async () => {
    // The inbox's parent is a regular file, so creating the directory fails.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");

    let raised = 0;
    const store = new FsInboxStore(join(blocker, "inbox.md"), new InboxMutex(), () => raised++);

    await assert.rejects(() => store.append("- a thought\n"));
    assert.equal(raised, 0);
  });
});

describe("FsInboxDocument raises the signal", () => {
  test("once a sorted item has actually been spliced out", async () => {
    writeFileSync(inboxPath, "- first\n- second\n");
    const seen: string[] = [];
    const doc = new FsInboxDocument(inboxPath, new InboxMutex(), () => {
      seen.push(readFileSync(inboxPath, "utf8"));
    });

    assert.equal(await doc.removeRange(0, 8, "- first\n"), "removed");
    assert.deepEqual(seen, ["- second\n"]);
  });

  test("never on a mismatch, which leaves the file untouched", async () => {
    writeFileSync(inboxPath, "- first\n- second\n");
    let raised = 0;
    const doc = new FsInboxDocument(inboxPath, new InboxMutex(), () => raised++);

    assert.equal(await doc.removeRange(0, 8, "- nothing like it"), "mismatch");
    assert.equal(raised, 0);
  });
});

describe("capture keeps its non-blocking submit", () => {
  test("submit returns before the write lands, and the signal comes after", async () => {
    const order: string[] = [];
    const changed = new InboxChanged();
    changed.subscribe(() => order.push("changed"));

    const service = new CaptureService({
      inbox: new FsInboxStore(inboxPath, new InboxMutex(), () => changed.raise()),
      transcription: { transcribe: async () => "" },
    });

    await service.submit("a thought", "typed");
    order.push("submit returned");

    // Hanging the signal off the write cannot be allowed to drag the capture
    // box's close behind the disk (Principle VI) — submit still resolves on
    // enqueue, so it necessarily comes back first.
    assert.deepEqual(order, ["submit returned"]);

    await service.flush();
    assert.deepEqual(order, ["submit returned", "changed"]);
    assert.match(readFileSync(inboxPath, "utf8"), /a thought/);
  });
});
