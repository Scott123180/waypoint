import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * SC-001 and FR-061: **every** existing feature suite passes against a build
 * with no transport configured.
 *
 * Features 1 through 6, not Feature 2 alone. Feature 1's suite is what proves
 * capture is untouched (FR-071); Features 3–6 are what prove nothing else came
 * to depend on this layer. If any of them needed editing, the degrade-to-
 * nothing contract is broken and the right response is to stop, not to edit
 * the test.
 *
 * **The executed count is asserted.** That is the whole reason this file
 * shells out rather than trusting the suite as a whole: a green that came from
 * a glob matching nothing, or a runner silently skipping a directory, is
 * exactly the failure mode this guarantee is most exposed to. A number that
 * only ever goes up when someone changes it deliberately is the cheapest
 * defence against a test that quietly stopped running.
 */

const REPO = resolve(__dirname, "..", "..", "..", "..");

/**
 * The test files as they existed before this feature, straight from git.
 *
 * Derived rather than listed, so a new Feature 8 test cannot wander into the
 * baseline and inflate it.
 */
function baselineFiles(): string[] {
  const tracked = execFileSync(
    "git",
    ["ls-tree", "-r", "HEAD", "--name-only"],
    { cwd: REPO, encoding: "utf8" },
  );

  return tracked
    .split("\n")
    .filter((p) => /^packages\/(core|desktop)\/tests\/.*\.test\.ts$/.test(p))
    .map((p) => join(REPO, p.replace("/tests/", "/dist/tests/").replace(/\.ts$/, ".js")))
    .sort();
}

/**
 * Exactly what was observed on 2026-08-17, with no `intelligence.md` anywhere.
 *
 * Raise these deliberately when a feature adds tests. If they fall, something
 * stopped running.
 */
const EXPECTED_FILES = 187;
const EXPECTED_TESTS = 1646;

describe("Features 1 through 6, against an unconfigured build", () => {
  test("every pre-existing test file is still there", () => {
    const files = baselineFiles();
    assert.equal(files.length, EXPECTED_FILES, "the baseline changed size");

    for (const file of files) {
      assert.ok(existsSync(file), `${file} was not compiled — it cannot have run`);
    }
  });

  test("they all pass, and the executed count is what it was", () => {
    const files = baselineFiles();

    // `NODE_TEST_CONTEXT` is set by the runner we are running *under*, and a
    // child that sees it switches to a nested reporter that prints no totals.
    // Stripping it is what makes the counts below readable at all.
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: "America/New_York" };
    delete env["NODE_TEST_CONTEXT"];
    delete env["NODE_OPTIONS"];

    const result = execFileSync(process.execPath, ["--test", ...files], {
      cwd: REPO,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });

    const number = (label: string): number => {
      const match = new RegExp(`^# ${label} (\\d+)$`, "m").exec(result);
      assert.ok(match, `the runner printed no ${label} count`);
      return Number(match[1]);
    };

    assert.equal(number("fail"), 0, "a pre-existing suite failed with nothing configured");
    assert.equal(
      number("tests"),
      EXPECTED_TESTS,
      "the executed count moved — a suite may have silently not run",
    );
    assert.equal(number("pass"), EXPECTED_TESTS);
  });
});

describe("what this feature was allowed to change", () => {
  /** Files with uncommitted modifications, from git rather than from memory. */
  function modified(): string[] {
    return execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("??"))
      .map((line) => line.slice(3).trim())
      .filter((p) => /^packages\/(core|desktop)\/tests\//.test(p))
      .sort();
  }

  /**
   * The plan predicted **one** existing test file would change:
   * `sort-scope-boundaries.test.ts`, by one line plus a dated comment.
   *
   * Two more did, and both are *helpers* rather than tests — they had to,
   * because they implement interfaces this feature widened. Recorded here
   * rather than left to be noticed: Feature 6's plan predicted "zero existing
   * tests modified" and was wrong, and writing the prediction down is what
   * made that visible.
   *
   *   - `sort-fakes.ts` implements `InboxDocument`, which gained
   *     `replaceRange`. A fake that did not implement it would not compile.
   *   - `e2e/harness.ts` gained two launch options. `intelligence.md` is read
   *     at startup, so a vault seeded after launch would be read by nothing.
   *
   * Neither changes what any existing test asserts, which is the line that
   * matters — and the count assertion above is what proves it.
   */
  test("exactly three test-tree files, and each one is accounted for", () => {
    assert.deepEqual(modified(), [
      "packages/core/tests/sort-fakes.ts",
      "packages/core/tests/sort-scope-boundaries.test.ts",
      "packages/desktop/tests/e2e/harness.ts",
    ]);
  });

  test("only one of them is a test file rather than a helper", () => {
    const tests = modified().filter((p) => p.endsWith(".test.ts"));
    assert.deepEqual(tests, ["packages/core/tests/sort-scope-boundaries.test.ts"]);
  });

  test("the guards this feature must not have touched are untouched", () => {
    const untouched = [
      "packages/core/tests/decision-points.test.ts",
      "packages/core/tests/sort-no-suggestion.test.ts",
      "packages/core/tests/sort-offline.test.ts",
      "packages/core/tests/summary-payload.test.ts",
      "packages/core/tests/project-scope-boundaries.test.ts",
      "packages/core/tests/policy-no-files-created.test.ts",
      "packages/core/tests/review-no-outbound.test.ts",
    ];

    for (const path of untouched) {
      assert.ok(!modified().includes(path), `${path} was edited, and it is a guard`);
    }
  });
});
