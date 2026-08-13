import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { structureGaps } from "../src/projects/gaps";
import type { Project, ProjectStatus } from "../src/projects/types";

/**
 * The incomplete flag: derived on every read, never stored (FR-018, FR-020).
 *
 * A stored flag would be a second copy of a fact the fields already carry, and
 * the two would diverge the first time the user edited the file in vim — which
 * is the exact scenario this data model exists to support (research R5).
 */

function project(over: Partial<Project> = {}): Project {
  return {
    slug: "p",
    title: "P",
    status: "active",
    outcome: "Done means done.",
    nextAction: "Do the thing",
    dri: "me",
    milestones: [
      {
        index: 0,
        definitionOfDone: "One",
        verifier: "me",
        done: false,
        completedOn: null,
        raw: "- [ ] One — @me",
      },
    ],
    completedOn: null,
    unprocessed: [],
    ...over,
  };
}

describe("structureGaps", () => {
  test("a fully structured project has no gaps", () => {
    assert.deepEqual(structureGaps(project()), []);
  });

  describe("all eight combinations of the three elements", () => {
    const CASES: ReadonlyArray<readonly [boolean, boolean, boolean, string[]]> = [
      [true, true, true, []],
      [false, true, true, ["outcome"]],
      [true, false, true, ["milestones"]],
      [true, true, false, ["next-action"]],
      [false, false, true, ["outcome", "milestones"]],
      [false, true, false, ["outcome", "next-action"]],
      [true, false, false, ["milestones", "next-action"]],
      [false, false, false, ["outcome", "milestones", "next-action"]],
    ];

    for (const [hasOutcome, hasMilestones, hasNextAction, expected] of CASES) {
      test(`outcome=${hasOutcome} milestones=${hasMilestones} nextAction=${hasNextAction}`, () => {
        const p = project({
          outcome: hasOutcome ? "An outcome" : null,
          milestones: hasMilestones ? project().milestones : [],
          nextAction: hasNextAction ? "An action" : null,
        });
        assert.deepEqual(structureGaps(p), expected);
      });
    }
  });

  test("gaps come back in a stable order, so the UI does not reshuffle", () => {
    const p = project({ outcome: null, milestones: [], nextAction: null });
    assert.deepEqual(structureGaps(p), ["outcome", "milestones", "next-action"]);
    assert.deepEqual(structureGaps(p), structureGaps(p));
  });

  describe("what does NOT flag", () => {
    test("a missing DRI never contributes a gap", () => {
      // Deliberate: the spec lists three elements, and a DRI is not one of them
      // (FR-009). A project you own yourself is not half-defined.
      assert.deepEqual(structureGaps(project({ dri: null })), []);
    });

    test("exactly one milestone does not flag", () => {
      // The floor of two is a target, not a rule (FR-013a). One milestone is a
      // project mid-typing.
      assert.deepEqual(structureGaps(project()), []);
    });

    test("four milestones do not flag", () => {
      const many = [0, 1, 2, 3].map((i) => ({
        index: i,
        definitionOfDone: `M${i}`,
        verifier: null,
        done: false,
        completedOn: null,
        raw: `- [ ] M${i}`,
      }));
      assert.deepEqual(structureGaps(project({ milestones: many })), []);
    });

    test("unprocessed items neither cause nor clear a gap", () => {
      const withItems = project({
        unprocessed: [{ text: "raw", capturedAt: null, index: 0, raw: "- raw" }],
      });
      assert.deepEqual(structureGaps(withItems), []);
    });
  });

  describe("status has no influence (FR-021)", () => {
    for (const status of ["active", "parked", "waiting", "done"] as ProjectStatus[]) {
      test(`a ${status} project missing its outcome still reports it`, () => {
        assert.deepEqual(structureGaps(project({ status, outcome: null })), ["outcome"]);
      });

      test(`a ${status} project that is complete reports nothing`, () => {
        assert.deepEqual(structureGaps(project({ status })), []);
      });
    }
  });

  test("supplying the last missing element clears the flag with no separate step", () => {
    // FR-023: because the flag is derived, clearing it is not an action at all.
    const before = project({ nextAction: null });
    assert.deepEqual(structureGaps(before), ["next-action"]);
    assert.deepEqual(structureGaps({ ...before, nextAction: "Now there is one" }), []);
  });

  test("an outcome of only whitespace counts as missing", () => {
    assert.deepEqual(structureGaps(project({ outcome: "   " })), ["outcome"]);
  });
});
