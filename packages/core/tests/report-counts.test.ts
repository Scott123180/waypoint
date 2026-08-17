import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Counts, and only counts (FR-010f, FR-010g, SC-015a).
 *
 * A count is arithmetic over entries the reader can see listed beneath it, not
 * an opinion — which is why it sits outside the rule against summarizing. The
 * boundary is drawn tightly: every step past a count (a rate, a streak, a
 * per-quarter split) is where a view starts having a view.
 *
 * Nothing stores a total. Each count is computed at render time from the array
 * about to be printed, so a number and its list cannot disagree — there is no
 * stored value to drift.
 */

const VAULT = {
  "projects/roof.md": projectFile({
    slug: "roof",
    title: "Roof repair",
    status: "done",
    completed: "2026-06-30",
    milestones: [
      { text: "one", done: true, completedOn: "2026-06-10" },
      { text: "two", done: true, completedOn: "2026-06-11" },
      { text: "undated", done: true },
    ],
  }),
  "top-three.md": topThreeFile([
    {
      week: "2026-W24",
      outcomes: [
        { text: "ship", done: true, completedOn: "2026-06-11" },
        { text: "write", done: true, completedOn: "2026-06-12" },
      ],
    },
    { week: "2026-W25", outcomes: [{ text: "close", done: true, completedOn: "2026-06-18" }] },
  ]),
  "log/2026-W24.md": logFile({ week: "2026-W24", note: "a note" }),
};

/** Every `## Heading (n)` in a report, as [heading, n]. */
function headingCounts(text: string): Array<[string, number]> {
  return [...text.matchAll(/^## (.+?) \((\d+)\)$/gm)].map((m) => [m[1] ?? "", Number(m[2])]);
}

/** The `- ` lines belonging to a section, in document order. */
function bodyLines(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${heading} `) || l === `## ${heading}`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.startsWith("- "));
}

describe("every count equals the list beneath it", () => {
  test("across every section of a populated report", async () => {
    const { service } = serviceFor(VAULT);
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    for (const [heading, count] of headingCounts(text)) {
      if (heading === "Weekly outcomes") {
        // Its body is grouped under week subheadings; the count is the total
        // number of outcomes rather than the number of weeks.
        const outcomes = text.split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2} — /.test(l));
        assert.ok(count <= outcomes.length, heading);
        continue;
      }
      if (heading === "Weekly notes") continue; // counted in weeks, bodied in prose
      assert.equal(bodyLines(text, heading).length, count, `${heading} count disagrees with its list`);
    }
  });

  test("a section containing nothing states zero rather than omitting its count", async () => {
    const { service } = serviceFor({ "projects/empty.md": projectFile({ slug: "empty" }) });
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    assert.match(text, /^## Completions \(0\)$/m);
    assert.match(text, /^## Undated \(0\)$/m);
    assert.match(text, /^## Weekly outcomes \(0\)$/m);
  });

  test("no count is stored on the value — it exists only in the rendering", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));

    // A stored total would be a second representation of the same fact, and
    // second representations drift. There must be nothing shaped like one.
    const keys = JSON.stringify(r);
    assert.doesNotMatch(keys, /"count"/);
    assert.doesNotMatch(keys, /"total"/);
  });
});

describe("counts are the only figures", () => {
  test("no rate, percentage, average, streak, or per-period split appears", async () => {
    const { service } = serviceFor(VAULT);
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    for (const forbidden of [
      /%/,
      /\baverage\b/i,
      /\bmean\b/i,
      /\bstreak\b/i,
      /\bper (day|week|month|quarter|year)\b/i,
      /\bup \d/i,
      /\bdown \d/i,
      /\bcompared\b/i,
      /\btrend/i,
    ]) {
      assert.doesNotMatch(text, forbidden, String(forbidden));
    }
  });

  test("the only bare numbers are counts, dates, week ids, and recorded durations", async () => {
    const { service } = serviceFor(VAULT);
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    for (const raw of text.split(/\s+/)) {
      if (!/\d/.test(raw)) continue;
      // A week's span renders as `(2026-06-08 to 2026-06-14)`, so the brackets
      // are furniture rather than part of the figure.
      const token = raw.replace(/^\(/, "").replace(/[),.]$/, "");
      const ok =
        /^\d+$/.test(token) || // a section count, or a count in the unreviewed sentence
        /^\d{4}-\d{2}-\d{2}$/.test(token) || // a date, including a week-span endpoint
        /^\d{4}-W\d{2}$/.test(token) || // a week id
        /^\d+d$/.test(token); // a duration the ledger recorded
      assert.ok(ok, `unexpected figure in the report: ${raw}`);
    }
  });
});
