import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { renderStub } from "../src/vault/stub";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * A project created here and one created mid-sort must be the same file.
 *
 * That is why `create` calls Feature 2's `renderStub` rather than writing its
 * own idea of a new project: two definitions would be free to drift, and the
 * drift would only show up in users' vaults (FR-005).
 */

function service(files: Record<string, string> = {}) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("create", () => {
  test("writes exactly what sort's stub writes", async () => {
    const { vault, projects } = service();
    const outcome = await projects.create("Roof repair");
    assert.ok(outcome.ok);
    assert.equal(vault.files.get("projects/roof-repair.md"), renderStub("Roof repair"));
  });

  test("writes no outcome, milestone, next action, or DRI", async () => {
    const { vault, projects } = service();
    await projects.create("Roof repair");
    const content = vault.files.get("projects/roof-repair.md") ?? "";
    for (const field of ["outcome", "milestone", "next action", "dri"]) {
      assert.doesNotMatch(content, new RegExp(field, "i"));
    }
  });

  test("returns the new project, flagged as needing structure", async () => {
    const { projects } = service();
    const outcome = await projects.create("Roof repair");
    assert.ok(outcome.ok);
    assert.equal(outcome.project.title, "Roof repair");
    assert.equal(outcome.project.status, "active");
  });

  test("keeps the title verbatim while slugging the filename", async () => {
    const { vault, projects } = service();
    await projects.create("Q3  Planning & Review");
    const content = vault.files.get("projects/q3-planning-review.md");
    assert.match(content ?? "", /^# Q3 {2}Planning & Review$/m);
  });

  describe("a title that already exists", () => {
    test("returns the existing project rather than creating a second", async () => {
      const { vault, projects } = service({ "projects/roof-repair.md": "# Roof repair\n\nstatus: parked\n" });
      const outcome = await projects.create("Roof repair");
      assert.ok(outcome.ok);
      assert.equal(outcome.project.status, "parked", "should be the existing project");
      assert.equal(vault.files.size, 1);
      assert.deepEqual(vault.writeLog, [], "matching an existing project must not write");
    });

    test("matches ignoring case and surrounding whitespace", async () => {
      const { vault, projects } = service({ "projects/roof-repair.md": "# Roof repair\n\nstatus: active\n" });
      await projects.create("  ROOF   repair  ");
      assert.equal(vault.files.size, 1);
    });
  });

  describe("a title that is not usable", () => {
    for (const title of ["", "   ", "\t\n"]) {
      test(`refuses ${JSON.stringify(title)} and creates nothing`, async () => {
        const { vault, projects } = service();
        const outcome = await projects.create(title);
        assert.equal(outcome.ok, false);
        assert.equal(outcome.ok === false && outcome.reason, "empty-title");
        assert.equal(vault.files.size, 0);
      });
    }

    test("refuses a title that slugs to nothing", async () => {
      // "!!!" has no alphanumerics, so there is no filename to derive.
      const { vault, projects } = service();
      const outcome = await projects.create("!!!");
      assert.equal(outcome.ok, false);
      assert.equal(vault.files.size, 0);
    });
  });

  test("titles that differ only by punctuation resolve to one project", async () => {
    // Slug equality is the duplicate test, exactly as Feature 2 defined it
    // (FR-012 there): "Roof repair" and "Roof repair!" are one project, not
    // two files one keystroke apart. Loose matching, faithful storage.
    const { vault, projects } = service();
    await projects.create("Roof repair");
    const second = await projects.create("Roof repair!");

    assert.ok(second.ok);
    assert.equal(vault.files.size, 1);
    assert.equal(second.project.slug, "roof-repair");
    assert.equal(second.project.title, "Roof repair", "the first title is kept, not overwritten");
  });
});
