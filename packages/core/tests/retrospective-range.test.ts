import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { inRange, isLocalDate } from "../src/retrospective/select";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * The range, and what it contains.
 *
 * Both endpoints are inclusive (FR-001), and membership is decided by comparing
 * `YYYY-MM-DD` as text (FR-002). The text comparison is not a shortcut: parsing
 * to instants is what would let a timezone or a DST transition move a
 * completion across a boundary, which is exactly the recalculation FR-052
 * forbids.
 */

const VAULT = {
  "projects/fence.md": projectFile({
    slug: "fence",
    title: "Fix the fence",
    milestones: [
      { text: "day before", done: true, completedOn: "2026-05-31" },
      { text: "first day", done: true, completedOn: "2026-06-01" },
      { text: "last day", done: true, completedOn: "2026-06-30" },
      { text: "day after", done: true, completedOn: "2026-07-01" },
    ],
  }),
};

describe("range boundaries are inclusive (SC-002)", () => {
  test("both endpoints are members, and neither neighbour is", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-30"));

    assert.deepEqual(
      r.completions.map((c) => c.text),
      ["last day", "first day"],
    );
  });

  test("a single day is a range", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-01"));
    assert.deepEqual(
      r.completions.map((c) => c.text),
      ["first day"],
    );
  });

  test("widening by one day at each end picks up exactly one more at each end", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-05-31", "2026-07-01"));
    assert.equal(r.completions.length, 4);
  });
});

/**
 * T011a — no timezone conversion (FR-002).
 *
 * `TZ=America/New_York` is pinned by the test script, so a regression to
 * instant comparison would pass under the one zone CI runs in. This changes the
 * zone at runtime and asserts the answer does not move, which is the only way
 * the pinned zone stops being a place for the bug to hide.
 */
describe("selection does not convert timezones", () => {
  const originalTz = process.env["TZ"];
  after(() => {
    process.env["TZ"] = originalTz;
  });

  // 2026-03-08 is the US spring-forward; 2026-11-01 the fall-back. A date
  // parsed as an instant and formatted back can land on the previous day.
  const DST = {
    "projects/clocks.md": projectFile({
      slug: "clocks",
      title: "Clock changes",
      milestones: [
        { text: "spring forward", done: true, completedOn: "2026-03-08" },
        { text: "fall back", done: true, completedOn: "2026-11-01" },
      ],
    }),
  };

  for (const tz of ["America/New_York", "Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
    test(`membership is identical under TZ=${tz}`, async () => {
      process.env["TZ"] = tz;
      const { service } = serviceFor(DST);

      const spring = await readOk(service, range("2026-03-08", "2026-03-08"));
      assert.deepEqual(
        spring.completions.map((c) => c.text),
        ["spring forward"],
      );

      const fall = await readOk(service, range("2026-11-01", "2026-11-01"));
      assert.deepEqual(
        fall.completions.map((c) => c.text),
        ["fall back"],
      );

      // And the day either side stays out, in every zone.
      const before = await readOk(service, range("2026-03-07", "2026-03-07"));
      assert.deepEqual(before.completions, []);
    });
  }

  test("`inRange` touches no clock at all", () => {
    // A pure string predicate: if this ever needs a Date, the guarantee is gone.
    assert.equal(inRange("2026-03-08", { from: "2026-03-08", to: "2026-03-08" }), true);
    assert.equal(inRange("2026-03-07", { from: "2026-03-08", to: "2026-03-08" }), false);
    assert.equal(inRange("2026-11-01", { from: "2026-01-01", to: "2026-12-31" }), true);
  });
});

describe("what counts as a date", () => {
  test("a real calendar date", () => {
    assert.equal(isLocalDate("2026-06-01"), true);
    assert.equal(isLocalDate("2026-02-29"), false, "2026 is not a leap year");
    assert.equal(isLocalDate("2024-02-29"), true);
  });

  test("shaped like a date but not one", () => {
    // The trap: this matches every `\d{4}-\d{2}-\d{2}` check in the repo,
    // including the one `parseMilestone` uses to populate `completedOn`.
    assert.equal(isLocalDate("2026-13-45"), false);
    assert.equal(isLocalDate("2026-00-10"), false);
    assert.equal(isLocalDate("2026-06-31"), false);
  });

  test("not a date at all", () => {
    for (const value of ["", "soon", "2026", "2026-6-1", "next tuesday"]) {
      assert.equal(isLocalDate(value), false, value);
    }
  });
});

describe("refusals (T007)", () => {
  test("an inverted range is refused, naming both dates", async () => {
    const { service, vault } = serviceFor(VAULT);
    const result = await service.read(range("2026-12-31", "2026-01-01"));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "range-inverted");
    assert.match(result.message, /2026-12-31/);
    assert.match(result.message, /2026-01-01/);
    // A refusal reads nothing (FR-003).
    assert.deepEqual(vault.reads, []);
    assert.deepEqual(vault.lists, []);
  });

  test("an endpoint that is not a calendar date is refused first", async () => {
    const { service } = serviceFor(VAULT);
    const result = await service.read(range("2026-13-45", "2026-01-01"));

    assert.equal(result.ok, false);
    if (result.ok) return;
    // Not `range-inverted`, even though it would also compare as inverted:
    // an inverted comparison is never performed on something that is not a date.
    assert.equal(result.reason, "invalid-date");
    assert.match(result.message, /start/);
  });

  test("the end date is validated too", async () => {
    const { service } = serviceFor(VAULT);
    const result = await service.read(range("2026-01-01", "whenever"));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "invalid-date");
    assert.match(result.message, /end/);
  });
});
