import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

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

  /**
   * **Amended 2026-08-16 (convergence T111).** This test kept its name and
   * inverted its meaning. It narrowed to `nothing-here` — a slug with no file —
   * and then asserted `doesNotMatch(/^Project: /m)`: the name promised the
   * export names the project it found nothing for, which is FR-046, and the
   * assertion required that it must not. What it actually pinned was the defect
   * convergence found, where a narrowed report printed no `Project:` line while
   * still omitting the outcome and narrative sections *because* it was narrowed.
   *
   * Narrowing to a slug with no file is now refused (see
   * `retrospective-narrowing.test.ts`), so this tests what its name always said:
   * a real project, nothing of it in range, named anyway.
   */
  test("an empty narrowed retrospective names the project it found nothing for", async () => {
    const { service } = serviceFor({
      "projects/shed.md": projectFile({ slug: "shed", title: "Shed rebuild" }),
    });
    const r = await readOk(service, range("2026-01-01", "2026-03-31", "shed"));
    const exported = renderReport(r);

    assert.match(exported, /Nothing was completed in this range\./);
    // Self-describing once separated from the application: an export that does
    // not say what it was filtered to is a document overstating its own scope.
    assert.match(exported, /^Project: Shed rebuild$/m);
  });
});
