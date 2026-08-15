import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The inbox step.
 *
 * The count is a fact about the file, derived every time it is asked. The
 * consequence of a non-empty inbox is a rule, and lives in the policy module —
 * nothing here knows whether the answer is a warning or a refusal (FR-017).
 */

describe("the inbox step", () => {
  test("reports how many items are sitting there", async () => {
    const { service } = makeReview({ inbox: "- one\n- two\n- three\n" });
    await service.start();

    assert.equal((await service.inboxStep()).count, 3);
  });

  test("the count is derived from the file every time, never cached", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n- two\n" });
    await service.start();
    assert.equal((await service.inboxStep()).count, 2);

    inbox.content = "- one\n";
    assert.equal((await service.inboxStep()).count, 1, "a change on disk is reflected immediately");
  });

  test("hand-written lines count — inbox zero means genuinely clear", async () => {
    // Feature 2's decision, and Feature 5 is the feature that depends on it.
    const { service } = makeReview({
      inbox: "- 2026-08-09T16:02:11-04:00 a captured thought\n- something typed by hand\n",
    });
    await service.start();

    assert.equal((await service.inboxStep()).count, 2);
  });

  test("a non-empty inbox warns with the count and can be passed", async () => {
    const { service } = makeReview({ inbox: "- one\n- two\n" });
    await service.start();

    const warned = await service.advance();
    assert.equal(warned.ok, false);
    if (!warned.ok) {
      assert.equal(warned.confirmable, true, "a warning is passable; a block is not");
      // Small numbers read as words in a sentence the user sees, the same way
      // the WIP limit's refusal already phrases them.
      assert.match(warned.message, /two items/, "the user is told how many are waiting");
    }

    const proceeded = await service.advance({ confirmed: true });
    assert.ok(proceeded.ok);
    if (proceeded.ok) assert.equal(proceeded.review.step, "projects");
  });

  test("an empty inbox advances silently", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();

    const result = await service.advance();
    assert.ok(result.ok, "no confirmation is asked for when there is nothing to warn about");
    if (result.ok) assert.equal(result.review.step, "projects");
  });

  test("what was recorded is the count at the moment the step was passed", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n- two\n- three\n" });
    await service.start();
    await service.advance({ confirmed: true });

    inbox.content = "";
    const review = await service.current();
    assert.equal(review?.inbox?.count, 3, "the log records what was true then, not now");
  });

  test("an empty inbox is recorded as clear rather than as a warning passed", async () => {
    const { service, vault } = makeReview({ inbox: "" });
    await service.start();
    await service.advance();

    assert.match(vault.files.get("log/2026-W33.md") ?? "", /inbox clear/);
  });

  test("the review never writes the inbox", async () => {
    const { service, inbox } = makeReview({ inbox: "- one\n" });
    const before = inbox.content;

    await service.start();
    await service.advance({ confirmed: true });

    assert.equal(inbox.content, before, "the review reads the inbox and never sorts for the user");
  });
});
