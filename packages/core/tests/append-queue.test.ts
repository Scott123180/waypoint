import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { AppendQueue } from "../src/inbox/append-queue";
import { FakeInboxStore, tick } from "./fakes";

describe("AppendQueue", () => {
  test("writes in the order enqueued", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);

    void queue.enqueue("- a\n", "a");
    void queue.enqueue("- b\n", "b");
    void queue.enqueue("- c\n", "c");
    await queue.flush();

    assert.deepEqual(store.written, ["- a\n", "- b\n", "- c\n"]);
    assert.equal(store.content, "- a\n- b\n- c\n");
  });

  test("enqueue returns before the underlying write completes", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.block();

    const pending = queue.enqueue("- a\n", "a");

    // The write is held open, yet control has already returned to us. This is
    // the property that lets the capture box close without waiting on disk.
    await tick();
    assert.equal(store.written.length, 0);
    assert.ok(pending instanceof Promise);

    store.release();
    await pending;
    assert.deepEqual(store.written, ["- a\n"]);
  });

  test("reports the byte offset before each write", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);

    const first = await queue.enqueue("- a\n", "a");
    const second = await queue.enqueue("- b\n", "b");

    assert.equal(first.offsetBefore, 0);
    assert.equal(second.offsetBefore, 4);
  });

  test("serializes writes rather than interleaving them", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.block();

    void queue.enqueue("- first\n", "first");
    void queue.enqueue("- second\n", "second");
    store.release();
    await queue.flush();

    assert.deepEqual(store.written, ["- first\n", "- second\n"]);
  });

  test("flush drains everything still pending", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);
    store.block();

    void queue.enqueue("- a\n", "a");
    void queue.enqueue("- b\n", "b");
    store.release();

    await queue.flush();
    assert.equal(store.written.length, 2);
  });

  test("flush on an idle queue resolves immediately", async () => {
    const queue = new AppendQueue(new FakeInboxStore());
    await queue.flush();
  });

  test("keeps byte offsets correct across multi-byte characters", async () => {
    const store = new FakeInboxStore();
    const queue = new AppendQueue(store);

    await queue.enqueue("- café\n", "café");
    const second = await queue.enqueue("- next\n", "next");

    // "- café\n" is 8 bytes in UTF-8 (é is two bytes), not 7 characters.
    assert.equal(second.offsetBefore, 8);
  });
});
