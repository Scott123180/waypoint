import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * The whole result, always (FR-006a, SC-022).
 *
 * "What did I do this year" answered with the first hundred things is a wrong
 * answer, not a shorter one — and the user named "since I joined" as a range
 * they want. Nothing is capped, sampled, truncated, or held behind a page.
 */

/** 2,000 dated completions across four years and 100 projects. */
function scaleVault(): { files: Record<string, string>; total: number } {
  const files: Record<string, string> = {};
  let total = 0;

  for (let p = 0; p < 100; p += 1) {
    const slug = `project-${String(p).padStart(3, "0")}`;
    const milestones = [];
    for (let m = 0; m < 20; m += 1) {
      const year = 2022 + ((p + m) % 4);
      const month = String(1 + ((p * 3 + m) % 12)).padStart(2, "0");
      const day = String(1 + ((p + m * 7) % 28)).padStart(2, "0");
      milestones.push({ text: `${slug} step ${m}`, done: true, completedOn: `${year}-${month}-${day}` });
      total += 1;
    }
    files[`projects/${slug}.md`] = projectFile({ slug, title: `Project ${p}`, milestones });
  }

  return { files, total };
}

describe("a four-year range returns everything in it", () => {
  test("every completion is present — none capped, sampled, or truncated", async () => {
    const { files, total } = scaleVault();
    const { service } = serviceFor(files);

    const r = await readOk(service, range("2022-01-01", "2025-12-31"));
    assert.equal(r.completions.length, total, `expected all ${total} completions`);
    assert.equal(total, 2000, "the fixture is the one the criterion names");
  });

  test("the export carries the same total", async () => {
    const { files, total } = scaleVault();
    const { service } = serviceFor(files);

    const r = await readOk(service, range("2022-01-01", "2025-12-31"));
    const lines = renderReport(r)
      .split("\n")
      .filter((l) => l.startsWith("- 20"));
    assert.equal(lines.length, total);
  });

  test("the oldest entry is present, not merely reachable", async () => {
    const { files } = scaleVault();
    const { service } = serviceFor(files);

    const r = await readOk(service, range("2022-01-01", "2025-12-31"));
    const dates = r.completions.map((c) => c.completedOn ?? "");
    const oldest = [...dates].sort()[0];
    assert.equal(dates[dates.length - 1], oldest, "the last entry is the oldest, so nothing was cut");
    assert.ok(oldest?.startsWith("2022"), "the far end of the range survived");
  });

  test("narrowing the range narrows the result, and only that", async () => {
    const { files } = scaleVault();
    const { service } = serviceFor(files);

    const wide = await readOk(service, range("2022-01-01", "2025-12-31"));
    const narrow = await readOk(service, range("2024-01-01", "2024-12-31"));

    assert.ok(narrow.completions.length < wide.completions.length);
    for (const c of narrow.completions) {
      assert.ok(c.completedOn?.startsWith("2024"), c.completedOn ?? "");
    }
  });
});
