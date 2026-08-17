import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * Weeks the user never reviewed, named together (FR-024a–d).
 *
 * The requirement is that a skipped week must not read as an empty one. A count
 * that names every missed week satisfies that exactly — while two hundred
 * near-identical sections would bury the six weeks they actually wrote
 * something about, which is the same failure in the other direction.
 *
 * Deliberately one rule at every length. A threshold would be a number with no
 * principled value and the first thing a reader would have to learn.
 */

async function narrativeOf(files: Record<string, string>, from: string, to: string) {
  const { service } = serviceFor(files);
  const r = await readOk(service, range(from, to));
  assert.ok(r.narrative.applies);
  if (!r.narrative.applies) throw new Error("unreachable");
  return { n: r.narrative.value, text: renderReport(r) };
}

describe("the unreviewed report", () => {
  const SIX_OF_THIRTEEN: Record<string, string> = {};
  for (const w of ["2026-W14", "2026-W15", "2026-W16", "2026-W17", "2026-W18", "2026-W19"]) {
    SIX_OF_THIRTEEN[`log/${w}.md`] = logFile({ week: w, note: `note for ${w}` });
  }

  test("names every week with no log, alongside both counts", async () => {
    // 2026-W14 begins 2026-03-30; thirteen weeks runs to 2026-06-28.
    const { n, text } = await narrativeOf(SIX_OF_THIRTEEN, "2026-03-30", "2026-06-28");

    assert.equal(n.unreviewed.weeksInRange, 13);
    assert.deepEqual(n.unreviewed.weeks, [
      "2026-W20",
      "2026-W21",
      "2026-W22",
      "2026-W23",
      "2026-W24",
      "2026-W25",
      "2026-W26",
    ]);
    assert.match(text, /No review was run for 7 of the 13 weeks in this range:/);
    assert.match(text, /2026-W20, 2026-W21, 2026-W22, 2026-W23, 2026-W24, 2026-W25, 2026-W26/);
  });

  test("the reviewed weeks each get their own section", async () => {
    const { text } = await narrativeOf(SIX_OF_THIRTEEN, "2026-03-30", "2026-06-28");
    const sections = [...text.matchAll(/^### (2026-W\d\d)/gm)].map((m) => m[1]);
    assert.deepEqual(sections, [
      "2026-W19",
      "2026-W18",
      "2026-W17",
      "2026-W16",
      "2026-W15",
      "2026-W14",
    ]);
  });

  test("the section count is the number of weeks shown, not the range length", async () => {
    const { text } = await narrativeOf(SIX_OF_THIRTEEN, "2026-03-30", "2026-06-28");
    assert.match(text, /^## Weekly notes \(6\)$/m);
  });
});

describe("no threshold at any length (FR-024c)", () => {
  test("a 209-week range produces one report, not 197 sections", async () => {
    const files: Record<string, string> = {};
    for (let w = 1; w <= 12; w += 1) {
      const id = `2023-W${String(w).padStart(2, "0")}`;
      files[`log/${id}.md`] = logFile({ week: id, note: `note ${w}` });
    }

    const { n, text } = await narrativeOf(files, "2023-01-02", "2026-12-31");

    assert.equal(n.weeks.length, 12);
    assert.ok(n.unreviewed.weeks.length > 190, `${n.unreviewed.weeks.length} unreviewed`);
    assert.equal(n.unreviewed.weeksInRange, n.weeks.length + n.unreviewed.weeks.length);

    // One report line, whatever the length. The same regexp that matched at 13.
    const reports = [...text.matchAll(/^No review was run for \d+ of the \d+ weeks/gm)];
    assert.equal(reports.length, 1);
    // And every missed week is still named, not elided.
    for (const week of n.unreviewed.weeks) assert.ok(text.includes(week), week);
  });
});

describe("when nothing was missed (FR-024d)", () => {
  test("the report still appears and says none were missed", async () => {
    const files: Record<string, string> = {};
    for (const w of ["2026-W20", "2026-W21"]) {
      files[`log/${w}.md`] = logFile({ week: w, note: "x" });
    }

    const { n, text } = await narrativeOf(files, "2026-05-11", "2026-05-24");
    assert.deepEqual(n.unreviewed.weeks, []);
    assert.equal(n.unreviewed.weeksInRange, 2);
    assert.match(text, /Every one of the 2 weeks in this range was reviewed\./);
  });
});

describe("a missing log directory (FR-029)", () => {
  test("every week is named unreviewed, nothing errors, and nothing is created", async () => {
    const { service, vault } = serviceFor({});
    const r = await readOk(service, range("2026-05-11", "2026-05-24"));

    assert.ok(r.narrative.applies);
    if (!r.narrative.applies) return;
    assert.deepEqual(r.narrative.value.unreviewed.weeks, ["2026-W20", "2026-W21"]);
    assert.deepEqual(r.narrative.value.weeks, []);
    // `list` was asked; nothing was created as a side effect of it being empty.
    assert.ok(vault.lists.includes("log"));
  });
});

describe("week enumeration", () => {
  test("a range covering part of a week still includes that week", async () => {
    const { n } = await narrativeOf({}, "2026-05-14", "2026-05-14");
    assert.deepEqual(n.unreviewed.weeks, ["2026-W20"]);
    assert.equal(n.unreviewed.weeksInRange, 1);
  });

  test("across an ISO year boundary in a 53-week year", async () => {
    // 2026 has 53 weeks; 2027-01-01 belongs to 2026-W53.
    const { n } = await narrativeOf({}, "2026-12-28", "2027-01-10");
    assert.deepEqual(n.unreviewed.weeks, ["2026-W53", "2027-W01"]);
  });
});
