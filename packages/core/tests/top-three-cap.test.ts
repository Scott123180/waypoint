import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The weekly outcome cap — a policy rule, not a core invariant (FR-063).
 *
 * The project's own test for the boundary is that a rule two users could set
 * differently while both still using Waypoint correctly is policy. The
 * constitution applied exactly that test to the milestone cap; this is the
 * near-identical rule, so it lands in the same place.
 */

const NOW = "2026-08-14T10:00:00-04:00"; // 2026-W33

function service(policy?: string) {
  const files: Record<string, string> = {};
  if (policy !== undefined) files["policy.md"] = policy;
  const vault = seedVault(files);
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(NOW) }) };
}

describe("weekly outcome cap", () => {
  test("the default is three", async () => {
    const { topThree } = service();
    for (const text of ["a", "b", "c"]) {
      assert.ok((await topThree.addOutcome(text)).ok, `${text} should be accepted`);
    }

    const fourth = await topThree.addOutcome("d");
    assert.ok(!fourth.ok);
    assert.equal(fourth.reason, "outcome-cap");
  });

  test("the refusal states the maximum", async () => {
    const { topThree } = service();
    for (const text of ["a", "b", "c"]) await topThree.addOutcome(text);

    const fourth = await topThree.addOutcome("d");
    assert.ok(!fourth.ok);
    assert.match(fourth.message, /three|3/i);
  });

  test("the existing outcomes are unchanged when it refuses", async () => {
    const { vault, topThree } = service();
    for (const text of ["a", "b", "c"]) await topThree.addOutcome(text);
    const before = vault.files.get("top-three.md") ?? "";

    await topThree.addOutcome("d");

    assert.equal(vault.files.get("top-three.md"), before, "a refusal writes nothing");
  });

  test("a configured cap of two refuses the third", async () => {
    const { topThree } = service("# Policy\n\nweekly outcome cap: 2\n");

    assert.ok((await topThree.addOutcome("a")).ok);
    assert.ok((await topThree.addOutcome("b")).ok);

    const third = await topThree.addOutcome("c");
    assert.ok(!third.ok);
    assert.equal(third.reason, "outcome-cap");
  });

  test("a configured cap of five accepts a fourth and fifth", async () => {
    const { topThree } = service("weekly outcome cap: 5\n");
    for (const text of ["a", "b", "c", "d", "e"]) {
      assert.ok((await topThree.addOutcome(text)).ok, `${text} should be accepted at a cap of five`);
    }
    assert.ok(!(await topThree.addOutcome("f")).ok);
  });

  test("the concept is still the top three at any configured cap (FR-063b)", async () => {
    // The cap is a rule the user may set; the name is core vocabulary. A user
    // who configures five has changed a rule, not renamed the concept — the
    // same way a configurable milestone cap does not rename milestones.
    const { topThree } = service("weekly outcome cap: 5\n");
    const week = await topThree.current();
    assert.equal(week.id, "2026-W33", "still a week of the top three, whatever the cap");
    assert.ok("outcomes" in week, "the shape does not change with the cap");
  });

  test("a cap of zero refuses everything and is not corrected", async () => {
    const { topThree } = service("weekly outcome cap: 0\n");
    const result = await topThree.addOutcome("a");
    assert.ok(!result.ok);
    assert.equal(result.reason, "outcome-cap");
  });

  test("editing, completing and removing are never capped", async () => {
    // Only recording a new outcome can take a week over its maximum.
    const { topThree } = service("weekly outcome cap: 1\n");
    await topThree.addOutcome("a");
    const week = await topThree.current();
    const ref = { week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" };

    assert.ok((await topThree.editOutcome(ref, "a, revised")).ok);
    const revised = await topThree.current();
    const next = { week: revised.id, index: 0, raw: revised.outcomes[0]?.raw ?? "" };
    assert.ok((await topThree.completeOutcome(next)).ok);
  });

  test("a hand-edited week over the cap is displayed, and the next add is still refused", async () => {
    const vault = seedVault({
      "top-three.md": ["## 2026-W33", "", "- [ ] a", "- [ ] b", "- [ ] c", "- [ ] d", ""].join("\n"),
    });
    const topThree = new TopThreeService({ vault, clock: new FixedClock(NOW) });

    assert.equal((await topThree.current()).outcomes.length, 4, "shown as it stands");
    const result = await topThree.addOutcome("e");
    assert.ok(!result.ok, "but the app will not add a fifth");
  });
});
