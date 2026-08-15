import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The alias list is the user's, and only the user's (FR-030, SC-017).
 *
 * The tempting behaviour this forbids: noticing that `Scott R.` keeps appearing
 * and helpfully adding it as an alias. That would silently claim another
 * person's work — the exact failure the whole matching design exists to
 * prevent — and it would do so invisibly, in a file the user believes they
 * control.
 *
 * A prohibition with no test is a comment.
 */

const IDENTITY = ["# Identity", "", "me: Scott Rodgers", "", "## Aliases", "", "- scott", ""].join("\n");

const PROJECT = [
  "# Roof repair",
  "",
  "status: active",
  "dri: Scott R.",
  "",
  "## Milestones",
  "",
  "- [ ] Estimate approved — @Scott K.",
  "",
].join("\n");

function setup() {
  const vault = seedVault({ "projects/roof.md": PROJECT, "identity.md": IDENTITY });
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("identity is never inferred", () => {
  test("running every DRI-touching verb leaves identity.md byte-for-byte unchanged", async () => {
    const { vault, projects } = setup();

    await projects.list();
    await projects.get("roof");
    await projects.getResolved("roof");
    await projects.setDri("roof", "Scott R.", "Scott K.");
    await projects.setDri("roof", "Scott K.", null);
    await projects.setDri("roof", null, "Someone Entirely New");
    await projects.list();

    assert.equal(vault.files.get("identity.md"), IDENTITY, "identity.md must not have changed");
  });

  test("identity.md is never written to at all", async () => {
    const { vault, projects } = setup();

    await projects.list();
    await projects.setDri("roof", "Scott R.", "Priya Sharma");

    assert.ok(!vault.writeLog.includes("identity.md"), "identity.md appeared in the write log");
  });

  test("an unmatched DRI stays unmatched however often it is seen", async () => {
    // `Scott R.` is not `Scott` and not `Scott Rodgers`; it is a third
    // spelling the user has not claimed. Reading it five times must not make
    // it any more the user's than reading it once (FR-026, FR-027).
    const { vault, projects } = setup();

    for (let i = 0; i < 5; i++) await projects.list();

    const [summary] = await projects.list();
    assert.equal(
      summary?.dri.resolution,
      "theirs",
      "seeing a name repeatedly is not evidence about who it is",
    );
    assert.equal(vault.files.get("identity.md"), IDENTITY);
  });

  test("setting a DRI to a new name does not claim it", async () => {
    const { projects } = setup();
    await projects.setDri("roof", "Scott R.", "Brand New Person");

    const [summary] = await projects.list();
    assert.equal(summary?.dri.resolution, "theirs", "typing a name is not claiming it");
  });

  test("no verb offers to add, learn or suggest an alias", () => {
    const verbs = Object.getOwnPropertyNames(ProjectService.prototype);
    for (const banned of [/alias/i, /claim/i, /learn/i]) {
      const offender = verbs.find((v) => banned.test(v));
      assert.equal(offender, undefined, `${offender} would let the app maintain the alias list`);
    }
  });

  test("no source file in identity/ carries inference machinery", () => {
    const dir = join(__dirname, "..", "..", "src", "identity");
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, entry), "utf8");
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const banned of ["suggest", "infer", "guess", "levenshtein", "fuzzy", "similar"]) {
        assert.ok(
          !code.toLowerCase().includes(banned),
          `identity/${entry} contains "${banned}" outside a comment`,
        );
      }
    }
  });

  test("identity resolution never writes anywhere", async () => {
    const { vault, projects } = setup();
    await projects.list();
    await projects.getResolved("roof");

    assert.deepEqual(vault.writeLog, [], "resolving is a read, start to finish");
  });
});
