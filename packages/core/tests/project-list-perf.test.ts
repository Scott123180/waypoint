import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * The project list is available in under 100 ms for 100 projects (SC-017).
 *
 * The budget exists so that reading every file to compute progress and gaps
 * never becomes an argument for caching them — a cache is exactly what would
 * let the flag drift from the files it describes (research R5).
 *
 * As in Features 1 and 2, a CI timing is a regression signal; the authoritative
 * measurement is real hardware. The threshold is generous for that reason.
 */

const BUDGET_MS = 100;

function vaultOf(count: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    files[`projects/p-${i}.md`] = STRUCTURED.replace("# Roof repair", `# Project ${i}`);
  }
  return seedVault(files);
}

describe("project list performance", () => {
  test("100 projects list in under 100 ms", async () => {
    const vault = vaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    // Warm once so the measurement is not paying for lazy module work.
    await projects.list();

    const started = performance.now();
    const summaries = await projects.list();
    const elapsed = performance.now() - started;

    assert.equal(summaries.length, 100);
    assert.ok(elapsed < BUDGET_MS, `listing 100 projects took ${elapsed.toFixed(1)}ms`);
  });

  test("listActive stays within the same budget", async () => {
    const vault = vaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });
    await projects.listActive();

    const started = performance.now();
    await projects.listActive();
    assert.ok(performance.now() - started < BUDGET_MS);
  });

  test("every summary carries its progress and gaps — the budget buys the whole list", async () => {
    // A fast list that omitted what the view needs would be measuring nothing.
    const vault = vaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });
    const summaries = await projects.list();

    assert.ok(summaries.every((s) => s.milestonesTotal === 3));
    assert.ok(summaries.every((s) => Array.isArray(s.gaps)));
  });

  test("listing does not scale into a second read of each file", async () => {
    const vault = vaultOf(20);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    let reads = 0;
    const realRead = vault.read.bind(vault);
    vault.read = (p: string) => {
      reads += 1;
      return realRead(p);
    };

    await projects.list();
    assert.equal(reads, 20, "one read per project, not two");
  });
});
