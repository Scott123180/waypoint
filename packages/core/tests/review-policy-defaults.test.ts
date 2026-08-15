import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * No `policy.md`, and a broken one.
 *
 * **Absence is the normal case.** Every vault already on disk has no
 * `policy.md`, and none is created to answer a question — a file appearing
 * because the user opened a view would be the application deciding what belongs
 * in their data directory (FR-083, Principle IV).
 *
 * **A configuration error never blocks anything.** A typo in `policy.md` is
 * surfaced, in the module's own words, riding along with a decision that still
 * gets made. Refusing to work because a setting is unreadable would punish the
 * user for editing the file they were invited to edit (FR-084).
 */

const INBOX = "- one thought\n- another thought\n";

const PROJECT = [
  "# Docs refresh",
  "",
  "status: waiting",
  "",
  "## Ledger",
  "",
  "- 2026-06-01 status active → waiting",
  "",
].join("\n");

describe("with no policy.md", () => {
  test("the documented defaults apply", async () => {
    const { service } = makeReview({ inbox: INBOX, files: { "projects/docs-refresh.md": PROJECT } });
    await service.start();

    // Inbox gate defaults to warn…
    const warned = await service.advance();
    assert.equal(warned.ok, false);
    if (!warned.ok) assert.equal(warned.confirmable, true);

    // …and staleness to seven days, so 74 is over it.
    const [entry] = await service.projectStep();
    assert.ok(entry?.stale);
  });

  test("nothing errors", async () => {
    const { service } = makeReview({ inbox: INBOX, files: { "projects/docs-refresh.md": PROJECT } });
    await service.start();

    for (let i = 0; i < 4; i++) await service.advance({ confirmed: true });
    const done = await service.complete({ note: "no policy file anywhere" });

    assert.ok(done.ok);
  });

  test("no file is created", async () => {
    const { service, vault } = makeReview({ inbox: INBOX, files: { "projects/docs-refresh.md": PROJECT } });
    await service.start();

    await service.advance({ confirmed: true });
    await service.projectStep();
    await service.waitingStep();

    assert.ok(!vault.files.has("policy.md"), "asking a rule a question does not write a rules file");
    assert.deepEqual(
      vault.writeLog.filter((p) => p === "policy.md"),
      [],
    );
  });
});

describe("a malformed value", () => {
  const BROKEN = "inbox gate: sometimes\nstaleness days: soon\n";

  test("applies the documented default", async () => {
    const { service } = makeReview({
      inbox: INBOX,
      files: { "policy.md": BROKEN, "projects/docs-refresh.md": PROJECT },
    });
    await service.start();

    const warned = await service.advance();
    assert.equal(warned.ok, false);
    if (!warned.ok) {
      assert.equal(warned.confirmable, true, "an unreadable gate falls back to warn, not to block");
    }

    const [entry] = await service.projectStep();
    assert.ok(entry?.stale, "and an unreadable threshold falls back to seven days");
  });

  test("surfaces the problem in the module's own words", async () => {
    const { service } = makeReview({ inbox: INBOX, files: { "policy.md": BROKEN } });
    await service.start();

    const warned = await service.advance();
    assert.equal(warned.ok, false);
    if (!warned.ok) {
      assert.match(warned.message, /inbox gate/, "the user is told which line to look at");
      assert.match(warned.message, /sometimes/, "and what they typed");
    }
  });

  test("blocks no step", async () => {
    const { service } = makeReview({
      inbox: "",
      files: { "policy.md": BROKEN, "projects/docs-refresh.md": PROJECT },
    });
    await service.start();

    // Three advances reach the last step; the fourth would be past the end,
    // which `complete` is for.
    for (let i = 0; i < 3; i++) {
      const result = await service.advance({ confirmed: true });
      assert.ok(result.ok, "a typo in a settings file must not stop the user working");
    }
    assert.ok((await service.complete({ note: null })).ok);
  });

  test("is visible at the start of the ritual, not only when a rule fires", async () => {
    const { service } = makeReview({ inbox: "", files: { "policy.md": BROKEN } });
    await service.start();

    const { count, notice } = await service.inboxStep();
    assert.equal(count, 0, "the gate is silent — the inbox is clear");
    assert.match(notice, /inbox gate/, "but the module still has something to say about its own settings");
    assert.match(notice, /staleness days/, "both problems, not just the first");
  });

  test("a healthy configuration produces no notice at all", async () => {
    const { service } = makeReview({ inbox: "", files: { "policy.md": "inbox gate: block\n" } });
    await service.start();

    assert.equal((await service.inboxStep()).notice, "", "silence is what nothing-wrong looks like");
  });

  test("one broken value does not reset another", async () => {
    const { service } = makeReview({
      inbox: INBOX,
      files: {
        // The gate is nonsense; the threshold is deliberate and must survive.
        "policy.md": "inbox gate: sometimes\nstaleness days: 100\n",
        "projects/docs-refresh.md": PROJECT,
      },
    });
    await service.start();

    const [entry] = await service.projectStep();
    assert.equal(entry?.stale, null, "74 days is not stale when the user said 100");
  });
});

describe("an empty vault with no configuration at all", () => {
  test("every step reports its empty state and the review completes", async () => {
    const { service, vault } = makeReview();
    await service.start();

    assert.deepEqual(await service.inboxStep(), { count: 0, notice: "" });
    assert.deepEqual(await service.projectStep(), []);
    assert.deepEqual(await service.waitingStep(), { total: 0, stale: [], unreadable: [] });

    const step = await service.topThreeStep();
    assert.deepEqual(step.reviewed.outcomes, []);

    for (let i = 0; i < 4; i++) await service.advance();
    assert.ok((await service.complete({ note: null })).ok);

    // The log, and nothing else.
    assert.deepEqual([...new Set(vault.writeLog)], ["log/2026-W33.md"]);
  });
});
