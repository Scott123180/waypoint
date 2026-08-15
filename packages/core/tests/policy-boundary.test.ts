import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The module boundary, enforced rather than described.
 *
 * Policy lives in its own directory inside `packages/core` rather than its own
 * workspace package, because core must be able to default to the one shipped
 * module and a package split would make that a cycle (research R2, R3). What a
 * package split would have given for free — an import direction that cannot be
 * violated — this test gives instead.
 *
 * The direction that matters most is `identity/` never importing `policy/`:
 * that is the property Feature 5's review and Feature 6's retrospective will
 * rely on to resolve identity without depending on policy (FR-053). Without a
 * test, the boundary is a comment.
 *
 * Reads TypeScript source rather than compiled output, so a type-only import
 * — erased by the compiler — is caught too.
 */

const SRC = join(__dirname, "..", "..", "src");

function sourcesIn(dir: string): { file: string; text: string }[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => ({
      file: `${dir}/${e.name}`,
      text: readFileSync(join(SRC, dir, e.name), "utf8"),
    }));
}

/** Source with block and line comments removed, so scans read code alone. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Every module path this file imports from, however the import is spelled. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from|require\()\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) found.push(m[1] ?? "");
  return found;
}

describe("policy module boundary", () => {
  test("identity/ never imports policy/", () => {
    for (const { file, text } of sourcesIn("identity")) {
      for (const path of importsOf(text)) {
        assert.ok(
          !path.includes("policy"),
          `${file} imports ${path} — identity must stay usable without the policy module (FR-053)`,
        );
      }
    }
  });

  test("policy/ imports no service", () => {
    // A rule answers a question; it does not act. Handing it a service would
    // let a rule write, and invert the dependency the seam exists to create.
    for (const { file, text } of sourcesIn("policy")) {
      for (const path of importsOf(text)) {
        assert.ok(
          !path.includes("-service"),
          `${file} imports ${path} — a policy rule must not reach a service`,
        );
      }
    }
  });

  test("policy/ does not import projects/ or weekly/", () => {
    for (const { file, text } of sourcesIn("policy")) {
      for (const path of importsOf(text)) {
        assert.ok(
          !path.includes("projects/") && !path.includes("weekly/"),
          `${file} imports ${path} — policy reads the seam's payloads, not the domain modules`,
        );
      }
    }
  });

  test("projects/ and weekly/ reach policy/ only through the default factory", () => {
    for (const dir of ["projects", "weekly"]) {
      for (const { file, text } of sourcesIn(dir)) {
        for (const path of importsOf(text)) {
          if (!path.includes("policy")) continue;
          assert.ok(
            path.endsWith("policy/default-policy"),
            `${file} imports ${path} — the only permitted reach into policy/ is the createDefaultPolicy factory`,
          );
          assert.match(
            text,
            /createDefaultPolicy/,
            `${file} imports the policy module for something other than the factory`,
          );
        }
      }
    }
  });

  test("no rule value leaks out of policy/", () => {
    // Feature 5 added two settings, and both are the kind that get "helpfully"
    // duplicated: a `STALENESS_DAYS = 7` beside the code that uses it, or a
    // `gate === "block"` branch in the service that consults the gate. Either
    // would mean two places to change one rule, and they would disagree the
    // first time only one was edited (005 FR-078, FR-079).
    for (const dir of ["review", "waiting", "projects", "weekly", "identity", "vault"]) {
      for (const { file, text: source } of sourcesIn(dir)) {
        // Comments are stripped first. A module is allowed — encouraged — to
        // *explain* the rule it consults; what it may not do is implement one.
        // Without this the assertion fires on prose, which teaches people to
        // stop writing the prose.
        const text = withoutComments(source);

        assert.doesNotMatch(
          text,
          /stalenessDays|staleness days|inboxGate|inbox gate/,
          `${file} names a policy setting — the rule and its threshold live in policy/`,
        );
        // Core *must* branch on a verdict — `allow`/`warn`/`block` is the
        // seam's vocabulary and acting on the answer is the whole point. What
        // it must never do is compute one: comparing a duration to a number is
        // the staleness rule, wherever it is written.
        // Against a *positive* number. `days < 0` is a sign check — a
        // hand-edited file can date a transition after the day it is read, and
        // guarding that is arithmetic, not policy. A threshold is a number
        // someone chose, and every number someone chose is a rule.
        assert.doesNotMatch(
          text,
          /\bdays?\b\s*[<>]=?\s*[1-9]/i,
          `${file} compares a duration to a threshold — that comparison is the rule (005 FR-079)`,
        );
      }
    }
  });

  test("review/ and waiting/ import nothing from Electron", () => {
    // Principle II, checked at the only place it can be lost silently. The
    // client renders what these modules decide; a module that reached for
    // Electron would have moved the decision into the client's process.
    for (const dir of ["review", "waiting"]) {
      for (const { file, text } of sourcesIn(dir)) {
        for (const path of importsOf(text)) {
          assert.ok(
            !path.includes("electron") && !path.startsWith("@waypoint/desktop"),
            `${file} imports ${path} — core must run without a client (005 FR-086)`,
          );
        }
      }
    }
  });

  test("the summary port has exactly one call site", () => {
    // FR-102: one interface, one place it is invoked, supplied by injection.
    // The guard is the count, the same way T006 guards the decision points —
    // a second call site is how "one narrow seam" quietly becomes a plugin
    // system nobody decided to build.
    const dirs = ["review", "waiting", "projects", "weekly", "policy", "identity", "vault", "sort", "inbox"];
    const sites: string[] = [];

    for (const dir of dirs) {
      for (const { file, text } of sourcesIn(dir)) {
        for (const line of text.split("\n")) {
          // `.draft(` as a call, not the `draft(` of the interface declaration.
          if (/\.draft\(/.test(line)) sites.push(`${file}: ${line.trim()}`);
        }
      }
    }

    assert.equal(sites.length, 1, `expected one call site, found:\n${sites.join("\n")}`);
    assert.match(sites[0] ?? "", /^review\/review-service\.ts:/, "and it is at review completion");
  });

  test("the public surface exposes no extension-registration API", () => {
    // FR-064: the seam and one default module only. A loader, a registry, or a
    // `registerPolicy` export would be a promise that is expensive to take back.
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const forbidden of ["registerPolicy", "PolicyRegistry", "loadPolicy", "discoverPolic"]) {
      assert.ok(!index.includes(forbidden), `index.ts exports ${forbidden} — no extension surface yet`);
    }
  });
});
