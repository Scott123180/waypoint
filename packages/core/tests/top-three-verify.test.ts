import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Verify before write, at entry granularity (FR-015a–c).
 *
 * Feature 3's precedent, narrowed the same way it was: the comparison is
 * against a freshly read file, and it covers the one entry being written.
 * Cancelling an edit to outcome one because outcome three changed would be a
 * refusal the user cannot act on — so an unrelated hand-edit must not cancel
 * the write, and must survive it.
 */

const NOW = "2026-08-14T10:00:00-04:00"; // 2026-W33

const FILE = ["# Top three", "", "## 2026-W33", "", "- [ ] first", "- [ ] second", ""].join("\n");

function service(content = FILE) {
  const vault = seedVault({ "top-three.md": content });
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(NOW) }) };
}

describe("top three: verify before write", () => {
  test("an entry changed on disk cancels the write", async () => {
    const { vault, topThree } = service();
    const stale = { week: "2026-W33", index: 0, raw: "- [ ] first" };

    vault.files.set("top-three.md", FILE.replace("- [ ] first", "- [ ] first, edited in vim"));
    const before = vault.files.get("top-three.md") ?? "";

    const result = await topThree.editOutcome(stale, "first, edited in the app");

    assert.ok(!result.ok);
    assert.equal(result.reason, "entry-changed");
    assert.equal(vault.files.get("top-three.md"), before, "the file must be byte-for-byte unchanged");
    assert.deepEqual(vault.writeLog, [], "nothing was written");
  });

  test("the refusal says what the entry now reads", async () => {
    const { vault, topThree } = service();
    vault.files.set("top-three.md", FILE.replace("- [ ] first", "- [ ] first, edited in vim"));

    const result = await topThree.editOutcome(
      { week: "2026-W33", index: 0, raw: "- [ ] first" },
      "something else",
    );

    assert.ok(!result.ok);
    assert.match(result.message, /first, edited in vim/);
  });

  test("an unrelated hand-edit elsewhere in the same week does NOT cancel the write", async () => {
    // The whole point of entry-level rather than week-level verification.
    const { vault, topThree } = service();
    const ref = { week: "2026-W33", index: 0, raw: "- [ ] first" };

    vault.files.set("top-three.md", FILE.replace("- [ ] second", "- [ ] second, edited in vim"));

    const result = await topThree.editOutcome(ref, "first, edited in the app");

    assert.ok(result.ok, "an edit to a different entry must not block this one");
    assert.deepEqual(
      result.week.outcomes.map((o) => o.text),
      ["first, edited in the app", "second, edited in vim"],
      "and the hand-edit survives",
    );
  });

  test("a hand-edit in a different week does not cancel the write", async () => {
    const withPast = `${FILE}\n## 2026-W32\n\n- [ ] older\n`;
    const { vault, topThree } = service(withPast);

    vault.files.set("top-three.md", withPast.replace("- [ ] older", "- [ ] older, reworded"));
    const result = await topThree.editOutcome(
      { week: "2026-W33", index: 0, raw: "- [ ] first" },
      "first, revised",
    );

    assert.ok(result.ok);
    assert.match(vault.files.get("top-three.md") ?? "", /older, reworded/);
  });

  test("verification covers removing, completing and reopening too", async () => {
    for (const verb of ["removeOutcome", "completeOutcome", "reopenOutcome"] as const) {
      const { vault, topThree } = service();
      vault.files.set("top-three.md", FILE.replace("- [ ] first", "- [ ] changed"));
      const before = vault.files.get("top-three.md") ?? "";

      const result = await topThree[verb]({ week: "2026-W33", index: 0, raw: "- [ ] first" });

      assert.ok(!result.ok, `${verb} must verify first`);
      assert.equal(result.reason, "entry-changed");
      assert.equal(vault.files.get("top-three.md"), before, `${verb} must leave the file untouched`);
    }
  });

  test("an entry removed on disk cancels rather than writing at that position", async () => {
    const { vault, topThree } = service();
    vault.files.set("top-three.md", ["# Top three", "", "## 2026-W33", "", "- [ ] second", ""].join("\n"));

    const result = await topThree.editOutcome(
      { week: "2026-W33", index: 1, raw: "- [ ] second" },
      "moved",
    );

    assert.ok(!result.ok);
    assert.equal(result.reason, "entry-changed");
  });

  test("a stale ref is never trusted over a fresh read", async () => {
    // The caller passes what it was shown; the file is the authority.
    const { vault, topThree } = service();
    vault.files.delete("top-three.md");

    const result = await topThree.editOutcome(
      { week: "2026-W33", index: 0, raw: "- [ ] first" },
      "anything",
    );

    assert.ok(!result.ok);
    assert.equal(result.reason, "entry-changed");
  });
});
