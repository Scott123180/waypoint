import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readCalendar } from "../src/calendar/calendar-document";

/**
 * Parsing never fails, and nothing is ever repaired (FR-032).
 *
 * A line the grammar cannot read comes back verbatim with its **1-based** line
 * number, so the user is sent to line 14 rather than sent hunting. It is never
 * listed as stale, never counted toward a panel, never rewritten, and never
 * dropped — the discipline `waiting-document.ts` already follows, and the same
 * `UnreadableLine` shape, because a second identical type would be free to
 * drift from the first.
 */

describe("parsing never throws", () => {
  const INPUTS: Record<string, string> = {
    "a file of noise": "###\n\ttabs\n!!!\n \n",
    "an empty file": "",
    "only blank lines": "\n\n\n",
    "a bare dash": "-\n",
    "a truncated item line": "- 2026-08-11 —\n",
    "an em dash with no date": "- — Something\n",
    "windows line endings": "- 2026-08-11 — Something\r\n",
    "an unterminated final line": "- 2026-08-11 — Something",
  };

  for (const [name, content] of Object.entries(INPUTS)) {
    test(name, () => {
      assert.doesNotThrow(() => readCalendar(content));
    });
  }
});

describe("nothing readable, nothing invented", () => {
  test("an empty file yields no items and no unreadable lines", () => {
    assert.deepEqual(readCalendar(""), { items: [], unreadable: [] });
  });

  test("blank lines alone yield nothing — a blank line is not a complaint", () => {
    assert.deepEqual(readCalendar("\n\n\n"), { items: [], unreadable: [] });
  });

  test("a file of noise yields no items, and every non-blank line is surfaced", () => {
    const { items, unreadable } = readCalendar("###\nnot an item\n\n!!!\n");
    assert.deepEqual(items, []);
    assert.deepEqual(unreadable, [
      { line: 1, raw: "###" },
      { line: 2, raw: "not an item" },
      { line: 4, raw: "!!!" },
    ]);
  });
});

describe("an unreadable line", () => {
  test("carries its 1-based line number, matching the editor's gutter", () => {
    const { unreadable } = readCalendar(
      ["- 2026-08-11 — First", "- badly formed", "- 2026-08-01 — Third", ""].join("\n"),
    );

    assert.deepEqual(unreadable, [{ line: 2, raw: "- badly formed" }]);
  });

  test("is returned exactly as it sits on disk, never normalized", () => {
    const raw = "-   2026-08-11  —   spacing all wrong   ";
    const { unreadable } = readCalendar(`${raw}\n`);
    assert.equal(unreadable[0]?.raw, raw);
  });

  test("is never counted as an item", () => {
    const { items } = readCalendar("- badly formed\n- also badly formed\n");
    assert.deepEqual(items, []);
  });
});

describe("a continuation is not an unreadable line", () => {
  test("an indented line under an open item is that item's text", () => {
    const { items, unreadable } = readCalendar(
      ["- 2026-07-30 — Quarterly planning day", "  needs a whole afternoon", ""].join("\n"),
    );

    assert.deepEqual(unreadable, [], "the continuation is already shown; complaining twice is wrong");
    assert.equal(items[0]?.text, "Quarterly planning day\nneeds a whole afternoon");
  });

  test("an indented line with no item above it has nothing to belong to", () => {
    const { items, unreadable } = readCalendar("  orphaned continuation\n");
    assert.deepEqual(items, []);
    assert.deepEqual(unreadable, [{ line: 1, raw: "  orphaned continuation" }]);
  });
});
