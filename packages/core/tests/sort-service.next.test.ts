import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

const make = (inbox: string) => {
  const doc = new FakeInboxDocument(inbox);
  const service = new SortService({
    inbox: doc,
    vault: new FakeVaultStore(),
    journal: new FakeSortJournal(),
    clock: fixedClock(),
  });
  return { doc, service };
};

describe("SortService.next", () => {
  test("returns the first item in file order", async () => {
    const { service } = make(
      "- 2026-08-09T14:23:05-04:00 first\n- 2026-08-09T14:31:12-04:00 second\n",
    );

    const item = await service.next();
    assert.equal(item?.text, "first");
  });

  test("file order wins over timestamp order", async () => {
    // A hand-edit can put items out of chronological order. The user sees
    // their file, so that is what we present (FR-001).
    const { service } = make(
      "- 2026-08-09T18:00:00-04:00 later\n- 2026-08-09T09:00:00-04:00 earlier\n",
    );

    assert.equal((await service.next())?.text, "later");
  });

  test("returns null for an empty inbox", async () => {
    const { service } = make("");
    assert.equal(await service.next(), null);
  });

  test("returns null for an inbox of only blank lines", async () => {
    const { service } = make("\n\n   \n\t\n");
    assert.equal(await service.next(), null);
  });

  test("calling twice without deciding returns the same item", async () => {
    // There is no cursor to advance. This is what makes FR-002 structural:
    // a client cannot skip ahead because there is nothing to skip with.
    const { service } = make("- 2026-08-09T14:23:05-04:00 first\nsecond\n");

    const a = await service.next();
    const b = await service.next();

    assert.equal(a?.text, "first");
    assert.deepEqual(a?.ref, b?.ref);
  });

  test("a hand-written item comes back with no timestamp", async () => {
    const { service } = make("Buy milk\n");

    const item = await service.next();
    assert.equal(item?.text, "Buy milk");
    assert.equal(item?.capturedAt, null);
  });

  test("reflects an external edit without a restart", async () => {
    const { doc, service } = make("- 2026-08-09T14:23:05-04:00 first\n");
    assert.equal((await service.next())?.text, "first");

    doc.content = "prepended by hand\n" + doc.content;

    assert.equal((await service.next())?.text, "prepended by hand");
  });

  test("the ref round-trips the exact bytes shown", async () => {
    const inbox = "- 2026-08-09T14:23:05-04:00 café ☕\n";
    const { service } = make(inbox);

    const item = await service.next();
    assert.equal(item?.ref.raw, inbox);
    assert.equal(item?.ref.start, 0);
    assert.equal(item?.ref.end, Buffer.byteLength(inbox, "utf8"));
  });

  test("a multi-line item is presented whole", async () => {
    const { service } = make(
      "- 2026-08-09T14:31:12-04:00 Ask Priya whether it moved,\n  and tell the rotation.\n",
    );

    const item = await service.next();
    assert.equal(item?.text, "Ask Priya whether it moved,\nand tell the rotation.");
  });
});

describe("SortService.count / isEmpty", () => {
  test("counts routable items, ignoring blank lines", async () => {
    const { service } = make("first\n\n\nsecond\n\n");
    assert.equal(await service.count(), 2);
  });

  test("isEmpty is true for blank-only content", async () => {
    const { service } = make("\n   \n");
    assert.equal(await service.isEmpty(), true);
  });

  test("isEmpty is false while any hand-written text remains", async () => {
    // Hand-written items count toward zero (FR-027c), so the weekly review
    // gate cannot pass over a file that still has thoughts in it.
    const { service } = make("## Someday\n");
    assert.equal(await service.isEmpty(), false);
  });

  test("is computed from the file each call, never cached", async () => {
    const { doc, service } = make("one\n");
    assert.equal(await service.count(), 1);

    doc.content = "one\ntwo\n";
    assert.equal(await service.count(), 2);

    doc.content = "";
    assert.equal(await service.isEmpty(), true);
  });
});
