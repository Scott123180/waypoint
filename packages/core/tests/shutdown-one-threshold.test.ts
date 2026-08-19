import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { calendarFile, policyFile, shutdownFor, waitingFile } from "./shutdown-fakes";

/**
 * One number moves all three sets, or this test fails (SC-006).
 *
 * `calendar-staleness-rule` and `shutdown-shared-threshold` assert this at the
 * policy module. This asserts it where the user sees it: through a whole
 * `read()`, over waiting items and calendar flags dated every day from 0 to 30
 * back, at the default and at one other configured value, with the boundary day
 * asserted on both sides.
 *
 * A second threshold anywhere — a calendar-specific key, a per-panel default, a
 * comparison in the service — makes the sets disagree and makes this red.
 */

const TODAY = "2026-08-19T10:00:00-04:00";

/** `2026-08-19` minus `days`, as a local calendar date. */
function daysAgo(days: number): string {
  const date = new Date("2026-08-19T12:00:00");
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

const AGES = Array.from({ length: 31 }, (_, i) => i);

function vault(threshold?: number): Record<string, string> {
  return {
    "waiting.md": waitingFile(
      AGES.map((age) => ({ since: daysAgo(age), owner: `Owner${age}`, text: `waiting ${age}` })),
    ),
    "calendar.md": calendarFile(
      AGES.map((age) => ({ flaggedOn: daysAgo(age), text: `flag ${age}` })),
    ),
    ...(threshold === undefined ? {} : { "policy.md": policyFile({ "staleness days": threshold }) }),
  };
}

/** The ages actually surfaced in each panel, from one reading. */
async function surfaced(threshold?: number): Promise<{ waiting: number[]; calendar: number[] }> {
  const { service } = shutdownFor(vault(threshold), { now: TODAY });
  const view = await service.read();

  return {
    waiting: view.waiting.items.map((s) => s.untouchedDays).sort((a, b) => a - b),
    calendar: view.calendar.items.map((s) => s.unscheduledDays).sort((a, b) => a - b),
  };
}

const atLeast = (n: number): number[] => AGES.filter((age) => age >= n);

describe("at the shipped default of seven", () => {
  test("both panels surface everything at or past seven days, and nothing under it", async () => {
    const result = await surfaced();

    assert.deepEqual(result.waiting, atLeast(7));
    assert.deepEqual(result.calendar, atLeast(7));
  });

  test("the boundary day is in, and the day before it is out — in both panels", async () => {
    const result = await surfaced();

    for (const [name, ages] of Object.entries(result)) {
      assert.ok(ages.includes(7), `${name} must include the boundary day itself`);
      assert.ok(!ages.includes(6), `${name} must not include the day inside it`);
    }
  });
});

describe("at a configured value", () => {
  test("both panels move together to fourteen", async () => {
    const result = await surfaced(14);

    assert.deepEqual(result.waiting, atLeast(14));
    assert.deepEqual(result.calendar, atLeast(14));
  });

  test("both panels move together to one", async () => {
    const result = await surfaced(1);

    assert.deepEqual(result.waiting, atLeast(1));
    assert.deepEqual(result.calendar, atLeast(1));
  });

  test("zero surfaces everything, including today's — zero is a number, not an off switch", async () => {
    const result = await surfaced(0);

    assert.deepEqual(result.waiting, AGES);
    assert.deepEqual(result.calendar, AGES);
  });

  test("a threshold past the fixture empties both", async () => {
    const result = await surfaced(31);

    assert.deepEqual(result.waiting, []);
    assert.deepEqual(result.calendar, []);
  });
});

describe("the two panels never disagree", () => {
  test("at every threshold from zero to thirty-one, the same ages surface in both", async () => {
    for (const threshold of [0, 1, 5, 6, 7, 8, 13, 14, 20, 30, 31]) {
      const result = await surfaced(threshold);
      assert.deepEqual(
        result.waiting,
        result.calendar,
        `threshold ${threshold} made the waiting panel and the calendar panel disagree`,
      );
    }
  });
});
