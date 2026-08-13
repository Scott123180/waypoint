import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Flag accuracy end to end: no false flags, no misses, and a hand-edit lands
 * without the application being involved (FR-018, FR-020, SC-004).
 *
 * The hand-edit case is the one that proves the flag is derived rather than
 * stored. A stored flag would still say "complete" after the user deleted the
 * next action in vim, and the user would trust it.
 */

function build(over: { outcome?: boolean; milestones?: boolean; nextAction?: boolean; dri?: boolean }) {
  let content = "# P\n\nstatus: active\n";
  if (over.nextAction) content = content.replace("status: active", "status: active\nnext action: Do it");
  if (over.dri) content = content.replace("status: active", "status: active\ndri: me");
  if (over.outcome) content += "\n## Outcome\n\nDone means done.\n";
  if (over.milestones) content += "\n## Milestones\n\n- [ ] One — @me\n";
  return content;
}

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("no false flags and no misses", () => {
  const COMBOS = [
    { outcome: false, milestones: false, nextAction: false, expect: ["outcome", "milestones", "next-action"] },
    { outcome: true, milestones: false, nextAction: false, expect: ["milestones", "next-action"] },
    { outcome: false, milestones: true, nextAction: false, expect: ["outcome", "next-action"] },
    { outcome: false, milestones: false, nextAction: true, expect: ["outcome", "milestones"] },
    { outcome: true, milestones: true, nextAction: false, expect: ["next-action"] },
    { outcome: true, milestones: false, nextAction: true, expect: ["milestones"] },
    { outcome: false, milestones: true, nextAction: true, expect: ["outcome"] },
    { outcome: true, milestones: true, nextAction: true, expect: [] },
  ];

  for (const combo of COMBOS) {
    test(`outcome=${combo.outcome} milestones=${combo.milestones} nextAction=${combo.nextAction}`, async () => {
      const { projects } = service({ "projects/p.md": build(combo) });
      const [s] = await projects.list();
      assert.deepEqual(s?.gaps, combo.expect);
    });
  }

  test("a mixed vault flags exactly the incomplete ones", async () => {
    const { projects } = service({
      "projects/complete.md": build({ outcome: true, milestones: true, nextAction: true }),
      "projects/no-outcome.md": build({ milestones: true, nextAction: true }),
      "projects/no-milestones.md": build({ outcome: true, nextAction: true }),
      "projects/no-action.md": build({ outcome: true, milestones: true }),
      "projects/stub.md": build({}),
    });

    const flagged = (await projects.list())
      .filter((p) => p.gaps.length > 0)
      .map((p) => p.slug)
      .sort();

    assert.deepEqual(flagged, ["no-action", "no-milestones", "no-outcome", "stub"]);
  });
});

describe("a missing DRI is never a gap (FR-009, SC-005)", () => {
  test("an otherwise complete project with no DRI is not flagged", async () => {
    const { projects } = service({
      "projects/p.md": build({ outcome: true, milestones: true, nextAction: true }),
    });
    const [s] = await projects.list();
    assert.deepEqual(s?.gaps, []);
  });

  test("adding a DRI changes nothing about the flag", async () => {
    const { projects } = service({
      "projects/p.md": build({ outcome: true, milestones: true, nextAction: true, dri: true }),
    });
    const [s] = await projects.list();
    assert.deepEqual(s?.gaps, []);
  });

  test("removing the DRI from a complete project does not flag it", async () => {
    const { projects } = service({
      "projects/p.md": build({ outcome: true, milestones: true, nextAction: true, dri: true }),
    });
    await projects.setDri("p", "me", null);
    const [s] = await projects.list();
    assert.deepEqual(s?.gaps, []);
  });
});

describe("a hand-edit flips the flag with the app uninvolved (FR-020)", () => {
  test("deleting the next action line flags the project on the next read", async () => {
    const { vault, projects } = service({
      "projects/p.md": build({ outcome: true, milestones: true, nextAction: true }),
    });
    assert.deepEqual((await projects.list())[0]?.gaps, []);

    // Exactly what a text editor would leave behind.
    vault.files.set(
      "projects/p.md",
      (vault.files.get("projects/p.md") ?? "").replace("next action: Do it\n", ""),
    );

    assert.deepEqual((await projects.list())[0]?.gaps, ["next-action"]);
    assert.deepEqual(vault.writeLog, [], "the app wrote nothing to make this true");
  });

  test("adding an outcome by hand clears that gap", async () => {
    const { vault, projects } = service({ "projects/p.md": build({ milestones: true, nextAction: true }) });
    assert.deepEqual((await projects.list())[0]?.gaps, ["outcome"]);

    vault.files.set(
      "projects/p.md",
      `${vault.files.get("projects/p.md") ?? ""}\n## Outcome\n\nTyped straight into vim.\n`,
    );
    assert.deepEqual((await projects.list())[0]?.gaps, []);
  });

  test("nothing about the flag is stored in the file", async () => {
    const { vault, projects } = service({ "projects/p.md": build({}) });
    await projects.setOutcome("p", null, "Now there is one.");
    const content = vault.files.get("projects/p.md") ?? "";
    for (const word of ["gap", "incomplete", "needs structure", "flag"]) {
      assert.doesNotMatch(content, new RegExp(word, "i"), `the flag must not be persisted (${word})`);
    }
  });
});
