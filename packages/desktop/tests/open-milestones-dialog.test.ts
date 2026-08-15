import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ProjectService } from "@waypoint/core";

import { FsVaultStore } from "../src/main/adapters/fs-vault-store";
import { makeTempVault } from "./vault-fixture";

/**
 * The confirmation dialog still appears after the rule moves behind a decision
 * point ([contracts/policy-seam.md](../../../specs/004-top-three-wip-limit/contracts/policy-seam.md)).
 *
 * This is the one migration failure a core test cannot catch. Every core test
 * asserts on the *refusal value*; the renderer branches on the literal string
 * `"open-milestones"` and reads `outcome.open`. Rename either at the seam and
 * the dialog silently stops appearing — completing a project with open
 * milestones would just succeed, with no error anywhere and no test failing.
 *
 * So this asserts the two things the client actually depends on: the exact
 * reason string, and a populated `open` array. It also pins the renderer to
 * those same names, so the two halves cannot drift apart independently.
 */

const PROJECT = [
  "# Roof repair",
  "",
  "status: active",
  "",
  "## Milestones",
  "",
  "- [ ] Estimate approved",
  "- [x] Materials delivered — done 2026-08-01",
  "- [ ] Work signed off",
  "",
].join("\n");

describe("the open-milestone confirmation reaches the client intact", () => {
  test("the refusal carries the exact reason string the renderer branches on", async () => {
    const temp = makeTempVault();
    temp.write("projects/roof.md", PROJECT);
    const projects = new ProjectService({ vault: new FsVaultStore(temp.root, () => {}) });

    const outcome = await projects.complete("roof");
    temp.cleanup();

    assert.ok(!outcome.ok);
    assert.equal(
      outcome.reason,
      "open-milestones",
      "renderer/projects.ts branches on this literal; renaming it hides the dialog",
    );
  });

  test("the refusal carries a populated `open` array, not `subjects`", async () => {
    const temp = makeTempVault();
    temp.write("projects/roof.md", PROJECT);
    const projects = new ProjectService({ vault: new FsVaultStore(temp.root, () => {}) });

    const outcome = await projects.complete("roof");
    temp.cleanup();
    assert.ok(!outcome.ok);

    assert.deepEqual(outcome.open, ["Estimate approved", "Work signed off"]);
    assert.equal(
      (outcome as { subjects?: string[] }).subjects,
      undefined,
      "`subjects` belongs to the WIP refusal; overloading either field would cross the two dialogs",
    );
  });

  test("confirming from the client completes the project", async () => {
    const temp = makeTempVault();
    temp.write("projects/roof.md", PROJECT);
    const projects = new ProjectService({ vault: new FsVaultStore(temp.root, () => {}) });

    const confirmed = await projects.complete("roof", { confirmOpenMilestones: true });
    temp.cleanup();
    assert.ok(confirmed.ok);
    assert.equal(confirmed.project.status, "done");
  });

  test("the renderer still keys off the same names", () => {
    // Pins the other half. If the renderer is rewritten to read something else,
    // this fails rather than the dialog quietly vanishing at runtime.
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "renderer", "projects.ts"),
      "utf8",
    );
    assert.match(source, /reason === "open-milestones"/, "the renderer's branch");
    assert.match(source, /outcome\.open/, "the renderer's list of names");
  });

  test("a WIP refusal is not mistaken for an open-milestone confirmation", async () => {
    // The failure this separation exists to prevent: if the WIP block reused
    // `open`, the renderer would render it as a confirmation list and offer to
    // complete the very project the user was trying to activate.
    const temp = makeTempVault();
    temp.write("identity.md", "me: Scott Rodgers\n");
    for (let i = 0; i < 3; i++) {
      temp.write(`projects/mine-${i}.md`, `# Mine ${i}\n\nstatus: active\ndri: Scott Rodgers\n`);
    }
    temp.write("projects/candidate.md", "# Candidate\n\nstatus: parked\ndri: Scott Rodgers\n");
    const projects = new ProjectService({ vault: new FsVaultStore(temp.root, () => {}) });

    const outcome = await projects.setStatus("candidate", "parked", "active");
    temp.cleanup();
    assert.ok(!outcome.ok);
    assert.equal(outcome.reason, "wip-limit");
    assert.equal(outcome.open, undefined, "a WIP block must never populate the confirmation list");
    assert.equal(outcome.subjects?.length, 3);
  });
});
