import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The writable window: this week and next.
 *
 * Widened from "this week only" because a review run on a Friday commits to the
 * week ahead — and the widening belongs to the **top three**, not to the review.
 * A review-only write path would be behaviour existing in exactly one client,
 * which is the thing the architecture is built to prevent (FR-049a).
 *
 * Past weeks are unchanged: still read-only, still refused with `past-week`.
 * That refusal is what makes the file a record rather than a scratchpad, and
 * `top-three-preservation.test.ts` asserts it without modification.
 *
 * The harness clock sits in 2026-W33, so W34 is next and W35 is out of reach.
 */

const FILE = `## 2026-W33

- [ ] Ship the migration runbook

## 2026-W31

- [x] Fix the fence — done 2026-07-31
`;

function service(content = FILE) {
  const vault = seedVault({ "top-three.md": content });
  return {
    vault,
    topThree: new TopThreeService({ vault, clock: new FixedClock("2026-08-14T10:00:00-04:00") }),
  };
}

describe("the current week", () => {
  test("is writable, as it always was", async () => {
    const { topThree } = service();
    const result = await topThree.addOutcome("Close the vendor contract");
    assert.ok(result.ok);
    assert.equal(result.week.id, "2026-W33");
  });
});

describe("the next week", () => {
  test("is writable", async () => {
    const { vault, topThree } = service();

    const result = await topThree.addOutcome("Land the cutover", "2026-W34");

    assert.ok(result.ok);
    assert.equal(result.week.id, "2026-W34");
    assert.match(vault.files.get("top-three.md") ?? "", /^## 2026-W34$/m);
  });

  test("its outcomes can be edited, completed, and removed", async () => {
    const { topThree } = service();
    await topThree.addOutcome("Land the cutover", "2026-W34");

    const week = (await topThree.history()).find((w) => w.id === "2026-W34");
    const outcome = week?.outcomes[0];
    assert.ok(outcome);

    const ref = { week: "2026-W34", index: outcome.index, raw: outcome.raw };
    const edited = await topThree.editOutcome(ref, "Land the cutover with the vendor");
    assert.ok(edited.ok);

    const next = edited.week.outcomes[0];
    assert.ok(next);
    const done = await topThree.completeOutcome({ week: "2026-W34", index: next.index, raw: next.raw });
    assert.ok(done.ok);
    assert.equal(done.week.outcomes[0]?.done, true);
  });
});

describe("two weeks ahead", () => {
  test("is refused with future-week, naming the weeks that are writable", async () => {
    const { topThree } = service();

    const result = await topThree.addOutcome("Something in a fortnight", "2026-W35");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "future-week");
      assert.match(result.message, /2026-W33/, "the user is told which weeks they may write");
      assert.match(result.message, /2026-W34/);
    }
  });

  test("writes nothing", async () => {
    const { vault, topThree } = service();
    vault.writeLog.length = 0;

    await topThree.addOutcome("Something in a fortnight", "2026-W35");

    assert.deepEqual(vault.writeLog, []);
  });

  test("and neither does an edit to one", async () => {
    const { topThree } = service();
    const result = await topThree.editOutcome(
      { week: "2026-W40", index: 0, raw: "- [ ] anything" },
      "changed",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "future-week");
  });
});

describe("an earlier week", () => {
  test("still refuses with past-week, unchanged", async () => {
    const { topThree } = service();

    const result = await topThree.editOutcome(
      { week: "2026-W31", index: 0, raw: "- [x] Fix the fence — done 2026-07-31" },
      "Rebuild the fence",
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "past-week", "the widening moved the future edge, not the past one");
      assert.match(result.message, /record/);
    }
  });

  test("is left byte-for-byte alone by a write to the next week", async () => {
    const { vault, topThree } = service();
    const before = vault.files.get("top-three.md") ?? "";

    await topThree.addOutcome("Land the cutover", "2026-W34");

    const after = vault.files.get("top-three.md") ?? "";
    assert.ok(after.includes("## 2026-W31"), "the old section is still there");
    assert.ok(
      after.includes("- [x] Fix the fence — done 2026-07-31"),
      "with its outcome, its done mark, and its completion date",
    );
    assert.notEqual(after, before, "and the new week really was written");
  });
});
