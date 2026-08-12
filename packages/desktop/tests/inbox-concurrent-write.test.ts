import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FsInboxStore } from "../src/main/adapters/fs-inbox-store";
import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault } from "./vault-fixture";
import { parseInbox } from "@waypoint/core";

/**
 * Regression test for a defect found in cross-artifact analysis, not in
 * production: sort rebuilds inbox.md and renames it into place, which orphans
 * the inode capture appends to. A capture landing mid-sort was destroyed
 * silently — no error, nothing on disk (FR-020e, SC-005a, research R4a).
 *
 * These tests must keep passing. If the shared mutex is ever removed from
 * either adapter, this is what catches it.
 */

const SEED =
  "- 2026-08-09T14:23:05-04:00 first\n" +
  "- 2026-08-09T14:31:12-04:00 second\n" +
  "- 2026-08-09T15:02:44-04:00 third\n";

const secondItem = () => {
  const item = parseInbox(SEED)[1]!;
  return { start: item.start, end: item.end, raw: item.raw };
};

describe("capture landing during a sort", () => {
  test("a concurrent append survives the removal", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const doc = new FsInboxDocument(vault.inboxPath, mutex);
      const ref = secondItem();

      // Both start in the same tick, the way a hotkey capture would while a
      // sort decision is committing.
      await Promise.all([
        doc.removeRange(ref.start, ref.end, ref.raw),
        store.append("- 2026-08-11T10:00:00-04:00 captured mid-sort\n"),
      ]);

      const after = vault.read("inbox.md");
      assert.match(after, /captured mid-sort/, "the capture must not be destroyed");
      assert.match(after, /first/);
      assert.match(after, /third/);
    } finally {
      vault.cleanup();
    }
  });

  test("many interleaved captures all survive", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const doc = new FsInboxDocument(vault.inboxPath, mutex);
      const ref = secondItem();

      const captures = Array.from({ length: 10 }, (_, i) =>
        store.append(`- 2026-08-11T10:00:0${i}-04:00 capture ${i}\n`),
      );

      await Promise.all([doc.removeRange(ref.start, ref.end, ref.raw), ...captures]);

      const after = vault.read("inbox.md");
      for (let i = 0; i < 10; i++) {
        assert.match(after, new RegExp(`capture ${i}\\b`), `capture ${i} was lost`);
      }
    } finally {
      vault.cleanup();
    }
  });

  test("the removal still happens, or refuses cleanly", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const doc = new FsInboxDocument(vault.inboxPath, mutex);
      const ref = secondItem();

      const [outcome] = await Promise.all([
        doc.removeRange(ref.start, ref.end, ref.raw),
        store.append("- 2026-08-11T10:00:00-04:00 late arrival\n"),
      ]);

      const after = vault.read("inbox.md");
      if (outcome === "removed") {
        assert.ok(!after.includes("second"), "the sorted item should be gone");
      } else {
        // Refusing is a safe outcome; losing the item is not.
        assert.match(after, /second/);
      }
      assert.match(after, /late arrival/);
    } finally {
      vault.cleanup();
    }
  });

  test("an append that lands after the read is not silently dropped", async () => {
    // The narrow case: the append completes while the rewrite is between its
    // read and its rename.
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const doc = new FsInboxDocument(vault.inboxPath, mutex);
      const ref = secondItem();

      const removal = doc.removeRange(ref.start, ref.end, ref.raw);
      const append = store.append("- 2026-08-11T10:00:00-04:00 squeezed in\n");
      await Promise.all([removal, append]);

      assert.match(vault.read("inbox.md"), /squeezed in/);
    } finally {
      vault.cleanup();
    }
  });
});

describe("the lost-update window, deterministically", () => {
  /**
   * The tests above exercise the *retry* path: an append that lands before the
   * final size check makes the splice start over, so the capture survives.
   *
   * They pass with or without the mutex, which makes them poor evidence. These
   * two drive the one window a size check cannot cover — after the stat,
   * before the rename — and show the difference plainly.
   */

  /** Stands in for the pre-fix design: no serialization between writers. */
  const passthroughMutex = { run: <T>(op: () => Promise<T>): Promise<T> => op() } as InboxMutex;

  test("WITHOUT the shared mutex, a capture in that window is destroyed", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const store = new FsInboxStore(vault.inboxPath, passthroughMutex);
      const ref = secondItem();

      const doc = new FsInboxDocument(vault.inboxPath, passthroughMutex, undefined, async () => {
        // Unserialized, this append goes straight to the doomed inode.
        await store.append("- 2026-08-11T10:00:00-04:00 doomed capture\n");
      });

      await doc.removeRange(ref.start, ref.end, ref.raw);

      // Documents the defect this design exists to prevent. If this ever
      // starts passing, the guard moved and the test above needs rewriting.
      assert.ok(
        !vault.read("inbox.md").includes("doomed capture"),
        "expected the unprotected version to lose the capture",
      );
    } finally {
      vault.cleanup();
    }
  });

  test("WITH the shared mutex, the same capture survives", async () => {
    const vault = makeTempVault();
    try {
      vault.write("inbox.md", SEED);

      const mutex = new InboxMutex();
      const store = new FsInboxStore(vault.inboxPath, mutex);
      const ref = secondItem();

      let queued: Promise<unknown> = Promise.resolve();
      const doc = new FsInboxDocument(vault.inboxPath, mutex, undefined, () => {
        // The lock is held, so this queues behind the rewrite instead of
        // racing it. Not awaited here — awaiting inside the critical section
        // would deadlock, which is itself the point.
        queued = store.append("- 2026-08-11T10:00:00-04:00 protected capture\n");
      });

      await doc.removeRange(ref.start, ref.end, ref.raw);
      await queued;

      const after = vault.read("inbox.md");
      assert.match(after, /protected capture/, "the mutex must preserve the capture");
      assert.ok(!after.includes("second"), "the sorted item should still be gone");
    } finally {
      vault.cleanup();
    }
  });
});
