import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * 2026-08-14, Feature 4: the tripwire fired, and it was right to.
 *
 * This block was written to catch a WIP limit or a top-three "added just here"
 * before the feature that owns them existed. Feature 4 is that feature, so the
 * boundary moves forward rather than the tripwire being deleted: WIP and
 * top-three are now in scope, and the weekly review (Feature 5), the
 * retrospective (Feature 6) and the local API (Feature 7) are still not.
 *
 * Deliberately narrow. Everything in this file that exercises the milestone cap
 * or the open-milestone confirmation is untouched, because those are what
 * Feature 4's migration must prove it did not change (FR-062a, FR-062b).
 */
describe("no review or network interface, and no limit outside policy (FR-049)", () => {
  test("core itself still holds no opinion about how many projects may be active", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`projects/p-${i}.md`] = STRUCTURED;
    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });

    // Still true after Feature 4, and for a sharper reason: the limit counts
    // only projects whose DRI resolves to the user, and these have none. An
    // unknown owner is not the user (FR-041).
    assert.equal((await projects.listActive()).length, 12);
    const created = await projects.create("A thirteenth");
    assert.ok(created.ok, "creating past any imagined limit must succeed");
  });

  for (const forbidden of [/review/i, /serve|listen|http|port|api/i]) {
    test(`no ProjectService verb matches ${forbidden}`, () => {
      const offender = PROJECT_VERBS.find((v) => forbidden.test(v));
      assert.equal(offender, undefined, `${offender} belongs to a later feature`);
    });
  }

  test("the package exports nothing named for a still-later feature", () => {
    const exported = Object.keys(core);
    for (const name of exported) {
      assert.doesNotMatch(
        name,
        /weeklyreview|retrospective|httpserver/i,
        `${name} is out of scope for this feature`,
      );
    }
  });

  test("core consults the limit but never holds it", () => {
    // The boundary that replaces the old blanket ban on /wip/. Core may report
    // *how much* is being driven — a fact about the data — and may ask policy
    // whether that is allowed. What it must not do is know the number or make
    // the comparison itself, which is what reading `wipLimit` would mean
    // (FR-052).
    const source = readFileSync(join(__dirname, "..", "..", "src", "projects", "project-service.ts"), "utf8");
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    assert.ok(!code.includes("parsePolicyConfig"), "core read the user's policy file");
    assert.ok(!code.includes("policy-config"), "core reached into policy's configuration");
    assert.ok(!code.includes("wipLimit"), "core read the configured limit");
    assert.ok(!code.includes("weeklyOutcomeCap"), "core read another module's rule");
    assert.ok(!/>=?\s*config\./.test(code), "core made the comparison a rule should make");
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
