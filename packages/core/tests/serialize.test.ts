// Fixed zone so the local-offset assertions are deterministic on any machine.
process.env.TZ = "America/New_York";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { serializeItem, formatTimestamp } from "../src/inbox/serialize";
import type { CaptureItem } from "../src/capture/capture-item";

function item(text: string, iso = "2026-08-09T18:23:05.000Z"): CaptureItem {
  return { id: "test-id", text, capturedAt: new Date(iso), source: "typed" };
}

describe("formatTimestamp", () => {
  test("uses ISO 8601 with a local UTC offset, to seconds", () => {
    const stamp = formatTimestamp(new Date("2026-08-09T18:23:05.000Z"));
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  test("renders the local wall-clock time the user experienced", () => {
    // 18:23:05Z is 14:23:05 in New York (EDT, -04:00).
    const stamp = formatTimestamp(new Date("2026-08-09T18:23:05.000Z"));
    assert.equal(stamp, "2026-08-09T14:23:05-04:00");
  });

  test("round-trips back to the same instant", () => {
    const original = new Date("2026-01-15T09:07:03.000Z");
    const parsed = new Date(formatTimestamp(original));
    assert.equal(parsed.getTime(), original.getTime());
  });

  test("handles a standard-time date with a different offset", () => {
    // January is EST (-05:00), proving the offset is computed, not hardcoded.
    assert.equal(formatTimestamp(new Date("2026-01-15T19:07:03.000Z")), "2026-01-15T14:07:03-05:00");
  });
});

describe("serializeItem", () => {
  test("renders a single-line thought as one markdown list item", () => {
    const block = serializeItem(item("Call the roofer back about the estimate"));
    assert.equal(block, "- 2026-08-09T14:23:05-04:00 Call the roofer back about the estimate\n");
  });

  test("puts exactly one space between timestamp and text", () => {
    const block = serializeItem(item("thought"));
    assert.match(block, /^- \S+ thought\n$/);
  });

  test("indents continuation lines by exactly two spaces", () => {
    const block = serializeItem(item("first line\nsecond line\nthird line"));
    assert.equal(
      block,
      "- 2026-08-09T14:23:05-04:00 first line\n  second line\n  third line\n",
    );
  });

  test("preserves blank lines inside a dictated paragraph break", () => {
    const block = serializeItem(item("para one\n\npara two"));
    assert.equal(block, "- 2026-08-09T14:23:05-04:00 para one\n\n  para two\n");
  });

  test("always ends with a newline so the next append is safe", () => {
    assert.ok(serializeItem(item("no trailing newline here")).endsWith("\n"));
  });

  test("does not alter the text", () => {
    // No capitalization, punctuation, or trailing-period fixes: capture is raw.
    const raw = "ask priya re: the migration window   (and the on-call rotation)";
    const block = serializeItem(item(raw));
    assert.ok(block.includes(raw));
  });

  test("does not emit an id, tag, or any other metadata", () => {
    const block = serializeItem(item("a thought"));
    assert.ok(!block.includes("test-id"));
    assert.ok(!block.includes("typed"));
  });
});
