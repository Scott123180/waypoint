import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The walk reads each project file at most once.
 *
 * Counted, not timed. A quadratic walk — every project re-reading the vault to
 * resolve its own DRI — finishes fast enough on a developer's machine with a
 * hundred projects that a stopwatch would never notice, and then falls over on
 * a real vault. The read count is the honest measure (SC-016, 004 research R6).
 */

function vaultOf(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const slug = `project-${String(i).padStart(3, "0")}`;
    files[`projects/${slug}.md`] = [
      `# Project ${i}`,
      "",
      // A mix, so the walk set is a real filter rather than everything.
      `status: ${i % 3 === 0 ? "waiting" : i % 5 === 0 ? "parked" : "active"}`,
      "dri: Priya Raman",
      "",
      "## Ledger",
      "",
      "- 2026-06-01 status active → waiting",
      "",
    ].join("\n");
  }
  return files;
}

describe("building the walk over a hundred projects", () => {
  test("reads each project file at most once", async () => {
    const { service, vault } = makeReview({ files: vaultOf(100) });
    await service.start();

    vault.readLog.length = 0;
    const walk = await service.projectStep();
    assert.ok(walk.length > 0, "the fixture produced a walk to measure");

    const reads = vault.readLog.filter((p) => p.startsWith("projects/"));
    const counts = new Map<string, number>();
    for (const path of reads) counts.set(path, (counts.get(path) ?? 0) + 1);

    const repeated = [...counts.entries()].filter(([, n]) => n > 1);
    assert.deepEqual(repeated, [], "a project file was read more than once");
    assert.equal(counts.size, 100, "every project is read — the walk set is filtered after parsing");
  });

  test("the total read count grows with the vault, not with its square", async () => {
    const { service: small, vault: smallVault } = makeReview({ files: vaultOf(10) });
    await small.start();
    smallVault.readLog.length = 0;
    await small.projectStep();
    const ten = smallVault.readLog.filter((p) => p.startsWith("projects/")).length;

    const { service: large, vault: largeVault } = makeReview({ files: vaultOf(100) });
    await large.start();
    largeVault.readLog.length = 0;
    await large.projectStep();
    const hundred = largeVault.readLog.filter((p) => p.startsWith("projects/")).length;

    assert.equal(ten, 10);
    assert.equal(hundred, 100, `ten times the projects must not be ${hundred / ten} times the reads`);
  });
});
