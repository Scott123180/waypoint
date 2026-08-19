import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { calendarFile, populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * Panel 4 — flagged for the calendar, never scheduled (FR-028, FR-029a).
 *
 * The same rule and the same threshold as panel 3, asked with a third subject.
 * A flag has exactly one age — how long since it was flagged — because
 * `calendar.md` records no event date, time, duration, or attendee. It is a
 * staging list of flags, not a calendar.
 */

describe("membership", () => {
  test("lists exactly the flags at or past the threshold", async () => {
    const { service } = shutdownFor(populatedVault());

    const { calendar } = await service.read();

    assert.equal(calendar.failure, null);
    assert.deepEqual(calendar.items.map((s) => s.item.text), [
      "Quarterly planning day",
      "Book flights for the March offsite",
    ]);
  });

  test("the boundary day itself is listed", async () => {
    const { service } = shutdownFor({
      "calendar.md": calendarFile([{ flaggedOn: "2026-08-12", text: "Exactly seven days" }]),
    });

    assert.equal((await service.read()).calendar.items.length, 1);
  });

  test("one day inside the boundary is not", async () => {
    const { service } = shutdownFor({
      "calendar.md": calendarFile([{ flaggedOn: "2026-08-13", text: "Six days" }]),
    });

    assert.deepEqual((await service.read()).calendar.items, []);
  });

  test("file order is kept — nothing is sorted by how long it has sat", async () => {
    const { service } = shutdownFor({
      "calendar.md": calendarFile([
        { flaggedOn: "2026-08-12", text: "Newer" },
        { flaggedOn: "2026-01-01", text: "Much older" },
      ]),
    });

    assert.deepEqual(
      (await service.read()).calendar.items.map((s) => s.item.text),
      ["Newer", "Much older"],
    );
  });
});

describe("a date that cannot be judged is never evidence of neglect", () => {
  test("an unreadable flag date is never listed", async () => {
    const { service } = shutdownFor({ "calendar.md": "- 2026-13-99 — Something\n" });

    const { calendar } = await service.read();

    assert.deepEqual(calendar.items, []);
    assert.equal(calendar.failure, null, "an odd date is not a failed source");
  });

  test("a future flag date is never listed", async () => {
    const { service } = shutdownFor({
      "calendar.md": calendarFile([{ flaggedOn: "2026-12-25", text: "Christmas planning" }]),
    });

    assert.deepEqual((await service.read()).calendar.items, []);
  });
});

describe("what each listed flag carries", () => {
  test("its text, verbatim", async () => {
    const { service } = shutdownFor(populatedVault());

    const { calendar } = await service.read();

    assert.equal(calendar.items[0]?.item.text, "Quarterly planning day");
  });

  test("the one age a flag has", async () => {
    const { service } = shutdownFor(populatedVault());

    const { calendar } = await service.read();

    assert.equal(calendar.items[0]?.unscheduledDays, 20);
    assert.equal(calendar.items[1]?.unscheduledDays, 7);
  });

  test("the reason, in the calendar's own words rather than the waiting list's", async () => {
    const { service } = shutdownFor(populatedVault());

    const { calendar } = await service.read();

    assert.equal(
      calendar.items[1]?.reason,
      "This has been waiting to be scheduled for 7 days. Put it in your calendar, or let it go.",
    );
  });

  test("no field an event would have — no date, time, duration, or attendee", async () => {
    const { service } = shutdownFor(populatedVault());

    const { calendar } = await service.read();

    assert.deepEqual(Object.keys(calendar.items[0]?.item ?? {}).sort(), [
      "capturedAt",
      "flaggedOn",
      "index",
      "raw",
      "text",
    ]);
  });
});
