import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * SC-001: a full year over a 100-project vault, opened to first entry in under
 * ten seconds (convergence T112).
 *
 * **What this measures, and what it does not.** The criterion is written about
 * what the user experiences — opening the window until the first entry is on
 * screen — and the window's paint is not reachable from a core test. What is
 * measured here is the part that scales with the vault and could plausibly
 * spend the budget: reading every project file, selecting and ordering the
 * completions, enumerating the weeks, and rendering the whole report. Electron's
 * window creation and paint are effectively constant against vault size, and
 * the E2E suite already exercises them.
 *
 * The budget asserted is deliberately far tighter than ten seconds. A core read
 * that took even one second over this fixture would be a defect worth failing
 * on, and asserting the literal SC-001 number would pass through almost any
 * regression — which is the failure mode a performance test exists to catch.
 * [plan.md](../../../specs/006-retrospective-view/plan.md) called SC-001 a
 * quickstart smoke check rather than a unit test; this does not replace the
 * human look at the window, it bounds the half of it that can rot silently.
 *
 * Treat a CI failure as a regression signal, not an absolute measurement — the
 * same standing this repo already gives `inbox-parse-perf.test.ts`.
 */

/** 100 projects, ~20 completions each, four years, 52 weeks of outcomes. */
function bigVault(): Record<string, string> {
  const files: Record<string, string> = {};

  for (let p = 0; p < 100; p += 1) {
    const slug = `project-${String(p).padStart(3, "0")}`;
    const milestones = [];
    for (let m = 0; m < 20; m += 1) {
      const year = 2022 + ((p + m) % 4);
      const month = String(1 + ((p * 3 + m) % 12)).padStart(2, "0");
      const day = String(1 + ((p + m * 7) % 28)).padStart(2, "0");
      milestones.push({ text: `${slug} step ${m}`, done: true, completedOn: `${year}-${month}-${day}` });
    }
    files[`projects/${slug}.md`] = projectFile({ slug, title: `Project ${p}`, milestones });
  }

  const weeks = [];
  for (let w = 1; w <= 52; w += 1) {
    weeks.push({
      week: `2025-W${String(w).padStart(2, "0")}`,
      outcomes: [{ text: `outcome ${w}`, done: true, completedOn: "2025-06-15" }],
    });
  }
  files["top-three.md"] = topThreeFile(weeks);

  for (let w = 1; w <= 52; w += 1) {
    const id = `2025-W${String(w).padStart(2, "0")}`;
    files[`log/${id}.md`] = logFile({ week: id, note: `week ${w}` });
  }

  return files;
}

const BUDGET_MS = 1000;

describe("a year over a hundred projects (SC-001)", () => {
  test(`reads and renders in under ${BUDGET_MS}ms`, async () => {
    const { service } = serviceFor(bigVault());
    const query = range("2025-01-01", "2025-12-31");

    const started = process.hrtime.bigint();
    const r = await readOk(service, query);
    const text = renderReport(r);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // The work was real: an empty result would make the timing meaningless.
    assert.ok(r.completions.length > 0, "the fixture produced completions");
    assert.ok(text.length > 0);
    assert.ok(
      elapsedMs < BUDGET_MS,
      `read and render took ${elapsedMs.toFixed(1)}ms, budget is ${BUDGET_MS}ms ` +
        `(SC-001 allows 10,000ms to first entry, including the window paint this cannot see)`,
    );
  });

  test("a four-year range stays inside the same budget", async () => {
    const { service } = serviceFor(bigVault());

    const started = process.hrtime.bigint();
    const r = await readOk(service, range("2022-01-01", "2025-12-31"));
    renderReport(r);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // The "since I joined" case. Nothing is capped, so this is the whole result
    // (FR-006a) — the point being that completeness is not what costs the time.
    assert.ok(r.completions.length > 1000, `four years produced ${r.completions.length} completions`);
    assert.ok(
      elapsedMs < BUDGET_MS,
      `read and render took ${elapsedMs.toFixed(1)}ms, budget is ${BUDGET_MS}ms`,
    );
  });
});
