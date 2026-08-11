import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { InboxMutex } from "../src/main/inbox-mutex";

let dir: string;
let inboxPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-undo-"));
  inboxPath = join(dir, "inbox.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FsInboxStore.size", () => {
  test("reports the byte length", async () => {
    writeFileSync(inboxPath, "- a thought\n");
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).size(), 12);
  });

  test("reports zero for a missing file", async () => {
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).size(), 0);
  });

  test("counts bytes, not characters", async () => {
    writeFileSync(inboxPath, "café\n");
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).size(), 6);
  });
});

describe("FsInboxStore.readTail", () => {
  test("reads the trailing bytes", async () => {
    writeFileSync(inboxPath, "- earlier\n- ours\n");
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).readTail(7), "- ours\n");
  });

  test("reads the whole file when asked for more than it holds", async () => {
    writeFileSync(inboxPath, "- short\n");
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).readTail(999), "- short\n");
  });

  test("returns empty for a missing file", async () => {
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).readTail(10), "");
  });

  test("reads multi-byte characters back intact", async () => {
    const block = "- café ☕\n";
    writeFileSync(inboxPath, `- earlier\n${block}`);

    const bytes = Buffer.byteLength(block, "utf8");
    assert.equal(await new FsInboxStore(inboxPath, new InboxMutex()).readTail(bytes), block);
  });
});

describe("FsInboxStore.truncate", () => {
  test("cuts the file back to the given length", async () => {
    writeFileSync(inboxPath, "- earlier\n- ours\n");
    await new FsInboxStore(inboxPath, new InboxMutex()).truncate(10);

    assert.equal(readFileSync(inboxPath, "utf8"), "- earlier\n");
  });

  test("restores the file byte-for-byte", async () => {
    const original = "# My inbox\n\n- hand written\n";
    writeFileSync(inboxPath, original);
    const store = new FsInboxStore(inboxPath, new InboxMutex());

    const { offsetBefore } = await store.append("- appended\n");
    await store.truncate(offsetBefore);

    assert.equal(readFileSync(inboxPath, "utf8"), original);
  });

  test("restores a file that had no trailing newline", async () => {
    // The append adds one; undo must remove that too, not leave it behind.
    const original = "hand written, no trailing newline";
    writeFileSync(inboxPath, original);
    const store = new FsInboxStore(inboxPath, new InboxMutex());

    const { offsetBefore } = await store.append("- appended\n");
    await store.truncate(offsetBefore);

    assert.equal(readFileSync(inboxPath, "utf8"), original);
  });
});

describe("append then undo round trip", () => {
  test("the recorded offset and tail identify exactly what was written", async () => {
    writeFileSync(inboxPath, "- earlier\n");
    const store = new FsInboxStore(inboxPath, new InboxMutex());

    const block = "- ours\n";
    const { offsetBefore } = await store.append(block);

    const size = await store.size();
    const tail = await store.readTail(size - offsetBefore);
    assert.equal(tail, block);

    await store.truncate(offsetBefore);
    assert.equal(readFileSync(inboxPath, "utf8"), "- earlier\n");
  });

  test("a hand edit after the append is detectable", async () => {
    writeFileSync(inboxPath, "- earlier\n");
    const store = new FsInboxStore(inboxPath, new InboxMutex());
    const block = "- ours\n";
    const { offsetBefore } = await store.append(block);

    writeFileSync(inboxPath, readFileSync(inboxPath, "utf8") + "- added by hand\n");

    const size = await store.size();
    const tail = await store.readTail(size - offsetBefore);
    // The mismatch is what lets undo refuse instead of deleting the new line.
    assert.notEqual(tail, block);
  });
});
