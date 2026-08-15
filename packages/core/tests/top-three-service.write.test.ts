import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * The write verbs.
 *
 * Refusals are values a caller renders, not errors thrown — matching
 * `ProjectOutcome` and `SortOutcome`. A client that has to catch to find out
 * whether an edit landed is a client that will forget to.
 */

const NOW = "2026-08-14T10:00:00-04:00"; // Friday, 2026-W33

function service(content?: string) {
  const vault = seedVault(content === undefined ? {} : { "top-three.md": content });
  const clock = new FixedClock(NOW);
  return { vault, clock, topThree: new TopThreeService({ vault, clock }) };
}

function file(vault: { files: Map<string, string> }): string {
  return vault.files.get("top-three.md") ?? "";
}

describe("top three: writing", () => {
  describe("adding", () => {
    test("the first outcome creates the week", async () => {
      const { vault, topThree } = service();
      const result = await topThree.addOutcome("Decide the license");

      assert.ok(result.ok);
      assert.equal(result.week.outcomes.length, 1);
      assert.equal(result.week.outcomes[0]?.text, "Decide the license");
      assert.match(file(vault), /## 2026-W33/);
    });

    test("one outcome is a complete week — two and three are not required", async () => {
      const { topThree } = service();
      const result = await topThree.addOutcome("Just the one");
      assert.ok(result.ok);
      assert.equal(result.week.outcomes.length, 1);
    });

    test("outcomes keep entry order", async () => {
      const { topThree } = service();
      await topThree.addOutcome("first");
      await topThree.addOutcome("second");
      const result = await topThree.addOutcome("third");

      assert.ok(result.ok);
      assert.deepEqual(
        result.week.outcomes.map((o) => o.text),
        ["first", "second", "third"],
      );
    });

    test("empty and whitespace-only text is refused", async () => {
      const { vault, topThree } = service();
      for (const text of ["", "   ", "\t"]) {
        const result = await topThree.addOutcome(text);
        assert.ok(!result.ok);
        assert.equal(result.reason, "empty-value");
      }
      assert.deepEqual(vault.writeLog, [], "a refusal writes nothing");
    });

    test("surrounding whitespace is trimmed, inner text is verbatim", async () => {
      const { topThree } = service();
      const result = await topThree.addOutcome("  Ship it — properly  ");
      assert.ok(result.ok);
      assert.equal(result.week.outcomes[0]?.text, "Ship it — properly");
    });
  });

  describe("editing", () => {
    test("changes only the entry named", async () => {
      const { topThree } = service();
      await topThree.addOutcome("first");
      await topThree.addOutcome("second");
      const week = await topThree.current();

      const ref = { week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" };
      const result = await topThree.editOutcome(ref, "first, revised");

      assert.ok(result.ok);
      assert.deepEqual(
        result.week.outcomes.map((o) => o.text),
        ["first, revised", "second"],
      );
    });

    test("preserves the done state and date of the entry being edited", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      let week = await topThree.current();
      await topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" });

      week = await topThree.current();
      const result = await topThree.editOutcome(
        { week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" },
        "a, reworded",
      );

      assert.ok(result.ok);
      assert.equal(result.week.outcomes[0]?.done, true);
      assert.equal(result.week.outcomes[0]?.completedOn, "2026-08-14");
    });

    test("empty text is refused", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      const week = await topThree.current();
      const result = await topThree.editOutcome(
        { week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" },
        "  ",
      );
      assert.ok(!result.ok);
      assert.equal(result.reason, "empty-value");
    });
  });

  describe("removing", () => {
    test("leaves the other outcomes untouched", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      await topThree.addOutcome("b");
      await topThree.addOutcome("c");
      const week = await topThree.current();

      const result = await topThree.removeOutcome({
        week: week.id,
        index: 1,
        raw: week.outcomes[1]?.raw ?? "",
      });

      assert.ok(result.ok);
      assert.deepEqual(
        result.week.outcomes.map((o) => o.text),
        ["a", "c"],
      );
    });

    test("removing the last one leaves a valid empty week", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      const week = await topThree.current();

      const result = await topThree.removeOutcome({
        week: week.id,
        index: 0,
        raw: week.outcomes[0]?.raw ?? "",
      });

      assert.ok(result.ok);
      assert.deepEqual(result.week.outcomes, []);
    });
  });

  describe("completing and reopening", () => {
    test("completing records today's local date", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      const week = await topThree.current();

      const result = await topThree.completeOutcome({
        week: week.id,
        index: 0,
        raw: week.outcomes[0]?.raw ?? "",
      });

      assert.ok(result.ok);
      assert.equal(result.week.outcomes[0]?.done, true);
      assert.equal(result.week.outcomes[0]?.completedOn, "2026-08-14");
    });

    test("completing asks for no date and prompts for nothing", async () => {
      const { vault, topThree } = service();
      await topThree.addOutcome("a");
      const week = await topThree.current();
      await topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" });
      assert.match(file(vault), /- \[x\] a — done 2026-08-14/);
    });

    test("reopening clears the date", async () => {
      const { topThree } = service();
      await topThree.addOutcome("a");
      let week = await topThree.current();
      await topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" });

      week = await topThree.current();
      const result = await topThree.reopenOutcome({
        week: week.id,
        index: 0,
        raw: week.outcomes[0]?.raw ?? "",
      });

      assert.ok(result.ok);
      assert.equal(result.week.outcomes[0]?.done, false);
      assert.equal(result.week.outcomes[0]?.completedOn, null);
    });

    test("completing leaves the other outcomes alone", async () => {
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
      assert.equal(result.week.outcomes[1]?.done, false);
      assert.equal(result.week.outcomes[1]?.text, "b");
    });
  });

  test("every successful verb answers with the week as it now stands on disk", async () => {
    const { vault, topThree } = service();
    const result = await topThree.addOutcome("a");
    assert.ok(result.ok);

    const reread = new TopThreeService({ vault, clock: new FixedClock(NOW) });
    assert.deepEqual(result.week, await reread.current());
  });
});
