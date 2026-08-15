import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * One pass over the vault (FR-020c, SC-016c).
 *
 * Ambiguity is the first derived value that needs vault-wide input, which makes
 * the naive shape quadratic: a list that maps over slugs, with each summary
 * resolving itself, re-reads every file for every project — 10,000 reads for
 * 100 projects.
 *
 * This is asserted by **counting reads, not by timing**. A timing test passes
 * on fast hardware even when the implementation is quadratic, so it would not
 * catch the regression it exists to catch. The 100 ms budget is checked
 * separately in `project-list-perf.test.ts`; this is the real gate.
 *
 * The tempting fix — cache the corpus — is exactly the stored derived state
 * Feature 3's research R5 rules out, because it drifts the moment the user
 * edits a file in vim.
 */

function vaultOf(count: number) {
  const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
  for (let i = 0; i < count; i++) {
    files[`projects/p-${i}.md`] = STRUCTURED.replace("# Roof repair", `# Project ${i}`);
  }
  return seedVault(files);
}

function projectReads(readLog: string[]): string[] {
  return readLog.filter((p) => p.startsWith("projects/"));
}

describe("read count", () => {
  test("a 100-project list reads each project file exactly once", async () => {
    const vault = vaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    await projects.list();

    const reads = projectReads(vault.readLog);
    assert.equal(reads.length, 100, `expected 100 project reads, got ${reads.length}`);
    assert.equal(new Set(reads).size, 100, "no file read twice");
  });

  test("identity is read once per list, not once per project", async () => {
    const vault = vaultOf(50);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    await projects.list();

    const identityReads = vault.readLog.filter((p) => p === "identity.md");
    assert.equal(identityReads.length, 1, `identity.md read ${identityReads.length} times`);
  });

  test("the read count grows linearly, not quadratically", async () => {
    const counts: number[] = [];
    for (const size of [10, 20, 40]) {
      const vault = vaultOf(size);
      await new ProjectService({ vault, clock: new FixedClock() }).list();
      counts.push(projectReads(vault.readLog).length);
    }
    assert.deepEqual(counts, [10, 20, 40], "doubling the vault must double the reads, not square them");
  });

  test("listActive and listCompleted are single-pass too", async () => {
    for (const verb of ["listActive", "listCompleted"] as const) {
      const vault = vaultOf(30);
      const projects = new ProjectService({ vault, clock: new FixedClock() });

      await projects[verb]();

      assert.equal(projectReads(vault.readLog).length, 30, `${verb} must not re-read`);
    }
  });

  test("nothing is cached between calls", async () => {
    // The counterpart to the budget: one pass per call, but a fresh pass every
    // call. A cache would make the second call cheap and the answer stale.
    const vault = vaultOf(10);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    await projects.list();
    vault.readLog.length = 0;
    await projects.list();

    assert.equal(projectReads(vault.readLog).length, 10, "the second read must go to disk again");
  });
});
