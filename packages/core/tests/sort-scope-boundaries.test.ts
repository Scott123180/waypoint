import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * FR-016a and FR-032: the things this feature deliberately does *not* do.
 * Asserted so a later feature adds them on purpose rather than by drift.
 */

const service = new SortService({
  inbox: new FakeInboxDocument(""),
  vault: new FakeVaultStore(),
  journal: new FakeSortJournal(),
  clock: fixedClock(),
});

describe("out-of-scope guarantees", () => {
  /**
   * Amended 2026-08-17, when Feature 8 shipped LLM-assisted organization.
   *
   * `split` joins the expected surface. It is this feature's only write: one
   * atomic `replaceRange` that divides an item into several. A separate
   * `SplitService` was considered and rejected — it would hold the same
   * `InboxDocument` and the same mutex and a copy of the item-changed
   * verification, putting two writers on `inbox.md`, which is the hazard
   * `inbox-mutex.ts` exists to remove (008 research R7).
   *
   * **The forbidden list below is unchanged, `suggest` included, and still
   * passes.** That is the part of this guard that matters most here:
   * suggesting is a different verb on a different service, so a client cannot
   * reach a destination through a suggestion — it reaches a *proposal*, and
   * then reaches `sort()` itself.
   */
  test("the service offers no editing, reordering, bulk, or undo verb", () => {
    const surface = Object.getOwnPropertyNames(SortService.prototype).filter((n) => n !== "constructor");

    assert.deepEqual(surface.sort(), [
      "count",
      "destinations",
      "isEmpty",
      "next",
      "readDestinations",
      "recover",
      "resolveCreate",
      "sort",
      "split",
    ]);
    for (const forbidden of ["edit", "reorder", "move", "undo", "bulk", "purge", "suggest"]) {
      assert.ok(
        !surface.some((n) => n.toLowerCase().includes(forbidden)),
        `SortService must not expose "${forbidden}"`,
      );
    }
  });

  test("sorting takes exactly one item at a time", () => {
    // No array overload exists, which is what keeps FR-004 structural.
    assert.equal(service.sort.length, 2);
  });

  test("nothing prunes the discard list", async () => {
    const vault = new FakeVaultStore();
    vault.files.set("trash.md", "- 2020-01-01 — ancient\n");
    const svc = new SortService({
      inbox: new FakeInboxDocument("x\n"),
      vault,
      journal: new FakeSortJournal(),
      clock: fixedClock(),
    });

    const item = await svc.next();
    await svc.sort(item!.ref, { to: "trash" });

    // The old line is still there: no expiry, no size limit (FR-016a).
    assert.match(vault.files.get("trash.md") ?? "", /ancient/);
  });
});
