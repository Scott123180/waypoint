import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Nothing is ever generated, suggested, pre-filled, or ranked (FR-016, SC-017).
 *
 * Mirrors Feature 3's `project-no-suggestion.test.ts`. This is a prohibition,
 * and a prohibition with no test is a comment — the whole point of keeping
 * capture and organisation separate is that the tool does not put words in the
 * user's mouth. Every outcome on disk must trace to something the user typed.
 */

const NOW = "2026-08-14T10:00:00-04:00";

function service(content?: string) {
  const vault = seedVault(content === undefined ? {} : { "top-three.md": content });
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(NOW) }) };
}

describe("the top three suggests nothing", () => {
  test("an empty week offers no starter outcomes", async () => {
    const { topThree } = service();
    const week = await topThree.current();
    assert.deepEqual(week.outcomes, [], "an empty week is empty, not pre-filled");
  });

  test("a new week does not inherit last week's outcomes", async () => {
    // The most tempting "helpful" behaviour, and the wrong one: carrying work
    // forward silently would mean the record no longer says what the user
    // actually committed to that week.
    const { vault, topThree } = service(
      ["## 2026-W32", "", "- [ ] carried over?", "- [x] finished — done 2026-08-08", ""].join("\n"),
    );

    const week = await topThree.current();
    assert.equal(week.id, "2026-W33");
    assert.deepEqual(week.outcomes, []);
    assert.deepEqual(vault.writeLog, [], "and nothing was written to make it so");
  });

  test("every stored outcome is text the caller supplied, verbatim", async () => {
    const { vault, topThree } = service();
    await topThree.addOutcome("Decide the license");
    await topThree.addOutcome("Ship the seam");

    const stored = (vault.files.get("top-three.md") ?? "")
      .split("\n")
      .filter((l) => l.startsWith("- ["))
      .map((l) => l.replace(/^- \[[ x]\] /, ""));

    assert.deepEqual(stored, ["Decide the license", "Ship the seam"]);
  });

  test("outcomes keep entry order and are never re-ranked", async () => {
    const { topThree } = service();
    await topThree.addOutcome("zebra");
    await topThree.addOutcome("apple");
    await topThree.addOutcome("mango");

    const week = await topThree.current();
    assert.deepEqual(
      week.outcomes.map((o) => o.text),
      ["zebra", "apple", "mango"],
      "entry order, not alphabetical, not by any inferred priority",
    );
  });

  test("completing one does not reorder or promote the others", async () => {
    const { topThree } = service();
    await topThree.addOutcome("a");
    await topThree.addOutcome("b");
    const week = await topThree.current();

    const result = await topThree.completeOutcome({
      week: week.id,
      index: 0,
      raw: week.outcomes[0]?.raw ?? "",
    });

    assert.ok(result.ok);
    assert.deepEqual(
      result.week.outcomes.map((o) => o.text),
      ["a", "b"],
      "a finished outcome stays where it is",
    );
  });

  test("no source file in weekly/ carries suggestion machinery", () => {
    // A structural guard: the vocabulary of ranking and suggesting should not
    // appear at all in this module.
    const dir = join(__dirname, "..", "..", "src", "weekly");
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, entry), "utf8");
      const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const banned of ["suggest", "recommend", "rank(", "autofill", "prefill"]) {
        assert.ok(
          !code.toLowerCase().includes(banned),
          `weekly/${entry} contains "${banned}" outside a comment`,
        );
      }
    }
  });
});
