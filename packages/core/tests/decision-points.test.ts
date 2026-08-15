import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DECISION_POINTS } from "../src/ports/index";

/**
 * The seam declares exactly five decision points (004 FR-063a, 005 FR-080).
 *
 * A guard rather than a behaviour test. The constitution allows one default
 * policy module and no extension surface; the matching discipline on core's
 * side is that decision points are declared when a rule needs them, never
 * speculatively. Without this, a sixth point can be added silently and the
 * seam sprawls one commit at a time.
 *
 * **Why this count moved from three.** Feature 5 added two points, each with a
 * rule registered against it: the inbox gate and the shared staleness check.
 * The number is the thing that changed — no existing point moved, and no
 * behaviour drifted with it. Feature 4 anticipated exactly this: "when a future
 * feature needs a fourth, it adds it then."
 */

describe("decision points", () => {
  test("there are exactly five", () => {
    assert.equal(DECISION_POINTS.length, 5);
  });

  test("they are the five named in the contracts", () => {
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

  test("no duplicates", () => {
    assert.equal(new Set(DECISION_POINTS).size, DECISION_POINTS.length);
  });
});
