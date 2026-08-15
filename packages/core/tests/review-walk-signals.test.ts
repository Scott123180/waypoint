import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * What the user is shown about each project when they arrive at it.
 *
 * Everything needed to decide, assembled by core: the fields, the milestones
 * with their done state, how the DRI resolves, the structure gaps, and the
 * needs-a-DRI signal. A client that had to compute any of it would be a client
 * holding a rule, and Feature 6's API would have to reimplement the same rule to
 * agree (FR-023, FR-024, FR-025).
 */

const FULL = `# Migration cutover

status: active
next action: Chase the vendor contract
dri: Scott Rodgers

## Outcome

The old cluster is switched off and nothing is running on it.

## Milestones

- [x] Runbook reviewed by SRE — @Priya — done 2026-06-30
- [ ] Cutover rehearsed end to end — @Priya
`;

const NO_DRI = `# Hiring loop

status: active
next action: Book the panel

## Outcome

Two engineers accepted and started.

## Milestones

- [ ] Panel trained on the new rubric
`;

const GAPPY = "# Vendor review\n\nstatus: active\ndri: Scott Rodgers\n";

const IDENTITY = "me: Scott Rodgers\n";

function walkOf(files: Record<string, string>) {
  return makeReview({ files: { "identity.md": IDENTITY, ...files } });
}

describe("each walk entry", () => {
  test("carries the fields the user needs to decide", async () => {
    const { service } = walkOf({ "projects/migration-cutover.md": FULL });
    await service.start();

    const [entry] = await service.projectStep();
    assert.ok(entry);
    assert.equal(entry.project.title, "Migration cutover");
    assert.equal(entry.project.status, "active");
    assert.equal(entry.outcome, "The old cluster is switched off and nothing is running on it.");
    assert.equal(entry.nextAction, "Chase the vendor contract");
    assert.equal(entry.project.dri.raw, "Scott Rodgers");
    assert.equal(entry.project.dri.resolution, "mine", "how the DRI resolves, not just what it says");
  });

  test("carries the milestones with their done state", async () => {
    const { service } = walkOf({ "projects/migration-cutover.md": FULL });
    await service.start();

    const [entry] = await service.projectStep();
    assert.deepEqual(
      entry?.milestones.map((m) => ({ text: m.definitionOfDone, done: m.done })),
      [
        { text: "Runbook reviewed by SRE", done: true },
        { text: "Cutover rehearsed end to end", done: false },
      ],
    );
    assert.equal(entry?.project.milestonesDone, 1);
    assert.equal(entry?.project.milestonesTotal, 2);
  });

  test("carries its structure gaps", async () => {
    const { service } = walkOf({ "projects/vendor-review.md": GAPPY });
    await service.start();

    const [entry] = await service.projectStep();
    assert.deepEqual(entry?.project.gaps.slice().sort(), ["milestones", "next-action", "outcome"]);
  });

  test("a project missing only a DRI shows that signal and no structure gap", async () => {
    // Feature 3's FR-009 and Feature 4's FR-032, unchanged: a missing owner is
    // informational, never a gap. Reversing that here would newly flag every
    // otherwise-complete project that happens to have no owner.
    const { service } = walkOf({ "projects/hiring-loop.md": NO_DRI });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.project.needsDri, true);
    assert.deepEqual(entry?.project.gaps, [], "no DRI is not a structure gap");
  });

  test("a fully structured project shows no gaps and no DRI signal", async () => {
    const { service } = walkOf({ "projects/migration-cutover.md": FULL });
    await service.start();

    const [entry] = await service.projectStep();
    assert.deepEqual(entry?.project.gaps, []);
    assert.equal(entry?.project.needsDri, false);
  });

  test("carries when its current status began, when the ledger says", async () => {
    const { service } = walkOf({
      "projects/docs-refresh.md": `# Docs refresh

status: waiting

## Ledger

- 2026-06-01 status active → waiting
`,
    });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.project.statusSince, "2026-06-01");
  });

  test("carries nothing it has not been reviewed against yet", async () => {
    const { service } = walkOf({ "projects/migration-cutover.md": FULL });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.reviewed, false, "no record in this review yet");
    assert.equal(entry?.stale, null, "an active project is never put to the staleness rule");
  });
});
