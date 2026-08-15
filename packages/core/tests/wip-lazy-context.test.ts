import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import type { Decision, DecisionContext, PolicyModule } from "../src/ports/index";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * A rule pays only for what it asks for (research R4).
 *
 * Core cannot compute the WIP count only when the target status is `active`,
 * because "only when active" *is* the rule — knowing that would be core
 * knowing the rules. But eagerly listing every project on every decision would
 * make adding a milestone as expensive as rendering the whole list.
 *
 * A lazy accessor resolves the tension: core offers the capability
 * unconditionally, and the module decides whether to pay for it. This test is
 * what keeps that property from quietly regressing into an eager field.
 */

/** Records what each decision was given, and calls nothing on its own. */
class SpyPolicy implements PolicyModule {
  contexts: DecisionContext[] = [];
  accessorCalls = 0;

  async decide(context: DecisionContext): Promise<Decision> {
    this.contexts.push(context);
    if (context.point === "project.status.change") {
      const original = context.activeProjectsDrivenByUser;
      context.activeProjectsDrivenByUser = async () => {
        this.accessorCalls += 1;
        return original();
      };
    }
    return { verdict: "allow", reason: "" };
  }
}

const PROJECT = ["# P", "", "status: active", "dri: Scott Rodgers", ""].join("\n");

function service(policy: PolicyModule) {
  const vault = seedVault({ "projects/p.md": PROJECT, "identity.md": "me: Scott Rodgers\n" });
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock(), policy }) };
}

describe("lazy decision context", () => {
  test("the milestone point is never handed the vault accessor", async () => {
    const policy = new SpyPolicy();
    await policy.decide({
      point: "project.milestone.add",
      project: { slug: "p", title: "P", status: "active", dri: null },
      milestoneCount: 0,
    });

    const context = policy.contexts[0];
    assert.ok(context);
    assert.ok(
      !("activeProjectsDrivenByUser" in context),
      "a rule that cannot need the vault is not handed a way to read it",
    );
  });

  test("the outcome point is never handed the vault accessor either", async () => {
    const policy = new SpyPolicy();
    await policy.decide({ point: "week.outcome.record", week: "2026-W33", outcomeCount: 0 });

    const context = policy.contexts[0];
    assert.ok(context);
    assert.ok(!("activeProjectsDrivenByUser" in context));
  });

  test("a status rule that does not call the accessor costs nothing", async () => {
    const policy = new SpyPolicy();
    const { projects } = service(policy);

    await projects.setStatus("p", "active", "parked");

    assert.equal(policy.accessorCalls, 0, "the module allowed without asking, and paid for nothing");
  });

  test("the accessor works when a rule does call it", async () => {
    const policy = new SpyPolicy();
    const { projects } = service(policy);

    await projects.setStatus("p", "active", "parked");

    const context = policy.contexts.find((c) => c.point === "project.status.change");
    assert.ok(context && context.point === "project.status.change");
    assert.deepEqual(await context.activeProjectsDrivenByUser(), [], "the project being changed is excluded");
  });

  test("the status context carries the resolved DRI, so policy never resolves identity", async () => {
    const policy = new SpyPolicy();
    const { projects } = service(policy);

    await projects.setStatus("p", "active", "parked");

    const context = policy.contexts.find((c) => c.point === "project.status.change");
    assert.ok(context && context.point === "project.status.change");
    assert.equal(context.dri.resolution, "mine", "resolved by core (FR-053)");
  });

  test("the accessor excludes the project being changed", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "projects/a.md": ["# A", "", "status: active", "dri: Scott Rodgers", ""].join("\n"),
      "projects/b.md": ["# B", "", "status: active", "dri: Scott Rodgers", ""].join("\n"),
    });
    const policy = new SpyPolicy();
    const projects = new ProjectService({ vault, clock: new FixedClock(), policy });

    await projects.setStatus("a", "active", "active");

    const context = policy.contexts.find((c) => c.point === "project.status.change");
    assert.ok(context && context.point === "project.status.change");
    const others = await context.activeProjectsDrivenByUser();
    assert.deepEqual(
      others.map((p) => p.slug),
      ["b"],
      "otherwise a no-op write would count itself and refuse at the limit rather than above it",
    );
  });
});
