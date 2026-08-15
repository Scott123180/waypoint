import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * History is kept, byte for byte (FR-011, FR-013, SC-001).
 *
 * The promise this feature makes is that looking back at what you committed to
 * is trustworthy. That is only true if setting a new week cannot disturb an old
 * one, and if the app will not quietly rewrite a past week the user has since
 * corrected by hand.
 */

const W32 = ["## 2026-W32", "", "- [x] Land inbox sort recovery — done 2026-08-08", "- [ ] Abandoned idea", ""];
const W31 = ["## 2026-W31", "", "- [x] Cut v0.3.0 — done 2026-08-01", ""];
const HISTORY = ["# Top three", "", ...W32, ...W31].join("\n");

/** Friday of 2026-W33 — a week later than anything on file. */
const NOW = "2026-08-14T10:00:00-04:00";

function service(content = HISTORY) {
  const vault = seedVault({ "top-three.md": content });
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(NOW) }) };
}

/** The exact text of one week's section, heading included. */
function sectionOf(content: string, week: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${week}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("top three: preserving history", () => {
  test("setting a new week leaves every prior week byte-for-byte identical", async () => {
    const { vault, topThree } = service();
    const before32 = sectionOf(HISTORY, "2026-W32");
    const before31 = sectionOf(HISTORY, "2026-W31");

    await topThree.addOutcome("This week's thing");

    const after = vault.files.get("top-three.md") ?? "";
    assert.equal(sectionOf(after, "2026-W32"), before32);
    assert.equal(sectionOf(after, "2026-W31"), before31);
  });

  test("a new week is inserted newest-first, above the existing ones", async () => {
    const { vault, topThree } = service();
    await topThree.addOutcome("This week's thing");

    const after = vault.files.get("top-three.md") ?? "";
    assert.ok(
      after.indexOf("## 2026-W33") < after.indexOf("## 2026-W32"),
      "the current week belongs at the top, where a user opening the file looks",
    );
  });

  test("done marks and completion dates in past weeks survive", async () => {
    const { vault, topThree } = service();
    await topThree.addOutcome("a");
    await topThree.addOutcome("b");

    const after = vault.files.get("top-three.md") ?? "";
    assert.match(after, /- \[x\] Land inbox sort recovery — done 2026-08-08/);
    assert.match(after, /- \[x\] Cut v0\.3\.0 — done 2026-08-01/);
  });

  test("an unfinished outcome in a past week stays unfinished", async () => {
    // No retroactive tidying. What the user did not finish is part of the
    // record — that is the point of keeping it.
    const { vault, topThree } = service();
    await topThree.addOutcome("a");
    assert.match(vault.files.get("top-three.md") ?? "", /- \[ \] Abandoned idea/);
  });

  test("four weeks set in a row all survive with their marks intact", async () => {
    const vault = seedVault({});
    const clock = new FixedClock("2026-07-24T10:00:00-04:00"); // 2026-W30
    const topThree = new TopThreeService({ vault, clock });

    for (const [iso, text] of [
      ["2026-07-24T10:00:00-04:00", "week thirty"],
      ["2026-07-31T10:00:00-04:00", "week thirty-one"],
      ["2026-08-07T10:00:00-04:00", "week thirty-two"],
      ["2026-08-14T10:00:00-04:00", "week thirty-three"],
    ] as const) {
      clock.set(iso);
      const added = await topThree.addOutcome(text);
      assert.ok(added.ok);
      const week = await topThree.current();
      await topThree.completeOutcome({ week: week.id, index: 0, raw: week.outcomes[0]?.raw ?? "" });
    }

    const weeks = await topThree.history();
    assert.deepEqual(
      weeks.map((w) => w.id),
      ["2026-W33", "2026-W32", "2026-W31", "2026-W30"],
    );
    for (const week of weeks) {
      assert.equal(week.outcomes.length, 1, `${week.id} kept its outcome`);
      assert.equal(week.outcomes[0]?.done, true, `${week.id} kept its done mark`);
    }
  });

  describe("past weeks are a record", () => {
    test("editing a past week is refused", async () => {
      const { vault, topThree } = service();
      const before = vault.files.get("top-three.md") ?? "";

      const result = await topThree.editOutcome(
        { week: "2026-W32", index: 1, raw: "- [ ] Abandoned idea" },
        "rewriting history",
      );

      assert.ok(!result.ok);
      assert.equal(result.reason, "past-week");
      assert.equal(vault.files.get("top-three.md"), before);
    });

    test("completing, reopening and removing in a past week are refused too", async () => {
      for (const verb of ["completeOutcome", "reopenOutcome", "removeOutcome"] as const) {
        const { vault, topThree } = service();
        const before = vault.files.get("top-three.md") ?? "";

        const result = await topThree[verb]({
          week: "2026-W32",
          index: 1,
          raw: "- [ ] Abandoned idea",
        });

        assert.ok(!result.ok, `${verb} must refuse a past week`);
        assert.equal(result.reason, "past-week");
        assert.equal(vault.files.get("top-three.md"), before);
      }
    });

    test("the file itself stays hand-editable — the refusal is the app's, not the format's", async () => {
      // Correcting history deliberately is the user's business. The app simply
      // declines to be the one doing it.
      const { vault, topThree } = service();
      vault.files.set("top-three.md", (vault.files.get("top-three.md") ?? "").replace("Abandoned idea", "Fixed by hand"));

      const weeks = await topThree.history();
      const past = weeks.find((w) => w.id === "2026-W32");
      assert.equal(past?.outcomes[1]?.text, "Fixed by hand");
    });
  });
});
