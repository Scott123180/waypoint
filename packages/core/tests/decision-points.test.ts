import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DECISION_POINTS } from "../src/ports/index";

/**
 * The seam declares exactly three decision points (FR-063a).
 *
 * A guard rather than a behaviour test. The constitution allows one default
 * policy module and no extension surface; the matching discipline on core's
 * side is that decision points are declared when a rule needs them, never
 * speculatively. Without this, a fourth point can be added silently and the
 * seam sprawls one commit at a time.
 */

describe("decision points", () => {
  test("there are exactly three", () => {
    assert.equal(DECISION_POINTS.length, 3);
  });

  test("they are the three named in the contract", () => {
    assert.deepEqual(
      [...DECISION_POINTS].sort(),
      ["project.milestone.add", "project.status.change", "week.outcome.record"],
    );
  });

  test("no duplicates", () => {
    assert.equal(new Set(DECISION_POINTS).size, DECISION_POINTS.length);
  });
});
