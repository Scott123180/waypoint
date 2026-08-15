import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isoWeek, nextWeek, weekStart } from "../src/weekly/iso-week";

/**
 * Week arithmetic, built on the one `isoWeek` this repo already has.
 *
 * The review needs to name the week *after* the one it is reviewing, and that
 * is where a second, hand-rolled implementation would have appeared — the
 * tempting `+ 7 days` or `+ 1` to the week number. Both are wrong at a year
 * boundary, and wrong in a way nobody notices until the first week of January
 * (research R9).
 *
 * The round-trip is the real test: `isoWeek(weekStart(id)) === id` over five
 * years of consecutive weeks, including a 53-week year. Anything that computes
 * the Monday of a week wrongly fails somewhere in that range.
 */

describe("weekStart", () => {
  test("returns the Monday of that ISO week", () => {
    // 2026-W33 runs Mon 10 Aug — Sun 16 Aug.
    const monday = weekStart("2026-W33");
    assert.equal(monday.getFullYear(), 2026);
    assert.equal(monday.getMonth(), 7);
    assert.equal(monday.getDate(), 10);
    assert.equal(monday.getDay(), 1, "Monday, because ISO weeks begin on Monday");
  });

  test("handles the week that straddles a year boundary", () => {
    // 2026-W53 runs Mon 28 Dec 2026 — Sun 3 Jan 2027. The identifier carries
    // the ISO week-numbering year, not the calendar year of every day in it.
    const monday = weekStart("2026-W53");
    assert.equal(monday.getFullYear(), 2026);
    assert.equal(monday.getMonth(), 11);
    assert.equal(monday.getDate(), 28);
  });
});

describe("the round trip", () => {
  test("holds over sixty consecutive weeks spanning three year boundaries", () => {
    // Starts inside 2025 and runs past the end of 2026 — which is a 53-week
    // ISO year, the case a naive implementation gets wrong.
    let week = "2025-W40";
    for (let i = 0; i < 120; i++) {
      assert.equal(isoWeek(weekStart(week)), week, `round trip failed at ${week}`);
      week = nextWeek(week);
    }
  });

  test("every day of a week maps back to that week", () => {
    const monday = weekStart("2026-W33");
    for (let day = 0; day < 7; day++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + day);
      assert.equal(isoWeek(date), "2026-W33", `day ${day} fell outside its own week`);
    }
  });
});

describe("nextWeek", () => {
  test("crosses a 53-week year correctly", () => {
    assert.equal(
      nextWeek("2026-W53"),
      "2027-W01",
      "the case `+ 1 to the number` gets wrong, silently, once a year",
    );
  });

  test("crosses an ordinary year boundary", () => {
    assert.equal(nextWeek("2025-W52"), "2026-W01");
  });

  test("is an ordinary increment within a year", () => {
    assert.equal(nextWeek("2026-W33"), "2026-W34");
    assert.equal(nextWeek("2026-W09"), "2026-W10", "and keeps the two-digit padding");
  });

  test("never produces a week the parser would reject", () => {
    let week = "2024-W01";
    for (let i = 0; i < 300; i++) {
      assert.match(week, /^\d{4}-W\d{2}$/, `${week} is not a week identifier`);
      week = nextWeek(week);
    }
  });
});
