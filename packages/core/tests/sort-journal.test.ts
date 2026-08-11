import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { newEntry, planRecovery } from "../src/sort/journal";
import type { ItemRef } from "../src/sort/decision";

/**
 * The recovery decision table. This is the real specification for crash
 * behaviour — the I/O around it is trivial by comparison (research R10).
 */

const INBOX = "- 2026-08-09T14:23:05-04:00 first\n- 2026-08-09T14:31:12-04:00 second\n";
const REF: ItemRef = {
  start: 0,
  end: Buffer.byteLength("- 2026-08-09T14:23:05-04:00 first\n", "utf8"),
  raw: "- 2026-08-09T14:23:05-04:00 first\n",
};
const NOW = new Date("2026-08-11T10:00:00-04:00");

const entryAt = (destinationWritten: boolean) => ({
  ...newEntry("e1", REF, { to: "trash" }, NOW),
  destinationWritten,
});

describe("newEntry", () => {
  test("starts with the destination unwritten", () => {
    const entry = newEntry("e1", REF, { to: "trash" }, NOW);
    assert.equal(entry.destinationWritten, false);
    assert.equal(entry.id, "e1");
    assert.equal(entry.startedAt, NOW.toISOString());
  });
});

describe("planRecovery", () => {
  test("crash before the destination write: redo it, then remove", () => {
    const action = planRecovery(entryAt(false), INBOX);
    assert.deepEqual(action, { do: "write-destination-then-remove" });
  });

  test("crash after the destination write: just finish the removal", () => {
    const action = planRecovery(entryAt(true), INBOX);
    assert.deepEqual(action, { do: "remove-from-inbox" });
  });

  test("crash after removal but before clearing: nothing left to do", () => {
    // The item is gone from the inbox and the destination has it. This is a
    // completed decision whose entry was never cleared.
    const withoutFirst = "- 2026-08-09T14:31:12-04:00 second\n";
    const action = planRecovery(entryAt(true), withoutFirst);

    assert.equal(action.do, "abandon");
  });

  test("item hand-edited away before the destination was written: abandon", () => {
    // Nothing was written anywhere, and the item the user meant is gone.
    // Guessing would be worse than stopping.
    const edited = "- 2026-08-09T14:23:05-04:00 reworded by hand\n";
    const action = planRecovery(entryAt(false), edited);

    assert.equal(action.do, "abandon");
    assert.match((action as { why: string }).why, /no longer in the inbox/);
  });

  test("an empty inbox is handled without throwing", () => {
    assert.equal(planRecovery(entryAt(false), "").do, "abandon");
    assert.equal(planRecovery(entryAt(true), "").do, "abandon");
  });

  test("recovery is decided from bytes, not line numbers", () => {
    // Prepending content shifts the item; the recorded range no longer holds
    // what it did, so recovery must not act on the offset blindly.
    const shifted = "an unrelated hand-written line\n" + INBOX;
    assert.equal(planRecovery(entryAt(true), shifted).do, "abandon");
  });

  test("planning twice yields the same answer (idempotent)", () => {
    const entry = entryAt(true);
    assert.deepEqual(planRecovery(entry, INBOX), planRecovery(entry, INBOX));
  });

  test("multi-byte content does not confuse the range check", () => {
    const doc = "- 2026-08-09T14:23:05-04:00 café ☕\n- 2026-08-09T14:31:12-04:00 second\n";
    const raw = "- 2026-08-09T14:23:05-04:00 café ☕\n";
    const ref: ItemRef = { start: 0, end: Buffer.byteLength(raw, "utf8"), raw };
    const entry = { ...newEntry("e2", ref, { to: "trash" }, NOW), destinationWritten: true };

    assert.deepEqual(planRecovery(entry, doc), { do: "remove-from-inbox" });
  });
});
