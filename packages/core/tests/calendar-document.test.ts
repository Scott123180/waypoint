import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CALENDAR_PATH, readCalendar } from "../src/calendar/calendar-document";
import { calendarFile } from "./shutdown-fakes";

/**
 * Reading `calendar.md` (contracts/calendar-format.md).
 *
 * The format is **not** designed here. Feature 2 fixed it when it started
 * writing this file, deliberately shaping it like `waiting.md` so a later
 * feature could measure staleness the same way. This is that feature, and this
 * is the reading half.
 *
 * The fixtures render through the shipped `calendarLine`, so a fixture cannot
 * drift from the grammar the parser is supposed to accept.
 */

const CAPTURED = new Date("2026-08-09T16:02:11-04:00");

describe("the item line", () => {
  test("the path is the one sorting writes", () => {
    assert.equal(CALENDAR_PATH, "calendar.md");
  });

  test("a line with a capture timestamp keeps both the flag date and the time", () => {
    const { items, unreadable } = readCalendar(
      calendarFile([
        { flaggedOn: "2026-08-11", text: "Book flights for the March offsite", capturedAt: CAPTURED },
      ]),
    );

    assert.deepEqual(unreadable, []);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.flaggedOn, "2026-08-11");
    assert.equal(items[0]?.text, "Book flights for the March offsite");
    assert.equal(items[0]?.capturedAt?.toISOString(), CAPTURED.toISOString());
  });

  test("a hand-written line has no capture time, and none is substituted", () => {
    const { items } = readCalendar(
      calendarFile([{ flaggedOn: "2026-08-11", text: "Dentist sometime in September" }]),
    );

    assert.equal(items[0]?.capturedAt, null);
    assert.equal(items[0]?.text, "Dentist sometime in September");
  });

  test("the flag date is carried verbatim, whatever it says", () => {
    // A malformed date is not evidence of neglect and is not repaired here.
    // `daysBetween` yields null and the rule answers `allow` (FR-029a).
    const { items } = readCalendar("- 2026-13-99 — Something\n");
    assert.equal(items[0]?.flaggedOn, "2026-13-99");
  });
});

describe("continuations", () => {
  test("two-space continuation lines rejoin with newlines", () => {
    const { items, unreadable } = readCalendar(
      ["- 2026-07-30 — Quarterly planning day", "  needs a whole afternoon, not an hour", ""].join("\n"),
    );

    assert.deepEqual(unreadable, []);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.text, "Quarterly planning day\nneeds a whole afternoon, not an hour");
  });

  test("`raw` is the whole block, item line and continuations together", () => {
    const content = ["- 2026-07-30 — Quarterly planning day", "  needs a whole afternoon", ""].join("\n");
    const { items } = readCalendar(content);

    assert.equal(items[0]?.raw, "- 2026-07-30 — Quarterly planning day\n  needs a whole afternoon");
  });
});

describe("order and identity", () => {
  const CONTENT = calendarFile([
    { flaggedOn: "2026-08-11", text: "First" },
    { flaggedOn: "2026-07-30", text: "Second" },
    { flaggedOn: "2026-08-01", text: "Third" },
  ]);

  test("file order is preserved — nothing is sorted by date", () => {
    const { items } = readCalendar(CONTENT);
    assert.deepEqual(items.map((i) => i.text), ["First", "Second", "Third"]);
  });

  test("`index` is the 0-based position among well-formed items", () => {
    const { items } = readCalendar(CONTENT);
    assert.deepEqual(items.map((i) => i.index), [0, 1, 2]);
  });

  test("an unreadable line between two items does not shift the second one's index", () => {
    // A malformed *list item*, which ends the block above rather than being
    // absorbed into it. An unindented line that starts no list item is a
    // continuation of the item above, exactly as in `waiting.md`.
    const { items } = readCalendar(
      ["- 2026-08-11 — First", "- not an item at all", "- 2026-08-01 — Third", ""].join("\n"),
    );

    assert.deepEqual(items.map((i) => [i.index, i.text]), [
      [0, "First"],
      [1, "Third"],
    ]);
  });
});
