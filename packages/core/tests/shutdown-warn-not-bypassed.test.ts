import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDefaultPolicy } from "../src/policy/default-policy";
import { ProjectService } from "../src/projects/project-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { WaitingService } from "../src/waiting/waiting-service";
import { seedVault } from "./project-fakes";
import { actingVault, populatedVault } from "./shutdown-fakes";

/**
 * Where a rule warns, this screen surfaces the warning and the same choice
 * (FR-039, FR-041).
 *
 * There is no bypass, no override, no suppression, and no "don't ask me again"
 * — and the strongest form of that claim is that **no core verb has a parameter
 * through which one could be expressed**. A flag that existed and went unused
 * would be one call site away from being used.
 *
 * The one confirmation parameter that does ship — `complete(slug, {
 * confirmOpenMilestones })` — is checked below and is not a bypass: it is how a
 * `warn` is *answered*, the user's yes travelling back to the same rule. It also
 * belongs to a verb this screen does not call.
 *
 * The channel and bridge half of this is `shutdown-ipc-contract.test.ts`'s,
 * because core imports nothing from Electron and cannot see a channel.
 */

const SRC = join(__dirname, "..", "..", "src");

function code(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), "utf8")
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const VERBS = {
  "TopThreeService.completeOutcome": TopThreeService.prototype.completeOutcome,
  "ProjectService.completeMilestone": ProjectService.prototype.completeMilestone,
  "ProjectService.setNextAction": ProjectService.prototype.setNextAction,
  "WaitingService.recordFollowUp": WaitingService.prototype.recordFollowUp,
  "WaitingService.recordReceived": WaitingService.prototype.recordReceived,
};

describe("the five verbs take no bypass", () => {
  test("each takes exactly the arguments it needs to identify what to write", () => {
    assert.equal(VERBS["TopThreeService.completeOutcome"].length, 1, "the ref, and nothing else");
    assert.equal(VERBS["ProjectService.completeMilestone"].length, 2, "the slug and the ref");
    assert.equal(VERBS["ProjectService.setNextAction"].length, 3, "the slug, expected, next");
    assert.equal(VERBS["WaitingService.recordFollowUp"].length, 1);
    assert.equal(VERBS["WaitingService.recordReceived"].length, 1);
  });

  test("none of their signatures names an override", () => {
    const sources = {
      "weekly/top-three-service.ts": code("weekly", "top-three-service.ts"),
      "projects/project-service.ts": code("projects", "project-service.ts"),
      "waiting/waiting-service.ts": code("waiting", "waiting-service.ts"),
    };

    for (const [file, source] of Object.entries(sources)) {
      for (const forbidden of ["force", "override", "bypass", "skipPolicy", "ignoreWarning", "suppress", "dontAsk"]) {
        assert.ok(
          !new RegExp(`\\b${forbidden}\\b`, "i").test(source),
          `${file} names "${forbidden}" — a warning with an escape hatch is not a warning`,
        );
      }
    }
  });

  test("the shutdown itself passes no options to any of them", () => {
    const service = code("shutdown", "shutdown-service.ts");

    // It cannot: it calls none of them. The service reads, and the client calls
    // the verbs — so there is no place in core where an option could be added.
    for (const verb of ["completeOutcome", "completeMilestone", "setNextAction", "recordFollowUp", "recordReceived"]) {
      assert.ok(!service.includes(verb), `ShutdownService must not call ${verb}`);
    }
  });
});

describe("the one confirmation that ships is not a bypass", () => {
  test("`confirmOpenMilestones` answers a warning rather than skipping it", async () => {
    // The rule still fires, still names the open milestones, and still returns
    // its own message; the option is the user's "yes" travelling back to it.
    const vault = seedVault({
      "projects/p.md": ["# P", "", "status: active", "", "## Milestones", "", "- [ ] Not done", ""].join("\n"),
    });
    const projects = new ProjectService({ vault, policy: createDefaultPolicy(vault) });

    const refused = await projects.complete("p");
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.reason, "open-milestones");
      assert.deepEqual(refused.open, ["Not done"]);
    }
  });

  test("and it belongs to a verb this screen does not call", () => {
    const service = code("shutdown", "shutdown-service.ts");

    assert.ok(!service.includes("complete("), "completing a project is the projects window's verb");
    assert.ok(!service.includes("confirmOpenMilestones"));
  });
});

describe("a warning reaches the caller as a value, unchanged", () => {
  test("the stale reason on the view is exactly what the rule returned", async () => {
    const { shutdown, policy } = actingVault(populatedVault());

    const view = await shutdown.read();
    const warned = policy.answers.filter((a) => a.verdict === "warn");

    assert.ok(warned.length > 0, "the fixture must produce warnings for this to mean anything");
    for (const stale of [...view.waiting.items, ...view.calendar.items]) {
      assert.ok(
        warned.some((a) => a.reason === stale.reason),
        "a warning shown in different words is a different warning",
      );
    }
  });

  test("nothing on the view offers a way to stop being told", async () => {
    const { shutdown } = actingVault(populatedVault());

    const view = await shutdown.read();
    const names = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        names.add(key);
        walk(child);
      }
    };
    walk(view);

    for (const name of names) {
      assert.doesNotMatch(name, /dismiss|snooze|mute|acknowledg|seen|hide|ignore/i, `${name} would be a suppression`);
    }
  });
});
