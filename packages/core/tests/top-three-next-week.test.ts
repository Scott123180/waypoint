import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * `addOutcome(text, week?)`.
 *
 * The optional argument is what keeps this a widening rather than a second
 * verb: every existing caller passes one argument and still targets the current
 * week, and every rule that applied to the current week applies to the next one
 * identically. A separate `addNextWeekOutcome` would have been a second write
 * path with its own chance to forget the cap (FR-050).
 */

function service(content = "") {
  const vault = seedVault({ "top-three.md": content });
  return {
    vault,
    topThree: new TopThreeService({ vault, clock: new FixedClock("2026-08-14T10:00:00-04:00") }),
  };
}

describe("the week argument", () => {
  test("defaults to the current week when omitted", async () => {
    const { topThree } = service();
    const result = await topThree.addOutcome("Ship the runbook");
    assert.ok(result.ok);
    assert.equal(result.week.id, "2026-W33");
  });

  test("targets the week given", async () => {
    const { topThree } = service();
    const result = await topThree.addOutcome("Land the cutover", "2026-W34");
    assert.ok(result.ok);
    assert.equal(result.week.id, "2026-W34");
  });

  test("keeps the two weeks separate", async () => {
    const { topThree } = service();
    await topThree.addOutcome("This week", "2026-W33");
    await topThree.addOutcome("Next week", "2026-W34");

    const history = await topThree.history();
    assert.deepEqual(
      history.find((w) => w.id === "2026-W33")?.outcomes.map((o) => o.text),
      ["This week"],
    );
    assert.deepEqual(
      history.find((w) => w.id === "2026-W34")?.outcomes.map((o) => o.text),
      ["Next week"],
    );
  });
});

describe("every rule applies to the next week identically", () => {
  test("the configured cap", async () => {
    const { topThree } = service();
    for (const text of ["One", "Two", "Three"]) {
      const ok = await topThree.addOutcome(text, "2026-W34");
      assert.ok(ok.ok, `${text} should fit`);
    }

    const fourth = await topThree.addOutcome("Four", "2026-W34");
    assert.equal(fourth.ok, false, "the cap counts the target week, not the current one");
    if (!fourth.ok) {
      assert.equal(fourth.reason, "outcome-cap");
      assert.match(fourth.message, /2026-W34/, "and names the week it is talking about");
    }
  });

  test("a full current week does not block the next one", async () => {
    const { topThree } = service();
    for (const text of ["One", "Two", "Three"]) await topThree.addOutcome(text);

    const ahead = await topThree.addOutcome("Something next week", "2026-W34");
    assert.ok(ahead.ok, "each week has its own three");
  });

  test("the configured cap, raised, applies to the next week too", async () => {
    const vault = seedVault({ "top-three.md": "", "policy.md": "weekly outcome cap: 5\n" });
    const topThree = new TopThreeService({ vault, clock: new FixedClock("2026-08-14T10:00:00-04:00") });

    for (const text of ["One", "Two", "Three", "Four", "Five"]) {
      const ok = await topThree.addOutcome(text, "2026-W34");
      assert.ok(ok.ok, `${text} should fit under a cap of five`);
    }
    assert.equal((await topThree.addOutcome("Six", "2026-W34")).ok, false);
  });

  test("the empty-text refusal", async () => {
    const { vault, topThree } = service();
    vault.writeLog.length = 0;

    const result = await topThree.addOutcome("   ", "2026-W34");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "empty-value");
    assert.deepEqual(vault.writeLog, []);
  });

  test("verify-before-write", async () => {
    const { vault, topThree } = service();
    await topThree.addOutcome("Land the cutover", "2026-W34");

    const week = (await topThree.history()).find((w) => w.id === "2026-W34");
    const outcome = week?.outcomes[0];
    assert.ok(outcome);

    // Reworded in a text editor while the view had it on screen.
    vault.files.set(
      "top-three.md",
      (vault.files.get("top-three.md") ?? "").replace("Land the cutover", "Land the cutover, maybe"),
    );

    const result = await topThree.editOutcome(
      { week: "2026-W34", index: outcome.index, raw: outcome.raw },
      "Something else",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "entry-changed");
    assert.match(vault.files.get("top-three.md") ?? "", /Land the cutover, maybe/);
  });
});

describe("the file the widening produces", () => {
  test("is an ordinary top-three file, readable by everything that reads one", async () => {
    const { vault, topThree } = service("## 2026-W33\n\n- [ ] Ship the runbook\n");
    await topThree.addOutcome("Land the cutover", "2026-W34");

    const content = vault.files.get("top-three.md") ?? "";
    assert.match(content, /^## 2026-W34$/m);
    assert.match(content, /^- \[ \] Land the cutover$/m);
    assert.match(content, /^## 2026-W33$/m, "and nothing already there moved");
  });
});
