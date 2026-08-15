import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The open-milestone confirmation, inside the review and outside it.
 *
 * A `warn`, not a `block`, in both places — a hard refusal would be routed
 * around by deleting the milestone, which destroys its record. The review must
 * inherit that whole shape: the same question, the same milestones named, and
 * the same outcome when the user confirms.
 */

const WITH_OPEN = `# Migration cutover

status: active

## Outcome

The old cluster is switched off.

## Milestones

- [x] Runbook reviewed by SRE — @Priya — done 2026-06-30
- [ ] Cutover rehearsed end to end — @Priya
- [ ] Old cluster powered down
`;

function files(): Record<string, string> {
  return { "projects/migration-cutover.md": WITH_OPEN };
}

describe("marking a project done with milestones open", () => {
  test("asks the same question, naming the same milestones", async () => {
    const inside = makeReview({ files: files() });
    await inside.service.start();
    const throughReview = await inside.service.recordStatus("migration-cutover", "active", "done");

    const outside = makeReview({ files: files() });
    const throughService = await outside.projects.complete("migration-cutover");

    assert.equal(throughReview.ok, false);
    assert.equal(throughService.ok, false);
    if (throughReview.ok || throughService.ok) return;

    assert.equal(throughReview.reason, "open-milestones");
    assert.equal(throughReview.reason, throughService.reason);
    assert.equal(throughReview.message, throughService.message);
    assert.deepEqual(throughReview.open, throughService.open);
    assert.deepEqual(throughService.open, ["Cutover rehearsed end to end", "Old cluster powered down"]);
  });

  test("confirming proceeds identically, down to the bytes on disk", async () => {
    const inside = makeReview({ files: files() });
    await inside.service.start();
    const throughReview = await inside.service.recordStatus("migration-cutover", "active", "done", {
      confirmOpenMilestones: true,
    });

    const outside = makeReview({ files: files() });
    const throughService = await outside.projects.complete("migration-cutover", {
      confirmOpenMilestones: true,
    });

    assert.ok(throughReview.ok);
    assert.ok(throughService.ok);

    assert.equal(
      inside.vault.files.get("projects/migration-cutover.md"),
      outside.vault.files.get("projects/migration-cutover.md"),
      "completion date, status, and ledger entry all identical",
    );
  });

  test("the open milestones are left open, recorded as never completed", async () => {
    const { service, projects } = makeReview({ files: files() });
    await service.start();

    await service.recordStatus("migration-cutover", "active", "done", { confirmOpenMilestones: true });

    const project = await projects.get("migration-cutover");
    assert.equal(project?.milestones.filter((m) => !m.done).length, 2);
    assert.equal(project?.status, "done");
  });

  test("the review records what was decided, once the verb succeeded", async () => {
    const { service } = makeReview({ files: files() });
    await service.start();

    await service.recordStatus("migration-cutover", "active", "done", { confirmOpenMilestones: true });

    const review = await service.current();
    assert.equal(review?.projects.length, 1);
    assert.equal(review?.projects[0]?.slug, "migration-cutover");
    assert.equal(review?.projects[0]?.action, "status");
    assert.equal(review?.projects[0]?.detail, "active → done");
  });

  test("the unconfirmed question records nothing", async () => {
    const { service } = makeReview({ files: files() });
    await service.start();

    await service.recordStatus("migration-cutover", "active", "done");

    assert.deepEqual((await service.current())?.projects, []);
  });
});
