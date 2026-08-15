import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * One write at a time.
 *
 * Every write is a read-modify-write of one section of one file, so two
 * overlapping calls would both read the same state and the second would
 * silently discard the first. Awaits interleave even on one thread, which is
 * why this needs an explicit queue rather than careful ordering — the same
 * discipline `TopThreeService` uses, and for the same reason: silent data loss
 * is the failure the plain-text format exists to make impossible.
 */

describe("concurrent writes", () => {
  test("two advances fired together do not lose one another's work", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();

    const [first, second] = await Promise.all([service.advance(), service.advance()]);

    assert.ok(first.ok);
    assert.ok(second.ok);
    assert.equal((await service.current())?.step, "waiting", "both advances landed");
  });

  test("starting twice at once creates one review, not two", async () => {
    const { service, vault } = makeReview();

    const [a, b] = await Promise.all([service.start(), service.start()]);

    assert.equal(a.week, b.week);
    assert.equal(
      vault.writeLog.filter((p) => p === "log/2026-W33.md").length,
      1,
      "the second call found the first call's file",
    );
  });

  test("a completion racing an advance leaves a coherent file", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();
    for (let i = 0; i < 3; i++) await service.advance();

    const [complete, advance] = await Promise.all([
      service.complete({ note: "finished" }),
      service.advance(),
    ]);

    // Whichever ran first, the file must say exactly one coherent thing.
    const review = await service.current();
    assert.equal(review?.status, "complete");
    assert.equal(review?.note, "finished");
    assert.ok(complete.ok || advance.ok, "at least one of the two succeeded");
  });
});
