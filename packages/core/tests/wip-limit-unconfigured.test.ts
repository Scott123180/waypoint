import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Configuration edges (FR-049, FR-060).
 *
 * With no identity, the limit cannot fire — not because it is disabled, but
 * because no project can be *known* to be the user's. That distinction is why
 * the not-configured state is surfaced separately: a silent limit and a
 * satisfied limit look identical otherwise.
 *
 * A configured zero is honoured rather than corrected. It is a coherent thing
 * to have set, and quietly overruling it would be the app deciding it knows
 * better than the file.
 */

function project(title: string, status: string, dri: string | null): string {
  const lines = [`# ${title}`, "", `status: ${status}`];
  if (dri !== null) lines.push(`dri: ${dri}`);
  return `${lines.join("\n")}\n`;
}

function vaultOf(extra: Record<string, string> = {}) {
  const files: Record<string, string> = { ...extra };
  for (let i = 0; i < 5; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
  files["projects/candidate.md"] = project("Candidate", "parked", "Scott Rodgers");
  return seedVault(files);
}

describe("with no identity configured", () => {
  test("the limit never fires, however many projects are active", async () => {
    const projects = new ProjectService({ vault: vaultOf(), clock: new FixedClock() });
    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok);
  });

  test("the over-limit state reports nothing is being driven", async () => {
    const projects = new ProjectService({ vault: vaultOf(), clock: new FixedClock() });
    const state = await projects.overLimitState();

    assert.equal(state.driving, 0);
    assert.equal(state.hasRoom, true);
    assert.equal(state.identityConfigured, false, "so a client can say why, not just that");
  });

  test("adding identity turns the limit on with no other change", async () => {
    const vault = vaultOf();
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    assert.ok((await projects.setStatus("candidate", "parked", "active")).ok);
    await projects.setStatus("candidate", "active", "parked");

    vault.files.set("identity.md", "me: Scott Rodgers\n");
    const result = await projects.setStatus("candidate", "parked", "active");

    assert.ok(!result.ok);
    assert.equal(result.reason, "wip-limit");
  });
});

describe("with a configured limit of zero", () => {
  test("every activation of the user's projects is refused", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: 0\n",
      "projects/mine.md": project("Mine", "parked", "Scott Rodgers"),
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const result = await projects.setStatus("mine", "parked", "active");
    assert.ok(!result.ok);
    assert.equal(result.reason, "wip-limit");
  });

  test("zero is not corrected to a default", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: 0\n",
      "projects/mine.md": project("Mine", "parked", "Scott Rodgers"),
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const state = await projects.overLimitState();
    assert.equal(state.hasRoom, false, "a limit of zero leaves no room, and is not corrected");
  });

  test("someone else's projects still activate freely", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: 0\n",
      "projects/theirs.md": project("Theirs", "parked", "Priya"),
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    assert.ok((await projects.setStatus("theirs", "parked", "active")).ok);
  });
});

describe("with malformed policy configuration", () => {
  test("the default applies and nothing is blocked by the error itself", async () => {
    const files: Record<string, string> = {
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: banana\n",
    };
    for (let i = 0; i < 2; i++) files[`projects/mine-${i}.md`] = project(`Mine ${i}`, "active", "Scott Rodgers");
    files["projects/candidate.md"] = project("Candidate", "parked", "Scott Rodgers");

    const projects = new ProjectService({ vault: seedVault(files), clock: new FixedClock() });

    assert.ok(
      (await projects.setStatus("candidate", "parked", "active")).ok,
      "the default of three still leaves room for a third",
    );
  });

  test("the problem is surfaced rather than thrown", async () => {
    const vault = seedVault({
      "identity.md": "me: Scott Rodgers\n",
      "policy.md": "wip limit: banana\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    const state = await projects.overLimitState();
    assert.equal(state.hasRoom, true, "the default of three applies, so nothing is blocked");
    assert.match(state.message, /wip limit/, "and the user is told their file has a problem");
  });
});
