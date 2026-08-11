import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * Refusals are values, not exceptions — refusing is an expected outcome that
 * a client must render. On any refusal, nothing is written anywhere and the
 * item stays in the inbox.
 */

const INBOX = "- 2026-08-09T14:23:05-04:00 Call the roofer\nsecond item\n";
const REF = {
  start: 0,
  end: Buffer.byteLength("- 2026-08-09T14:23:05-04:00 Call the roofer\n", "utf8"),
  raw: "- 2026-08-09T14:23:05-04:00 Call the roofer\n",
};

const make = (inbox = INBOX, files: Record<string, string> = {}) => {
  const doc = new FakeInboxDocument(inbox);
  const vault = new FakeVaultStore();
  for (const [p, c] of Object.entries(files)) vault.files.set(p, c);
  const journal = new FakeSortJournal();
  const service = new SortService({ inbox: doc, vault, journal, clock: fixedClock() });
  return { doc, vault, journal, service };
};

describe("refusals leave everything untouched", () => {
  test("empty waiting-for owner is refused", async () => {
    const { doc, vault, service } = make();

    const outcome = await service.sort(REF, { to: "waiting", owner: "   " });

    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok && outcome.reason, "empty-owner");
    assert.equal(doc.content, INBOX, "inbox must be unchanged");
    assert.equal(vault.files.size, 0, "nothing may be written");
  });

  test("a changed item is refused and nothing is written", async () => {
    const { doc, vault, journal, service } = make();
    doc.content = "- 2026-08-09T14:23:05-04:00 Call the roofer BACK\nsecond item\n";

    const outcome = await service.sort(REF, { to: "trash" });

    assert.equal(!outcome.ok && outcome.reason, "item-changed");
    assert.equal(vault.files.size, 0);
    assert.equal(journal.entries.length, 0, "no journal entry may be left behind");
  });

  test("a deleted destination is reported, not silently recreated", async () => {
    // FR-020c: the user removed that project on purpose.
    const { doc, vault, service } = make();

    const outcome = await service.sort(REF, { to: "project", slug: "gone" });

    assert.equal(!outcome.ok && outcome.reason, "destination-missing");
    assert.equal(vault.files.has("projects/gone.md"), false);
    assert.equal(doc.content, INBOX);
  });

  test("a failed destination write leaves the item in the inbox", async () => {
    const { doc, vault, journal, service } = make();
    vault.failWrites.add("trash.md");

    const outcome = await service.sort(REF, { to: "trash" });

    assert.equal(!outcome.ok && outcome.reason, "write-failed");
    assert.equal(doc.content, INBOX, "the thought must survive a failed write");
    assert.equal(journal.entries.length, 0);
  });

  test("a failed inbox removal keeps the journal entry for recovery", async () => {
    // The destination has the item; the next launch finishes the removal.
    const { vault, journal, service } = make();
    const doc = new FakeInboxDocument(INBOX);
    doc.failNextWrite = true;
    const svc = new SortService({ inbox: doc, vault, journal, clock: fixedClock() });

    const outcome = await svc.sort(REF, { to: "trash" });

    assert.equal(!outcome.ok && outcome.reason, "write-failed");
    assert.equal(journal.entries.length, 1, "entry must survive for recovery");
    assert.equal(journal.entries[0]?.destinationWritten, true);
    assert.match(vault.files.get("trash.md") ?? "", /Call the roofer/);
    void service;
  });

  test("refusal messages are safe to show a user", async () => {
    const { service } = make();
    const outcome = await service.sort(REF, { to: "waiting", owner: "" });

    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.ok(outcome.message.length > 0);
      assert.doesNotMatch(outcome.message, /undefined|\[object/);
    }
  });
});
