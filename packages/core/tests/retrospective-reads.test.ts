import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Read counting, not timing (SC-019).
 *
 * A stopwatch on a laptop proves nothing about the shape of the algorithm; a
 * read count proves the thing that actually matters, which is that nothing
 * reads inside a per-entry loop. This is the form Feature 5 used for SC-016 and
 * Feature 3 for `identity-read-count.test.ts`.
 */

/** 100 projects, ~20 completions each, spread over four years. */
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
      outcomes: [{ text: `outcome ${w}`, done: true, completedOn: `2025-06-15` }],
    });
  }
  files["top-three.md"] = topThreeFile(weeks);

  for (let w = 1; w <= 10; w += 1) {
    const id = `2025-W${String(w).padStart(2, "0")}`;
    files[`log/${id}.md`] = logFile({ week: id, note: `week ${w}` });
  }

  return files;
}

describe("reads are bounded", () => {
  test("each project file is read exactly once over a four-year range", async () => {
    const { service, vault } = serviceFor(bigVault());
    await readOk(service, range("2022-01-01", "2026-12-31"));

    for (let p = 0; p < 100; p += 1) {
      const path = `projects/project-${String(p).padStart(3, "0")}.md`;
      assert.equal(vault.readCount(path), 1, path);
    }
  });

  test("identity is read once per retrospective, never once per project", async () => {
    const { service, vault } = serviceFor(bigVault());
    await readOk(service, range("2022-01-01", "2026-12-31"));
    assert.equal(vault.readCount("identity.md"), 1);
  });

  test("top-three.md is read at most once", async () => {
    const { service, vault } = serviceFor(bigVault());
    await readOk(service, range("2022-01-01", "2026-12-31"));
    assert.ok(vault.readCount("top-three.md") <= 1, "one read, or none when unused");
  });

  test("no file anywhere is read twice", async () => {
    const { service, vault } = serviceFor(bigVault());
    await readOk(service, range("2022-01-01", "2026-12-31"));
    assert.equal(vault.maxReadCount(), 1, `repeated reads: ${vault.reads.join(", ")}`);
  });

  test("only log files whose week overlaps the range are read", async () => {
    const { service, vault } = serviceFor(bigVault());
    // A range covering 2025-W01..W02 only.
    await readOk(service, range("2024-12-30", "2025-01-12"));

    const logReads = vault.reads.filter((p) => p.startsWith("log/"));
    assert.deepEqual(logReads.sort(), ["log/2025-W01.md", "log/2025-W02.md"]);
  });

  test("narrowing to one project still reads each project file once", async () => {
    // Resolving a slug means reading the set; it must not mean reading it twice.
    const { service, vault } = serviceFor(bigVault());
    await readOk(service, range("2022-01-01", "2026-12-31", "project-042"));
    assert.equal(vault.maxReadCount(), 1);
  });
});
