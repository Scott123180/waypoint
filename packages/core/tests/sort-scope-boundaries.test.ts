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
