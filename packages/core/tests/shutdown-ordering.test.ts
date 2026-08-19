import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { calendarFile, populatedVault, shutdownFor, waitingFile } from "./shutdown-fakes";

/**
 * Source order, everywhere. Nothing is ranked (FR-009, FR-010, US1 scenario 15).
 *
 * File order for the three lists, slug order for the projects. Not sorted by
 * age, staleness, or urgency — a ranking is a judgement about which of the
 * user's commitments matters most, and this screen makes none. The oldest item
 * is not the most important one; it is just the oldest one, and the day count
 * beside it already says so.
 *
 * Determinism is the other half: two readings over unchanged data produce the
 * same value, so nothing here is shuffled, sampled, or time-dependent beyond
 * the single `today`.
 */

const SCRAMBLED = {
  "waiting.md": waitingFile([
    { since: "2026-08-12", owner: "Newest", text: "Seven days" },
    { since: "2026-01-01", owner: "Oldest", text: "Since January" },
    { since: "2026-06-01", owner: "Middle", text: "Since June" },
  ]),
  "calendar.md": calendarFile([
    { flaggedOn: "2026-08-12", text: "Seven days" },
    { flaggedOn: "2026-01-01", text: "Since January" },
    { flaggedOn: "2026-06-01", text: "Since June" },
  ]),
};

describe("the lists are in file order", () => {
  test("the waiting panel is not sorted by age", async () => {
    const { service } = shutdownFor(SCRAMBLED);

    const { waiting } = await service.read();

    assert.deepEqual(waiting.items.map((s) => s.item.owner), ["Newest", "Oldest", "Middle"]);
  });

  test("the calendar panel is not sorted by age", async () => {
    const { service } = shutdownFor(SCRAMBLED);

    const { calendar } = await service.read();

    assert.deepEqual(calendar.items.map((s) => s.item.text), [
      "Seven days",
      "Since January",
      "Since June",
    ]);
  });

  test("the top three is in the order the week records it", async () => {
    const { service } = shutdownFor(populatedVault());

    const { topThree } = await service.read();

    assert.deepEqual(
      topThree.week?.outcomes.map((o) => o.index),
      [0, 1, 2],
      "a done outcome is not moved to the bottom",
    );
  });

  test("the projects are in slug order", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();

    assert.deepEqual(projects.items.map((p) => p.summary.slug), ["alpha", "bravo"]);
  });
});

describe("nothing is ranked by urgency", () => {
  test("the oldest item does not float to the top of its panel", async () => {
    const { service } = shutdownFor(SCRAMBLED);

    const view = await service.read();

    assert.notEqual(
      view.waiting.items[0]?.item.owner,
      "Oldest",
      "sorting by age would be the screen deciding what matters most",
    );
    assert.notEqual(view.calendar.items[0]?.item.text, "Since January");
  });

  test("no panel carries a score, rank, priority, or ordering hint", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    const fields = [
      ...view.waiting.items.flatMap((s) => Object.keys(s)),
      ...view.calendar.items.flatMap((s) => Object.keys(s)),
      ...view.projects.items.flatMap((p) => Object.keys(p)),
    ];
    for (const field of fields) {
      assert.doesNotMatch(field, /score|rank|priority|urgen|weight|order/i, `${field} is a judgement`);
    }
  });
});

describe("two readings over unchanged data agree", () => {
  test("the whole value is identical", async () => {
    const { service } = shutdownFor(populatedVault());

    const first = await service.read();
    const second = await service.read();

    assert.deepEqual(second, first);
  });

  test("including over an empty vault", async () => {
    const { service } = shutdownFor({});

    assert.deepEqual(await service.read(), await service.read());
  });
});
