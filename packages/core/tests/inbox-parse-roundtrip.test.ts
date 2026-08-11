import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";
import { serializeItem } from "../src/inbox/serialize";
import { createCaptureItem } from "../src/capture/capture-item";

/**
 * parse and serialize are inverse operations on the same user-facing format.
 * If they ever disagree, capture writes items sort cannot read back.
 */

const at = (iso: string) => ({ now: () => new Date(iso) });

function roundTrip(text: string, iso = "2026-08-09T14:23:05-04:00") {
  const item = createCaptureItem(text, "typed", at(iso));
  const parsed = parseInbox(serializeItem(item));
  return { item, parsed };
}

describe("parse(serialize(x)) round trip", () => {
  const cases: [name: string, text: string][] = [
    ["plain text", "Call the roofer back"],
    ["trailing punctuation", "Did it work?"],
    ["leading dash", "- looks like a list item"],
    ["markdown heading", "## Someday"],
    ["markdown emphasis", "**bold** and _italic_"],
    ["a timestamp inside the text", "meet at 2026-08-09T14:23:05-04:00 sharp"],
    ["text that looks like a whole captured line", "- 2026-01-01T00:00:00-05:00 nested"],
    ["multi-byte", "café ☕ 日本語 ✈️"],
    ["multi-line", "first line\nsecond line\nthird line"],
    ["blank line inside", "before\n\nafter"],
    ["indented continuation-looking text", "outer\n  inner"],
    ["a very long single line", "x".repeat(2000)],
    ["internal double spaces", "keep  the   spacing"],
    ["colon-heavy", "note: this: that"],
  ];

  for (const [name, text] of cases) {
    test(`survives: ${name}`, () => {
      const { item, parsed } = roundTrip(text);

      assert.equal(parsed.length, 1, `expected exactly one item for ${JSON.stringify(text)}`);
      assert.equal(parsed[0]?.text, item.text);
      assert.equal(
        parsed[0]?.capturedAt?.getTime(),
        // Serialization is second-precision, so compare at that resolution.
        Math.floor(item.capturedAt.getTime() / 1000) * 1000,
      );
    });
  }

  test("a sequence of captures parses back one-for-one, in order", () => {
    const texts = ["first", "second\nwith continuation", "third ☕"];
    const items = texts.map((t, i) =>
      createCaptureItem(t, "typed", at(`2026-08-09T1${i}:00:00-04:00`)),
    );
    const doc = items.map(serializeItem).join("");

    const parsed = parseInbox(doc);

    assert.equal(parsed.length, texts.length);
    assert.deepEqual(parsed.map((p) => p.text), items.map((i) => i.text));
  });

  test("timestamps survive across a DST boundary in both directions", () => {
    // Serialization writes a local offset; parsing must not normalize it away.
    for (const iso of ["2026-01-15T12:00:00-05:00", "2026-07-15T12:00:00-04:00"]) {
      const { item, parsed } = roundTrip("seasonal", iso);
      assert.equal(
        parsed[0]?.capturedAt?.getTime(),
        Math.floor(item.capturedAt.getTime() / 1000) * 1000,
        `failed for ${iso}`,
      );
    }
  });
});
