import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DECISION_POINTS } from "../src/ports/index";
import * as core from "../src/index";

/**
 * FR-034 and SC-011: this feature adds no decision point, and consults none.
 *
 * `decision-points.test.ts` already asserts the count, and this feature did not
 * edit it — that is the load-bearing fact, and it is checked by
 * `degrade-to-nothing.test.ts`. What *this* file adds is the reason the count
 * did not move, stated where a future contributor will look for it.
 *
 * There is no rule here to allow, warn, or block. A proposal the user is free
 * to reject holds no opinion the system enforces, so there is nothing for a
 * decision point to decide. Accepting goes through `sort()`, and whatever
 * policy that action consults is consulted identically — which is a stronger
 * guarantee than adding a point and registering nothing against it.
 */

describe("the count is unchanged", () => {
  test("still five, and still the same five", () => {
    assert.equal(DECISION_POINTS.length, 5);
    assert.deepEqual(
      [...DECISION_POINTS],
      [
        "project.status.change",
        "project.milestone.add",
        "week.outcome.record",
        "review.inbox.advance",
        "waiting.stale.check",
      ],
    );
  });

  test("no point is named for anything this feature does", () => {
    for (const point of DECISION_POINTS) {
      assert.doesNotMatch(point, /suggest|propose|split|intelligence|transport|piece/i);
    }
  });
});

describe("no DecisionContext member was added", () => {
  const PORTS = readFileSync(join(__dirname, "..", "..", "src", "ports", "index.ts"), "utf8");

  test("the union still has exactly five members, one per point", () => {
    const union = /export type DecisionContext =([\s\S]*?);/.exec(PORTS);
    assert.ok(union, "DecisionContext must be declared in ports/index.ts");

    const members = (union[1] ?? "")
      .split("|")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    assert.deepEqual(members.sort(), [
      "MilestoneAddContext",
      "OutcomeRecordContext",
      "ReviewInboxAdvanceContext",
      "StatusChangeContext",
      "WaitingStaleContext",
    ]);
  });

  test("no context type is exported for a suggestion", () => {
    for (const name of Object.keys(core)) {
      assert.doesNotMatch(
        name,
        /SuggestionContext|SplitContext|DestinationContext|ProposalContext/,
        `${name} is a decision point arriving without one being declared`,
      );
    }
  });
});

describe("and none is consulted", () => {
  function code(...parts: string[]): string {
    return readFileSync(join(__dirname, "..", "..", "src", ...parts), "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  for (const file of [
    ["suggest", "suggestion-service.ts"],
    ["suggest", "catalog.ts"],
    ["suggest", "intelligence-config.ts"],
    ["suggest", "types.ts"],
    ["intelligence", "default-intelligence.ts"],
    ["intelligence", "request.ts"],
    ["intelligence", "response.ts"],
    ["intelligence", "segments.ts"],
  ]) {
    test(`${file.join("/")} names no decision point and no verdict`, () => {
      const source = code(...file);

      assert.ok(!source.includes("DECISION_POINTS"), "a decision point is referenced");
      assert.ok(!source.includes("decide("), "a rule is consulted");
      assert.ok(!source.includes("PolicyModule"), "a policy module is reachable");
      for (const verdict of ['"allow"', '"warn"', '"block"']) {
        assert.ok(!source.includes(verdict), `${verdict} appears — this layer holds no verdicts`);
      }
    });
  }

  test("the split verb consults nothing either", () => {
    const source = code("sort", "split.ts");
    assert.ok(!source.includes("decide("), "splitting consults a rule");
    assert.ok(!source.includes("DECISION_POINTS"));
  });
});
