import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { parseInbox } from "../src/inbox/parse";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * The guarantee that replaces Feature 1's "never rewrites" promise: sorting one
 * item changes that item's bytes and nothing else (FR-021, FR-023, FR-027d,
 * SC-003a).
 */

const MESSY =
  "# my inbox, hand organised\n" +
  "\n" +
  "- 2026-08-09T14:23:05-04:00 first captured\n" +
  "a line I typed myself\n" +
  "- 2026-08-09T14:31:12-04:00 second captured,\n" +
  "  with a continuation\n" +
  "\n" +
  "\n" +
  "## Someday\n" +
  "   \n" +
  "- 2026-08-09T15:02:44-04:00 café ☕ 日本語\n" +
  "trailing line with no newline";

describe("byte preservation across a sort", () => {
  const sortOne = async (doc: string, index: number) => {
    const inbox = new FakeInboxDocument(doc);
    const service = new SortService({
      inbox,
      vault: new FakeVaultStore(),
      journal: new FakeSortJournal(),
      clock: fixedClock(),
    });
    const item = parseInbox(doc)[index]!;
    const outcome = await service.sort(
      { start: item.start, end: item.end, raw: item.raw },
      { to: "trash" },
    );
    assert.equal(outcome.ok, true);
    return inbox.content;
  };

  test("removing any single item leaves the rest byte-identical", async () => {
    const items = parseInbox(MESSY);

    for (let i = 0; i < items.length; i++) {
      const after = await sortOne(MESSY, i);
      const expected =
        MESSY.slice(0, byteToCharIndex(MESSY, items[i]!.start)) +
        MESSY.slice(byteToCharIndex(MESSY, items[i]!.end));

      assert.equal(after, expected, `removing item ${i} disturbed other bytes`);
    }
  });

  test("sorting every item leaves only the blank lines and spacing", async () => {
    let doc = MESSY;
    for (let guard = 0; guard < 20; guard++) {
      const items = parseInbox(doc);
      if (items.length === 0) break;
      doc = await sortOne(doc, 0);
    }

    assert.equal(parseInbox(doc).length, 0);
    assert.equal(doc.trim(), "", "nothing routable may remain");
  });

  test("multi-byte content is never corrupted", async () => {
    const items = parseInbox(MESSY);
    const emojiIndex = items.findIndex((i) => i.text.includes("☕"));
    const after = await sortOne(MESSY, emojiIndex);

    assert.ok(!after.includes("☕"));
    assert.ok(after.includes("日本語") === false);
    // Everything else, including the hand-written lines, is intact.
    assert.ok(after.includes("a line I typed myself"));
    assert.ok(after.includes("## Someday"));
    assert.ok(after.includes("trailing line with no newline"));
  });

  test("a file with no trailing newline still round-trips", async () => {
    const items = parseInbox(MESSY);
    const last = items.length - 1;
    const after = await sortOne(MESSY, last);

    assert.ok(!after.includes("trailing line with no newline"));
    assert.ok(after.includes("café ☕"));
  });
});

/** Byte offset → character index, for building the expected string in tests. */
function byteToCharIndex(doc: string, byteOffset: number): number {
  return Buffer.from(doc, "utf8").subarray(0, byteOffset).toString("utf8").length;
}
