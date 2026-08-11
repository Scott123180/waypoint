import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

import { FsInboxDocument } from "../src/main/adapters/fs-inbox-document";
import { InboxMutex } from "../src/main/inbox-mutex";
import { makeTempVault } from "./vault-fixture";
import { parseInbox } from "@waypoint/core";

const SEED =
  "- 2026-08-09T14:23:05-04:00 first ☕\n" +
  "- 2026-08-09T14:31:12-04:00 second\n" +
  "  with a continuation\n" +
  "\n" +
  "hand written third\n";

const refAt = (doc: string, i: number) => {
  const item = parseInbox(doc)[i]!;
  return { start: item.start, end: item.end, raw: item.raw };
};

const withVault = async (fn: (v: ReturnType<typeof makeTempVault>, d: FsInboxDocument) => Promise<void>) => {
  const vault = makeTempVault();
  try {
    vault.write("inbox.md", SEED);
    await fn(vault, new FsInboxDocument(vault.inboxPath, new InboxMutex()));
  } finally {
    vault.cleanup();
  }
};

describe("FsInboxDocument.read", () => {
  test("returns the file contents", async () => {
    await withVault(async (vault, doc) => {
      assert.equal(await doc.read(), SEED);
      void vault;
    });
  });

  test("a missing file reads as empty rather than throwing", async () => {
    const vault = makeTempVault();
    try {
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      assert.equal(await doc.read(), "");
    } finally {
      vault.cleanup();
    }
  });
});

describe("FsInboxDocument.removeRange", () => {
  test("removes exactly the block and nothing else", async () => {
    await withVault(async (vault, doc) => {
      const ref = refAt(SEED, 1);

      assert.equal(await doc.removeRange(ref.start, ref.end, ref.raw), "removed");
      assert.equal(vault.read("inbox.md"), "- 2026-08-09T14:23:05-04:00 first ☕\n\nhand written third\n");
    });
  });

  test("multi-byte content does not corrupt the splice", async () => {
    await withVault(async (vault, doc) => {
      const ref = refAt(SEED, 0);

      assert.equal(await doc.removeRange(ref.start, ref.end, ref.raw), "removed");
      const after = vault.read("inbox.md");
      assert.ok(!after.includes("first"));
      assert.match(after, /second/);
    });
  });

  test("refuses without writing when the bytes changed", async () => {
    await withVault(async (vault, doc) => {
      const ref = refAt(SEED, 1);
      const edited = SEED.replace("second", "SECOND reworded");
      writeFileSync(vault.inboxPath, edited);

      assert.equal(await doc.removeRange(ref.start, ref.end, ref.raw), "mismatch");
      assert.equal(vault.read("inbox.md"), edited, "not one byte may change on refusal");
    });
  });

  test("refuses when the file was deleted", async () => {
    const vault = makeTempVault();
    try {
      const doc = new FsInboxDocument(vault.inboxPath, new InboxMutex());
      assert.equal(await doc.removeRange(0, 5, "hello"), "mismatch");
    } finally {
      vault.cleanup();
    }
  });

  test("leaves no temp files behind on success or refusal", async () => {
    await withVault(async (vault, doc) => {
      const ref = refAt(SEED, 0);
      await doc.removeRange(ref.start, ref.end, ref.raw);
      await doc.removeRange(ref.start, ref.end, "something else entirely");

      const strays = readdirSync(vault.root).filter((f) => f.includes(".tmp"));
      assert.deepEqual(strays, []);
    });
  });

  test("removing every item empties the file", async () => {
    await withVault(async (vault, doc) => {
      for (let guard = 0; guard < 10; guard++) {
        const items = parseInbox(readFileSync(vault.inboxPath, "utf8"));
        const item = items[0];
        if (!item) break;
        await doc.removeRange(item.start, item.end, item.raw);
      }

      assert.equal(vault.read("inbox.md").trim(), "");
    });
  });

  test("the result is durable, not buffered", async () => {
    await withVault(async (vault, doc) => {
      const ref = refAt(SEED, 0);
      await doc.removeRange(ref.start, ref.end, ref.raw);

      // Read through a fresh descriptor, the way another process would.
      assert.ok(!readFileSync(vault.inboxPath, "utf8").includes("first ☕"));
    });
  });
});
