import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview, project } from "./review-fakes";

/**
 * Which projects the walk covers, and in what order.
 *
 * Active **and** waiting. A waiting project is the one most likely to have gone
 * quiet, which is exactly what a weekly review is for; parked and done are
 * decisions already made, and walking them every week would train the user to
 * click through the step (FR-022).
 */

const VAULT = {
  "projects/alpha.md": project("Alpha"),
  "projects/bravo.md": ["# Bravo", "", "status: waiting", ""].join("\n"),
  "projects/charlie.md": ["# Charlie", "", "status: parked", ""].join("\n"),
  "projects/delta.md": ["# Delta", "", "status: done", "completed: 2026-07-01", ""].join("\n"),
  "projects/echo.md": ["# Echo", "", "status: waiting", ""].join("\n"),
};

describe("the walk set", () => {
  test("covers active and waiting projects", async () => {
    const { service } = makeReview({ files: VAULT });
    await service.start();

    const walk = await service.projectStep();
    assert.deepEqual(
      walk.map((w) => w.project.slug),
      ["alpha", "bravo", "echo"],
    );
  });

  test("excludes parked and done", async () => {
    const { service } = makeReview({ files: VAULT });
    await service.start();

    const slugs = (await service.projectStep()).map((w) => w.project.slug);
    assert.ok(!slugs.includes("charlie"), "parked is a decision already made");
    assert.ok(!slugs.includes("delta"), "done is a decision already made");
  });

  test("each project appears exactly once", async () => {
    const { service } = makeReview({ files: VAULT });
    await service.start();

    const slugs = (await service.projectStep()).map((w) => w.project.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  test("the order is identical across repeated reads of unchanged data", async () => {
    const { service } = makeReview({ files: VAULT });
    await service.start();

    const first = (await service.projectStep()).map((w) => w.project.slug);
    const second = (await service.projectStep()).map((w) => w.project.slug);
    const third = (await service.projectStep()).map((w) => w.project.slug);

    assert.deepEqual(second, first, "a walk that reorders itself makes the user lose their place");
    assert.deepEqual(third, first);
  });

  test("an empty vault yields an empty walk rather than an error", async () => {
    const { service } = makeReview();
    await service.start();

    assert.deepEqual(await service.projectStep(), []);
  });

  test("a project whose status changes mid-review leaves the walk", async () => {
    // The set is derived on every read, so parking a project during the walk
    // takes it out of the remaining walk rather than leaving a stale entry.
    const { service, projects } = makeReview({ files: VAULT });
    await service.start();

    await projects.setStatus("bravo", "waiting", "parked");

    const slugs = (await service.projectStep()).map((w) => w.project.slug);
    assert.deepEqual(slugs, ["alpha", "echo"]);
  });
});
