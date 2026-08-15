import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The milestone cap, inside the review and outside it.
 *
 * The review surfaces structure gaps and offers to fix them on the spot, which
 * makes it the most likely place for a rule to be quietly bypassed: the user is
 * being *told* the project needs milestones, so a cap firing here feels like an
 * obstacle rather than a guardrail. It fires anyway, with the same words
 * (FR-031).
 */

const AT_THE_CAP = `# Overcommitted

status: active
next action: Pick one

## Outcome

Something finishes.

## Milestones

- [ ] One
- [ ] Two
- [ ] Three
- [ ] Four
`;

const FLAGGED = `# Vendor review

status: active
next action: Read the contract

## Outcome

The contract is signed or walked away from.
`;

describe("adding a milestone beyond the cap", () => {
  test("refuses with the same message inside the review as outside it", async () => {
    const inside = makeReview({ files: { "projects/overcommitted.md": AT_THE_CAP } });
    await inside.service.start();
    const throughReview = await inside.service.recordMilestoneAdded("overcommitted", "Five", null);

    const outside = makeReview({ files: { "projects/overcommitted.md": AT_THE_CAP } });
    const throughService = await outside.projects.addMilestone("overcommitted", "Five", null);

    assert.equal(throughReview.ok, false);
    assert.equal(throughService.ok, false);
    if (throughReview.ok || throughService.ok) return;

    assert.equal(throughReview.reason, "milestone-cap");
    assert.equal(throughReview.reason, throughService.reason);
    assert.equal(throughReview.message, throughService.message);
  });

  test("the refusal records nothing and writes nothing", async () => {
    const { service, vault } = makeReview({ files: { "projects/overcommitted.md": AT_THE_CAP } });
    await service.start();
    vault.writeLog.length = 0;

    await service.recordMilestoneAdded("overcommitted", "Five", null);

    assert.deepEqual(vault.writeLog, []);
    assert.deepEqual((await service.current())?.projects, []);
  });
});

describe("fixing a flagged project's structure inside the review", () => {
  test("works, up to the cap, exactly as it does outside", async () => {
    const inside = makeReview({ files: { "projects/vendor-review.md": FLAGGED } });
    await inside.service.start();

    const [before] = await inside.service.projectStep();
    assert.deepEqual(before?.project.gaps, ["milestones"], "the gap is what prompts the fix");

    const throughReview = await inside.service.recordMilestoneAdded(
      "vendor-review",
      "Contract read end to end",
      "Priya",
    );
    assert.ok(throughReview.ok);

    const outside = makeReview({ files: { "projects/vendor-review.md": FLAGGED } });
    await outside.projects.addMilestone("vendor-review", "Contract read end to end", "Priya");

    assert.equal(
      inside.vault.files.get("projects/vendor-review.md"),
      outside.vault.files.get("projects/vendor-review.md"),
      "the same milestone line, written the same way",
    );

    const [after] = await inside.service.projectStep();
    assert.deepEqual(after?.project.gaps, [], "the gap closed because the file changed, not the review");
  });

  test("the cap is configured, and both paths read the same configuration", async () => {
    const files = { "projects/overcommitted.md": AT_THE_CAP, "policy.md": "milestone cap: 6\n" };

    const inside = makeReview({ files: { ...files } });
    await inside.service.start();
    const throughReview = await inside.service.recordMilestoneAdded("overcommitted", "Five", null);

    const outside = makeReview({ files: { ...files } });
    const throughService = await outside.projects.addMilestone("overcommitted", "Five", null);

    assert.equal(throughReview.ok, true);
    assert.equal(throughService.ok, true);
  });
});
