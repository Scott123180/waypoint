import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { parseInbox } from "../src/inbox/parse";
import { newEntry } from "../src/sort/journal";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * Recovery finishes whatever was in flight when the process last stopped, so a
 * crash leaves a duplicate only until relaunch (FR-020d, SC-005).
 */

const INBOX = "- 2026-08-09T14:23:05-04:00 first\n- 2026-08-09T14:31:12-04:00 second\n";
const NOW = new Date("2026-08-11T10:00:00-04:00");

const refFor = (doc: string, i: number) => {
  const item = parseInbox(doc)[i]!;
  return { start: item.start, end: item.end, raw: item.raw };
};

const make = (inbox = INBOX) => {
  const doc = new FakeInboxDocument(inbox);
  const vault = new FakeVaultStore();
  const journal = new FakeSortJournal();
  const service = new SortService({ inbox: doc, vault, journal, clock: fixedClock() });
  return { doc, vault, journal, service };
};

describe("SortService.recover", () => {
  test("does nothing when the journal is empty", async () => {
    const { doc, service } = make();

    assert.deepEqual(await service.recover(), { completed: 0, abandoned: 0 });
    assert.equal(doc.content, INBOX);
  });

  test("crash before the destination write: finishes the whole decision", async () => {
    const { doc, vault, journal, service } = make();
    journal.entries.push(newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW));

    const report = await service.recover();

    assert.deepEqual(report, { completed: 1, abandoned: 0 });
    assert.match(vault.files.get("trash.md") ?? "", /first/);
    assert.ok(!doc.content.includes("first"), "the item must leave the inbox");
    assert.equal(journal.entries.length, 0, "the entry must be cleared");
  });

  test("crash after the destination write: finishes the removal only", async () => {
    const { doc, vault, journal, service } = make();
    vault.files.set("trash.md", "- 2026-08-11 — 2026-08-09T14:23:05-04:00 first\n");
    journal.entries.push({
      ...newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW),
      destinationWritten: true,
    });

    const report = await service.recover();

    assert.deepEqual(report, { completed: 1, abandoned: 0 });
    assert.ok(!doc.content.includes("first"));
    // Idempotent: the line is not written a second time.
    assert.equal((vault.files.get("trash.md") ?? "").match(/first/g)?.length, 1);
  });

  test("crash after removal but before clearing: nothing to redo", async () => {
    const withoutFirst = "- 2026-08-09T14:31:12-04:00 second\n";
    const { vault, journal, service } = make(withoutFirst);
    vault.files.set("trash.md", "- 2026-08-11 — 2026-08-09T14:23:05-04:00 first\n");
    journal.entries.push({
      ...newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW),
      destinationWritten: true,
    });

    const report = await service.recover();

    assert.deepEqual(report, { completed: 0, abandoned: 1 });
    assert.equal(journal.entries.length, 0);
  });

  test("a hand-edit between crash and relaunch is abandoned, not guessed at", async () => {
    const { doc, vault, journal, service } = make("totally different content\n");
    journal.entries.push(newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW));

    const report = await service.recover();

    assert.deepEqual(report, { completed: 0, abandoned: 1 });
    assert.equal(vault.files.size, 0, "nothing may be written on an abandon");
    assert.equal(doc.content, "totally different content\n");
  });

  test("running twice is a no-op the second time", async () => {
    const { doc, journal, service } = make();
    journal.entries.push(newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW));

    const first = await service.recover();
    const contentAfterFirst = doc.content;
    const second = await service.recover();

    assert.deepEqual(first, { completed: 1, abandoned: 0 });
    assert.deepEqual(second, { completed: 0, abandoned: 0 });
    assert.equal(doc.content, contentAfterFirst, "a second pass must change nothing");
  });

  test("several pending entries are all resolved", async () => {
    const { journal, service } = make();
    journal.entries.push(
      newEntry("e1", refFor(INBOX, 0), { to: "trash" }, NOW),
      newEntry("e2", refFor(INBOX, 1), { to: "calendar" }, NOW),
    );

    const report = await service.recover();

    assert.equal(report.completed + report.abandoned, 2);
    assert.equal(journal.entries.length, 0);
  });

  test("recovery routes to the destination the entry recorded", async () => {
    const { vault, journal, service } = make();
    journal.entries.push(
      newEntry("e1", refFor(INBOX, 0), { to: "waiting", owner: "Priya" }, NOW),
    );

    await service.recover();

    assert.match(vault.files.get("waiting.md") ?? "", /@Priya/);
  });

  test("a hand-written item recovers without acquiring a timestamp", async () => {
    const handwritten = "Buy milk\n";
    const { vault, journal, service } = make(handwritten);
    journal.entries.push(newEntry("e1", refFor(handwritten, 0), { to: "calendar" }, NOW));

    await service.recover();

    const line = vault.files.get("calendar.md") ?? "";
    assert.match(line, /Buy milk/);
    assert.doesNotMatch(line, /T\d{2}:\d{2}:\d{2}/, "no capture timestamp may be invented");
  });
});

describe("empty state", () => {
  test("an inbox of only blank lines is empty", async () => {
    const { service } = make("\n\n   \n");
    assert.equal(await service.isEmpty(), true);
    assert.equal(await service.next(), null);
  });

  test("any routable text means not empty, including hand-written", async () => {
    for (const content of ["## Someday\n", "Buy milk\n", "- 2026-08-09T14:23:05-04:00 x\n"]) {
      const { service } = make(content);
      assert.equal(await service.isEmpty(), false, `${JSON.stringify(content)} should not be empty`);
    }
  });

  test("an inbox that never existed is empty", async () => {
    const { service } = make("");
    assert.equal(await service.isEmpty(), true);
  });
});
