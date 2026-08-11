import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { parseInbox } from "../src/inbox/parse";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * Routing the five destinations end to end, against fakes.
 * Multi-line items must move as one unit and leave surrounding bytes alone.
 */

const INBOX =
  "- 2026-08-09T14:23:05-04:00 keep me ☕\n" +
  "- 2026-08-09T14:31:12-04:00 Ask Priya whether it moved,\n" +
  "  and tell the rotation before Friday.\n" +
  "\n" +
  "keep me too\n";

const make = (inbox = INBOX, files: Record<string, string> = {}) => {
  const doc = new FakeInboxDocument(inbox);
  const vault = new FakeVaultStore();
  for (const [p, c] of Object.entries(files)) vault.files.set(p, c);
  const service = new SortService({
    inbox: doc,
    vault,
    journal: new FakeSortJournal(),
    clock: fixedClock(),
  });
  return { doc, vault, service };
};

const refFor = (inbox: string, index: number) => {
  const item = parseInbox(inbox)[index]!;
  return { start: item.start, end: item.end, raw: item.raw };
};

describe("routing a multi-line item", () => {
  test("moves the whole item and leaves surrounding bytes untouched", async () => {
    const { doc, vault, service } = make();

    const outcome = await service.sort(refFor(INBOX, 1), { to: "trash" });

    assert.equal(outcome.ok, true);
    assert.equal(doc.content, "- 2026-08-09T14:23:05-04:00 keep me ☕\n\nkeep me too\n");
    const trash = vault.files.get("trash.md") ?? "";
    assert.match(trash, /Ask Priya whether it moved,/);
    assert.match(trash, /\n {2}and tell the rotation before Friday\./);
  });

  test("the blank line around it survives", async () => {
    const { doc, service } = make();
    await service.sort(refFor(INBOX, 1), { to: "calendar" });

    assert.ok(doc.content.includes("☕\n\nkeep me too"), "spacing must be preserved");
  });
});

describe("routing to each destination", () => {
  test("waiting-for records the owner and today's date", async () => {
    const { doc, vault, service } = make();

    const outcome = await service.sort(refFor(INBOX, 0), { to: "waiting", owner: "Priya" });

    assert.deepEqual(outcome, { ok: true, destination: "waiting.md" });
    assert.match(vault.files.get("waiting.md") ?? "", /^- 2026-08-11 @Priya — /m);
    assert.ok(!doc.content.includes("keep me ☕"));
  });

  test("calendar records a flag date and contacts nothing", async () => {
    const { vault, service } = make();

    const outcome = await service.sort(refFor(INBOX, 0), { to: "calendar" });

    assert.deepEqual(outcome, { ok: true, destination: "calendar.md" });
    assert.match(vault.files.get("calendar.md") ?? "", /^- 2026-08-11 — /m);
  });

  test("trash keeps the text recoverable", async () => {
    const { vault, service } = make();

    await service.sort(refFor(INBOX, 0), { to: "trash" });

    assert.match(vault.files.get("trash.md") ?? "", /keep me ☕/);
  });

  test("a project receives the item under ## Unprocessed", async () => {
    const { doc, vault, service } = make(INBOX, {
      "projects/roof.md": "# Roof\n\nstatus: active\n",
    });

    const outcome = await service.sort(refFor(INBOX, 0), { to: "project", slug: "roof" });

    assert.deepEqual(outcome, { ok: true, destination: "projects/roof.md" });
    const file = vault.files.get("projects/roof.md") ?? "";
    assert.match(file, /## Unprocessed\n\n- 2026-08-09T14:23:05-04:00 keep me ☕\n/);
    assert.ok(file.startsWith("# Roof\n\nstatus: active\n"), "existing content preserved");
    assert.ok(!doc.content.includes("keep me ☕"));
  });

  test("an area works the same way", async () => {
    const { vault, service } = make(INBOX, { "areas/health.md": "# Health\n" });

    const outcome = await service.sort(refFor(INBOX, 0), { to: "area", slug: "health" });

    assert.deepEqual(outcome, { ok: true, destination: "areas/health.md" });
    assert.match(vault.files.get("areas/health.md") ?? "", /## Unprocessed/);
  });

  test("a hand-written item lands with no fabricated timestamp", async () => {
    const inbox = "Buy milk\n";
    const { vault, service } = make(inbox);

    await service.sort(refFor(inbox, 0), { to: "calendar" });

    assert.equal(vault.files.get("calendar.md"), "- 2026-08-11 — Buy milk\n");
  });

  test("sorting every item empties the inbox", async () => {
    const { doc, service } = make();

    for (let guard = 0; guard < 10; guard++) {
      const item = await service.next();
      if (!item) break;
      const outcome = await service.sort(item.ref, { to: "trash" });
      assert.equal(outcome.ok, true, `failed on ${item.text}`);
    }

    assert.equal(await service.isEmpty(), true);
    assert.equal(doc.content.trim(), "");
  });
});
