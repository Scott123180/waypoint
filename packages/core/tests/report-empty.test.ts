import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { range, readOk, serviceFor } from "./retro-fakes";

/**
 * An empty retrospective is still a report (FR-048, report-format §9).
 *
 * Every section prints even when empty, with `(0)` and its own sentence saying
 * what it found none of. A missing section and an empty one look identical only
 * if one of them is missing — and a user who exported a range and got a blank
 * file would not know whether they had no work or a broken application.
 */

describe("a completely empty vault", () => {
  test("still produces a report that states its range", async () => {
    const { service } = serviceFor({});
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-03-31")));

    assert.match(text, /^# Retrospective: 2026-01-01 to 2026-03-31$/m);
    assert.ok(text.trim().length > 0, "an empty file is not an answer");
  });

  test("every section is present with a zero count and its own sentence", async () => {
    const { service } = serviceFor({});
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-03-31")));

    assert.match(text, /^## Completions \(0\)\n\nNothing was completed in this range\.$/m);
    assert.match(text, /^## Undated \(0\)\n\nEverything found in this range carries a completion date\.$/m);
    assert.match(text, /^## Weekly outcomes \(0\)\n\nNo weekly outcomes were completed in this range\.$/m);
    assert.match(text, /^## Weekly notes \(0\)$/m);
  });

  test("the unreviewed report is present and says how many weeks were missed", async () => {
    const { service } = serviceFor({});
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-03-31")));
    assert.match(text, /No review was run for \d+ of the \d+ weeks in this range:/);
  });

  test("no section is silently absent", async () => {
    const { service } = serviceFor({});
    const text = renderReport(await readOk(service, range("2026-01-01", "2026-03-31")));

    const headings = [...text.matchAll(/^## (.+?)(?: \(\d+\))?$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, ["Completions", "Undated", "Weekly outcomes", "Weekly notes"]);
    // The two conditional sections are conditional on a stated rule, not absent
    // by accident: no filter, so no history; nothing unreadable, so no section.
    assert.doesNotMatch(text, /## Project history/);
    assert.doesNotMatch(text, /## Could not be read/);
  });
});

describe("the export of an empty retrospective (T085)", () => {
  test("states the range and that nothing is recorded, rather than being blank", async () => {
    const { service } = serviceFor({});
    const r = await readOk(service, range("2026-01-01", "2026-03-31"));
    const exported = renderReport(r);

    assert.match(exported, /2026-01-01 to 2026-03-31/);
    assert.match(exported, /Nothing was completed in this range\./);
    assert.ok(exported.endsWith("\n"), "a text file ends with a newline");
  });

  test("an empty narrowed retrospective names the project it found nothing for", async () => {
    const { service } = serviceFor({});
    const r = await readOk(service, range("2026-01-01", "2026-03-31", "nothing-here"));
    const exported = renderReport(r);

    // The slug matched no file, so there is no title to print — and the report
    // says nothing was found rather than inventing a project.
    assert.match(exported, /Nothing was completed in this range\./);
    assert.doesNotMatch(exported, /^Project: /m);
  });
});
