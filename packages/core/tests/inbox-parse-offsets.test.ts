import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";

/**
 * Offsets are BYTE offsets into the UTF-8 file, not character indices.
 * Character arithmetic here would corrupt any file containing an emoji, and
 * removal is a byte splice. See contracts/inbox-parse.md.
 */

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");
const slice = (doc: string, start: number, end: number): string =>
  Buffer.from(doc, "utf8").subarray(start, end).toString("utf8");

describe("parseInbox byte offsets", () => {
  test("raw is exactly the bytes in [start, end)", () => {
    const doc = "- 2026-08-09T14:23:05-04:00 First\nSecond\n";
    const items = parseInbox(doc);

    for (const item of items) {
      assert.equal(slice(doc, item.start, item.end), item.raw);
    }
  });

  test("blocks are contiguous and cover every non-blank line", () => {
    const doc = "- 2026-08-09T14:23:05-04:00 First\nSecond\n";
    const items = parseInbox(doc);

    assert.equal(items[0]?.start, 0);
    assert.equal(items[0]?.end, bytes("- 2026-08-09T14:23:05-04:00 First\n"));
    assert.equal(items[1]?.start, items[0]?.end);
    assert.equal(items[1]?.end, bytes(doc));
  });

  test("end includes the block's trailing newline", () => {
    const items = parseInbox("Solo\n");
    assert.equal(items[0]?.raw, "Solo\n");
    assert.equal(items[0]?.end, 5);
  });

  test("multi-byte characters do not shift offsets", () => {
    // "café ☕" is 6 characters but 9 bytes. A character-index implementation
    // passes every ASCII test and corrupts this file.
    const doc = "- 2026-08-09T14:23:05-04:00 café ☕\nplain\n";
    const items = parseInbox(doc);

    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(slice(doc, item.start, item.end), item.raw);
    }
    assert.equal(items[1]?.text, "plain");
  });

  test("emoji and CJK survive a round of slicing", () => {
    const doc = "- 2026-08-09T14:23:05-04:00 Book flights ✈️🧳\n日本語のメモ\ntail\n";
    const items = parseInbox(doc);

    assert.equal(items.length, 3);
    assert.equal(items[1]?.text, "日本語のメモ");
    for (const item of items) {
      assert.equal(slice(doc, item.start, item.end), item.raw);
    }
  });

  test("a missing trailing newline still yields a spliceable range", () => {
    // Hand-edited files frequently lack one.
    const doc = "- 2026-08-09T14:23:05-04:00 First\nno trailing newline";
    const items = parseInbox(doc);

    assert.equal(items.length, 2);
    assert.equal(items[1]?.text, "no trailing newline");
    assert.equal(items[1]?.end, bytes(doc));
    assert.equal(slice(doc, items[1]!.start, items[1]!.end), items[1]?.raw);
  });

  test("blank lines are excluded from every block", () => {
    const doc = "First\n\nSecond\n";
    const items = parseInbox(doc);

    assert.equal(items[0]?.raw, "First\n");
    assert.equal(items[1]?.raw, "Second\n");
    // The blank line between them belongs to neither, so removing an item
    // leaves the user's spacing exactly as they arranged it.
    assert.equal(items[1]?.start, bytes("First\n\n"));
  });

  test("removing a block by splice leaves every other byte identical", () => {
    const doc =
      "- 2026-08-09T14:23:05-04:00 keep me ☕\n" +
      "- 2026-08-09T14:31:12-04:00 remove me\n" +
      "  with a continuation\n" +
      "\n" +
      "keep me too\n";
    const items = parseInbox(doc);
    const target = items[1]!;

    const buf = Buffer.from(doc, "utf8");
    const after = Buffer.concat([buf.subarray(0, target.start), buf.subarray(target.end)]).toString(
      "utf8",
    );

    assert.equal(
      after,
      "- 2026-08-09T14:23:05-04:00 keep me ☕\n\nkeep me too\n",
    );
  });
});
