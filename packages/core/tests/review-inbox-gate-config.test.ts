import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The inbox gate, configured from the vault.
 *
 * It ships as a **warning** — the opposite default from the WIP limit, and
 * deliberately so. The limit guards a commitment the user is making; a full
 * inbox only makes the picture incomplete, and a review that cannot start is a
 * review that does not happen. A user who wants the harder version writes
 * `inbox gate: block` in `policy.md` and gets it, with no application change
 * (FR-018, FR-019).
 */

const INBOX = "- one thought\n- another thought\n";

function harness(gate?: string) {
  return makeReview({
    inbox: INBOX,
    files: gate === undefined ? {} : { "policy.md": `inbox gate: ${gate}\n` },
  });
}

describe("the shipped default", () => {
  test("warns with the count and can be passed", async () => {
    const { service } = harness();
    await service.start();

    const warned = await service.advance();
    assert.equal(warned.ok, false);
    if (!warned.ok) {
      assert.equal(warned.reason, "inbox-not-empty");
      assert.equal(warned.confirmable, true, "a warning is passable; a block is not");
      assert.match(warned.message, /two items/);
    }

    const proceeded = await service.advance({ confirmed: true });
    assert.ok(proceeded.ok);
    if (proceeded.ok) assert.equal(proceeded.review.step, "projects");
  });

  test("records that the step was passed under a warning", async () => {
    const { service } = harness();
    await service.start();
    await service.advance({ confirmed: true });

    const review = await service.current();
    assert.equal(review?.inbox?.count, 2);
    assert.equal(review?.inbox?.verdict, "warn", "the log says what it was passed under");
  });
});

describe("inbox gate: block", () => {
  test("prevents advancing", async () => {
    const { service } = harness("block");
    await service.start();

    const blocked = await service.advance();
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.reason, "inbox-not-empty");
      assert.notEqual(blocked.confirmable, true, "a block cannot be confirmed past");
    }
  });

  test("cannot be confirmed past", async () => {
    const { service } = harness("block");
    await service.start();

    const forced = await service.advance({ confirmed: true });
    assert.equal(forced.ok, false, "the confirmation flag is not a bypass");

    const review = await service.current();
    assert.equal(review?.step, "inbox");
  });

  test("names sorting as the way to unblock it", async () => {
    const { service } = harness("block");
    await service.start();

    const blocked = await service.advance();
    if (!blocked.ok) {
      assert.match(blocked.message, /[Ss]ort/, "a refusal the user cannot act on is an obstacle");
      assert.match(blocked.message, /two items/);
    }
  });

  test("records nothing about a step that was not passed", async () => {
    const { service } = harness("block");
    await service.start();
    await service.advance();

    assert.equal((await service.current())?.inbox, null);
  });
});

describe("an empty inbox", () => {
  test("advances silently under block", async () => {
    const { service } = makeReview({ inbox: "", files: { "policy.md": "inbox gate: block\n" } });
    await service.start();

    const result = await service.advance();
    assert.ok(result.ok, "the gate is about a non-empty inbox");
    if (result.ok) assert.equal(result.review.step, "projects");
  });

  test("advances silently under warn", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();

    const result = await service.advance();
    assert.ok(result.ok);
  });

  test("is recorded as clear either way", async () => {
    const { service } = makeReview({ inbox: "" });
    await service.start();
    await service.advance();

    assert.equal((await service.current())?.inbox?.count, 0);
  });
});

describe("changing the setting", () => {
  test("takes effect without restarting anything", async () => {
    const { service, vault } = harness();
    await service.start();

    assert.equal((await service.advance()).ok, false, "warned");

    // The user edits `policy.md` mid-review, in another window.
    vault.files.set("policy.md", "inbox gate: block\n");

    const now = await service.advance({ confirmed: true });
    assert.equal(now.ok, false, "config is read fresh on every decision, never cached");
  });

  test("is made by editing the vault alone", async () => {
    // No argument, no flag, no rebuild: the only difference between these two
    // harnesses is a line of text in a file in the data directory.
    const warn = makeReview({ inbox: INBOX });
    await warn.service.start();
    const block = makeReview({ inbox: INBOX, files: { "policy.md": "inbox gate: block\n" } });
    await block.service.start();

    const warned = await warn.service.advance();
    const blocked = await block.service.advance();

    assert.equal(warned.ok, false);
    assert.equal(blocked.ok, false);
    if (!warned.ok && !blocked.ok) {
      assert.equal(warned.confirmable, true);
      assert.notEqual(blocked.confirmable, true);
    }
  });
});
