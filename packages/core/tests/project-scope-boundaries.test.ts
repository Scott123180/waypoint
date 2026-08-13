import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as core from "../src/index";
import { AreaService } from "../src/projects/area-service";
import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * What this feature deliberately does NOT do (FR-049).
 *
 * Scope boundaries rot silently — a WIP limit added "just here" or a delete
 * verb added "for convenience" would each be a later feature arriving early and
 * unspecified. This test is the tripwire.
 */

const PROJECT_VERBS = Object.getOwnPropertyNames(ProjectService.prototype);
const AREA_VERBS = Object.getOwnPropertyNames(AreaService.prototype);

describe("nothing deletes a project or an area", () => {
  for (const name of ["delete", "remove", "destroy", "archive", "purge", "trash"]) {
    test(`ProjectService has no ${name}()`, () => {
      assert.ok(
        !PROJECT_VERBS.some((v) => v.toLowerCase() === name),
        `${name}() is not in this feature's scope`,
      );
    });

    test(`AreaService has no ${name}()`, () => {
      assert.ok(!AREA_VERBS.some((v) => v.toLowerCase() === name));
    });
  }

  test("no exported verb removes a file from the vault", async () => {
    const vault = seedVault({ "projects/p.md": STRUCTURED, "areas/a.md": "# A\n\nstatus: active\n" });
    const clock = new FixedClock();
    const projects = new ProjectService({ vault, clock });

    // Everything that could plausibly shrink the vault, run to completion.
    await projects.setOutcome("p", "The roof survives a full winter with no leak, and the insurance claim is settled.", null);
    await projects.setStatus("p", "active", "done");
    await projects.complete("p", { confirmOpenMilestones: true });

    assert.ok(vault.files.has("projects/p.md"), "the project file must survive");
    assert.ok(vault.files.has("areas/a.md"), "the area file must survive");
  });
});

describe("no WIP limit, top-three, review, or network interface (FR-049)", () => {
  test("no verb limits how many projects may be active", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`projects/p-${i}.md`] = STRUCTURED;
    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });

    // Twelve active projects is a problem for Feature 4 to have an opinion
    // about. This feature must not develop one early.
    assert.equal((await projects.listActive()).length, 12);
    const created = await projects.create("A thirteenth");
    assert.ok(created.ok, "creating past any imagined limit must succeed");
  });

  for (const forbidden of [
    /wip/i,
    /topthree|top_three|top3/i,
    /review/i,
    /weekly/i,
    /serve|listen|http|port|api/i,
  ]) {
    test(`no ProjectService verb matches ${forbidden}`, () => {
      const offender = PROJECT_VERBS.find((v) => forbidden.test(v));
      assert.equal(offender, undefined, `${offender} belongs to a later feature`);
    });
  }

  test("the package exports nothing named for a later feature", () => {
    const exported = Object.keys(core);
    for (const name of exported) {
      assert.doesNotMatch(
        name,
        /wip|topthree|weeklyreview|retrospective|httpserver/i,
        `${name} is out of scope for this feature`,
      );
    }
  });
});

describe("the exported surface is the contract", () => {
  test("both services and the pure functions are reachable", () => {
    for (const name of [
      "ProjectService",
      "AreaService",
      "structureGaps",
      "parseProject",
      "parseArea",
      "parseMilestone",
      "renderMilestone",
    ]) {
      assert.ok(name in core, `${name} must be exported for other clients to use`);
    }
  });

  test("the milestone cap is exported rather than duplicated by callers", () => {
    assert.equal(core.MILESTONE_CAP, 4);
  });
});
