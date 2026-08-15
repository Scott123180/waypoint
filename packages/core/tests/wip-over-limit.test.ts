import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * An over-limit vault is shown, never corrected (FR-050, FR-051).
 *
 * In a plain-text system the user can always reach a state the rules would have
 * refused — by editing four files in vim, or by pulling a branch. The honest
 * response is to say so and carry on. Silently rewriting the user's files to
 * satisfy a rule would violate the guarantee the format exists to provide, and
 * would be a far worse failure than the over-commitment it "fixed".
 */

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

/** Five of the user's projects active, against a limit of three. */
function overCommitted(extra: Record<string, string> = {}) {
  const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n", ...extra };
  for (let i = 0; i < 5; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("already over the limit", () => {
  test("the state is reported plainly", async () => {
    const { projects } = overCommitted();
    const state = await projects.overLimitState();

    assert.equal(state.driving, 5);
    assert.equal(state.hasRoom, false);
    assert.match(state.message, /3/, "the module's message carries the limit");
  });

  test("it names which projects are being driven", async () => {
    const { projects } = overCommitted();
    const state = await projects.overLimitState();

    assert.deepEqual(state.subjects.sort(), ["Mine 0", "Mine 1", "Mine 2", "Mine 3", "Mine 4"]);
  });

  test("nothing is written and no status is changed", async () => {
    const { vault, projects } = overCommitted();
    const before = new Map(vault.files);

    await projects.list();
    await projects.overLimitState();

    assert.deepEqual(vault.writeLog, [], "reading an over-limit vault must not repair it");
    for (const [path, content] of before) {
      assert.equal(vault.files.get(path), content, `${path} must be untouched`);
    }
  });

  test("nothing is blocked", async () => {
    // The state is informational. Every verb still works, including ones that
    // leave the vault just as over-committed as before.
    const { projects } = overCommitted();

    assert.ok((await projects.setOutcome("mine-0", null, "An outcome")).ok);
    assert.ok((await projects.addMilestone("mine-0", "A milestone", null)).ok);
    assert.ok((await projects.setStatus("mine-0", "active", "waiting")).ok);

    // Going *back* to active is refused, and correctly so: with four still
    // being driven against a limit of three, re-activating is one more. Being
    // over the limit does not mean the limit has given up.
    const back = await projects.setStatus("mine-0", "waiting", "active");
    assert.ok(!back.ok);
    assert.equal(back.reason, "wip-limit");
  });

  test("activating a further project is still refused", async () => {
    // Being over the limit does not mean the limit has given up.
    const { projects } = overCommitted({
      "projects/candidate.md": project("Candidate", "parked", "Scott Rodgers"),
    });

    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(!result.ok);
    assert.equal(result.reason, "wip-limit");
  });

  test("the state is derived on every read", async () => {
    const { vault, projects } = overCommitted();
    assert.equal((await projects.overLimitState()).hasRoom, false);

    vault.files.set("projects/mine-0.md", project("Mine 0", "parked", "Scott Rodgers"));
    vault.files.set("projects/mine-1.md", project("Mine 1", "parked", "Scott Rodgers"));

    const state = await projects.overLimitState();
    assert.equal(state.driving, 3);
    assert.equal(state.hasRoom, false, "three of three leaves no room, but is not over");
  });

  test("exactly at the limit is not over it", async () => {
    const files: Record<string, string> = { "identity.md": "me: Scott Rodgers\n" };
    for (let i = 0; i < 3; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });
    const state = await projects.overLimitState();

    assert.equal(state.driving, 3);
    assert.equal(state.hasRoom, false, "no room for a fourth, which is what a client shows");
  });
});
