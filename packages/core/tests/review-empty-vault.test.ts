import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * A review of nothing still works.
 *
 * The empty vault is the first-run case, and a ritual that errors on day one is
 * a ritual nobody starts. Every step must report its empty state explicitly
 * rather than being skipped, so the user can see the ritual's shape before
 * they have any data to put in it (FR-007).
 */

describe("an empty vault", () => {
  test("every step passes and the review completes", async () => {
    const { service, vault } = makeReview({ inbox: "" });

    await service.start();
    for (let i = 0; i < 3; i++) {
      const result = await service.advance();
      assert.ok(result.ok, "no step may fail merely because there is nothing in it");
    }

    const done = await service.complete({});
    assert.ok(done.ok);
    if (done.ok) assert.equal(done.review.status, "complete");

    assert.ok(vault.files.has("log/2026-W33.md"), "a log is written even for an empty week");
  });

  test("the inbox step reports zero rather than erroring", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();
    assert.equal((await service.inboxStep()).count, 0);
  });

  test("the log of an empty week is still legible as a record", async () => {
    const { service, vault } = makeReview({ inbox: "" });
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance();
    await service.complete({});

    const content = vault.files.get("log/2026-W33.md") ?? "";
    assert.match(content, /^# Weekly review 2026-W33$/m);
    assert.match(content, /^status: complete$/m);
    assert.match(content, /## Projects/, "the shape of the ritual is visible even when empty");
    assert.match(content, /inbox clear/);
  });

  test("no file is created anywhere but the log", async () => {
    const { service, vault } = makeReview({ inbox: "" });
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance();
    await service.complete({});

    const touched = new Set(vault.writeLog);
    assert.deepEqual([...touched], ["log/2026-W33.md"]);
  });
});
