import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DECISION_POINTS } from "../src/ports/index";

/**
 * This feature adds no rule (FR-039).
 *
 * A guard, not a behaviour test — it is true the moment it is written, which is
 * exactly why it needs a sibling. **"No decision point was added" is also true
 * of a test in which no panel was ever built.** `shutdown-nothing-generated`
 * asserts from the other side that `waiting.stale.check` **was** consulted,
 * with `subject` `"item"` and with `subject` `"calendar"`, so "consulted
 * nothing" cannot masquerade as "consulted nothing new". Neither half may ship
 * without the other.
 *
 * `decision-points.test.ts` is untouched by this feature and still asserts the
 * same five. This file exists beside it so the claim is made in the feature's
 * own suite: if the count ever needs editing on this branch, a rule was added
 * and the design is wrong.
 */

describe("the seam is the size it was", () => {
  test("there are still exactly five points", () => {
    assert.equal(
      DECISION_POINTS.length,
      5,
      "a screen that shows what already exists holds no rule to enforce",
    );
  });

  test("they are the same five", () => {
    assert.deepEqual(
      [...DECISION_POINTS].sort(),
      [
        "project.milestone.add",
        "project.status.change",
        "review.inbox.advance",
        "waiting.stale.check",
        "week.outcome.record",
      ],
    );
  });
});

describe("no point is named for anything this feature introduced", () => {
  for (const forbidden of [/calendar/i, /shutdown|daily|evening|end.?of.?day/i, /\bday(s)?\b/i]) {
    test(`none matches ${forbidden}`, () => {
      const offender = DECISION_POINTS.find((point) => forbidden.test(point));
      assert.equal(
        offender,
        undefined,
        `${offender} is a second staleness rule wearing a new name — one point, three subjects`,
      );
    });
  }
});
