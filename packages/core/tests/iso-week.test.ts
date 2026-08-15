import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isoWeek } from "../src/weekly/iso-week";

/**
 * ISO-8601 week identifiers, computed rather than imported (research R1).
 *
 * Weeks start Monday, week 01 is the one containing the first Thursday, and
 * the label carries the ISO week-numbering year — so a January date can read
 * as the previous year, which looks wrong at a glance and is correct. It is
 * the price of every week having exactly one identifier (FR-003b).
 *
 * `TZ=America/New_York` is pinned in the `test` script and is load-bearing
 * here: "which week is it" is a question about the user's local midnight. A
 * run under UTC would place Sunday-evening dates in the following week.
 */

/** Local midnight, which is what a user means by a date. */
function local(y: number, m: number, d: number, hour = 12): Date {
  return new Date(y, m - 1, d, hour);
}

describe("isoWeek", () => {
  test("the reference week used throughout the design docs", () => {
    // 2026-08-14 is a Friday; the Thursday fixing its week is 2026-08-13.
    assert.equal(isoWeek(local(2026, 8, 14)), "2026-W33");
  });

  describe("year boundaries", () => {
    const cases: Array<[string, Date, string]> = [
      // 2026-01-01 is a Thursday, so it falls in week 01 of 2026 — and drags
      // the tail of December 2025 with it.
      ["2025-12-28 (Sunday) closes 2025", local(2025, 12, 28), "2025-W52"],
      ["2025-12-29 (Monday) opens 2026-W01", local(2025, 12, 29), "2026-W01"],
      ["2026-01-01 (Thursday)", local(2026, 1, 1), "2026-W01"],
      ["2026-01-04 (Sunday) closes 2026-W01", local(2026, 1, 4), "2026-W01"],
      ["2026-01-05 (Monday) opens W02", local(2026, 1, 5), "2026-W02"],

      // 2026 is a 53-week year, so 2027 opens inside 2026-W53.
      ["2026-12-31 (Thursday)", local(2026, 12, 31), "2026-W53"],
      ["2027-01-01 (Friday) still belongs to 2026", local(2027, 1, 1), "2026-W53"],
      ["2027-01-03 (Sunday) still belongs to 2026", local(2027, 1, 3), "2026-W53"],
      ["2027-01-04 (Monday) opens 2027-W01", local(2027, 1, 4), "2027-W01"],

      // A third boundary, in the other direction: 2024 ends inside 2025-W01.
      ["2024-12-29 (Sunday) closes 2024", local(2024, 12, 29), "2024-W52"],
      ["2024-12-30 (Monday) opens 2025-W01", local(2024, 12, 30), "2025-W01"],
      ["2025-01-01 (Wednesday)", local(2025, 1, 1), "2025-W01"],

      // 2020 was also a 53-week year.
      ["2021-01-01 (Friday) belongs to 2020", local(2021, 1, 1), "2020-W53"],
    ];

    for (const [name, date, expected] of cases) {
      test(name, () => {
        assert.equal(isoWeek(date), expected);
      });
    }
  });

  test("the week turns over on Monday, not at the weekend", () => {
    // Sunday evening and Monday morning are different weeks. This is the case
    // a UTC-run test would get wrong.
    assert.equal(isoWeek(local(2026, 8, 16, 23)), "2026-W33", "Sunday night");
    assert.equal(isoWeek(local(2026, 8, 17, 0)), "2026-W34", "Monday midnight");
  });

  test("every day of one week shares an identifier", () => {
    const ids = new Set<string>();
    for (let d = 17; d <= 23; d++) ids.add(isoWeek(local(2026, 8, d)));
    assert.deepEqual([...ids], ["2026-W34"]);
  });

  test("the week number is always zero-padded to two digits", () => {
    assert.equal(isoWeek(local(2026, 1, 1)), "2026-W01");
    assert.match(isoWeek(local(2026, 3, 2)), /^\d{4}-W\d{2}$/);
  });

  test("60 consecutive weeks sort chronologically as plain text", () => {
    // The reason for zero-padding: identifiers are section headings in a file
    // the user greps and sorts. Text order must be time order (SC-002b).
    const ids: string[] = [];
    const cursor = local(2026, 6, 1);
    for (let i = 0; i < 60; i++) {
      ids.push(isoWeek(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    assert.deepEqual([...ids].sort(), ids, "text order diverged from time order");
    assert.equal(new Set(ids).size, 60, "no week repeated or skipped");
  });

  test("no week is unreachable across a 53-week year", () => {
    // Walk every day of 2026 and confirm all 53 weeks appear.
    const weeks = new Set<string>();
    const cursor = local(2026, 1, 1);
    while (cursor.getFullYear() === 2026) {
      weeks.add(isoWeek(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const of2026 = [...weeks].filter((w) => w.startsWith("2026-W"));
    assert.equal(of2026.length, 53, "2026 is a 53-week ISO year");
  });
});
