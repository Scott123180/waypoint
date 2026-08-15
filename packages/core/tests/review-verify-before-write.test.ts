import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The review inherits verify-before-write; it does not reimplement it.
 *
 * A weekly review is precisely where a screen sits open for a long time. The
 * user starts the walk, gets pulled into something else, edits a project in
 * vim, and comes back — and the value on screen is now a lie. Feature 3 already
 * refuses that write; the review must not have found a way around it (FR-035).
 *
 * The behaviour under test is Feature 3's, reached through Feature 5's verbs.
 * The project is re-presented so the user can decide again against what the
 * file actually says.
 */

const PROJECT = `# Migration cutover

status: active
next action: Chase the vendor

## Outcome

The old cluster is off.

## Milestones

- [ ] Cutover rehearsed end to end
`;

function harness() {
  return makeReview({ files: { "projects/migration-cutover.md": PROJECT } });
}

describe("a field edited on disk while the review has it on screen", () => {
  test("refuses the write and says what the file now reads", async () => {
    const { service, vault } = harness();
    await service.start();

    // What the user was shown.
    const [entry] = await service.projectStep();
    assert.equal(entry?.nextAction, "Chase the vendor");

    // What happened while they were thinking.
    vault.files.set(
      "projects/migration-cutover.md",
      PROJECT.replace("next action: Chase the vendor", "next action: Escalate to legal"),
    );

    const result = await service.recordNextAction(
      "migration-cutover",
      entry?.nextAction ?? null,
      "Chase the vendor again",
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "field-changed");
      assert.match(result.message, /Escalate to legal/, "the user is told what it says now");
    }
  });

  test("nothing is written, and the hand-edit survives", async () => {
    const { service, vault } = harness();
    await service.start();

    const edited = PROJECT.replace("next action: Chase the vendor", "next action: Escalate to legal");
    vault.files.set("projects/migration-cutover.md", edited);
    vault.writeLog.length = 0;

    await service.recordNextAction("migration-cutover", "Chase the vendor", "Chase the vendor again");

    assert.deepEqual(vault.writeLog, []);
    assert.equal(vault.files.get("projects/migration-cutover.md"), edited);
  });

  test("the project is re-presented as it now reads", async () => {
    const { service, vault } = harness();
    await service.start();

    vault.files.set(
      "projects/migration-cutover.md",
      PROJECT.replace("next action: Chase the vendor", "next action: Escalate to legal"),
    );

    await service.recordNextAction("migration-cutover", "Chase the vendor", "Chase the vendor again");

    const [entry] = await service.projectStep();
    assert.equal(entry?.nextAction, "Escalate to legal", "the walk re-reads rather than replaying");
    assert.equal(entry?.reviewed, false, "a refused write left no record, so it is still to be walked");
  });
});

describe("a milestone reworded on disk", () => {
  test("fails verification rather than being written over", async () => {
    const { service, vault } = harness();
    await service.start();

    const ref = { index: 0, raw: "- [ ] Cutover rehearsed end to end" };
    vault.files.set(
      "projects/migration-cutover.md",
      PROJECT.replace(ref.raw, "- [ ] Cutover rehearsed with the vendor present"),
    );

    const result = await service.recordMilestoneDone("migration-cutover", ref);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "field-changed");
    assert.match(
      vault.files.get("projects/migration-cutover.md") ?? "",
      /- \[ \] Cutover rehearsed with the vendor present/,
      "still open, still in the user's words",
    );
  });
});

describe("a status changed on disk", () => {
  test("refuses, so the review cannot undo a decision made elsewhere", async () => {
    const { service, vault } = harness();
    await service.start();

    vault.files.set("projects/migration-cutover.md", PROJECT.replace("status: active", "status: parked"));

    const result = await service.recordStatus("migration-cutover", "active", "waiting");

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "field-changed");
    assert.match(vault.files.get("projects/migration-cutover.md") ?? "", /^status: parked$/m);
    assert.deepEqual((await service.current())?.projects, [], "nothing happened, nothing recorded");
  });
});
