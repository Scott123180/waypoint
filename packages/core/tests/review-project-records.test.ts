import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * What the log records about each project, and when.
 *
 * Two things in a fixed order: perform the change **through the owning
 * service**, then record what was decided. Never the other way round, and never
 * one without the other — a log entry for a write that did not happen is worse
 * than no log at all, because it is a record that reads as true (FR-030).
 *
 * `no change` is a decision and is recorded as one. "I looked at it and there
 * is nothing to do" and "I never got to it" are different facts about the week,
 * and a resumed review needs to tell them apart (FR-033, FR-034).
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

describe("every recording verb", () => {
  test("writes through the owning service and appends its line", async () => {
    const { service, projects } = harness();
    await service.start();

    const result = await service.recordNextAction(
      "migration-cutover",
      "Chase the vendor",
      "Chase the vendor's legal team",
    );
    assert.ok(result.ok);

    const project = await projects.get("migration-cutover");
    assert.equal(project?.nextAction, "Chase the vendor's legal team", "the file changed");

    const record = (await service.current())?.projects[0];
    assert.equal(record?.slug, "migration-cutover");
    assert.equal(record?.action, "next-action", "and the log says so");
  });

  test("records a milestone completion with the milestone's own words", async () => {
    const { service, projects } = harness();
    await service.start();

    const result = await service.recordMilestoneDone("migration-cutover", {
      index: 0,
      raw: "- [ ] Cutover rehearsed end to end",
    });
    assert.ok(result.ok);

    const project = await projects.get("migration-cutover");
    assert.equal(project?.milestones[0]?.done, true);
    assert.equal(project?.milestones[0]?.completedOn, "2026-08-14");

    const record = (await service.current())?.projects[0];
    assert.equal(record?.action, "milestone-done");
    assert.equal(record?.detail, "Cutover rehearsed end to end");
  });

  test("records a status change as the transition it was", async () => {
    const { service } = harness();
    await service.start();

    await service.recordStatus("migration-cutover", "active", "parked");

    const record = (await service.current())?.projects[0];
    assert.equal(record?.action, "status");
    assert.equal(record?.detail, "active → parked");
  });

  test("records a structure fix by the field it filled", async () => {
    const { service } = makeReview({
      files: { "projects/vendor-review.md": "# Vendor review\n\nstatus: active\n" },
    });
    await service.start();

    await service.recordStructure("vendor-review", "outcome", null, "The contract is signed.");

    const record = (await service.current())?.projects[0];
    assert.equal(record?.action, "structure");
    assert.equal(record?.detail, "outcome");
  });

  test("records an added milestone as the structure fix it is", async () => {
    const { service } = makeReview({
      files: { "projects/vendor-review.md": "# Vendor review\n\nstatus: active\n" },
    });
    await service.start();

    await service.recordMilestoneAdded("vendor-review", "Contract read end to end", null);

    // Round-trips through the file: written by the renderer, read back by the
    // parser as the same thing rather than as an unrecognised line.
    const record = (await service.current())?.projects[0];
    assert.equal(record?.action, "structure");
    assert.equal(record?.detail, "milestones");
  });
});

describe("a refusal from the underlying verb", () => {
  test("is returned unchanged and records nothing", async () => {
    const { service } = harness();
    await service.start();

    const result = await service.recordNextAction(
      "migration-cutover",
      "something the file does not say",
      "a new next action",
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "field-changed", "the owning verb's own refusal");
    assert.deepEqual((await service.current())?.projects, []);
  });

  test("a project that does not exist is refused, not recorded", async () => {
    const { service } = harness();
    await service.start();

    const result = await service.recordNoChange("no-such-project");

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not-found");
    assert.deepEqual((await service.current())?.projects, []);
  });
});

describe("no change", () => {
  test("marks the project reviewed", async () => {
    const { service } = harness();
    await service.start();

    const result = await service.recordNoChange("migration-cutover");
    assert.ok(result.ok);

    const record = (await service.current())?.projects[0];
    assert.equal(record?.action, "none");
    assert.equal(record?.detail, null);
  });

  test("is distinguishable from never having been reached", async () => {
    const { service } = makeReview({
      files: {
        "projects/looked-at.md": "# Looked at\n\nstatus: active\n",
        "projects/never-reached.md": "# Never reached\n\nstatus: active\n",
      },
    });
    await service.start();

    await service.recordNoChange("looked-at");

    const walk = await service.projectStep();
    assert.equal(walk.find((w) => w.project.slug === "looked-at")?.reviewed, true);
    assert.equal(walk.find((w) => w.project.slug === "never-reached")?.reviewed, false);
  });

  test("writes nothing to the project file", async () => {
    const { service, vault } = harness();
    await service.start();
    vault.writeLog.length = 0;

    await service.recordNoChange("migration-cutover");

    assert.deepEqual(
      vault.writeLog.filter((p) => p.startsWith("projects/")),
      [],
      "a decision to change nothing changes nothing",
    );
  });
});

describe("a completed review", () => {
  test("refuses further records — it is a record now", async () => {
    const { service } = harness();
    await service.start();
    for (let i = 0; i < 4; i++) await service.advance({ confirmed: true });
    await service.complete({ note: "done" });

    const result = await service.recordNoChange("migration-cutover");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "already-complete");
  });
});
