import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * What the log records about the week's outcomes.
 *
 * Finished, slipped, and committed — a snapshot of the week as it actually
 * ended, written once, at completion. This is the raw material a retrospective
 * would read a year later, which is the whole reason the log exists (FR-065).
 *
 * And nothing already written moves. Completing this week's review says nothing
 * about any earlier week: not its outcomes, not their done marks, not their
 * completion dates (FR-066).
 */

const TOP_THREE = `## 2026-W33

- [x] Ship the migration runbook — done 2026-08-12
- [x] Close the vendor contract — done 2026-08-13
- [ ] Rewrite the on-call rota

## 2026-W31

- [x] Fix the fence — done 2026-07-31
- [ ] Repaint the shed
`;

async function completed() {
  const harness = makeReview({ files: { "top-three.md": TOP_THREE } });
  await harness.service.start();
  for (let i = 0; i < 3; i++) await harness.service.advance({ confirmed: true });

  // Committing to the week ahead, through the top three's own verb — the
  // review records what landed rather than being a second way to write it.
  await harness.topThree.addOutcome("Land the cutover", "2026-W34");
  await harness.topThree.addOutcome("One-on-ones with the new starters", "2026-W34");

  await harness.service.advance();
  await harness.service.complete({ note: "Cutover slipped a week." });
  return harness;
}

describe("completion records the week", () => {
  test("what was finished", async () => {
    const { service } = await completed();

    const review = await service.current();
    assert.deepEqual(review?.topThree?.finished, [
      "Ship the migration runbook",
      "Close the vendor contract",
    ]);
  });

  test("what slipped", async () => {
    const { service } = await completed();

    const review = await service.current();
    assert.deepEqual(review?.topThree?.slipped, ["Rewrite the on-call rota"]);
  });

  test("what was committed to, and for which week", async () => {
    const { service } = await completed();

    const review = await service.current();
    assert.deepEqual(review?.topThree?.committed, [
      "Land the cutover",
      "One-on-ones with the new starters",
    ]);
    assert.equal(review?.topThree?.forWeek, "2026-W34", "the review's week plus one");
  });

  test("in a form a person can read in a text editor", async () => {
    const { vault } = await completed();

    const content = vault.files.get("log/2026-W33.md") ?? "";
    assert.match(content, /^- finished: Ship the migration runbook$/m);
    assert.match(content, /^- slipped: Rewrite the on-call rota$/m);
    assert.match(content, /^- committed 2026-W34: Land the cutover$/m);
  });
});

describe("earlier weeks", () => {
  test("keep their outcomes, done marks, and completion dates", async () => {
    const { vault } = await completed();

    const content = vault.files.get("top-three.md") ?? "";
    assert.match(content, /^## 2026-W31$/m);
    assert.match(content, /^- \[x\] Fix the fence — done 2026-07-31$/m);
    assert.match(content, /^- \[ \] Repaint the shed$/m);
  });

  test("and an earlier week's review log is untouched", async () => {
    const harness = makeReview({ files: { "top-three.md": TOP_THREE }, now: "2026-08-07T09:00:00-04:00" });
    await harness.service.start();
    for (let i = 0; i < 4; i++) await harness.service.advance({ confirmed: true });
    await harness.service.complete({ note: "week 32" });
    const earlier = harness.vault.files.get("log/2026-W32.md");

    harness.clock.set("2026-08-14T09:00:00-04:00");
    await harness.service.start();
    for (let i = 0; i < 4; i++) await harness.service.advance({ confirmed: true });
    await harness.service.complete({ note: "week 33" });

    assert.equal(harness.vault.files.get("log/2026-W32.md"), earlier, "byte for byte");
  });
});

describe("an empty week", () => {
  test("records the absence honestly rather than inventing content", async () => {
    const { service } = makeReview();
    await service.start();
    for (let i = 0; i < 4; i++) await service.advance({ confirmed: true });
    await service.complete({ note: null });

    const review = await service.current();
    assert.deepEqual(review?.topThree, null, "nothing happened, so nothing is recorded");
    assert.equal(review?.note, null, "and no note was fabricated to fill the section");
    assert.equal(review?.status, "complete");
  });
});
