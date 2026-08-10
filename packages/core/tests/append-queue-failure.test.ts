import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AppendQueue } from "../src/inbox/append-queue";
import { InboxWriteError } from "../src/errors";
import { FakeInboxStore } from "./fakes";

describe("AppendQueue failure handling", () => {
  test("retries a failed write exactly once, then succeeds", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.failuresRemaining = 1;

    await queue.enqueue("- a\n", "a");

    assert.deepEqual(store.written, ["- a\n"]);
  });

  test("raises InboxWriteError when the retry also fails", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.failuresRemaining = 2;

    await assert.rejects(() => queue.enqueue("- a\n", "a"), InboxWriteError);
  });

  test("the error carries the raw text so the thought stays recoverable", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.failuresRemaining = 2;

    // A failed disk write must never mean a silently lost thought — the user
    // has to be able to get their text back.
    await assert.rejects(
      () => queue.enqueue("- call the roofer\n", "call the roofer"),
      (err: unknown) => {
        assert.ok(err instanceof InboxWriteError);
        assert.equal(err.recoverableText, "call the roofer");
        return true;
      },
    );
  });

  test("notifies the error handler with the same error", async () => {
    const store = new FakeInboxStore();
    const seen: InboxWriteError[] = [];
    const queue = new AppendQueue(store, (err) => seen.push(err));
    store.failuresRemaining = 2;

    await assert.rejects(() => queue.enqueue("- a\n", "a"));

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.recoverableText, "a");
  });

  test("keeps processing later items after one fails", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.failuresRemaining = 2;

    const failing = queue.enqueue("- doomed\n", "doomed");
    const following = queue.enqueue("- survivor\n", "survivor");

    await assert.rejects(() => failing);
    await following;

    // A wedged queue would lose every thought after the first failure.
    assert.deepEqual(store.written, ["- survivor\n"]);
  });

  test("flush still resolves when a queued write failed", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store, () => {});
    store.failuresRemaining = 2;

    void queue.enqueue("- doomed\n", "doomed").catch(() => {});
    await queue.flush();
  });
});
