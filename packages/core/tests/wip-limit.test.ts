import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The work-in-progress limit (FR-038, FR-044–FR-047).
 *
 * A `block`, not a warning. The roadmap's word is "refuses", and a refusal that
 * can be clicked through is not the guardrail described — it is a speed bump
 * that trains the user to dismiss the system's refusals.
 *
 * What makes it usable rather than infuriating is that it names the way out.
 */

const IDENTITY = "me: Scott Rodgers\n";

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

/** `count` active projects the user is DRI on, plus one parked candidate. */
function vaultOf(count: number, extra: Record<string, string> = {}) {
  const files: Record<string, string> = { "identity.md": IDENTITY, ...extra };
  for (let i = 0; i < count; i++) {
    files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
  }
  files["projects/candidate.md"] = project("Candidate", "parked", "Scott Rodgers");
  return seedVault(files);
}

function service(vault: ReturnType<typeof seedVault>) {
  return new ProjectService({ vault, clock: new FixedClock() });
}

describe("the WIP limit", () => {
  test("at the limit, activating another of the user's projects is refused", async () => {
    const vault = vaultOf(3);
    const projects = service(vault);

    const result = await projects.setStatus("candidate", "parked", "active");

    assert.ok(!result.ok);
    assert.equal(result.reason, "wip-limit");
  });

  test("the refusal states the rule, the count and the limit", async () => {
    const projects = service(vaultOf(3));
    const result = await projects.setStatus("candidate", "parked", "active");

    assert.ok(!result.ok);
    assert.match(result.message, /3/, "the count and the limit are both three here");
    assert.match(result.message, /driv|active/i, "it says what the rule is about");
  });

  test("the refusal names the projects to finish or park", async () => {
    const projects = service(vaultOf(3));
    const result = await projects.setStatus("candidate", "parked", "active");

    assert.ok(!result.ok);
    assert.deepEqual(result.subjects?.sort(), ["Mine 0", "Mine 1", "Mine 2"]);
  });

  test("every named project is verifiably active and the user's", async () => {
    const vault = vaultOf(3, {
      "projects/theirs.md": project("Theirs", "active", "Priya Sharma"),
      "projects/nobody.md": project("Nobody", "active", null),
      "projects/parked-mine.md": project("Parked mine", "parked", "Scott Rodgers"),
    });
    const projects = service(vault);

    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(!result.ok);

    const summaries = await projects.list();
    for (const title of result.subjects ?? []) {
      const found = summaries.find((s) => s.title === title);
      assert.equal(found?.status, "active", `${title} must be active`);
      assert.equal(found?.dri.resolution, "mine", `${title} must be the user's`);
    }
    assert.ok(!result.subjects?.includes("Theirs"));
    assert.ok(!result.subjects?.includes("Nobody"));
    assert.ok(!result.subjects?.includes("Parked mine"));
  });

  test("the refusal writes nothing", async () => {
    const vault = vaultOf(3);
    const before = vault.files.get("projects/candidate.md");

    await service(vault).setStatus("candidate", "parked", "active");

    assert.equal(vault.files.get("projects/candidate.md"), before);
    assert.deepEqual(vault.writeLog, []);
  });

  test("parking one of the named projects makes room", async () => {
    const vault = vaultOf(3);
    const projects = service(vault);

    assert.ok(!(await projects.setStatus("candidate", "parked", "active")).ok);
    assert.ok((await projects.setStatus("mine-0", "active", "parked")).ok);
    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok, "room was made");
  });

  test("finishing one of the named projects makes room", async () => {
    const vault = vaultOf(3);
    const projects = service(vault);

    assert.ok(!(await projects.setStatus("candidate", "parked", "active")).ok);
    assert.ok((await projects.complete("mine-0", { confirmOpenMilestones: true })).ok);
    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok);
  });

  test("below the limit, activating succeeds with no message at all", async () => {
    const vault = vaultOf(2);
    const result = await service(vault).setStatus("candidate", "parked", "active");

    assert.ok(result.ok);
    assert.equal(result.project.status, "active");
  });

  test("the boundary is exact: the third is accepted, the fourth refused", async () => {
    const vault = vaultOf(2);
    const projects = service(vault);

    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok, "the third");

    vault.files.set("projects/fourth.md", project("Fourth", "parked", "Scott Rodgers"));
    assert.ok(!(await projects.setStatus("fourth", "parked", "active")).ok, "the fourth");
  });

  test("reopening a done project into active is subject to the limit too", async () => {
    const vault = vaultOf(3, {
      "projects/finished.md": project("Finished", "done", "Scott Rodgers"),
    });
    const projects = service(vault);

    const result = await projects.reopen("finished", "active");
    assert.ok(!result.ok);
    assert.equal(result.reason, "wip-limit");
  });

  test("reopening into parked is never refused", async () => {
    const vault = vaultOf(3, {
      "projects/finished.md": project("Finished", "done", "Scott Rodgers"),
    });
    assert.ok((await service(vault).reopen("finished", "parked")).ok);
  });

  test("the decision is made against the state on disk at that moment (FR-047)", async () => {
    // Another window parks one of the counted projects between reads. The
    // refusal must not name a project that is no longer active — and here,
    // must not fire at all, because there is now room.
    const vault = vaultOf(3);
    const projects = service(vault);

    vault.files.set("projects/mine-0.md", project("Mine 0", "parked", "Scott Rodgers"));

    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(result.ok, "the count is re-read at decision time, not remembered");
  });

  test("a project no longer active is never named in a refusal", async () => {
    const vault = vaultOf(4);
    const projects = service(vault);

    vault.files.set("projects/mine-0.md", project("Mine 0", "done", "Scott Rodgers"));

    const result = await projects.setStatus("candidate", "parked", "active");
    assert.ok(!result.ok, "still over the limit with three left");
    assert.ok(!result.subjects?.includes("Mine 0"), "a finished project is not something to finish");
  });
});
