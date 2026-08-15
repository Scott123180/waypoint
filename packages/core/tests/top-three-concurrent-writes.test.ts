import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Overlapping writes do not lose an outcome.
 *
 * Found by the end-to-end suite, not by design: pressing Enter twice quickly in
 * the add box produced two outcomes where three were typed, silently. Every
 * write here is read-modify-write over a whole week's section, so two calls
 * that overlap both read the same state and the second discards the first.
 *
 * Awaits interleave even on a single thread, so ordering the code carefully is
 * not a fix — the writes have to be serialized explicitly.
 *
 * This is the failure mode the plain-text format exists to make impossible:
 * data the user typed, gone, with nothing on screen to say so.
 */

const NOW = "2026-08-14T10:00:00-04:00";

function service(policy?: string) {
  const files: Record<string, string> = {};
  if (policy !== undefined) files["policy.md"] = policy;
  const vault = seedVault(files);
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(NOW) }) };
}

describe("concurrent writes", () => {
  test("three adds fired at once all land", async () => {
    const { topThree } = service();

    const results = await Promise.all([
      topThree.addOutcome("First"),
      topThree.addOutcome("Second"),
      topThree.addOutcome("Third"),
    ]);

    assert.deepEqual(
      results.map((r) => r.ok),
      [true, true, true],
    );
    const week = await topThree.current();
    assert.deepEqual(
      week.outcomes.map((o) => o.text).sort(),
      ["First", "Second", "Third"],
    );
  });

  test("the cap still holds under concurrent adds", async () => {
    // The other half of the same race: serialization must not let four through
    // by having each read a count of two.
    const { topThree } = service();

    const results = await Promise.all([
      topThree.addOutcome("a"),
      topThree.addOutcome("b"),
      topThree.addOutcome("c"),
      topThree.addOutcome("d"),
      topThree.addOutcome("e"),
    ]);

    const accepted = results.filter((r) => r.ok).length;
    assert.equal(accepted, 3, "exactly the cap, no more and no fewer");
    assert.equal((await topThree.current()).outcomes.length, 3);
  });

  test("an add overlapping an edit does not lose either", async () => {
    const { topThree } = service();
    await topThree.addOutcome("First");
    const week = await topThree.current();
    const ref = { week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" };

    const [edited, added] = await Promise.all([
      topThree.editOutcome(ref, "First, revised"),
      topThree.addOutcome("Second"),
    ]);

    assert.ok(added.ok, "the add landed");
    const after = await topThree.current();

    if (edited.ok) {
      assert.deepEqual(
        after.outcomes.map((o) => o.text).sort(),
        ["First, revised", "Second"],
      );
    } else {
      // Losing the race to a refusal is acceptable — the user is told. Losing
      // it silently is not.
      assert.equal(edited.reason, "entry-changed");
      assert.deepEqual(
        after.outcomes.map((o) => o.text).sort(),
        ["First", "Second"],
      );
    }
  });

  test("concurrent completes do not drop one another", async () => {
    const { topThree } = service();
    await topThree.addOutcome("a");
    await topThree.addOutcome("b");
    const week = await topThree.current();

    await Promise.all([
      topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" }),
      topThree.completeOutcome({ week: week.id, index: 1, raw: week.outcomes[1]?.raw ?? "" }),
    ]);

    const after = await topThree.current();
    assert.equal(after.outcomes.length, 2, "neither outcome vanished");
  });

  test("a rejected write does not stall the queue", async () => {
    // The queue must survive a refusal, or one bad write freezes the view.
    const { topThree } = service();

    const [refused, accepted] = await Promise.all([
      topThree.addOutcome("   "),
      topThree.addOutcome("Real"),
    ]);

    assert.ok(!refused.ok);
    assert.ok(accepted.ok);
    assert.ok((await topThree.addOutcome("Another")).ok, "the queue still runs");
  });
});
