import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * With no identity configured, nothing is the user's — and that is said
 * plainly rather than implied (FR-031).
 *
 * "No projects are mine" and "I have not told the system who I am" look the
 * same from a distance and mean completely different things. The second is the
 * reason the WIP limit is silent, and a user who cannot tell them apart will
 * conclude the limit is broken.
 */

const PROJECT = ["# Roof repair", "", "status: active", "dri: Scott Rodgers", ""].join("\n");

describe("identity not configured", () => {
  test("no project resolves to the user", async () => {
    const vault = seedVault({ "projects/roof.md": PROJECT });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.dri.resolution, "theirs");
  });

  test("nothing errors and the list still comes back", async () => {
    const vault = seedVault({ "projects/a.md": PROJECT, "projects/b.md": "# B\n\nstatus: active\n" });
    const summaries = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summaries.length, 2);
  });

  test("reading does not create identity.md", async () => {
    const vault = seedVault({ "projects/roof.md": PROJECT });
    await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.ok(!vault.files.has("identity.md"), "no file is created unasked (FR-059)");
    assert.deepEqual(vault.writeLog, []);
  });

  test("the not-configured state is distinguishable from 'nothing is mine'", async () => {
    const vault = seedVault({ "projects/roof.md": PROJECT });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    assert.equal(await projects.identityConfigured(), false);

    vault.files.set("identity.md", "me: Priya Sharma\n");
    assert.equal(
      await projects.identityConfigured(),
      true,
      "configured, and separately nothing happens to be mine",
    );
    assert.equal((await projects.list())[0]?.dri.resolution, "theirs");
  });

  test("a file naming no canonical value is not configured", async () => {
    const vault = seedVault({
      "projects/roof.md": PROJECT,
      "identity.md": "# Identity\n\n## Aliases\n\n- scott\n",
    });
    const projects = new ProjectService({ vault, clock: new FixedClock() });

    assert.equal(await projects.identityConfigured(), false);
    assert.equal((await projects.list())[0]?.dri.resolution, "theirs");
  });

  test("a project with no DRI is still unassigned, not theirs", async () => {
    // The needs-a-DRI signal does not depend on identity being configured.
    const vault = seedVault({ "projects/stub.md": "# Stub\n\nstatus: active\n" });
    const [summary] = await new ProjectService({ vault, clock: new FixedClock() }).list();

    assert.equal(summary?.dri.resolution, "unassigned");
    assert.equal(summary?.needsDri, true);
  });
});
