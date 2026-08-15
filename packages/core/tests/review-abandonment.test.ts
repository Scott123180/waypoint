import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * Walking away part-way through.
 *
 * Abandonment is a normal outcome, not an error state. The ritual is a habit
 * the user is trying to build, and a tool that punished a half-finished attempt
 * — by discarding what was done, or by pretending it was finished — would make
 * the next attempt less likely, which is the only thing that actually matters
 * here (FR-008, FR-060).
 *
 * So: what was decided stays decided, what was not is simply absent, and
 * nothing anywhere else in the vault moves.
 */

const VAULT = {
  "projects/alpha.md": "# Alpha\n\nstatus: active\n",
  "projects/bravo.md": "# Bravo\n\nstatus: active\n",
  "waiting.md": "- 2026-07-01 @Priya — Confirm the migration window\n",
  "top-three.md": "## 2026-W33\n\n- [ ] Ship the runbook\n",
};

describe("an abandoned review", () => {
  test("completes no step it did not reach", async () => {
    const { service } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");
    // …and the user closes the window here.

    const review = await service.current();
    assert.equal(review?.step, "projects");
    assert.equal(review?.status, "in-progress");
    assert.equal(review?.topThree, null, "a step never reached recorded nothing");
    assert.deepEqual(review?.waiting, []);
  });

  test("writes no completed log", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");

    const content = vault.files.get("log/2026-W33.md") ?? "";
    assert.match(content, /^status: in progress$/m);
    assert.doesNotMatch(content, /^completed:/m);
  });

  test("alters no project it was not told to alter", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    assert.equal(vault.files.get("projects/alpha.md"), VAULT["projects/alpha.md"]);
    assert.equal(vault.files.get("projects/bravo.md"), VAULT["projects/bravo.md"]);
  });

  test("alters no waiting-for item, inbox item, or outcome", async () => {
    const { service, vault, inbox } = makeReview({
      files: { ...VAULT },
      inbox: "- an unsorted thought\n",
    });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    assert.equal(vault.files.get("waiting.md"), VAULT["waiting.md"]);
    assert.equal(vault.files.get("top-three.md"), VAULT["top-three.md"]);
    assert.equal(inbox.content, "- an unsorted thought\n", "the review never writes the inbox");
  });

  test("writes to nothing but its own log", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.advance({ confirmed: true });
    await service.recordNoChange("alpha");

    assert.deepEqual(
      [...new Set(vault.writeLog)],
      ["log/2026-W33.md"],
      "recording a decision that changed nothing must change nothing",
    );
  });
});

describe("a later week's review", () => {
  test("does not backfill or complete the abandoned one", async () => {
    const { service, clock, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");
    const abandoned = vault.files.get("log/2026-W33.md");

    clock.set("2026-08-24T09:00:00-04:00");
    await service.start();
    for (let i = 0; i < 4; i++) await service.advance({ confirmed: true });
    await service.complete({ note: "a week later" });

    assert.equal(
      vault.files.get("log/2026-W33.md"),
      abandoned,
      "finishing this week says nothing about last week",
    );
  });

  test("leaves it readable, and plainly unfinished, in history", async () => {
    const { service, clock } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");

    clock.set("2026-08-24T09:00:00-04:00");
    await service.start();

    const history = await service.history();
    const old = history.find((h) => h.week === "2026-W33");
    assert.equal(old?.status, "in-progress");
    assert.equal(old?.completed, null);
  });
});
