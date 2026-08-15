import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ReviewService } from "../src/review/review-service";
import { ProjectService } from "../src/projects/project-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { WaitingService } from "../src/waiting/waiting-service";
import { parseReview } from "../src/review/review-document";
import { FakeInbox, MutableClock, makeReview } from "./review-fakes";

/**
 * Pausing and coming back.
 *
 * The file **is** the state, so resuming is not a feature that has to work — it
 * is the absence of a feature that could fail. There is no journal, no session,
 * and no in-memory review waiting to be flushed at the end. Every assertion
 * here re-reads `log/…md` rather than trusting the object a verb returned,
 * because trusting the object would test the wrong thing entirely (FR-054,
 * SC-006).
 */

const VAULT = {
  "projects/alpha.md": "# Alpha\n\nstatus: active\nnext action: Do the thing\n",
  "projects/bravo.md": "# Bravo\n\nstatus: active\n",
  "projects/charlie.md": "# Charlie\n\nstatus: waiting\n",
};

const WEEK = "log/2026-W33.md";

describe("every decision is on disk the moment it is made", () => {
  test("a recorded project change is in the file before the verb returns", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    await service.recordNoChange("alpha");

    // Read the file, not the returned review. The returned object could be
    // right while nothing had been written.
    const onDisk = parseReview(vault.files.get(WEEK) ?? "", "2026-W33");
    assert.equal(onDisk.projects.length, 1);
    assert.equal(onDisk.projects[0]?.slug, "alpha");
  });

  test("passing a step is on disk before the verb returns", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    await service.advance({ confirmed: true });

    assert.equal(parseReview(vault.files.get(WEEK) ?? "", "2026-W33").step, "projects");
  });

  test("nothing is held back until completion", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");
    await service.recordStatus("bravo", "active", "parked");

    const onDisk = parseReview(vault.files.get(WEEK) ?? "", "2026-W33");
    assert.equal(onDisk.status, "in-progress", "still open, and everything already recorded");
    assert.deepEqual(
      onDisk.projects.map((p) => `${p.slug}:${p.action}`),
      ["alpha:none", "bravo:status"],
    );
  });
});

describe("a fresh service against the same vault", () => {
  test("resumes at the same step with every decision present", async () => {
    const { service, vault, clock } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    // The service instance is discarded entirely — a new process, as far as
    // anything on disk can tell.
    const resumed = new ReviewService({
      vault,
      projects: new ProjectService({ vault, clock }),
      topThree: new TopThreeService({ vault, clock }),
      waiting: new WaitingService({ vault, clock }),
      inbox: new FakeInbox(""),
      clock,
    });

    const review = await resumed.current();
    assert.equal(review?.step, "projects");
    assert.equal(review?.status, "in-progress");
    assert.equal(review?.projects.length, 1);
  });

  test("resumes at the same position in the walk", async () => {
    const { service, vault, clock } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    const resumed = new ReviewService({
      vault,
      projects: new ProjectService({ vault, clock }),
      topThree: new TopThreeService({ vault, clock }),
      waiting: new WaitingService({ vault, clock }),
      inbox: new FakeInbox(""),
      clock,
    });

    const next = await resumed.nextProject();
    assert.equal(next?.project.slug, "bravo", "alpha was done; the walk carries on from there");
  });

  test("start() on an in-progress review resumes it rather than restarting it", async () => {
    const { service } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    const again = await service.start();
    assert.equal(again.step, "projects", "a week gets one review, and this is it");
    assert.equal(again.projects.length, 1, "nothing was discarded");
  });
});

describe("the paused state is legible in a text editor", () => {
  test("it says plainly that it is not finished, and where it got to", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    const content = vault.files.get(WEEK) ?? "";
    assert.match(content, /^status: in progress$/m);
    assert.match(content, /^step: projects$/m);
    assert.doesNotMatch(content, /^completed:/m);
    assert.match(content, /^- 2026-08-14 alpha no change$/m);
  });
});

describe("a clock that moved while the review was paused", () => {
  test("does not move the review — it belongs to the week it started in", async () => {
    const clock = new MutableClock("2026-08-14T09:00:00-04:00");
    const { service, vault } = makeReview({ files: { ...VAULT }, now: "2026-08-14T09:00:00-04:00" });
    await service.start();

    // Later the same week.
    clock.set("2026-08-16T09:00:00-04:00");
    await service.recordNoChange("alpha");

    assert.ok(vault.files.has(WEEK));
    assert.equal([...vault.files.keys()].filter((p) => p.startsWith("log/")).length, 1);
  });
});
