import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * Starting and resuming a review.
 *
 * The load-bearing property is that the file *is* the state: there is no
 * separate record of "a review is open", so starting twice cannot produce two
 * of anything, and nothing is created until the user asks (research R2).
 */

describe("starting a review", () => {
  test("creates the week's log with an in-progress marker", async () => {
    const { service, vault } = makeReview({ now: "2026-08-14T09:00:00-04:00" });

    const review = await service.start();

    assert.equal(review.week, "2026-W33");
    assert.equal(review.status, "in-progress");
    assert.equal(review.step, "inbox");
    assert.equal(review.started, "2026-08-14");

    const content = vault.files.get("log/2026-W33.md");
    assert.ok(content, "the log file for the week must exist");
    assert.match(content, /^status: in progress$/m);
  });

  test("the week comes from the same ISO computation the top three uses", async () => {
    // 1 January 2027 belongs to ISO week 2026-W53. The log and the top three
    // must agree about which seven days they mean (FR-004).
    const { service } = makeReview({ now: "2027-01-01T09:00:00-05:00" });
    assert.equal((await service.start()).week, "2026-W53");
  });

  test("nothing is created until the user starts one", async () => {
    const { service, vault } = makeReview();

    assert.equal(await service.current(), null);
    assert.deepEqual(await service.history(), []);
    assert.equal(vault.writeLog.length, 0, "no file may be created behind the user's back");
  });

  test("starting twice resumes rather than creating a second review", async () => {
    const { service, vault } = makeReview();

    const first = await service.start();
    await service.advance({ confirmed: true });
    const second = await service.start();

    assert.equal(second.week, first.week);
    assert.equal(second.step, "projects", "the resumed review is where it was left");
    assert.equal(
      vault.writeLog.filter((p) => p === "log/2026-W33.md").length,
      2,
      "one create plus one step advance — not a second create",
    );
  });

  test("current() returns the in-progress review without starting one", async () => {
    const { service } = makeReview();
    assert.equal(await service.current(), null);

    await service.start();
    assert.equal((await service.current())?.week, "2026-W33");
  });

  test("a review started last week is not the current week's review", async () => {
    const { service, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await service.start();

    clock.set("2026-08-21T09:00:00-04:00");
    assert.equal(await service.current(), null, "a new week has no review until one is started");

    const next = await service.start();
    assert.equal(next.week, "2026-W34");
    assert.equal(next.step, "inbox", "a new week's review starts at the beginning");
  });

  test("the earlier week's review is untouched by the new one", async () => {
    const { service, vault, clock } = makeReview({ now: "2026-08-14T09:00:00-04:00" });
    await service.start();
    await service.advance({ confirmed: true });
    const before = vault.files.get("log/2026-W33.md");

    clock.set("2026-08-21T09:00:00-04:00");
    await service.start();

    assert.equal(vault.files.get("log/2026-W33.md"), before, "byte-for-byte unchanged");
  });
});
