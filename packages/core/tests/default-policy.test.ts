import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultPolicy } from "../src/policy/default-policy";
import { DECISION_POINTS } from "../src/ports/index";
import type { DecisionContext } from "../src/ports/index";
import { FakeVaultStore } from "./sort-fakes";

/**
 * The one default module answers every point with a well-formed decision.
 *
 * Shape, not rules — each rule is tested by the story that owns it. What is
 * asserted here is the contract every caller relies on: a verdict from the
 * closed set, and a reason a client can display whenever the answer is not
 * `allow`. A blocked write with no explanation is a dead end for the user.
 */

function contextFor(point: (typeof DECISION_POINTS)[number]): DecisionContext {
  const project = { slug: "p", title: "P", status: "active" as const, dri: null };
  switch (point) {
    case "project.status.change":
      return {
        point,
        project,
        from: "parked",
        to: "active",
        dri: { resolution: "unassigned", raw: null },
        openMilestones: [],
        activeProjectsDrivenByUser: () => Promise.resolve([]),
      };
    case "project.milestone.add":
      return { point, project, milestoneCount: 0 };
    case "week.outcome.record":
      return { point, week: "2026-W33", outcomeCount: 0 };
  }
}

describe("default policy module", () => {
  for (const point of DECISION_POINTS) {
    test(`${point} returns a well-formed decision`, async () => {
      const policy = createDefaultPolicy(new FakeVaultStore());
      const decision = await policy.decide(contextFor(point));

      assert.ok(
        ["allow", "warn", "block"].includes(decision.verdict),
        `verdict must be in the closed set, got ${decision.verdict}`,
      );
      if (decision.verdict !== "allow") {
        assert.ok(decision.reason.length > 0, "a non-allow decision must carry a displayable reason");
      }
    });
  }

  test("a benign context is allowed at every point", async () => {
    const policy = createDefaultPolicy(new FakeVaultStore());
    for (const point of DECISION_POINTS) {
      const decision = await policy.decide(contextFor(point));
      assert.equal(decision.verdict, "allow", `${point} should allow a benign context`);
    }
  });

  test("subjects, when present, are never empty", async () => {
    const policy = createDefaultPolicy(new FakeVaultStore());
    for (const point of DECISION_POINTS) {
      const decision = await policy.decide(contextFor(point));
      if (decision.subjects !== undefined) {
        assert.ok(decision.subjects.length > 0, "an empty subjects list is worse than none");
      }
    }
  });
});
