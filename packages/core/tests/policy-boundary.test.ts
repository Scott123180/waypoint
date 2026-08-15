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

  test("the public surface exposes no extension-registration API", () => {
    // FR-064: the seam and one default module only. A loader, a registry, or a
    // `registerPolicy` export would be a promise that is expensive to take back.
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const forbidden of ["registerPolicy", "PolicyRegistry", "loadPolicy", "discoverPolic"]) {
      assert.ok(!index.includes(forbidden), `index.ts exports ${forbidden} — no extension surface yet`);
    }
  });
});
