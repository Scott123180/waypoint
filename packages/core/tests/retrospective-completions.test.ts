import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * What a completion is, and what it carries.
 *
 * Two kinds — a milestone and a project — from one pass over one parsed file,
 * because both live in it. A milestone names the project it belonged to
 * (FR-007), and that project is named as it *currently* reads, because the file
 * is the record and there is no earlier version to show.
 */

describe("milestone completions", () => {
  test("each names the project it belongs to", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({
        slug: "fence",
        title: "Fix the fence",
        milestones: [{ text: "Posts concreted in", done: true, completedOn: "2026-06-10" }],
      }),
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Estimate approved", done: true, completedOn: "2026-06-11" }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(
      r.completions.map((c) => [c.projectTitle, c.text]),
      [
        ["Roof repair", "Estimate approved"],
        ["Fix the fence", "Posts concreted in"],
      ],
    );
  });

  test("a project renamed after the fact shows its current title", async () => {
    // There is no record of the old name, and this feature does not create one.
    const { service } = serviceFor({
      "projects/fence.md": projectFile({
        slug: "fence",
        title: "Rebuild the fence (renamed)",
        milestones: [{ text: "Posts concreted in", done: true, completedOn: "2026-06-10" }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.equal(r.completions[0]?.projectTitle, "Rebuild the fence (renamed)");
    assert.equal(r.completions[0]?.projectSlug, "fence");
  });

  test("milestone text is verbatim, never reworded or truncated", async () => {
    const text = "Signed off by @Priya — including the § on drainage — and paid";
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        milestones: [{ text, done: true, completedOn: "2026-06-10" }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.equal(r.completions[0]?.text, text);
  });

  test("milestones not marked done never appear", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        milestones: [
          { text: "open", done: false },
          { text: "open with a date somehow", done: false, completedOn: "2026-06-10" },
          { text: "closed", done: true, completedOn: "2026-06-10" },
        ],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions.map((c) => c.text), ["closed"]);
    assert.deepEqual(r.undated, []);
  });
});

describe("project completions", () => {
  test("a completed project appears as its own kind, distinct from a milestone", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({
        slug: "fence",
        title: "Fix the fence",
        status: "done",
        completed: "2026-06-30",
        milestones: [{ text: "Posts concreted in", done: true, completedOn: "2026-06-10" }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(
      r.completions.map((c) => [c.kind, c.completedOn]),
      [
        ["project", "2026-06-30"],
        ["milestone", "2026-06-10"],
      ],
    );
  });

  test("a project completion carries its own title as its text", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({
        slug: "fence",
        title: "Fix the fence",
        status: "done",
        completed: "2026-06-30",
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.equal(r.completions[0]?.text, "Fix the fence");
    assert.equal(r.completions[0]?.projectSlug, "fence");
  });

  test("an unfinished project contributes no project completion", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({ slug: "fence", status: "active" }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions, []);
    assert.deepEqual(r.undated, []);
  });
});
