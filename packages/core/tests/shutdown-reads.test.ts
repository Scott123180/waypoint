import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  calendarFile,
  identityFile,
  policyFile,
  projectFile,
  shutdownFor,
  topThreeFile,
  waitingFile,
} from "./shutdown-fakes";

/**
 * Each panel source is read at most once per opening (FR-011a, SC-013).
 *
 * **Counted, never timed.** A per-item read finishes fast enough on a developer's
 * machine with a hundred projects that a stopwatch would never notice, and then
 * falls over on a real vault. The read count is the honest measure — the same
 * argument `review-read-count.test.ts` makes, and the same shape of assertion.
 *
 * **`policy.md` is deliberately outside the count**, and this is worth stating
 * plainly because a bare `maxReadCount() === 1` would be the obvious assertion
 * and would be wrong. `DefaultPolicy.decide()` re-reads its configuration on
 * every decision — by design, so a user editing `policy.md` sees the new rule
 * without restarting anything — and staleness is a question asked once per
 * candidate. A shutdown over thirty stale subjects reads `policy.md` thirty-odd
 * times. That is the shipped rule working, not this feature leaking a read, and
 * neither FR-011a nor SC-013 asks it to stop. It is asserted separately below so
 * the exclusion is visible rather than assumed.
 */

const PANEL_SOURCES = ["top-three.md", "identity.md", "waiting.md", "calendar.md"];

function vaultOf(projects: number): Record<string, string> {
  const files: Record<string, string> = {
    "identity.md": identityFile("Scott Hansen"),
    "top-three.md": topThreeFile([{ week: "2026-W34", outcomes: [{ text: "Ship it" }] }]),
    "waiting.md": waitingFile(
      Array.from({ length: 20 }, (_, i) => ({
        since: "2026-06-01",
        owner: `Owner${i}`,
        text: `waiting ${i}`,
      })),
    ),
    "calendar.md": calendarFile(
      Array.from({ length: 12 }, (_, i) => ({ flaggedOn: "2026-07-01", text: `flag ${i}` })),
    ),
  };

  for (let i = 0; i < projects; i++) {
    const slug = `project-${String(i).padStart(3, "0")}`;
    files[`projects/${slug}.md`] = projectFile({
      slug,
      title: `Project ${i}`,
      // A mix, so the panel is a real filter rather than everything.
      status: i % 3 === 0 ? "waiting" : "active",
      dri: i % 2 === 0 ? "Scott Hansen" : "Priya Raman",
      nextAction: "Something",
    });
  }
  return files;
}

/** Reads per path, filtered to the panel sources — the way SC-013 asks. */
function panelReads(reads: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of reads) {
    if (!PANEL_SOURCES.includes(path) && !path.startsWith("projects/")) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

describe("one read() over a hundred projects", () => {
  test("reads each panel source at most once", async () => {
    const { service, vault } = shutdownFor(vaultOf(100));

    const view = await service.read();
    assert.ok(view.projects.items.length > 0, "the fixture produced a panel to measure");
    assert.ok(view.waiting.items.length > 0, "and stale items, so the rule really ran");
    assert.ok(view.calendar.items.length > 0);

    const repeated = [...panelReads(vault.reads).entries()].filter(([, n]) => n > 1);
    assert.deepEqual(
      repeated,
      [],
      `these panel sources were read more than once: ${repeated.map(([p, n]) => `${p} × ${n}`).join(", ")}`,
    );
  });

  test("every project file is read exactly once — the filter happens after parsing", async () => {
    const { service, vault } = shutdownFor(vaultOf(100));

    await service.read();

    const projectReads = vault.reads.filter((p) => p.startsWith("projects/"));
    assert.equal(projectReads.length, 100);
    assert.equal(new Set(projectReads).size, 100);
  });

  test("the four single-file sources are each read once", async () => {
    const { service, vault } = shutdownFor(vaultOf(100));

    await service.read();

    for (const path of PANEL_SOURCES) {
      assert.equal(vault.reads.filter((p) => p === path).length, 1, `${path} was not read exactly once`);
    }
  });

  test("the count grows with the vault, not with its square", async () => {
    const ten = shutdownFor(vaultOf(10));
    await ten.service.read();
    const small = ten.vault.reads.filter((p) => p.startsWith("projects/")).length;

    const hundred = shutdownFor(vaultOf(100));
    await hundred.service.read();
    const large = hundred.vault.reads.filter((p) => p.startsWith("projects/")).length;

    assert.equal(small, 10);
    assert.equal(large, 100, `ten times the projects must not be ${large / small} times the reads`);
  });

  test("no read happens inside a per-item loop over any panel source", async () => {
    // Thirty-two stale subjects, and still one read of each list. If a loop
    // ever reached for the vault, this is where it would show up.
    const { service, vault } = shutdownFor(vaultOf(100));

    await service.read();

    assert.equal(vault.reads.filter((p) => p === "waiting.md").length, 1);
    assert.equal(vault.reads.filter((p) => p === "calendar.md").length, 1);
  });
});

describe("policy.md is outside the count, on purpose", () => {
  test("it is read once per decision, which is the shipped rule working", async () => {
    const files = { ...vaultOf(5), "policy.md": policyFile({ "staleness days": 7 }) };
    const { service, vault } = shutdownFor(files);

    const view = await service.read();
    const subjects = view.waiting.items.length + view.calendar.items.length;
    assert.ok(subjects > 1, "the fixture must ask the rule more than once for this to mean anything");

    assert.ok(
      vault.reads.filter((p) => p === "policy.md").length > subjects,
      "DefaultPolicy re-reads its configuration on every decision, by design",
    );
  });

  test("a bare maxReadCount() would therefore be the wrong assertion", async () => {
    const files = { ...vaultOf(5), "policy.md": policyFile({ "staleness days": 7 }) };
    const { service, vault } = shutdownFor(files);

    await service.read();

    assert.ok(
      vault.maxReadCount() > 1,
      "this is the number a naive read-count test would assert on, and it is policy.md's",
    );
    assert.deepEqual(
      [...panelReads(vault.reads).entries()].filter(([, n]) => n > 1),
      [],
      "while the panel sources — the ones SC-013 is about — are each read once",
    );
  });
});
