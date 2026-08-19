import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { shutdownFor, todayOf } from "./shutdown-fakes";

/**
 * A vault with nothing in it (FR-011, SC-011).
 *
 * The first-run case, and the one a reader is most likely to assume is an error
 * branch. It is not: four explicit empty panels, zero errors, and **no file
 * created by having been looked for**.
 *
 * "Nothing here" and "could not read this" are different answers, and this file
 * pins the first of them. `shutdown-source-failure.test.ts` pins the second.
 */

describe("read() against a vault with no files at all", () => {
  test("resolves rather than rejecting", async () => {
    const { service } = shutdownFor({});
    await assert.doesNotReject(() => service.read());
  });

  test("`today` is the injected clock's local date, not the machine's", async () => {
    const { service, clock } = shutdownFor({}, { now: "2026-08-19T22:40:00-04:00" });

    const view = await service.read();

    assert.equal(view.today, "2026-08-19");
    assert.equal(view.today, todayOf(clock));
  });

  test("the top three is an empty week, not a failure", async () => {
    const { service } = shutdownFor({});

    const { topThree } = await service.read();

    assert.equal(topThree.failure, null);
    assert.deepEqual(topThree.week?.outcomes, []);
    assert.equal(topThree.week?.current, true, "the week the clock is in, empty rather than absent");
  });

  test("the three list panels are empty and unfailed", async () => {
    const { service } = shutdownFor({});

    const view = await service.read();

    for (const [name, panel] of Object.entries({
      projects: view.projects,
      waiting: view.waiting,
      calendar: view.calendar,
    })) {
      assert.deepEqual(panel.items, [], `${name} must be empty`);
      assert.equal(panel.failure, null, `${name} must not report a failure — absence is not an error`);
    }
  });

  test("there is nothing unreadable and nothing to complain about", async () => {
    const { service } = shutdownFor({});

    const view = await service.read();

    assert.deepEqual(view.unreadableWaiting, []);
    assert.deepEqual(view.unreadableCalendar, []);
    assert.deepEqual(view.policyNotices, [], "no policy.md is the normal case, not a problem");
  });

  test("no rule is consulted, because there is nothing to ask about", async () => {
    const { service, policy } = shutdownFor({});

    await service.read();

    assert.deepEqual(policy.points(), []);
  });
});
