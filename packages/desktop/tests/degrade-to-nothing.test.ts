import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
 *
 * ---
 *
 * **This file asks git nothing, and that is the fix for two real failures.**
 *
 * It first derived the baseline from `git ls-tree HEAD`, reasoning that a list
 * rots and a query does not. `HEAD` meant "before Feature 8" for exactly as
 * long as Feature 8 was uncommitted. The first push moved it: the baseline
 * grew from 187 files to 228 and **included this file**, which spawns a runner
 * over the baseline — so it spawned itself. Both CI jobs sat on a three-second
 * step for twenty-one minutes.
 *
 * Pinning the query to the pre-feature commit fixed the recursion and failed
 * differently: `actions/checkout` clones shallow, so that commit does not
 * exist on a runner at all — `fatal: Not a valid object name`.
 *
 * The baseline is therefore **frozen into a fixture**, generated once from
 * that commit and committed alongside this file. It works in a shallow clone,
 * in a source tarball, and with no git at all, and it cannot drift, because
 * nothing recomputes it. The original instinct — "derived, so a new Feature 8
 * test cannot wander in and inflate it" — is better served by a list that is
 * incapable of changing than by a query whose answer depends on when it is
 * asked.
 */

const REPO = resolve(__dirname, "..", "..", "..", "..");

interface Baseline {
  expectedTests: number;
  files: Record<string, string>;
}

/** The 187 test files and their contents as of the commit before this feature. */
const BASELINE = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "baseline-before-008.json"), "utf8"),
) as Baseline;

const EXPECTED_FILES = 187;
const EXPECTED_TESTS = 1646;

/** Where the compiled form of each baseline source file lands. */
function compiled(source: string): string {
  return join(REPO, source.replace("/tests/", "/dist/tests/").replace(/\.ts$/, ".js"));
}

function baselineFiles(): string[] {
  const files = Object.keys(BASELINE.files).sort().map(compiled);

  // Structural, not stylistic. A runner spawned over a list containing this
  // file runs this file, which spawns a runner. However the baseline is ever
  // regenerated, that must stop here rather than in the process table.
  assert.ok(
    !files.some((f) => f.includes("degrade-to-nothing")),
    "the baseline contains this very file — running it would recurse",
  );

  return files;
}

describe("Features 1 through 6, against an unconfigured build", () => {
  test("the frozen baseline is the one that was measured", () => {
    assert.equal(Object.keys(BASELINE.files).length, EXPECTED_FILES, "the baseline changed size");
    assert.equal(BASELINE.expectedTests, EXPECTED_TESTS, "the fixture and this file disagree");
  });

  test("every pre-existing test file is still there", () => {
    for (const file of baselineFiles()) {
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

    // `spawnSync`, not `execFileSync`, and the reason is a CI round trip that
    // was wasted learning it: `execFileSync` throws on a non-zero exit with a
    // message that is the *command* — here, two thousand characters of file
    // paths — and the child's own output is on a property the test runner does
    // not print. A nested suite whose failure cannot be read is only slightly
    // better than one that hangs. This keeps the output and shows the part
    // that says what broke.
    const run = spawnSync(process.execPath, ["--test", ...files], {
      cwd: REPO,
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    });

    const result = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    if (run.status !== 0) {
      // Every failing subtest, with the assertion beneath it — enough to act
      // on from a CI log alone, without reproducing the run.
      const failures = result
        .split("\n")
        .filter((line, i, all) =>
          /^\s*not ok /.test(line) ||
          (/^\s*(error|expected|actual|operator):/.test(line) &&
            all.slice(Math.max(0, i - 12), i).some((l) => /^\s*not ok /.test(l))),
        )
        .slice(0, 60)
        .join("\n");

      assert.fail(
        `the pre-existing suite failed against an unconfigured build (exit ${run.status}):\n${failures}`,
      );
    }

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
  /**
   * Pre-existing test-tree files whose **contents** differ from the frozen
   * baseline.
   *
   * By content, not by git bookkeeping. This previously read
   * `git status --porcelain`, which sees only uncommitted work: the moment the
   * branch was committed it returned the empty list, so the two assertions
   * below would have failed and the guard assertion beneath them would have
   * passed vacuously forever. A guard that cannot fail is not a guard.
   *
   * A hash comparison has neither problem. It gives the same answer before the
   * commit, after the commit, and in a checkout with no history — and it
   * answers the question actually being asked, which was never "what does git
   * think is dirty" but "which of these files is no longer what it was".
   */
  function changed(): string[] {
    return Object.entries(BASELINE.files)
      .filter(([source, hash]) => {
        const path = join(REPO, source);
        if (!existsSync(path)) return true;
        return createHash("sha256").update(readFileSync(path)).digest("hex") !== hash;
      })
      .map(([source]) => source)
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
   *
   * Only `sort-scope-boundaries.test.ts` appears below: the baseline covers
   * `*.test.ts`, and the other two are helpers, which is precisely the
   * distinction the plan's prediction failed to draw.
   *
   * **2026-08-19, Feature 9.** A second entry joined the list, and it is not
   * Feature 9's doing — the shutdown changed no pre-existing test. Cutting the
   * 0.8.0 release surfaced a genuine O(n²) defect in `inbox/parse.ts`:
   * `toLines` recomputed `Buffer.byteLength(doc)` once per line, so a
   * 16,000-item inbox took 1.7s and every doubling of the input cost ~4x the
   * time. `inbox-parse-perf.test.ts` existed to catch exactly that and could
   * not: it took single un-warmed measurements and floored the baseline at 1ms,
   * which inflated the denominator enough to let a quadratic parser slip under
   * the threshold — so it failed intermittently on shared runners instead, and
   * the intermittency was read as runner noise and answered by widening the
   * tolerance. The test now takes the best of five runs at sizes well clear of
   * timer resolution and carries no floor. It is a changed pre-existing test
   * rather than a helper, so it is named here rather than folded into the
   * paragraph above.
   */
  test("exactly two pre-existing test files changed, and both are accounted for", () => {
    assert.deepEqual(changed(), [
      "packages/core/tests/inbox-parse-perf.test.ts",
      "packages/core/tests/sort-scope-boundaries.test.ts",
    ]);
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
      // Each must be in the baseline at all — a guard dropped from the fixture
      // would otherwise "pass" by not being looked at.
      assert.ok(BASELINE.files[path], `${path} is not in the frozen baseline`);
      assert.ok(!changed().includes(path), `${path} was edited, and it is a guard`);
    }
  });
});
