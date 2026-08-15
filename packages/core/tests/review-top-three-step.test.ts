import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The last step: what actually got done, and what next week is for.
 *
 * The load-bearing assertion in this file is the one about what the week ahead
 * is **not**. An unfinished outcome is not carried forward, not pre-filled, not
 * suggested, and not ranked. Deciding again is the point of the ritual — a tool
 * that rolled last week's list forward would let the user stop deciding, which
 * is exactly the failure the weekly review exists to prevent (FR-053, SC-015).
 *
 * The harness clock sits in 2026-W33, so the week ahead is W34.
 */

const REVIEWED = `## 2026-W33

- [x] Ship the migration runbook — done 2026-08-12
- [ ] Rewrite the on-call rota
- [ ] Close the vendor contract

## 2026-W31

- [x] Fix the fence — done 2026-07-31
`;

function harness(content = REVIEWED) {
  return makeReview({ files: { "top-three.md": content } });
}

describe("the step", () => {
  test("returns the reviewed week and the week ahead", async () => {
    const { service } = harness();
    await service.start();

    const { reviewed, ahead } = await service.topThreeStep();
    assert.equal(reviewed.id, "2026-W33");
    assert.equal(ahead.id, "2026-W34");
  });

  test("shows the reviewed week's outcomes with their state", async () => {
    const { service } = harness();
    await service.start();

    const { reviewed } = await service.topThreeStep();
    assert.deepEqual(
      reviewed.outcomes.map((o) => ({ text: o.text, done: o.done })),
      [
        { text: "Ship the migration runbook", done: true },
        { text: "Rewrite the on-call rota", done: false },
        { text: "Close the vendor contract", done: false },
      ],
    );
  });

  test("the week ahead starts empty", async () => {
    const { service } = harness();
    await service.start();

    const { ahead } = await service.topThreeStep();
    assert.deepEqual(ahead.outcomes, [], "nothing is suggested, pre-filled, ranked, or carried forward");
  });
});

describe("nothing is carried forward", () => {
  test("an unfinished outcome of the reviewed week never appears in the week ahead", async () => {
    const { service, vault } = harness();
    await service.start();

    await service.topThreeStep();
    await service.advance({ confirmed: true });
    await service.advance();
    await service.advance();

    const { ahead } = await service.topThreeStep();
    assert.deepEqual(ahead.outcomes, []);

    // And nothing was written into next week's section behind the scenes.
    assert.doesNotMatch(
      vault.files.get("top-three.md") ?? "",
      /Rewrite the on-call rota[\s\S]*## 2026-W34/,
    );
  });

  test("reading the step writes nothing at all", async () => {
    const { service, vault } = harness();
    await service.start();
    vault.writeLog.length = 0;

    await service.topThreeStep();

    assert.deepEqual(vault.writeLog, [], "a step that creates next week's section has an opinion");
  });
});

describe("a straggler finished on the day of the review", () => {
  test("can be marked done from within the step", async () => {
    const { service, topThree } = harness();
    await service.start();

    const { reviewed } = await service.topThreeStep();
    const straggler = reviewed.outcomes.find((o) => o.text === "Close the vendor contract");
    assert.ok(straggler);

    const result = await topThree.completeOutcome({
      week: reviewed.id,
      index: straggler.index,
      raw: straggler.raw,
    });
    assert.ok(result.ok);

    const after = await service.topThreeStep();
    assert.equal(
      after.reviewed.outcomes.find((o) => o.text === "Close the vendor contract")?.done,
      true,
      "a Friday review is exactly when a straggler gets marked done (FR-048)",
    );
  });
});

describe("earlier weeks", () => {
  test("are not part of the step at all", async () => {
    const { service } = harness();
    await service.start();

    const step = await service.topThreeStep();
    assert.deepEqual(Object.keys(step).sort(), ["ahead", "reviewed"]);
    assert.notEqual(step.reviewed.id, "2026-W31");
  });

  test("offer no edit — the refusal is the affordance's absence", async () => {
    const { service, topThree } = harness();
    await service.start();

    const result = await topThree.editOutcome(
      { week: "2026-W31", index: 0, raw: "- [x] Fix the fence — done 2026-07-31" },
      "Rebuild the fence",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "past-week");
  });
});

describe("an empty step", () => {
  test("passes with nothing set, and the review still completes", async () => {
    const { service } = makeReview();
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance({ confirmed: true });

    const step = await service.topThreeStep();
    assert.deepEqual(step.reviewed.outcomes, []);
    assert.deepEqual(step.ahead.outcomes, []);

    // The last step is passed by completing, not by advancing past it —
    // `advance` says so rather than pretending there is somewhere to go.
    const nowhere = await service.advance();
    assert.equal(nowhere.ok, false);
    if (!nowhere.ok) assert.equal(nowhere.reason, "step-order");

    const done = await service.complete({ note: null });
    assert.ok(done.ok, "committing to nothing is a valid answer (FR-052)");
    if (done.ok) assert.equal(done.review.status, "complete");
  });
});
