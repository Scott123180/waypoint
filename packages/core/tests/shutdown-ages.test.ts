import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { daysBetween } from "../src/vault/lists";
import { calendarFile, populatedVault, shutdownFor, waitingFile } from "./shutdown-fakes";

/**
 * One `today`, and every age measured against it.
 *
 * `today` is a **field on the value**, taken once at the top of `read()`. Two
 * numbers about the same item cannot disagree, because they are two subtractions
 * from the same date — and the date changing while the window is open changes
 * nothing, because nothing recomputes.
 *
 * That last part is the edge case the spec names, and it is the reason this
 * screen does not re-read itself: a value whose ages drifted under the user
 * mid-reading would be answering a question they had already finished asking.
 */

const AT_2340 = "2026-08-19T23:40:00-04:00";

describe("`today` is the clock's local date", () => {
  test("late in the evening it is still today, not tomorrow in UTC", async () => {
    const { service } = shutdownFor(populatedVault(), { now: AT_2340 });

    // 23:40 local is already the 20th in UTC. Staleness is judged against the
    // user's day, so a shutdown run at 23:40 on Wednesday is Wednesday's.
    assert.equal((await service.read()).today, "2026-08-19");
  });
});

describe("every day count comes from that one date", () => {
  test("the waiting ages are exactly `daysBetween` against `today`", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    for (const stale of view.waiting.items) {
      const last = stale.item.actions[stale.item.actions.length - 1]?.on ?? stale.item.since;
      assert.equal(stale.untouchedDays, daysBetween(last, view.today));
      assert.equal(stale.waitingDays, daysBetween(stale.item.since, view.today));
    }
  });

  test("the calendar ages are too", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    for (const stale of view.calendar.items) {
      assert.equal(stale.unscheduledDays, daysBetween(stale.item.flaggedOn, view.today));
    }
  });

  test("the two ages of one item cannot disagree, because they share a date", async () => {
    const { service } = shutdownFor({
      "waiting.md": waitingFile([
        {
          since: "2026-01-01",
          owner: "Lee",
          text: "Budget numbers",
          actions: [{ kind: "followed-up", on: "2026-08-01" }],
        },
      ]),
    });

    const view = await service.read();
    const stale = view.waiting.items[0];

    assert.ok(stale);
    assert.equal(stale.waitingDays, 230);
    assert.equal(stale.untouchedDays, 18);
    assert.ok(
      stale.waitingDays >= stale.untouchedDays,
      "an item cannot have been untouched for longer than it has been waiting",
    );
  });
});

describe("the date changing while the screen is open changes nothing", () => {
  test("advancing the clock after read() does not alter the returned value", async () => {
    const { service, clock } = shutdownFor(populatedVault());

    const view = await service.read();
    const before = JSON.stringify(view);

    clock.set("2026-09-30T10:00:00-04:00");

    assert.equal(JSON.stringify(view), before, "nothing in the value recomputes");
    assert.equal(view.today, "2026-08-19");
  });

  test("a fresh read after the clock moves does report the new day", async () => {
    // The other half: nothing is cached either. A second opening is a cold one.
    const { service, clock } = shutdownFor({
      "calendar.md": calendarFile([{ flaggedOn: "2026-08-18", text: "One day old at first" }]),
    });

    assert.deepEqual((await service.read()).calendar.items, [], "one day old, inside the threshold");

    clock.set("2026-08-30T10:00:00-04:00");
    const later = await service.read();

    assert.equal(later.today, "2026-08-30");
    assert.equal(later.calendar.items[0]?.unscheduledDays, 12);
  });
});
