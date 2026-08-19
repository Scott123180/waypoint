import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { actingVault, populatedVault, snapshot } from "./shutdown-fakes";

/**
 * Changing a next action from the shutdown == doing it from the projects view
 * (FR-035, SC-004).
 *
 * `setNextAction` takes the value the caller was **shown** as `expected`, and
 * that is what makes this comparison meaningful: the shutdown passes what its
 * panel displayed. A screen that trimmed, reformatted, or defaulted the next
 * action would send an `expected` the file does not match, and the write would
 * be refused rather than producing a matching file.
 *
 * The other half is that only the next action changes. A project file holds an
 * outcome, a DRI, milestones, unprocessed items and a ledger, and a verb that
 * rewrote the file wholesale would pass a comparison of the changed line while
 * quietly reflowing everything else.
 */

const SLUG = "alpha";
const NEXT = "Book the cutover window with Priya";

async function fromShutdown(): Promise<Record<string, string>> {
  const { shutdown, projects, vault } = actingVault(populatedVault());

  const view = await shutdown.read();
  const project = view.projects.items.find((p) => p.summary.slug === SLUG);
  assert.ok(project);

  const result = await projects.setNextAction(SLUG, project.nextAction, NEXT);
  assert.ok(result.ok, "the shutdown's path must not be refused");

  return snapshot(vault);
}

async function fromProjectsWindow(): Promise<Record<string, string>> {
  const { projects, vault } = actingVault(populatedVault());

  const project = await projects.get(SLUG);
  assert.ok(project);

  const result = await projects.setNextAction(SLUG, project.nextAction, NEXT);
  assert.ok(result.ok);

  return snapshot(vault);
}

describe("replacing a next action", () => {
  test("produces a byte-identical project file", async () => {
    assert.equal(
      (await fromShutdown())[`projects/${SLUG}.md`],
      (await fromProjectsWindow())[`projects/${SLUG}.md`],
    );
  });

  test("the whole vault matches", async () => {
    assert.deepEqual(await fromShutdown(), await fromProjectsWindow());
  });

  test("only the next action changed", async () => {
    const before = populatedVault()[`projects/${SLUG}.md`] ?? "";
    const after = (await fromShutdown())[`projects/${SLUG}.md`] ?? "";

    const changed = diffLines(before, after);
    assert.deepEqual(changed.removed, ["next action: Draft the migration note"]);
    assert.deepEqual(changed.added, [`next action: ${NEXT}`]);
  });

  test("every other field and section is untouched", async () => {
    const after = (await fromShutdown())[`projects/${SLUG}.md`] ?? "";

    for (const line of [
      "# Alpha",
      "status: active",
      "dri: Scott Hansen",
      "## Milestones",
      "- [x] Estimate approved — done 2026-08-01",
      "- [ ] Cutover rehearsed",
    ]) {
      assert.ok(after.includes(line), `${line} was disturbed`);
    }
  });

  test("clearing it is the same on both paths too", async () => {
    const shutdownRun = actingVault(populatedVault());
    const view = await shutdownRun.shutdown.read();
    const project = view.projects.items.find((p) => p.summary.slug === SLUG);
    assert.ok(project);
    assert.ok((await shutdownRun.projects.setNextAction(SLUG, project.nextAction, null)).ok);

    const windowRun = actingVault(populatedVault());
    const fromFile = await windowRun.projects.get(SLUG);
    assert.ok(fromFile);
    assert.ok((await windowRun.projects.setNextAction(SLUG, fromFile.nextAction, null)).ok);

    assert.deepEqual(snapshot(shutdownRun.vault), snapshot(windowRun.vault));
  });
});

/** Lines present in one and not the other, in file order. */
function diffLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  return {
    removed: a.filter((line) => !b.includes(line) && line.trim().length > 0),
    added: b.filter((line) => !a.includes(line) && line.trim().length > 0),
  };
}
