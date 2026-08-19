import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_POLICY_CONFIG, parsePolicyConfig } from "../src/policy/policy-config";
import { createDefaultPolicy } from "../src/policy/default-policy";
import { DECISION_POINTS, type DecisionVerdict } from "../src/ports/index";
import { seedVault } from "./project-fakes";
import { policyFile } from "./shutdown-fakes";

/**
 * One number, three subjects, no way to configure them apart (SC-006).
 *
 * Feature 5 wrote the two-subject version of this test. Feature 9 adds the
 * third and asserts all three together, because the guard is against the
 * obvious later "improvement": a second key, added because someone wanted a
 * different number for calendar flags.
 *
 * Structural rather than promised — there is exactly one `staleness days` key
 * and exactly one `waiting.stale.check` point, so "configure them separately"
 * is not a thing that can be expressed.
 */

const TODAY = "2026-08-19";
const SUBJECTS = ["item", "project", "calendar"] as const;

async function verdicts(
  since: string,
  threshold?: string | number,
): Promise<Record<(typeof SUBJECTS)[number], DecisionVerdict>> {
  const vault = seedVault(
    threshold === undefined ? {} : { "policy.md": policyFile({ "staleness days": threshold }) },
  );
  const policy = createDefaultPolicy(vault);

  const out = {} as Record<(typeof SUBJECTS)[number], DecisionVerdict>;
  for (const subject of SUBJECTS) {
    out[subject] = (
      await policy.decide({ point: "waiting.stale.check", subject, since, today: TODAY })
    ).verdict;
  }
  return out;
}

function all(verdict: DecisionVerdict): Record<(typeof SUBJECTS)[number], DecisionVerdict> {
  return { item: verdict, project: verdict, calendar: verdict };
}

describe("the same date gets the same verdict whatever the subject is", () => {
  test("at the shipped default of seven", async () => {
    assert.deepEqual(await verdicts("2026-08-12"), all("warn"), "seven days — the boundary itself");
    assert.deepEqual(await verdicts("2026-08-13"), all("allow"), "six days");
  });

  test("at a configured value, on both sides of its boundary", async () => {
    assert.deepEqual(await verdicts("2026-08-06", 14), all("allow"), "thirteen days, threshold 14");
    assert.deepEqual(await verdicts("2026-08-05", 14), all("warn"), "fourteen days, threshold 14");
  });

  test("at zero, which is a number and not an off switch", async () => {
    assert.deepEqual(await verdicts(TODAY, 0), all("warn"));
  });

  test("for an unreadable date, and for a future one", async () => {
    assert.deepEqual(await verdicts("soon"), all("allow"));
    assert.deepEqual(await verdicts("2026-12-25"), all("allow"));
  });
});

describe("changing the one value moves all three together", () => {
  test("a date 44 days back crosses every subject's boundary at the same number", async () => {
    const since = "2026-07-06";

    assert.deepEqual(await verdicts(since, 44), all("warn"), "at the threshold");
    assert.deepEqual(await verdicts(since, 45), all("allow"), "one past it");
    assert.deepEqual(await verdicts(since, 100), all("allow"));
    assert.deepEqual(await verdicts(since, 7), all("warn"));
  });

  test("there is no value that separates them", async () => {
    for (const threshold of [0, 1, 6, 7, 8, 13, 14, 30, 44, 45, 365]) {
      const result = await verdicts("2026-07-06", threshold);
      assert.equal(
        new Set(Object.values(result)).size,
        1,
        `threshold ${threshold} produced ${JSON.stringify(result)} — the subjects disagreed`,
      );
    }
  });
});

describe("no calendar-specific configuration exists to be set", () => {
  test("`PolicyConfig` gains no key", () => {
    assert.deepEqual(Object.keys(DEFAULT_POLICY_CONFIG).sort(), [
      "inboxGate",
      "milestoneCap",
      "stalenessDays",
      "weeklyOutcomeCap",
      "wipLimit",
    ]);
  });

  test("a calendar key in policy.md is not read, and is not even complained about", () => {
    // Unknown keys have always been ignored. The assertion is that no branch
    // was added to pick this one up.
    const config = parsePolicyConfig(
      policyFile({ "staleness days": 7, "calendar staleness days": 30 }),
      { withProblems: true },
    );

    assert.equal(config.stalenessDays, 7);
    assert.ok(!("calendarStalenessDays" in config));
  });

  test("the configuration parser names no calendar setting", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "policy", "policy-config.ts"),
      "utf8",
    );
    assert.ok(!/calendar/i.test(source), "a calendar key here would be the second threshold");
  });
});

describe("and no second decision point either", () => {
  test("the count is still five", () => {
    assert.equal(DECISION_POINTS.length, 5);
  });

  test("none of them is named for a calendar", () => {
    for (const point of DECISION_POINTS) assert.doesNotMatch(point, /calendar/i);
  });
});
