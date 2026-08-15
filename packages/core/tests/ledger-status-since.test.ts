import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseLedgerLine, statusSince } from "../src/projects/ledger";
import type { LedgerEntry } from "../src/projects/types";

/**
 * `statusSince` — the one thing derived from the ledger.
 *
 * Last match rather than first, because a project that has bounced between
 * statuses is asking about its *current* spell, not its first one. Null means
 * the ledger does not say, and unknown is never stale (FR-093, FR-094).
 */

function ledger(...lines: string[]): LedgerEntry[] {
  return lines.map((l) => {
    const entry = parseLedgerLine(l);
    assert.ok(entry, `fixture line does not parse: ${l}`);
    return entry;
  });
}

describe("statusSince", () => {
  test("is the date of the entry that entered the current status", () => {
    const entries = ledger("- 2026-06-02 status active → waiting");
    assert.equal(statusSince(entries, "waiting"), "2026-06-02");
  });

  test("a project that bounced reports its most recent spell", () => {
    const entries = ledger(
      "- 2026-06-02 status active → waiting",
      "- 2026-07-14 status waiting → active — after 42d waiting",
      "- 2026-08-01 status active → waiting — after 18d active",
    );

    assert.equal(
      statusSince(entries, "waiting"),
      "2026-08-01",
      "the current spell, not the first one — otherwise a project that was once waiting is stale forever",
    );
  });

  test("no entry entering that status yields null", () => {
    const entries = ledger("- 2026-06-02 status active → waiting");

    assert.equal(statusSince(entries, "parked"), null);
    assert.equal(statusSince([], "waiting"), null, "a project older than the ledger says nothing");
  });

  test("a status the ledger left rather than entered does not count", () => {
    const entries = ledger("- 2026-06-02 status waiting → active");

    assert.equal(
      statusSince(entries, "waiting"),
      null,
      "leaving a status is not entering it — reading the arrow backwards would date every spell wrong",
    );
  });

  test("an entry for another action never answers the question", () => {
    const entries = ledger("- 2026-08-15 milestone done Something that mentions → waiting");

    assert.equal(statusSince(entries, "waiting"), null, "only status entries date a status");
  });
});
