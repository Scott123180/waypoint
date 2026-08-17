import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * One project at a time.
 *
 * The sections a project does not have are omitted *with a stated reason*, not
 * shown empty. Neither a weekly outcome nor a week's note carries a project
 * association anywhere in the data, so showing them unfiltered would imply an
 * association that does not exist, and showing an empty list would imply the
 * user committed to nothing. Saying why is the only honest option, and the
 * words are core's (FR-032, FR-033).
 */

const VAULT = {
  "projects/roof.md": projectFile({
    slug: "roof",
    title: "Roof repair",
    status: "done",
    completed: "2026-06-30",
    milestones: [{ text: "Estimate approved", done: true, completedOn: "2026-06-10" }],
    ledger: ["- 2026-01-02 status created → active"],
  }),
  "projects/fence.md": projectFile({
    slug: "fence",
    title: "Fix the fence",
    milestones: [{ text: "Posts in", done: true, completedOn: "2026-06-11" }],
  }),
  "top-three.md": topThreeFile([
    { week: "2026-W24", outcomes: [{ text: "Ship it", done: true, completedOn: "2026-06-11" }] },
  ]),
  "log/2026-W24.md": logFile({ week: "2026-W24", note: "A fine week." }),
};

describe("filtering", () => {
  test("only the named project's completions appear", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    assert.deepEqual(
      r.completions.map((c) => [c.projectSlug, c.text]),
      [
        ["roof", "Roof repair"],
        ["roof", "Estimate approved"],
      ],
    );
  });

  test("the project's title is carried for the header", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    assert.equal(r.projectTitle, "Roof repair");
    assert.match(renderReport(r), /^Project: Roof repair$/m);
  });
});

describe("sections a project does not have", () => {
  test("outcomes are omitted with a stated reason, not shown empty", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    assert.equal(r.outcomes.applies, false);
    if (r.outcomes.applies) return;
    assert.match(r.outcomes.reason, /not recorded against a project/);
  });

  test("the narrative is omitted for the same kind of reason", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    assert.equal(r.narrative.applies, false);
    if (r.narrative.applies) return;
    assert.match(r.narrative.reason, /a note belongs to a week/);
  });

  test("the report prints the reason and no count", async () => {
    const { service } = serviceFor(VAULT);
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-12-31", "roof")));

    assert.match(text, /^## Weekly outcomes$/m, "no count, because nothing was counted");
    assert.match(text, /^## Weekly notes$/m);
    assert.doesNotMatch(text, /^## Weekly outcomes \(\d+\)$/m);
    assert.match(text, /Not shown: outcomes are committed to for a week/);
    assert.match(text, /Not shown: a note belongs to a week/);
  });

  test("there is no array a client could render as an empty list", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    // The union is the guarantee: `value` does not exist on the omitted branch.
    assert.ok(!("value" in r.outcomes));
    assert.ok(!("value" in r.narrative));
  });
});

describe("edges", () => {
  test("a slug with no file yields an empty reading, not a refusal (FR-034)", async () => {
    const { service } = serviceFor(VAULT);
    const result = await service.read(range("2026-01-01", "2026-12-31", "no-such-project"));

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.retrospective.completions, []);
    assert.equal(result.retrospective.history, null);
    assert.equal(result.retrospective.projectTitle, null);
  });

  test("a project with no completions in range says so plainly", async () => {
    const { service } = serviceFor(VAULT);
    const text = renderReport(await readOk(service, range("2020-01-01", "2020-12-31", "roof")));
    assert.match(text, /^## Completions \(0\)$/m);
    assert.match(text, /Nothing was completed in this range\./);
  });

  test("clearing the filter reproduces the unnarrowed report byte-identically", async () => {
    const { service } = serviceFor(VAULT);
    const before = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));
    await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    const after = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    assert.equal(after, before);
  });
});

describe("history is scoped to the filter (FR-036a, SC-014a)", () => {
  test("present when narrowed", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    assert.ok(r.history);
    assert.match(renderReport(r), /^## Project history \(1\)$/m);
  });

  test("absent from every unnarrowed reading", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));

    assert.equal(r.history, null);
    assert.doesNotMatch(renderReport(r), /## Project history/);
  });
});
