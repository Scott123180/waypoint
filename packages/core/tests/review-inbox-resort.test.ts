import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * "Go sort them and come back."
 *
 * Core's half of FR-016. Sorting itself is Feature 2's surface — the review
 * navigates to it and never reimplements it — so what has to hold here is that
 * coming back re-reads the file rather than showing what was true when the step
 * first opened, and that leaving and returning costs the user no progress.
 */

describe("returning from a sort", () => {
  test("the count reflects what was sorted while the review was open", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n- two\n- three\n" });
    await service.start();
    assert.equal((await service.inboxStep()).count, 3);

    // The user goes and sorts two items, then comes back.
    inbox.content = "- three\n";

    assert.equal((await service.inboxStep()).count, 1);
  });

  test("sorting to zero turns a warning into a silent advance", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n- two\n" });
    await service.start();

    const warned = await service.advance();
    assert.equal(warned.ok, false, "warned while items remain");

    inbox.content = "";
    const clear = await service.advance();
    assert.ok(clear.ok, "with the inbox clear there is nothing to warn about");
    if (clear.ok) assert.equal(clear.review.step, "projects");
  });

  test("going to sort and back does not reset the review", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n" });
    await service.start();

    // Nothing about sorting touches the review's own state: it is still on the
    // inbox step, still started when it was started.
    const before = await service.current();
    inbox.content = "";
    const after = await service.current();

    assert.equal(after?.step, before?.step);
    assert.equal(after?.started, before?.started);
    assert.equal(after?.status, "in-progress");
  });

  test("sorting after the step was passed does not rewrite what was recorded", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n- two\n" });
    await service.start();
    await service.advance({ confirmed: true });

    inbox.content = "";

    assert.equal(
      (await service.current())?.inbox?.count,
      2,
      "the log is a record of the moment, not a live view",
    );
  });
});
