import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview, passAllSteps } from "./review-fakes";

/**
 * Completing a review.
 *
 * Completion is the only transition the status has, and it is one-way. What it
 * writes — the note, the date, the status — is the permanent record; what it
 * must never write is anything the user did not say.
 */

describe("completing", () => {
  test("is refused until every step has been passed", async () => {
    const { service } = makeReview();
    await service.start();

    const early = await service.complete({});
    assert.equal(early.ok, false);
    if (!early.ok) {
      assert.equal(early.reason, "step-order");
      assert.match(early.message, /step/i);
    }
  });

  test("flips the status, records the date, and keeps the start date", async () => {
    const { service, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await passAllSteps(service);

    clock.set("2026-08-15T18:30:00-04:00");
    const result = await service.complete({});

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.review.status, "complete");
      assert.equal(result.review.completed, "2026-08-15");
      assert.equal(result.review.started, "2026-08-14");
    }
  });

  test("records the user's note verbatim", async () => {
    const note = "Cutover slipped because the vendor sat on the contract.\n\nChase earlier.";
    const { service, vault } = makeReview();
    await passAllSteps(service);

    await service.complete({ note });

    assert.equal((await service.current())?.note, note);
    assert.ok(vault.files.get("log/2026-W33.md")?.includes("Chase earlier."));
  });

  test("a skipped note records that none was written and fabricates nothing", async () => {
    const { service } = makeReview();
    await passAllSteps(service);

    await service.complete({});

    const review = await service.current();
    assert.equal(review?.note, null, "no note is not an empty note dressed up as one");
    assert.equal(review?.summary, null, "and nothing is generated in its place");
  });

  test("a whitespace-only note is treated as no note", async () => {
    const { service } = makeReview();
    await passAllSteps(service);

    await service.complete({ note: "   \n  " });
    assert.equal((await service.current())?.note, null);
  });

  test("any write against a completed review is refused", async () => {
    const { service } = makeReview();
    await passAllSteps(service);
    await service.complete({ note: "done" });

    for (const attempt of [
      () => service.advance({ confirmed: true }),
      () => service.goTo("inbox"),
      () => service.complete({ note: "again" }),
    ]) {
      const result = await attempt();
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "already-complete");
    }
  });

  test("starting again in the same week returns the completed record, not a fresh review", async () => {
    const { service } = makeReview();
    await passAllSteps(service);
    await service.complete({ note: "done" });

    const again = await service.start();
    assert.equal(again.status, "complete", "a week gets one review, and it is finished");
    assert.equal(again.note, "done");
  });

  test("completion does not touch any other file in the vault", async () => {
    const { service, vault } = makeReview({
      files: { "projects/one.md": "# One\n\nstatus: active\n" },
    });
    await passAllSteps(service);

    const before = vault.files.get("projects/one.md");
    await service.complete({ note: "done" });

    assert.equal(vault.files.get("projects/one.md"), before);
  });
});
