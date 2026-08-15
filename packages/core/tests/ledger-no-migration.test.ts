import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { GNARLY, STRUCTURED, STUB, STUB_WITH_UNPROCESSED } from "./project-fixtures";

/**
 * No file on disk is migrated.
 *
 * A project gains its ledger the first time an action is recorded against it —
 * extending rather than rewriting, exactly as Feature 3 established when it
 * added `## Milestones` beside Feature 2's stub (FR-099).
 *
 * This is the test that catches the tempting shortcut: adding the section on
 * read "so it is always there". That would touch every file in the vault the
 * first time the app opened, and the vault is git-tracked.
 */

const FIXTURES: Record<string, string> = {
  "projects/stub.md": STUB,
  "projects/structured.md": STRUCTURED,
  "projects/unprocessed.md": STUB_WITH_UNPROCESSED,
  "projects/gnarly.md": GNARLY,
};

function service() {
  const vault = seedVault(FIXTURES);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("reading never migrates", () => {
  test("listing, getting, and resolving write nothing at all", async () => {
    const { vault, projects } = service();

    await projects.list();
    await projects.listActive();
    await projects.listCompleted();
    await projects.get("structured");
    await projects.getResolved("structured");
    await projects.overLimitState();

    assert.deepEqual(vault.writeLog, [], "reading is reading");
  });

  test("every file is byte-for-byte what it was", async () => {
    const { vault, projects } = service();

    await projects.list();
    await projects.getResolved("gnarly");

    for (const [path, content] of Object.entries(FIXTURES)) {
      assert.equal(vault.files.get(path), content, `${path} was rewritten by a read`);
    }
  });

  test("a project with no ledger still reads and summarises", async () => {
    const { projects } = service();

    const summaries = await projects.list();
    for (const summary of summaries) {
      assert.equal(
        summary.statusSince,
        null,
        `${summary.slug} has no ledger, so the date its status began is unknown — not invented`,
      );
    }
  });
});

describe("a write that is not a status change never creates the section", () => {
  test("editing a field leaves a ledgerless project ledgerless", async () => {
    const { vault, projects } = service();

    await projects.setNextAction("stub", null, "Call the roofer");
    await projects.setDri("stub", null, "me");

    assert.doesNotMatch(vault.files.get("projects/stub.md") ?? "", /## Ledger/);
  });
});

describe("the section appears exactly once, on the first action", () => {
  test("and the rest of the file is untouched", async () => {
    const { vault, projects } = service();
    const before = vault.files.get("projects/structured.md") ?? "";

    await projects.setStatus("structured", "active", "waiting");
    const after = vault.files.get("projects/structured.md") ?? "";

    assert.equal((after.match(/## Ledger/g) ?? []).length, 1);

    // Everything Feature 3 wrote survives, in place.
    for (const line of before.split("\n")) {
      if (line.startsWith("status:") || line.trim().length === 0) continue;
      assert.ok(after.includes(line), `the ledger displaced: ${line}`);
    }
  });

  test("a second action reuses the section rather than adding another", async () => {
    const { vault, projects } = service();

    await projects.setStatus("stub", "active", "waiting");
    await projects.setStatus("stub", "waiting", "parked");

    assert.equal((vault.files.get("projects/stub.md") ?? "").match(/## Ledger/g)?.length, 1);
  });
});
