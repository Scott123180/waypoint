import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_POLICY_CONFIG, parsePolicyConfig } from "../src/policy/policy-config";
import { MILESTONE_CAP } from "../src/projects/project-service";

/**
 * Reading `policy.md`.
 *
 * Absence is the well-trodden path, not an error branch: every vault already on
 * disk has no such file, and so does every Feature 3 test fixture. Defaults are
 * numerically identical to Feature 3's shipped constants, which is what makes
 * the rule migration a no-op for existing data (research R10).
 */

describe("policy config", () => {
  test("absent file yields every default", () => {
    const config = parsePolicyConfig(null);
    // Whole-object rather than field-by-field, deliberately: it fails when the
    // shape grows, which is how a new setting gets a default chosen on purpose
    // instead of arriving as `undefined`. Feature 5 added the last two.
    assert.deepEqual(config, {
      wipLimit: 3,
      milestoneCap: 4,
      weeklyOutcomeCap: 3,
      inboxGate: "warn",
      stalenessDays: 7,
    });
  });

  test("the defaults match Feature 3's shipped milestone cap", () => {
    assert.equal(DEFAULT_POLICY_CONFIG.milestoneCap, 4);
  });

  test("the deprecated MILESTONE_CAP export agrees with the default", () => {
    // Core keeps its own copy of the number so it need not import anything from
    // the policy module (see the import-direction test). Two copies can drift,
    // so the agreement is asserted here rather than assumed.
    assert.equal(
      MILESTONE_CAP,
      DEFAULT_POLICY_CONFIG.milestoneCap,
      "the back-compat constant and the policy default have diverged",
    );
  });

  test("each value is read", () => {
    const config = parsePolicyConfig(
      ["# Policy", "", "wip limit: 5", "milestone cap: 6", "weekly outcome cap: 2"].join("\n"),
    );
    assert.deepEqual(config, {
      wipLimit: 5,
      milestoneCap: 6,
      weeklyOutcomeCap: 2,
      inboxGate: "warn",
      stalenessDays: 7,
    });
  });

  test("an empty file yields every default", () => {
    assert.deepEqual(parsePolicyConfig(""), DEFAULT_POLICY_CONFIG);
  });

  test("zero is honored, not corrected", () => {
    // A limit of zero that refuses every activation is a coherent thing to
    // have configured. Silently rewriting it would be the app overruling the
    // user in their own data directory.
    assert.equal(parsePolicyConfig("wip limit: 0").wipLimit, 0);
    assert.equal(parsePolicyConfig("weekly outcome cap: 0").weeklyOutcomeCap, 0);
  });

  test("a malformed value falls back for that value alone", () => {
    // The point of per-value fallback: a typo in one rule must not silently
    // restore a different rule the user deliberately changed.
    const config = parsePolicyConfig(["wip limit: banana", "milestone cap: 6"].join("\n"));
    assert.equal(config.wipLimit, 3, "falls back to the default");
    assert.equal(config.milestoneCap, 6, "the deliberate setting survives");
  });

  test("negative and non-integer values fall back", () => {
    assert.equal(parsePolicyConfig("wip limit: -1").wipLimit, 3);
    assert.equal(parsePolicyConfig("wip limit: 2.5").wipLimit, 3);
    assert.equal(parsePolicyConfig("wip limit:").wipLimit, 3);
  });

  test("keys are matched case-insensitively and tolerate hand-edited spacing", () => {
    const config = parsePolicyConfig(["WIP Limit:    7", "  milestone cap:6"].join("\n"));
    assert.equal(config.wipLimit, 7);
    assert.equal(config.milestoneCap, 6);
  });

  test("unknown keys and prose are ignored rather than rejected", () => {
    const config = parsePolicyConfig(
      ["# Policy", "", "wip limit: 2", "something else: yes", "", "## Notes", "", "wip limit: 99"].join("\n"),
    );
    assert.equal(config.wipLimit, 2, "only the preamble is read");
    assert.equal(config.milestoneCap, 4);
  });

  test("reported problems name the keys that fell back", () => {
    const { problems } = parsePolicyConfig("wip limit: banana", { withProblems: true });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /wip limit/);
    // Surfaced, never thrown: a configuration problem must not block an
    // operation (FR-060).
  });

  test("a clean file reports no problems", () => {
    assert.deepEqual(parsePolicyConfig("wip limit: 2", { withProblems: true }).problems, []);
  });
});

/**
 * The two keys Feature 5 added.
 *
 * `staleness days` behaves exactly like the counts above; `inbox gate` is the
 * first keyword-valued setting, so its fallback path is its own thing: an
 * unrecognised word is not a number that failed to parse, and the user needs to
 * be told which word they typed.
 */
describe("policy config — the review rules", () => {
  test("absent file yields the documented defaults", () => {
    const config = parsePolicyConfig(null);
    assert.equal(config.inboxGate, "warn", "the gate ships as a warning, not a block");
    assert.equal(config.stalenessDays, 7);
  });

  test("each value is read", () => {
    const config = parsePolicyConfig(["inbox gate: block", "staleness days: 10"].join("\n"));
    assert.equal(config.inboxGate, "block");
    assert.equal(config.stalenessDays, 10);
  });

  test("the gate is matched case-insensitively and tolerates hand-edited spacing", () => {
    assert.equal(parsePolicyConfig("Inbox Gate:   BLOCK").inboxGate, "block");
    assert.equal(parsePolicyConfig("inbox gate: warn").inboxGate, "warn");
  });

  test("an unrecognised gate value falls back to warn and reports the problem", () => {
    const { inboxGate, problems } = parsePolicyConfig("inbox gate: nag", { withProblems: true });
    assert.equal(inboxGate, "warn");
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /inbox gate/);
    assert.match(problems[0] ?? "", /nag/, "the user is told what they typed");
  });

  test("staleness days of zero is honored, not corrected", () => {
    // Everything stale is a coherent configuration, the same way a WIP limit of
    // zero is. The app does not overrule the user in their own data directory.
    assert.equal(parsePolicyConfig("staleness days: 0").stalenessDays, 0);
  });

  test("a malformed staleness value falls back for that value alone", () => {
    const config = parsePolicyConfig(
      ["staleness days: soon", "inbox gate: block", "wip limit: 5"].join("\n"),
    );
    assert.equal(config.stalenessDays, 7, "falls back to the default");
    assert.equal(config.inboxGate, "block", "the deliberate setting survives");
    assert.equal(config.wipLimit, 5, "and so does every other one");
  });

  test("a malformed gate does not disturb the numeric settings", () => {
    const config = parsePolicyConfig(["inbox gate: sometimes", "staleness days: 14"].join("\n"));
    assert.equal(config.inboxGate, "warn");
    assert.equal(config.stalenessDays, 14);
  });
});
