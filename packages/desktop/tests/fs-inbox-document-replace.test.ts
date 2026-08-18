import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "@waypoint/core";

import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault } from "./vault-fixture";

/**
 * `replaceRange` — the one method `InboxDocument` gains (research R8).
 *
 * It has to carry exactly the guarantees `removeRange` documents, because it
 * is the same operation with a non-empty replacement: atomic to a reader,
 * never discards a concurrent append, and writes nothing at all on a mismatch.
 * A split is one call to this, which is what makes FR-014's all-or-nothing the
 * rename's guarantee rather than a recovery path (research R9).
 *
 * The other half of this file is about what did **not** change. Feature 2's
 * `removeRange` keeps its signature and its behaviour and shares the same
 * private splice, so nothing that already worked has a second implementation
 * to drift from.
 */

const SEED =
  "- 2026-08-09T14:23:05-04:00 first\n" +
  "- 2026-08-09T14:31:12-04:00 second\n" +
  "- 2026-08-09T15:02:44-04:00 third\n";

const REPLACEMENT =
  "- 2026-08-09T14:31:12-04:00 second, part one\n" +
  "- 2026-08-09T14:31:12-04:00 second, part two\n";

function secondItem() {
  const item = parseInbox(SEED)[1]!;
  return { start: item.start, end: item.end, raw: item.raw };
}

describe("replacing a range", () => {
  test("puts the replacement exactly where the original was", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      const ref = secondItem();

      const result = await doc.replaceRange(ref.start, ref.end, ref.raw, REPLACEMENT);

      assert.equal(result, "replaced");
      assert.deepEqual(parseInbox(vault.read("inbox.md")).map((i) => i.text), [
        "first",
        "second, part one",
        "second, part two",
        "third",
      ]);
    } finally {
      vault.cleanup();
    }
  });

  test("writes nothing when the bytes do not match", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      const ref = secondItem();

      const result = await doc.replaceRange(ref.start, ref.end, "- something else entirely\n", REPLACEMENT);

      assert.equal(result, "mismatch");
      assert.equal(vault.read("inbox.md"), SEED, "a mismatch must leave the file untouched");
    } finally {
      vault.cleanup();
    }
  });

  test("an empty replacement is a removal, and is still one atomic write", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      const ref = secondItem();

      assert.equal(await doc.replaceRange(ref.start, ref.end, ref.raw, ""), "replaced");
      assert.deepEqual(parseInbox(vault.read("inbox.md")).map((i) => i.text), ["first", "third"]);
    } finally {
      vault.cleanup();
    }
  });

  test("a missing file is a mismatch rather than a crash", async () => {
    const vault = makeTempVault();
    try {
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      assert.equal(await doc.replaceRange(0, 10, "anything", REPLACEMENT), "mismatch");
    } finally {
      vault.cleanup();
    }
  });

  test("raises the changed signal only when bytes actually moved", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      let raised = 0;
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex(), () => (raised += 1));
      const ref = secondItem();

      await doc.replaceRange(ref.start, ref.end, "- wrong\n", REPLACEMENT);
      assert.equal(raised, 0, "a mismatch changed nothing, so no view should wake");

      await doc.replaceRange(ref.start, ref.end, ref.raw, REPLACEMENT);
      assert.equal(raised, 1, "a landed split raises the same signal capture and sort raise");
    } finally {
      vault.cleanup();
    }
  });
});

describe("a concurrent append is never discarded", () => {
  test("a capture landing mid-replace survives it", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const doc = new FsInboxDocument(vault.inboxPath, mutex);
      const ref = secondItem();

      await Promise.all([
        doc.replaceRange(ref.start, ref.end, ref.raw, REPLACEMENT),
        store.append("- 2026-08-11T10:00:00-04:00 captured mid-split\n"),
      ]);

      const after = vault.read("inbox.md");
      assert.match(after, /captured mid-split/, "the capture must not be destroyed by the rename");
      assert.match(after, /first/);
      assert.match(after, /third/);
    } finally {
      vault.cleanup();
    }
  });

  test("an out-of-process append that the size check can see causes a retry", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      const ref = secondItem();

      // Grown since the ref was taken, but the ref's own bytes are untouched —
      // an editor appending at the end. The stat before the rename sees the
      // new size, so the splice starts over from a fresh read rather than
      // renaming a file built from stale bytes.
      vault.write("inbox.md", `${SEED}- 2026-08-12T09:00:00-04:00 typed in vim\n`);

      assert.equal(await doc.replaceRange(ref.start, ref.end, ref.raw, REPLACEMENT), "replaced");

      const after = vault.read("inbox.md");
      assert.match(after, /typed in vim/, "the editor's line was discarded");
      assert.match(after, /second, part one/, "and the split still landed");
    } finally {
      vault.cleanup();
    }
  });

  /**
   * The one window a size check cannot cover: after the final `stat`, before
   * the `rename`. `beforeRename` exists to open it deliberately.
   *
   * An append landing there is discarded, and always has been — that is why
   * the shared mutex is a *required* constructor argument, so in-process
   * writers can never reach this window at all. What matters for Feature 8 is
   * that `replaceRange` is no worse than `removeRange`: the same window, the
   * same size, reached the same way. A split that had widened it would be a
   * regression this asserts against.
   */
  test("the beforeRename window is identical for both verbs", async () => {
    async function lostAppend(verb: "remove" | "replace"): Promise<boolean> {
      const vault = makeTempVault();
      try {
        vault.write("inbox.md", SEED);
        let once = false;
        const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex(), undefined, () => {
          if (once) return;
          once = true;
          vault.write("inbox.md", `${SEED}- 2026-08-12T09:00:00-04:00 typed in vim\n`);
        });

        const ref = secondItem();
        if (verb === "remove") await doc.removeRange(ref.start, ref.end, ref.raw);
        else await doc.replaceRange(ref.start, ref.end, ref.raw, REPLACEMENT);

        return !vault.read("inbox.md").includes("typed in vim");
      } finally {
        vault.cleanup();
      }
    }

    assert.equal(
      await lostAppend("replace"),
      await lostAppend("remove"),
      "replaceRange behaves differently in the window than removeRange does",
    );
  });
});

describe("removeRange is untouched", () => {
  test("its signature is unchanged: three arguments", () => {
    assert.equal(FsInboxDocument.prototype.removeRange.length, 3);
  });

  test("it still removes, and still reports a mismatch without writing", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      const ref = secondItem();

      assert.equal(await doc.removeRange(ref.start, ref.end, "- wrong\n"), "mismatch");
      assert.equal(vault.read("inbox.md"), SEED);

      assert.equal(await doc.removeRange(ref.start, ref.end, ref.raw), "removed");
      assert.deepEqual(parseInbox(vault.read("inbox.md")).map((i) => i.text), ["first", "third"]);
    } finally {
      vault.cleanup();
    }
  });

  test("both verbs share one splice, so neither can drift from the other", () => {
    // Two implementations of "rebuild and rename atomically" would be two
    // places for the concurrency handling to diverge, and the second one would
    // be the one nobody tested against a real editor.
    const names = Object.getOwnPropertyNames(FsInboxDocument.prototype);
    assert.ok(names.includes("spliceOnce"), "the shared splice must still be shared");
    assert.equal(
      names.filter((n) => n.startsWith("splice")).length,
      2,
      "spliceWithRetry and spliceOnce, and no third copy",
    );
  });
});
