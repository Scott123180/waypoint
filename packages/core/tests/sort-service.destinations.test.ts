import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SortService } from "../src/sort/sort-service";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";

const make = (files: Record<string, string> = {}) => {
  const vault = new FakeVaultStore();
  for (const [path, content] of Object.entries(files)) vault.files.set(path, content);
  const service = new SortService({
    inbox: new FakeInboxDocument(""),
    vault,
    journal: new FakeSortJournal(),
    clock: fixedClock(),
  });
  return { vault, service };
};

describe("SortService.destinations", () => {
  test("lists projects and areas separately", async () => {
    const { service } = make({
      "projects/roof-repair.md": "# Roof repair\n",
      "areas/health.md": "# Health\n",
    });

    const { projects, areas } = await service.destinations();

    assert.deepEqual(projects.map((p) => p.slug), ["roof-repair"]);
    assert.deepEqual(areas.map((a) => a.slug), ["health"]);
    assert.equal(projects[0]?.kind, "project");
    assert.equal(areas[0]?.kind, "area");
  });

  test("reads the display title from the heading", async () => {
    const { service } = make({ "projects/roof-repair.md": "# Roof repair\n\nstatus: active\n" });

    const { projects } = await service.destinations();
    assert.equal(projects[0]?.title, "Roof repair");
  });

  test("falls back to the slug when a hand-made file has no heading", async () => {
    const { service } = make({ "projects/scratch.md": "just some notes\n" });

    const { projects } = await service.destinations();
    assert.equal(projects[0]?.title, "scratch");
  });

  test("an empty vault yields empty lists rather than throwing", async () => {
    const { service } = make();
    assert.deepEqual(await service.destinations(), { projects: [], areas: [] });
  });

  test("a destination created by hand appears without a restart", async () => {
    const { vault, service } = make();
    assert.equal((await service.destinations()).projects.length, 0);

    vault.files.set("projects/new-thing.md", "# New thing\n");

    assert.equal((await service.destinations()).projects.length, 1);
  });

  test("order is stable across calls and not ranked", async () => {
    // FR-030: nothing suggests, ranks, or pre-selects. The client renders what
    // it is given, in the order it is given.
    const { service } = make({
      "projects/alpha.md": "# Alpha\n",
      "projects/beta.md": "# Beta\n",
      "projects/gamma.md": "# Gamma\n",
    });

    const first = (await service.destinations()).projects.map((p) => p.slug);
    const second = (await service.destinations()).projects.map((p) => p.slug);

    assert.deepEqual(first, second);
    assert.deepEqual(first, ["alpha", "beta", "gamma"]);
  });
});
