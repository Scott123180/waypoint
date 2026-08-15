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

    let projectReads = 0;
    const realRead = vault.read.bind(vault);
    vault.read = (p: string) => {
      // 2026-08-14, Feature 4: counts project files specifically rather than
      // every read. Identity resolution adds one read of `identity.md` per
      // list — O(1), not per project — so a bare total would now say 21 and
      // this test's actual subject, that no project file is read twice, would
      // be lost. The assertion is unchanged in everything it was written to
      // catch.
      if (p.startsWith("projects/")) projectReads += 1;
      return realRead(p);
    };

    await projects.list();
    assert.equal(projectReads, 20, "one read per project, not two");
  });
});

/**
 * 2026-08-14, Feature 4: the budget must hold with identity resolved.
 *
 * The cases above deliberately configure no `identity.md`, so `resolveDri`
 * returns at the not-configured check and the collision comparison ambiguity
 * needs — an O(n) scan of the name corpus, per project — never runs. That left
 * the most expensive path this feature added entirely untimed (SC-016a).
 *
 * The vault here is shaped to be the worst realistic case: every project is the
 * user's, and a second person shares their first name, so every single
 * resolution has to walk the corpus looking for a collision.
 */
function resolvedVaultOf(count: number) {
  const files: Record<string, string> = {
    // An alias that is a strict leading prefix of another real person's name,
    // which is what makes every match a candidate for ambiguity.
    "identity.md": "# Identity\n\nme: Scott Rodgers\n\n## Aliases\n\n- Scott\n",
    "projects/other-scott.md": "# Other\n\nstatus: parked\ndri: Scott Kim\n",
  };
  for (let i = 0; i < count; i++) {
    files[`projects/p-${i}.md`] = STRUCTURED.replace("# Roof repair", `# Project ${i}`).replace(
      "status: active",
      "status: active\ndri: Scott",
    );
  }
  return seedVault(files);
}

describe("performance with identity resolved", () => {
  test("100 projects list, every DRI resolved, in under 100 ms (SC-016a)", async () => {
    const vault = resolvedVaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const started = performance.now();
    const summaries = await projects.list();
    const elapsed = performance.now() - started;

    assert.equal(summaries.length, 101);
    assert.ok(elapsed < BUDGET_MS, `list took ${elapsed.toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  });

  test("the fixture really does exercise the ambiguity path", async () => {
    // Without this, the budget above could pass by accident on a vault where
    // no collision is ever considered — which is exactly how the gap arose.
    const projects = new ProjectService({ vault: resolvedVaultOf(5), clock: new FixedClock() });
    const summaries = await projects.list();

    const ambiguous = summaries.filter((s) => s.dri.resolution === "ambiguous");
    assert.equal(ambiguous.length, 5, "every project's DRI should be ambiguous in this fixture");
    assert.deepEqual(ambiguous[0]?.dri.collidesWith, ["Scott Kim"]);
  });

  test("opening one project in a 100-project vault stays under 100 ms (SC-016b)", async () => {
    // Resolving one project reads the whole vault, because ambiguity cannot be
    // answered from a single file. That cost was accepted so a detail view and
    // the list can never disagree (FR-020a) — but accepted is not the same as
    // unmeasured.
    const vault = resolvedVaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const started = performance.now();
    const resolved = await projects.getResolved("p-0");
    const elapsed = performance.now() - started;

    assert.ok(resolved);
    assert.ok(elapsed < BUDGET_MS, `getResolved took ${elapsed.toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  });

  test("the driving count stays within the same budget", async () => {
    const vault = resolvedVaultOf(100);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const started = performance.now();
    await projects.overLimitState();
    const elapsed = performance.now() - started;

    assert.ok(elapsed < BUDGET_MS, `overLimitState took ${elapsed.toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  });
});
