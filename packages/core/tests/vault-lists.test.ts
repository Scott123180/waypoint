import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { waitingLine, calendarLine, trashLine, localDate } from "../src/vault/lists";

/**
 * Line grammars for the three running lists.
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */

const captured = new Date("2026-08-09T16:02:11-04:00");
const today = new Date("2026-08-11T10:00:00-04:00");

describe("localDate", () => {
  test("formats as YYYY-MM-DD in local time", () => {
    assert.equal(localDate(new Date("2026-08-11T10:00:00-04:00")), "2026-08-11");
  });

  test("uses the local calendar day, not the UTC one", () => {
    // 23:30 local on the 11th is already the 12th in UTC; the user's day is
    // the one that matters for staleness.
    const late = new Date(2026, 7, 11, 23, 30, 0);
    assert.equal(localDate(late), "2026-08-11");
  });
});

describe("waitingLine", () => {
  test("carries owner, waiting-since date, capture timestamp, and text", () => {
    const line = waitingLine(
      { text: "Confirm the migration window moved", capturedAt: captured },
      "Priya",
      today,
    );

    assert.equal(
      line,
      "- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved",
    );
  });

  test("omits the timestamp entirely for a hand-written item", () => {
    // No date is invented for an item that never had one (FR-027a).
    const line = waitingLine({ text: "Send the revised estimate", capturedAt: null }, "roofer", today);

    assert.equal(line, "- 2026-08-11 @roofer — Send the revised estimate");
  });

  test("keeps a multi-line item's continuation indentation", () => {
    const line = waitingLine({ text: "first\nsecond", capturedAt: null }, "Sam", today);

    assert.equal(line, "- 2026-08-11 @Sam — first\n  second");
  });

  test("stores the owner verbatim, spaces and all", () => {
    const line = waitingLine({ text: "x", capturedAt: null }, "Dr. Ada Lovelace", today);
    assert.match(line, /@Dr\. Ada Lovelace —/);
  });
});

describe("calendarLine", () => {
  test("carries the flag date and the capture timestamp", () => {
    const line = calendarLine(
      { text: "Book flights for the March offsite", capturedAt: captured },
      today,
    );

    assert.equal(
      line,
      "- 2026-08-11 — 2026-08-09T16:02:11-04:00 Book flights for the March offsite",
    );
  });

  test("omits the timestamp for a hand-written item", () => {
    const line = calendarLine({ text: "Dentist sometime in September", capturedAt: null }, today);
    assert.equal(line, "- 2026-08-11 — Dentist sometime in September");
  });

  test("records no event date, time, or duration", () => {
    // This is a marker, not a calendar entry (FR-017).
    const line = calendarLine({ text: "Lunch", capturedAt: null }, today);
    assert.equal(line, "- 2026-08-11 — Lunch");
  });
});

describe("trashLine", () => {
  test("keeps the text and timestamp so a discard stays recoverable", () => {
    const line = trashLine({ text: "Turned out to be nothing", capturedAt: captured }, today);

    assert.equal(line, "- 2026-08-11 — 2026-08-09T16:02:11-04:00 Turned out to be nothing");
  });

  test("preserves text verbatim, including markdown that looks like structure", () => {
    const line = trashLine({ text: "## Someday", capturedAt: null }, today);
    assert.equal(line, "- 2026-08-11 — ## Someday");
  });
});
