import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TopThreeService } from "../src/weekly/top-three-service";
import { FixedClock, seedVault } from "./project-fakes";

/**
 * Reading the top three.
 *
 * Every read is fresh — no cursor, no cache, no session — so a hand-edit is
 * reflected the next time anything asks. `current` in particular is derived
 * from the clock on every read rather than stored, which is what stops a week
 * going stale in a file because the app was closed over a weekend.
 */

const CLOCK = new FixedClock("2026-08-14T10:00:00-04:00"); // Friday, 2026-W33

const FILE = [
  "# Top three",
  "",
  "## 2026-W33",
  "",
  "- [x] Ship the policy seam — done 2026-08-14",
  "- [ ] Decide the license",
  "",
  "## 2026-W32",
  "",
  "- [x] Land inbox sort recovery — done 2026-08-08",
  "",
].join("\n");

function serviceWith(content?: string) {
  const vault = seedVault(content === undefined ? {} : { "top-three.md": content });
  return { vault, topThree: new TopThreeService({ vault, clock: new FixedClock(CLOCK.now().toISOString()) }) };
}

describe("top three: reading", () => {
  test("an absent file yields an empty current week, not an error", async () => {
    const { topThree } = serviceWith();
    const week = await topThree.current();

    assert.equal(week.id, "2026-W33");
    assert.deepEqual(week.outcomes, []);
    assert.equal(week.current, true);
  });

  test("an absent file writes nothing", async () => {
    // Reading must not create the file. No file is created unless the user
    // asks for one (FR-059).
    const { vault, topThree } = serviceWith();
    await topThree.current();
    await topThree.history();
    assert.deepEqual(vault.writeLog, []);
  });

  test("the current week is the one the clock is in", async () => {
    const { topThree } = serviceWith(FILE);
    const week = await topThree.current();

    assert.equal(week.id, "2026-W33");
    assert.equal(week.outcomes.length, 2);
    assert.equal(week.current, true);
  });

  test("history is every week on file, newest first", async () => {
    const { topThree } = serviceWith(FILE);
    const weeks = await topThree.history();

    assert.deepEqual(
      weeks.map((w) => w.id),
      ["2026-W33", "2026-W32"],
    );
  });

  test("history sorts newest first even when the file is out of order", async () => {
    const scrambled = ["## 2026-W30", "- [ ] a", "", "## 2026-W33", "- [ ] b", "", "## 2026-W31", "- [ ] c", ""].join(
      "\n",
    );
    const { topThree } = serviceWith(scrambled);
    assert.deepEqual(
      (await topThree.history()).map((w) => w.id),
      ["2026-W33", "2026-W31", "2026-W30"],
    );
  });

  test("only the current week is marked current", async () => {
    const { topThree } = serviceWith(FILE);
    const weeks = await topThree.history();

    assert.deepEqual(
      weeks.map((w) => w.current),
      [true, false],
    );
  });

  test("a week in the future is not the current week", async () => {
    const { topThree } = serviceWith(["## 2026-W40", "- [ ] later", ""].join("\n"));
    const weeks = await topThree.history();
    assert.equal(weeks[0]?.current, false);
  });

  test("the current week appears in history even when the file has no section for it", async () => {
    // Otherwise "this week" would vanish from the record the moment the user
    // had not yet committed to anything.
    const { topThree } = serviceWith(["## 2026-W32", "- [ ] a", ""].join("\n"));
    const weeks = await topThree.history();
    assert.deepEqual(
      weeks.map((w) => w.id),
      ["2026-W33", "2026-W32"],
    );
    assert.deepEqual(weeks[0]?.outcomes, []);
  });

  test("a hand-edited week over the cap is shown as it stands", async () => {
    const four = ["## 2026-W33", "- [ ] a", "- [ ] b", "- [ ] c", "- [ ] d", ""].join("\n");
    const { topThree } = serviceWith(four);
    assert.equal((await topThree.current()).outcomes.length, 4);
  });

  test("a later read reflects a hand-edit made since the last one", async () => {
    const { vault, topThree } = serviceWith(FILE);
    assert.equal((await topThree.current()).outcomes.length, 2);

    vault.files.set("top-three.md", ["## 2026-W33", "- [ ] only this", ""].join("\n"));
    assert.equal((await topThree.current()).outcomes.length, 1);
  });
});
