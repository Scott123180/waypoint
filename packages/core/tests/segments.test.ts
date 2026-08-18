import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { segment, segmentTexts } from "../src/intelligence/segments";

/**
 * The partition the verbatim guarantee rests on (research R3).
 *
 * The model is shown numbered segments and answers with numbers. Core builds
 * every proposed piece by slicing the original at those numbers, so a piece
 * cannot contain words the user did not say — the response never carries text
 * at all.
 *
 * That only holds if the segments are a **total** partition: every byte of the
 * item lands in exactly one segment, whitespace included. Everything else here
 * is a heuristic and is allowed to be. A bad boundary yields a coarser
 * proposal; it cannot yield a wrong one. So the property below is the test
 * that matters, and the boundary assertions are documentation of the current
 * heuristic rather than a correctness claim.
 */

const FIXTURES: Record<string, string> = {
  empty: "",
  "single sentence": "Call the roofer about the estimate.",
  "no terminal punctuation": "call the roofer about the estimate",
  "run-on dictation":
    "ok so the hiring req, no wait, the req for the backend role, I need to get that " +
    "written up. Also dentist, Thursday I think. And the deploy pipeline keeps timing " +
    "out on the migration step.",
  "every terminator": "Did I? I did! Yes. Fine.",
  "multi-line": "first line\nsecond line\nthird line",
  "embedded blank lines": "first thought\n\nsecond thought\n\n\nthird thought",
  "blank line after a terminator": "One thought.\n\nAnother thought.",
  "trailing whitespace": "trailing spaces here.   ",
  "trailing newline": "ends with a newline\n",
  "leading whitespace": "   leading spaces",
  "double spaced sentences": "First one.  Second one.  Third one.",
  "continuation indent": "a dictated thought\n  that wrapped onto another line",
  "non-ASCII": "café. naïve résumé. 日本語のテキスト。 emoji 🎉 too.",
  "decimal points": "it costs 3.50 and takes 2.5 hours.",
  "only whitespace": "   \n  \n",
  "single character": "x",
};

describe("the partition is total — this is the load-bearing property", () => {
  for (const [name, text] of Object.entries(FIXTURES)) {
    test(`${name}: the segments concatenated are the item, byte for byte`, () => {
      const segments = segment(text);
      const rejoined = segments.map((s) => text.slice(s.start, s.end)).join("");

      assert.equal(rejoined, text, "a byte was dropped, duplicated, or reordered");
      assert.equal(
        Buffer.from(rejoined, "utf8").equals(Buffer.from(text, "utf8")),
        true,
        "the strings compare equal but the bytes differ",
      );
    });

    test(`${name}: segments abut exactly, with no gap and no overlap`, () => {
      const segments = segment(text);
      let expected = 0;
      for (const s of segments) {
        assert.equal(s.start, expected, "a gap or an overlap between segments");
        assert.ok(s.end > s.start, "an empty segment is not a segment");
        expected = s.end;
      }
      assert.equal(expected, text.length, "the last segment does not reach the end");
    });

    test(`${name}: indices are 0..n-1 in file order`, () => {
      const segments = segment(text);
      assert.deepEqual(
        segments.map((s) => s.index),
        segments.map((_, i) => i),
        "the index is what the model names, so it must be the position",
      );
    });
  }

  test("an empty item has no segments at all", () => {
    assert.deepEqual(segment(""), []);
  });
});

describe("where the boundaries fall — the heuristic, documented", () => {
  test("after a terminator followed by whitespace, which the segment keeps", () => {
    assert.deepEqual(segmentTexts("One. Two."), ["One. ", "Two."]);
    assert.deepEqual(segmentTexts("Really? Yes! Fine."), ["Really? ", "Yes! ", "Fine."]);
  });

  test("the whole whitespace run belongs to the segment it follows", () => {
    assert.deepEqual(segmentTexts("First one.  Second one."), ["First one.  ", "Second one."]);
    assert.deepEqual(segmentTexts("One thought.\n\nAnother."), ["One thought.\n\n", "Another."]);
  });

  test("at every newline, whether or not a sentence ended there", () => {
    assert.deepEqual(segmentTexts("first line\nsecond line"), ["first line\n", "second line"]);
  });

  test("a wrapped continuation keeps its indent, so nothing about layout is lost", () => {
    assert.deepEqual(segmentTexts("a thought\n  that wrapped"), ["a thought\n", "  that wrapped"]);
  });

  test("a terminator not followed by whitespace is not a boundary", () => {
    // "3.50" must not become two segments. The heuristic is allowed to be
    // imperfect, but this case is common enough in dictation to pin down.
    assert.deepEqual(segmentTexts("it costs 3.50 today"), ["it costs 3.50 today"]);
  });

  test("a terminator at the very end is not a boundary, because nothing follows", () => {
    assert.deepEqual(segmentTexts("Done."), ["Done."]);
  });
});

describe("what the provider is shown", () => {
  test("segment text is derived by slicing, never stored separately", () => {
    const text = "One. Two. Three.";
    const segments = segment(text);
    for (const s of segments) {
      assert.equal(text.slice(s.start, s.end).length > 0, true);
    }
    // A `Segment` carries offsets and an index. It deliberately carries no
    // text field: two copies of the same bytes are two things that can
    // disagree, and the whole point is that there is one original.
    assert.deepEqual(Object.keys(segments[0] ?? {}).sort(), ["end", "index", "start"]);
  });
});
