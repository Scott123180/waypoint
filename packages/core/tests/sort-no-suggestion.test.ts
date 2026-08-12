import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

/**
 * FR-030 / SC-007: nothing suggests, ranks, or pre-selects a destination.
 * The absence of any API field in which a suggestion could be expressed is
 * what makes that structural rather than a promise.
 */

const make = (files: Record<string, string>) => {
  const vault = new FakeVaultStore();
  for (const [p, c] of Object.entries(files)) vault.files.set(p, c);
  return new SortService({
    inbox: new FakeInboxDocument("- 2026-08-09T14:23:05-04:00 roof leak again\n"),
    vault,
    journal: new FakeSortJournal(),
    clock: fixedClock(),
  });
};

describe("no destination is ever proposed", () => {
  test("order is stable and unaffected by the item's text", async () => {
    // "roof leak again" would obviously match "Roof repair" to a ranker. It
    // must not move to the front.
    const service = make({
      "projects/attic.md": "# Attic\n",
      "projects/roof-repair.md": "# Roof repair\n",
      "projects/zebra.md": "# Zebra\n",
    });

    const { projects } = await service.destinations();
    assert.deepEqual(projects.map((p) => p.slug), ["attic", "roof-repair", "zebra"]);
  });

  test("repeated calls return an identical ordering", async () => {
    const service = make({ "projects/a.md": "# A\n", "projects/b.md": "# B\n" });

    const first = await service.destinations();
    const second = await service.destinations();
    assert.deepEqual(first, second);
  });

  test("a DestinationRef carries no score, rank, or selected flag", async () => {
    const service = make({ "projects/a.md": "# A\n" });
    const { projects } = await service.destinations();

    assert.deepEqual(Object.keys(projects[0] ?? {}).sort(), ["kind", "slug", "title"]);
  });

  test("previous choices do not influence later ordering", async () => {
    const service = make({ "projects/a.md": "# A\n", "projects/b.md": "# B\n" });
    const before = (await service.destinations()).projects.map((p) => p.slug);

    const item = await service.next();
    await service.sort(item!.ref, { to: "project", slug: "b" });

    const after = (await service.destinations()).projects.map((p) => p.slug);
    assert.deepEqual(after, before, "usage must not reorder the list");
  });
});
