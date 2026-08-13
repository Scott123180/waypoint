import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault, seedProject } from "./project-fakes";
import { COMPLETED, GNARLY, STRUCTURED, STUB } from "./project-fixtures";

/**
 * Reading is free of consequences: it re-reads from disk every time and it
 * never writes (FR-020, FR-031, FR-045).
 *
 * The zero-writes assertion is the one that matters. Opening a project must
 * produce no `git diff`, and the cheapest way for that to break is a read path
 * that "normalizes" the file on the way through (research R3).
 */

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("get", () => {
  test("returns a stub as a valid project with three nulls", async () => {
    const { projects } = service({ "projects/roof-repair.md": STUB });
    const p = await projects.get("roof-repair");
    assert.equal(p?.title, "Roof repair");
    assert.equal(p?.outcome, null);
    assert.equal(p?.nextAction, null);
    assert.equal(p?.dri, null);
  });

  test("returns null for a slug that does not exist", async () => {
    const { projects } = service({});
    assert.equal(await projects.get("ghost"), null);
  });

  test("reflects a change made to the file between calls", async () => {
    // No cache, no session. A hand-edit lands on the very next read.
    const { vault, projects } = service({ "projects/p.md": STUB });
    assert.equal((await projects.get("p"))?.dri, null);
    vault.files.set("projects/p.md", "# Roof repair\n\nstatus: active\ndri: Sam\n");
    assert.equal((await projects.get("p"))?.dri, "Sam");
  });
});

describe("list", () => {
  test("returns a summary per project, done ones included", async () => {
    const { projects } = service({
      "projects/a.md": STRUCTURED,
      "projects/b.md": COMPLETED,
    });
    const all = await projects.list();
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((p) => p.status).sort(),
      ["active", "done"],
    );
  });

  test("is empty for a vault with no projects", async () => {
    const { projects } = service({});
    assert.deepEqual(await projects.list(), []);
  });

  test("ignores areas", async () => {
    const { projects } = service({ "projects/a.md": STUB, "areas/h.md": STUB });
    assert.equal((await projects.list()).length, 1);
  });
});

describe("listActive", () => {
  test("excludes done projects — the rule lives here, not in a client", async () => {
    // FR-032. A renderer that filtered on `status` itself would be holding a
    // business rule, and Feature 6's API would have to reimplement it to agree.
    const { projects } = service({
      "projects/a.md": STRUCTURED,
      "projects/b.md": COMPLETED,
    });
    const active = await projects.listActive();
    assert.deepEqual(
      active.map((p) => p.slug),
      ["a"],
    );
  });

  test("includes parked and waiting projects, with their status visible", async () => {
    // Only done removes a project from view. Hiding parked work would recreate
    // the half-defined-and-forgotten problem the structure flag exists to stop.
    const { projects } = service({
      "projects/p.md": "# P\n\nstatus: parked\n",
      "projects/w.md": "# W\n\nstatus: waiting\n",
    });
    const active = await projects.listActive();
    assert.equal(active.length, 2);
    assert.deepEqual(active.map((p) => p.status).sort(), ["parked", "waiting"]);
  });
});

describe("reads never write", () => {
  test("get, list, and listActive leave the vault untouched", async () => {
    const { vault, projects } = service({
      "projects/gnarly.md": GNARLY,
      "projects/stub.md": STUB,
      "projects/done.md": COMPLETED,
    });
    const before = new Map(vault.files);

    await projects.get("gnarly");
    await projects.get("stub");
    await projects.list();
    await projects.listActive();

    assert.deepEqual(vault.writeLog, [], "reading must not write");
    for (const [path, content] of before) {
      assert.equal(vault.files.get(path), content, `${path} changed on read`);
    }
  });

  test("reading a hand-shaped file does not reformat it", async () => {
    const { vault, projects } = seedGnarly();
    await projects.get("q3");
    assert.equal(vault.files.get("projects/q3.md"), GNARLY);
  });
});

function seedGnarly() {
  const vault = seedProject("q3", GNARLY);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}
