import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The limit counts only what the user is actually driving (FR-039–FR-042).
 *
 * This is the decision the whole feature turns on. The user is a manager
 * overseeing many projects owned by other people; a limit counting all of them
 * would fire constantly and be ignored — and a rule nobody heeds is worse than
 * no rule, because it trains the user to dismiss the system's refusals.
 *
 * So: someone else's is uncapped, nobody's is uncapped, and ambiguous is
 * uncapped. An unknown owner is not the user.
 */

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

describe("what the limit counts", () => {
  test("10 other-owned and 5 unassigned projects all go active with zero refusals (SC-011)", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 10; i++) files[`projects/theirs-${i}.md`] = project(`Theirs ${i}`, "parked", "Priya Sharma");
    for (let i = 0; i < 5; i++) files[`projects/nobody-${i}.md`] = project(`Nobody ${i}`, "parked", null);

    const vault = seedVault(files);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    for (let i = 0; i < 10; i++) {
      assert.ok((await projects.setStatus(`theirs-${i}`, "parked", "active")).ok, `theirs-${i}`);
    }
    for (let i = 0; i < 5; i++) {
      assert.ok((await projects.setStatus(`nobody-${i}`, "parked", "active")).ok, `nobody-${i}`);
    }

    assert.equal((await projects.listActive()).length, 15);
  });

  test("a project whose DRI is someone else never counts, however many are active", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 12; i++) files[`projects/theirs-${i}.md`] = project(`Theirs ${i}`, "active", "Priya Sharma");
    files["projects/mine.md"] = project("Mine", "parked", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    assert.ok((await projects.setStatus("mine", "parked", "active")).ok);
  });

  test("a project with no DRI never counts", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 12; i++) files[`projects/stub-${i}.md`] = project(`Stub ${i}`, "active", null);
    files["projects/mine.md"] = project("Mine", "parked", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    assert.ok(
      (await projects.setStatus("mine", "parked", "active")).ok,
      "every sort-created stub starts with no DRI; counting them would make the limit fire on untriaged work",
    );
  });

  test("an ambiguous DRI never counts (FR-042)", async () => {
    // An unresolved identity is not the user's identity. Counting it would
    // reintroduce exactly the false-alarm mode this scoping exists to avoid.
    const files: Record<string, string> = {
      "identity.md": "me: Scott Rodgers\n\n## Aliases\n\n- Scott\n",
      // A second Scott, so a bare `Scott` is ambiguous.
      "projects/other-scott.md": project("Other", "parked", "Scott Kim"),
    };
    for (let i = 0; i < 5; i++) files[`projects/amb-${i}.md`] = project(`Ambiguous ${i}`, "active", "Scott");
    files["projects/mine.md"] = project("Mine", "parked", "Scott Rodgers");

    const vault = seedVault(files);
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const summaries = await projects.list();
    assert.equal(
      summaries.find((s) => s.slug === "amb-0")?.dri.resolution,
      "ambiguous",
      "fixture check: these must actually be ambiguous",
    );

    assert.ok((await projects.setStatus("mine", "parked", "active")).ok);
  });

  test("an ambiguous project may itself be activated freely", async () => {
    const files: Record<string, string> = {
      "identity.md": "me: Scott Rodgers\n\n## Aliases\n\n- Scott\n",
      "projects/other-scott.md": project("Other", "parked", "Scott Kim"),
      "projects/amb.md": project("Ambiguous", "parked", "Scott"),
    };
    for (let i = 0; i < 3; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    assert.ok(
      (await projects.setStatus("amb", "parked", "active")).ok,
      "the limit cannot block on a project it would not count",
    );
  });

  test("a mixed vault counts only the user's active projects", async () => {
    const files: Record<string, string> = {
      "identity.md": "me: Scott Rodgers\n",
      "projects/mine-0.md": project("Mine 0", "active", "Scott Rodgers"),
      "projects/mine-1.md": project("Mine 1", "active", "scott rodgers."),
      "projects/theirs.md": project("Theirs", "active", "Priya"),
      "projects/nobody.md": project("Nobody", "active", null),
      "projects/candidate.md": project("Candidate", "parked", "Scott Rodgers"),
    };
    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });

    // Two of the user's are active — a formatting variant still counts — so a
    // third is allowed and a fourth would not be.
    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(result.ok);
  });
});
