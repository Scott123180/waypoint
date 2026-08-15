import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { structureGaps } from "../src/projects/gaps";
import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Needing a DRI is its own signal (FR-032–FR-036).
 *
 * This is the Feature 3 FR-009 guard. Adding `"dri"` to `StructureGap` would
 * have been the obvious implementation and would have silently reversed a
 * decision Feature 3 made deliberately — newly flagging every otherwise
 * complete project that happens to have no owner. The two signals sit side by
 * side instead, and `gaps.ts` is not touched by this feature at all.
 *
 * Informational, always. Nothing blocks, gates, or delays on it.
 */

/** Complete but for the DRI: outcome, a milestone, and a next action. */
const NO_DRI = [
  "# Roof repair",
  "",
  "status: active",
  "next action: Call the roofer back",
  "",
  "## Outcome",
  "",
  "The roof survives a full winter with no leak.",
  "",
  "## Milestones",
  "",
  "- [ ] Estimate approved — @Priya",
  "",
].join("\n");

const WITH_DRI = NO_DRI.replace("next action:", "dri: Scott Rodgers\nnext action:");

describe("needs a DRI", () => {
  test("a project missing only a DRI is flagged for the DRI and NOT for structure", async () => {
    const vault = seedVault({ "projects/roof.md": NO_DRI, "identity.md": "me: Scott Rodgers\n" });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.needsDri, true);
    assert.deepEqual(summary?.gaps, [], "a missing DRI is not a structure gap (Feature 3 FR-009)");
  });

  test("the structure flag is unchanged by this feature", () => {
    // `structureGaps` is a pure function and is asserted directly, so a future
    // change to it fails here rather than somewhere downstream.
    const project = {
      slug: "p",
      title: "P",
      status: "active" as const,
      outcome: "something",
      nextAction: "something",
      dri: null,
      milestones: [
        { index: 0, definitionOfDone: "m", verifier: null, done: false, completedOn: null, raw: "- [ ] m" },
      ],
      completedOn: null,
      unprocessed: [],
      // Feature 5 added the ledger to `Project`. Empty is the honest value for a
      // fixture that has had no action recorded against it.
      ledger: [],
    };
    assert.deepEqual(structureGaps(project), []);
  });

  test("a project with a DRI does not need one", async () => {
    const vault = seedVault({ "projects/roof.md": WITH_DRI, "identity.md": "me: Scott Rodgers\n" });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.needsDri, false);
    assert.equal(summary?.dri.resolution, "mine");
  });

  test("a project with someone else's DRI does not need one", async () => {
    const vault = seedVault({
      "projects/roof.md": NO_DRI.replace("next action:", "dri: Priya Sharma\nnext action:"),
      "identity.md": "me: Scott Rodgers\n",
    });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.needsDri, false, "someone else's is still somebody's");
    assert.equal(summary?.dri.resolution, "theirs");
  });

  test("needing a DRI is independent of needing structure", async () => {
    // A bare stub needs both; they are reported separately.
    const vault = seedVault({ "projects/stub.md": "# Stub\n\nstatus: active\n" });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.needsDri, true);
    assert.deepEqual(summary?.gaps, ["outcome", "milestones", "next-action"]);
  });

  test("the signal is derived on every read, never stored", async () => {
    const vault = seedVault({ "projects/roof.md": NO_DRI, "identity.md": "me: Scott Rodgers\n" });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    assert.equal((await projects.list())[0]?.needsDri, true);

    vault.files.set("projects/roof.md", WITH_DRI);
    assert.equal((await projects.list())[0]?.needsDri, false, "a hand-edit is reflected on the next read");
  });

  test("it blocks nothing (FR-035)", async () => {
    const vault = seedVault({ "projects/roof.md": NO_DRI });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    // Every verb a project without a DRI could plausibly be gated on.
    assert.ok((await projects.setOutcome("roof", "The roof survives a full winter with no leak.", "New")).ok);
    assert.ok((await projects.addMilestone("roof", "Another", null)).ok);
    assert.ok((await projects.setStatus("roof", "active", "parked")).ok);
    assert.ok((await projects.complete("roof", { confirmOpenMilestones: true })).ok);
  });
});
