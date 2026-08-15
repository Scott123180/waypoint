import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { REVIEW_STEPS } from "../src/review/types";
import { makeReview } from "./review-fakes";

/**
 * The steps run in order, and going back loses nothing.
 *
 * Order is the ritual: reviewing projects before knowing what is in the inbox
 * is reviewing an incomplete picture, which is the reason the sequence exists
 * at all (FR-002).
 */

describe("step order", () => {
  test("the four steps are the ones the ritual names, in order", () => {
    assert.deepEqual([...REVIEW_STEPS], ["inbox", "projects", "waiting", "top-three"]);
  });

  test("advancing walks them in order", async () => {
    const { service } = makeReview();
    await service.start();

    const seen = ["inbox"];
    for (let i = 0; i < 3; i++) {
      const result = await service.advance({ confirmed: true });
      assert.ok(result.ok, "advancing a passed step should succeed");
      if (result.ok) seen.push(result.review.step);
    }

    assert.deepEqual(seen, ["inbox", "projects", "waiting", "top-three"]);
  });

  test("a later step cannot be reached before an earlier one is passed", async () => {
    const { service } = makeReview();
    await service.start();

    const result = await service.goTo("waiting");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "step-order");
      assert.match(result.message, /inbox/i, "the refusal names what still has to happen");
    }
  });

  test("going back to a passed step shows the decisions recorded against it", async () => {
    const { service } = makeReview({ inbox: "- something to sort\n" });
    await service.start();
    await service.advance({ confirmed: true });
    await service.advance({ confirmed: true });

    const back = await service.goTo("inbox");
    assert.ok(back.ok);
    if (back.ok) {
      assert.equal(back.review.step, "inbox");
      assert.equal(back.review.inbox?.count, 1, "what was recorded is still there");
    }
  });

  test("going back and forward again does not duplicate a record", async () => {
    const { service } = makeReview({ inbox: "- something\n" });
    await service.start();
    await service.advance({ confirmed: true });

    await service.goTo("inbox");
    const forward = await service.advance({ confirmed: true });

    assert.ok(forward.ok);
    const content = (await service.current())?.inbox;
    assert.ok(content, "the inbox record survives the round trip");

    const raw = await service.get("2026-W33");
    assert.equal(
      raw?.projects.length,
      0,
      "revisiting a step records nothing new about a later one",
    );
  });

  test("advancing past the last step is refused rather than wrapping", async () => {
    const { service } = makeReview();
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance({ confirmed: true });

    const result = await service.advance({ confirmed: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "step-order");
  });

  test("a step can pass having decided nothing", async () => {
    // An empty waiting-for list is not a step that was skipped; the difference
    // is why `step:` is stored rather than derived (research R3).
    const { service } = makeReview();
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance({ confirmed: true });

    assert.equal((await service.current())?.step, "top-three");
  });
});
