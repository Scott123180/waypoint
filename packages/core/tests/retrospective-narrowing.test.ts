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
  /**
   * **Amended 2026-08-16 (convergence T111).** This test used to assert the
   * opposite — "a slug with no file yields an empty reading, not a refusal
   * (FR-034)" — and asserted `history === null` and `projectTitle === null`
   * alongside it. Those two nulls *were* the defect, asserted as though they
   * were the design: the outcome and narrative sections are still omitted with
   * their project-scoping reasons on that path, so the report behaved as
   * narrowed while naming no project and carrying no history, and exported as a
   * document claiming to cover everything (FR-046, SC-014a).
   *
   * FR-034 governs a narrowed *project* with no completions in range — a real
   * one, reported plainly, which the test below still covers. A slug with no
   * file behind it is a different thing and is refused, as FR-003 refuses an
   * inverted range.
   */
  test("a slug with no file is refused rather than answered emptily", async () => {
    const { service } = serviceFor(VAULT);
    const result = await service.read(range("2026-01-01", "2026-12-31", "no-such-project"));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "unknown-project");
    assert.match(result.message, /no-such-project/);
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

/**
 * Narrowing to a project that is not there (006 FR-046, SC-014a).
 *
 * Reachable in the ordinary way: the picker is filled when the window opens,
 * and a project deleted in vim between then and pressing Show is a slug with no
 * file behind it.
 *
 * The failure it replaces was quiet. The sections that have no meaning under a
 * filter were still omitted with their project-scoping reasons — so the report
 * behaved as narrowed — while the header printed no `Project:` line and no
 * history section appeared, so it read as unnarrowed. An export of that is a
 * document claiming to cover everything while showing one project's worth of
 * nothing.
 *
 * Refusing is the same answer FR-003 gives an inverted range: name the problem,
 * show no report. Inventing a title from the slug, or printing an empty history
 * for a project that does not exist, would both be the reader deciding what the
 * files should have said.
 */
describe("narrowing to a project that does not exist", () => {
  test("is refused, naming the project rather than showing an empty report", async () => {
    const { service } = serviceFor(VAULT);
    const result = await service.read(range("2026-01-01", "2026-12-31", "shed"));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "unknown-project");
    assert.match(result.message, /shed/, "the refusal names what was asked for");
  });

  test("is distinct from a project that exists and has nothing in range", async () => {
    const { service } = serviceFor(VAULT);
    // `roof` is real; this range simply contains none of its completions. That
    // is a report saying so plainly, not a refusal (FR-034).
    const r = await readOk(service, range("2020-01-01", "2020-12-31", "roof"));

    assert.equal(r.completions.length, 0);
    assert.equal(r.projectTitle, "Roof repair", "a real narrowing still names itself");
    assert.ok(r.history, "and still carries a history section (SC-014a)");
    assert.match(renderReport(r), /Nothing was completed in this range\./);
  });

  test("every narrowing that produces a report states which project", async () => {
    const { service } = serviceFor(VAULT);
    for (const slug of ["roof", "fence"]) {
      const r = await readOk(service, range("2026-01-01", "2026-12-31", slug));
      assert.ok(r.projectTitle, `${slug} names itself`);
      assert.match(renderReport(r), /^Project: /m);
      assert.ok(r.history, "a narrowed report always has a history section (SC-014a)");
    }
  });
});
