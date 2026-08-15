import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * Resuming re-reads; it never replays.
 *
 * The distinction matters because the pause can be a week long. A review that
 * restored the screen it was showing when it stopped would present a project
 * that has since been finished, a next action that has since changed, and a
 * walk that no longer matches the vault — and every one of those would be a
 * decision made against something that is no longer true (FR-009, FR-061).
 *
 * Nothing about the walk is stored, which is what makes this free rather than
 * something that has to be maintained.
 */

const VAULT = {
  "projects/alpha.md": "# Alpha\n\nstatus: active\nnext action: Do the thing\n",
  "projects/bravo.md": "# Bravo\n\nstatus: active\n",
};

describe("a project finished between pause and resume", () => {
  test("is gone from the walk on resume, not replayed from the paused view", async () => {
    const { service, projects } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });

    const before = await service.projectStep();
    assert.deepEqual(before.map((e) => e.project.slug), ["alpha", "bravo"]);

    // The user finishes it in the projects window while the review sits open.
    await projects.complete("bravo");

    const after = await service.projectStep();
    assert.deepEqual(after.map((e) => e.project.slug), ["alpha"], "done is not walked");
  });

  test("its record in the log stays, because it really did happen", async () => {
    const { service, projects } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("bravo");

    await projects.complete("bravo");

    const review = await service.current();
    assert.equal(review?.projects[0]?.slug, "bravo", "the log is a record, not a view of the vault");
  });
});

describe("a project added mid-review", () => {
  test("joins the walk", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });

    vault.files.set("projects/charlie.md", "# Charlie\n\nstatus: active\n");

    const walk = await service.projectStep();
    assert.deepEqual(walk.map((e) => e.project.slug), ["alpha", "bravo", "charlie"]);
    assert.equal(walk.find((e) => e.project.slug === "charlie")?.reviewed, false);
  });
});

describe("a field edited between pause and resume", () => {
  test("is shown as it now reads", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    vault.files.set(
      "projects/alpha.md",
      "# Alpha\n\nstatus: active\nnext action: Something else entirely\n",
    );

    const [entry] = await service.projectStep();
    assert.equal(entry?.nextAction, "Something else entirely");
  });

  test("and a status hand-edited to waiting brings the staleness question with it", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    vault.files.set(
      "projects/alpha.md",
      [
        "# Alpha",
        "",
        "status: waiting",
        "",
        "## Ledger",
        "",
        "- 2026-05-01 status active → waiting",
        "",
      ].join("\n"),
    );

    const [entry] = await service.projectStep();
    assert.equal(entry?.project.status, "waiting");
    assert.ok(entry?.stale, "105 days of silence, surfaced on the next read rather than the next review");
  });
});
