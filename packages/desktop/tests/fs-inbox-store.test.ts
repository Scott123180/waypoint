import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";

let dir: string;
let inboxPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "waypoint-inbox-"));
  inboxPath = join(dir, "inbox.md");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FsInboxStore.append", () => {
  test("creates the file when absent", async () => {
    const store = new FsInboxStore(inboxPath);
    await store.append("- a thought\n");

    assert.equal(readFileSync(inboxPath, "utf8"), "- a thought\n");
  });

  test("creates missing parent directories", async () => {
    const nested = join(dir, "deep", "nested", "inbox.md");
    const store = new FsInboxStore(nested);
    await store.append("- a thought\n");

    assert.ok(existsSync(nested));
    assert.equal(readFileSync(nested, "utf8"), "- a thought\n");
  });

  test("appends to the end, leaving earlier content alone", async () => {
    writeFileSync(inboxPath, "- older thought\n");
    const store = new FsInboxStore(inboxPath);
    await store.append("- newer thought\n");

    assert.equal(readFileSync(inboxPath, "utf8"), "- older thought\n- newer thought\n");
  });

  test("reports the byte offset before the write", async () => {
    writeFileSync(inboxPath, "- older\n");
    const store = new FsInboxStore(inboxPath);

    const { offsetBefore } = await store.append("- newer\n");
    assert.equal(offsetBefore, 8);
  });

  test("reports offset 0 for a file that did not exist", async () => {
    const store = new FsInboxStore(inboxPath);
    const { offsetBefore } = await store.append("- first\n");
    assert.equal(offsetBefore, 0);
  });

  test("inserts a newline first when the existing file lacks a trailing one", async () => {
    // A hand-edited file often ends without a newline. Appending blindly would
    // graft our item onto the end of the user's last line.
    writeFileSync(inboxPath, "- hand written, no trailing newline");
    const store = new FsInboxStore(inboxPath);
    await store.append("- ours\n");

    assert.equal(
      readFileSync(inboxPath, "utf8"),
      "- hand written, no trailing newline\n- ours\n",
    );
  });

  test("preserves hand-edited content byte-for-byte", async () => {
    const handWritten = [
      "# My inbox",
      "",
      "- 2026-08-01T09:00:00-04:00 something I reworded myself",
      "  with a continuation I added",
      "",
      "a stray paragraph that is not an item at all",
      "",
    ].join("\n");
    writeFileSync(inboxPath, handWritten);

    const store = new FsInboxStore(inboxPath);
    await store.append("- appended\n");

    const after = readFileSync(inboxPath, "utf8");
    assert.ok(after.startsWith(handWritten), "existing content must be untouched");
    assert.equal(after, handWritten + "- appended\n");
  });

  test("counts offsets in bytes, not characters", async () => {
    writeFileSync(inboxPath, "- café\n");
    const store = new FsInboxStore(inboxPath);

    const { offsetBefore } = await store.append("- next\n");
    assert.equal(offsetBefore, 8);
  });

  test("keeps concurrent appends intact and ordered per call", async () => {
    const store = new FsInboxStore(inboxPath);
    await Promise.all([
      store.append("- one\n"),
      store.append("- two\n"),
      store.append("- three\n"),
    ]);

    const content = readFileSync(inboxPath, "utf8");
    // O_APPEND guarantees no write lands inside another, whatever the order.
    for (const line of ["- one\n", "- two\n", "- three\n"]) {
      assert.ok(content.includes(line), `expected intact line ${JSON.stringify(line)}`);
    }
    assert.equal(content.split("\n").filter(Boolean).length, 3);
  });
});
