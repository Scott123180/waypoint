import { test, describe } from "node:test";
import assert from "node:assert/strict";

import type { OutcomeRef } from "../src/weekly/types";
import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Marking an outcome done from the shutdown == doing it from the top three
 * (FR-033, SC-004).
 *
 * Two identical vaults, the same verb, two callers — and `top-three.md` compared
 * byte for byte, including the local completion date the verb records with no
 * prompt.
 *
 * The comparison is not trivial, and it is worth saying why. Both callers reach
 * `TopThreeService.completeOutcome`, so what is actually under test is the
 * **ref**: the shutdown builds one from what its panel displayed, and the
 * top-three window builds one from what `current()` returned. If the screen ever
 * showed a reworded, trimmed, or re-rendered version of an outcome, the ref
 * built from it would fail verification and the two files would differ here.
 */

function refFrom(week: { id: string }, outcome: { index: number; raw: string }): OutcomeRef {
  return { week: week.id, index: outcome.index, raw: outcome.raw };
}

/** The shutdown's path: build the ref from what the panel displayed. */
async function fromShutdown(pick: number): Promise<Record<string, string>> {
  const { shutdown, topThree, vault } = actingVault(populatedVault());

  const view = await shutdown.read();
  const week = view.topThree.week;
  assert.ok(week, "the panel must have a week for this to test anything");

  const outcome = week.outcomes.filter((o) => !o.done)[pick];
  assert.ok(outcome, "and an open outcome to complete");

  const result = await topThree.completeOutcome(refFrom(week, outcome));
  assert.ok(result.ok, "the shutdown's path must not be refused");

  return snapshot(vault);
}

/** The ordinary surface's path: build the ref from `current()`. */
async function fromTopThreeWindow(pick: number): Promise<Record<string, string>> {
  const { topThree, vault } = actingVault(populatedVault());

  const week = await topThree.current();
  const outcome = week.outcomes.filter((o) => !o.done)[pick];
  assert.ok(outcome);

  const result = await topThree.completeOutcome(refFrom(week, outcome));
  assert.ok(result.ok);

  return snapshot(vault);
}

describe("completing an outcome", () => {
  test("produces a byte-identical top-three.md", async () => {
    const shutdown = await fromShutdown(0);
    const window = await fromTopThreeWindow(0);

    assert.equal(shutdown["top-three.md"], window["top-three.md"]);
  });

  test("including the completion date, which the verb records with no prompt", async () => {
    const shutdown = await fromShutdown(0);

    assert.match(shutdown["top-three.md"] ?? "", /- \[x\] Ship the sort view — done 2026-08-19/);
  });

  test("and the same is true of the second open outcome", async () => {
    const shutdown = await fromShutdown(1);
    const window = await fromTopThreeWindow(1);

    assert.equal(shutdown["top-three.md"], window["top-three.md"]);
  });

  test("no other file is touched by either path", async () => {
    const shutdown = await fromShutdown(0);
    const window = await fromTopThreeWindow(0);

    assert.deepEqual(shutdown, window, "the whole vault matches, not just the file the verb owns");
  });

  test("the week's other outcomes are left exactly as they were", async () => {
    const before = populatedVault()["top-three.md"] ?? "";
    const after = (await fromShutdown(0))["top-three.md"] ?? "";

    for (const line of ["- [x] Decide the license — done 2026-08-17", "- [ ] Book the offsite"]) {
      assert.ok(before.includes(line), `the fixture must contain: ${line}`);
      assert.ok(after.includes(line), `${line} was disturbed by completing a different outcome`);
    }
  });

  test("and last week's section is untouched — a record stays a record", async () => {
    const after = (await fromShutdown(0))["top-three.md"] ?? "";

    assert.ok(after.includes("- [x] Last week's thing — done 2026-08-14"));
  });
});
