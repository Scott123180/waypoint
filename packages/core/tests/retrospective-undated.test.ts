import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * Undated, never guessed.
 *
 * Three states, because the data has three: a date, no date at all, and
 * something written where the date goes that is not a date. Folding the third
 * into the second would lose the text the user needs to find it in an editor
 * (FR-016, FR-018).
 *
 * The third state is the one that bites. `parseMilestone`'s date tail is
 * `/(\d{4}-\d{2}-\d{2})$/`, so `— done 2026-13-45` reaches `completedOn`
 * intact and satisfies every shape check in the repo. Compared as text it sorts
 * after every real December date and lands in any range reaching 2026.
 */

describe("a record marked done with no date", () => {
  test("is undated, and is not placed in the range", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Estimate approved", done: true }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions, []);
    assert.equal(r.undated.length, 1);
    assert.equal(r.undated[0]?.text, "Estimate approved");
    assert.equal(r.undated[0]?.completedOn, null);
    assert.equal(r.undated[0]?.rawDate, null, "nothing was written, so there is nothing to show");
  });

  test("a project marked done with no date is undated, not absent", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({ slug: "fence", title: "Fix the fence", status: "done" }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions, []);
    assert.deepEqual(
      r.undated.map((c) => [c.kind, c.text]),
      [["project", "Fix the fence"]],
    );
  });

  test("an undated record appears in no range, however wide", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        milestones: [{ text: "Estimate approved", done: true }],
      }),
    });

    for (const [from, to] of [
      ["1900-01-01", "2999-12-31"],
      ["2026-06-01", "2026-06-02"],
    ] as const) {
      const r = await readOk(service, range(from, to));
      assert.deepEqual(r.completions, [], `${from}..${to}`);
      assert.equal(r.undated.length, 1);
    }
  });
});

describe("a date that is not a date", () => {
  test("is kept verbatim in rawDate and never treated as a date", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        milestones: [{ text: "Legal review closed", done: true, completedOn: "2026-13-45" }],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(r.completions, [], "it must not land in a range it merely looks like it fits");
    assert.equal(r.undated[0]?.rawDate, "2026-13-45");
    assert.equal(r.undated[0]?.completedOn, null, "no consumer may mistake it for a date");
  });

  test("a project whose completed field is prose", async () => {
    const { service } = serviceFor({
      "projects/fence.md": projectFile({
        slug: "fence",
        title: "Fix the fence",
        status: "done",
        completed: "sometime last spring",
      }),
    });

    const r = await readOk(service, range("2020-01-01", "2030-12-31"));
    assert.deepEqual(r.completions, []);
    assert.equal(r.undated[0]?.rawDate, "sometime last spring");
  });

  test("nothing is corrected — the file is never rewritten to make it parse", async () => {
    const content = projectFile({
      slug: "roof",
      milestones: [{ text: "Legal review closed", done: true, completedOn: "2026-13-45" }],
    });
    const { service, vault } = serviceFor({ "projects/roof.md": content });

    await readOk(service, range("2026-01-01", "2026-12-31"));
    // The Proxy in retro-fakes would have thrown on a write; this asserts the
    // content is still what it was, for a reader who does not know that.
    assert.equal(await vault.read("projects/roof.md"), content);
  });
});

describe("undated entries are ordered too", () => {
  test("stably, by the same tie-break minus the date", async () => {
    const { service } = serviceFor({
      "projects/a.md": projectFile({
        slug: "a",
        milestones: [
          { text: "second", done: true },
          { text: "first", done: true },
        ],
      }),
      "projects/b.md": projectFile({
        slug: "b",
        milestones: [{ text: "third", done: true }],
      }),
    });

    const first = await readOk(service, range("2026-01-01", "2026-12-31"));
    const again = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.deepEqual(
      first.undated.map((c) => c.text),
      ["second", "first", "third"],
    );
    assert.deepEqual(first.undated, again.undated);
  });
});
