import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * Newest first, with a tie-break made of data.
 *
 * Two things finished on the same day have no recorded order, so one is
 * invented — but from the slug and the milestone index, both of which are part
 * of a record's identity. Nothing depends on read order, filesystem order, or
 * insertion order, which is what makes the same fixture render to the same
 * bytes on any machine (FR-008, SC-003, research R8).
 */

const SHARED_DATE = {
  "projects/zebra.md": projectFile({
    slug: "zebra",
    title: "Zebra",
    milestones: [
      { text: "z-second", done: true, completedOn: "2026-06-10" },
      { text: "z-first", done: true, completedOn: "2026-06-10" },
    ],
  }),
  "projects/apple.md": projectFile({
    slug: "apple",
    title: "Apple",
    status: "done",
    completed: "2026-06-10",
    milestones: [{ text: "a-only", done: true, completedOn: "2026-06-10" }],
  }),
};

describe("ordering", () => {
  test("dates descending", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        milestones: [
          { text: "middle", done: true, completedOn: "2026-06-15" },
          { text: "oldest", done: true, completedOn: "2026-01-02" },
          { text: "newest", done: true, completedOn: "2026-11-30" },
        ],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions.map((c) => c.text), ["newest", "middle", "oldest"]);
  });

  test("entries sharing a date break by slug, then kind, then index", async () => {
    const { service } = serviceFor(SHARED_DATE);
    const r = await readOk(service, range("2026-06-10", "2026-06-10"));

    assert.deepEqual(
      r.completions.map((c) => `${c.projectSlug}/${c.kind}/${c.text}`),
      [
        // apple before zebra; within apple, the project completion before its
        // milestone; within zebra, file order by index.
        "apple/project/Apple",
        "apple/milestone/a-only",
        "zebra/milestone/z-second",
        "zebra/milestone/z-first",
      ],
    );
  });

  test("the order is identical across repeated reads of unchanged data", async () => {
    const { service } = serviceFor(SHARED_DATE);
    const runs = await Promise.all([
      readOk(service, range("2026-01-01", "2026-12-31")),
      readOk(service, range("2026-01-01", "2026-12-31")),
      readOk(service, range("2026-01-01", "2026-12-31")),
    ]);

    const [first] = runs;
    for (const run of runs) {
      assert.deepEqual(run.completions, first?.completions);
    }
  });

  test("the order does not depend on which order the files were listed in", async () => {
    // Same content, opposite insertion order. If anything leaned on read order,
    // these two would disagree.
    const forwards = serviceFor(SHARED_DATE);
    const backwards = serviceFor(
      Object.fromEntries(Object.entries(SHARED_DATE).reverse()) as Record<string, string>,
    );

    const a = await readOk(forwards.service, range("2026-06-10", "2026-06-10"));
    const b = await readOk(backwards.service, range("2026-06-10", "2026-06-10"));
    assert.deepEqual(a.completions, b.completions);
  });
});
