import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildCorpus } from "../src/identity/corpus";
import { resolveDri } from "../src/identity/resolve";
import type { Identity } from "../src/identity/types";
import { ProjectService } from "../src/projects/project-service";
import type { Milestone, Project } from "../src/projects/types";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * What counts as evidence that a second person by that name exists (FR-028a).
 *
 * DRIs **and** milestone verifiers, from the project files only. A verifier is
 * a teammate by definition, so a second Scott is a second Scott wherever on a
 * project they are named.
 *
 * The boundary is drawn at the project files deliberately (FR-028b): widening
 * it to `waiting.md` would make core identity resolution depend on a file it
 * otherwise has no reason to open, and every added source widens the net in a
 * direction that weakens the WIP limit, since an ambiguous DRI stops counting.
 */

function project(dri: string | null, verifiers: string[] = []): Project {
  const milestones: Milestone[] = verifiers.map((verifier, index) => ({
    index,
    definitionOfDone: `m${index}`,
    verifier,
    done: false,
    completedOn: null,
    raw: `- [ ] m${index} — @${verifier}`,
  }));
  return {
    slug: "p",
    title: "P",
    status: "active",
    outcome: null,
    nextAction: null,
    dri,
    milestones,
    completedOn: null,
    unprocessed: [],
  };
}

describe("the name corpus", () => {
  test("collects DRI names", () => {
    const corpus = buildCorpus([project("Scott"), project("Priya")]);
    assert.deepEqual([...corpus].map((c) => c.raw).sort(), ["Priya", "Scott"]);
  });

  test("collects milestone verifier names too", () => {
    const corpus = buildCorpus([project(null, ["Priya", "Dev"])]);
    assert.deepEqual([...corpus].map((c) => c.raw).sort(), ["Dev", "Priya"]);
  });

  test("a colliding name appearing ONLY as a verifier still triggers ambiguity", () => {
    // The reason verifiers are included at all.
    const me: Identity = { canonical: "Scott", aliases: [] };
    const corpus = buildCorpus([project("Scott"), project("Priya", ["Scott R."])]);

    const result = resolveDri("Scott", me, corpus);
    assert.equal(result.resolution, "ambiguous");
    assert.deepEqual(result.collidesWith, ["Scott R."]);
  });

  test("distinct names are deduplicated by their normalized form", () => {
    const corpus = buildCorpus([project("Scott"), project("  SCOTT  "), project("scott.")]);
    assert.equal(corpus.length, 1, "one person, however the name is spelled");
  });

  test("absent DRIs and verifiers contribute nothing", () => {
    assert.deepEqual([...buildCorpus([project(null), project("   ")])], []);
  });

  test("an empty project list yields an empty corpus", () => {
    assert.deepEqual([...buildCorpus([])], []);
  });
});

describe("the corpus reads project files and nothing else (FR-028b, SC-008a)", () => {
  const PROJECT = ["# P", "", "status: active", "dri: Scott", "", "## Milestones", "", "- [ ] m — @Priya", ""].join(
    "\n",
  );

  test("a colliding name only in waiting.md does not make a DRI ambiguous", () => {
    const vault = seedVault({
      "projects/p.md": PROJECT,
      "identity.md": "me: Scott\n",
      "waiting.md": "- Scott R. owes me the estimate\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    return projects.list().then((summaries) => {
      assert.equal(summaries[0]?.dri.resolution, "mine", "waiting.md is not identity's business");
    });
  });

  test("no file other than the project files and identity.md is read", async () => {
    const vault = seedVault({
      "projects/p.md": PROJECT,
      "identity.md": "me: Scott\n",
      "waiting.md": "- Scott R.\n",
      "inbox.md": "- something\n",
      "areas/a.md": "# A\n\nstatus: active\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    await projects.list();

    for (const path of vault.readLog) {
      assert.ok(
        path.startsWith("projects/") || path === "identity.md" || path === "policy.md",
        `list() read ${path}, which identity resolution has no business opening`,
      );
    }
    assert.ok(!vault.readLog.includes("waiting.md"));
    assert.ok(!vault.readLog.includes("inbox.md"));
  });

  test("areas contribute no names — an area has no DRI (FR-037)", async () => {
    const vault = seedVault({
      "projects/p.md": PROJECT,
      "areas/a.md": ["# A", "", "status: active", "dri: Scott R.", ""].join("\n"),
      "identity.md": "me: Scott\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const summaries = await projects.list();
    assert.equal(
      summaries[0]?.dri.resolution,
      "mine",
      "a stray dri: line in an area file is not evidence of a second person",
    );
  });
});
