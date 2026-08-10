import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { performUndo } from "../src/capture/undo-token";
import { FakeInboxStore } from "./fakes";

describe("performUndo", () => {
  test("truncates back to the offset when the tail still matches", async () => {
    const store = new FakeInboxStore();
    store.content = "- earlier\n- ours\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 10,
    });

    assert.deepEqual(outcome, { ok: true });
    assert.equal(store.content, "- earlier\n");
  });

  test("undoes the only item in a file", async () => {
    const store = new FakeInboxStore();
    store.content = "- ours\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 0,
    });

    assert.deepEqual(outcome, { ok: true });
    assert.equal(store.content, "");
  });

  test("accounts for the newline the store inserts before an item", async () => {
    // The store prepends "\n" when the existing file lacked a trailing one.
    const store = new FakeInboxStore();
    store.content = "hand written, no newline\n- ours\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 24,
    });

    assert.deepEqual(outcome, { ok: true });
    // Restores the file byte-for-byte, including the missing trailing newline.
    assert.equal(store.content, "hand written, no newline");
  });

  test("refuses when the tail no longer matches", async () => {
    const store = new FakeInboxStore();
    store.content = "- earlier\n- ours\n- something the user typed by hand\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 10,
    });

    // Refusing is the only safe answer: truncating here would delete a line the
    // user wrote themselves between capture and undo.
    assert.deepEqual(outcome, { ok: false, reason: "file-changed" });
  });

  test("changes nothing when it refuses", async () => {
    const store = new FakeInboxStore();
    const original = "- earlier\n- ours\n- added by hand\n";
    store.content = original;

    await performUndo(store, { itemId: "x", serializedBlock: "- ours\n", offsetBefore: 10 });

    assert.equal(store.content, original);
  });

  test("refuses when the file shrank below the recorded offset", async () => {
    const store = new FakeInboxStore();
    store.content = "- tiny\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 500,
    });

    assert.deepEqual(outcome, { ok: false, reason: "file-changed" });
  });

  test("refuses when nothing follows the offset", async () => {
    const store = new FakeInboxStore();
    store.content = "- earlier\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 10,
    });

    assert.deepEqual(outcome, { ok: false, reason: "file-changed" });
  });

  test("refuses when the whole file was replaced", async () => {
    const store = new FakeInboxStore();
    store.content = "completely different content entirely\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- ours\n",
      offsetBefore: 10,
    });

    assert.deepEqual(outcome, { ok: false, reason: "file-changed" });
  });

  test("handles multi-byte characters in the undone block", async () => {
    const store = new FakeInboxStore();
    store.content = "- earlier\n- café ☕\n";

    const outcome = await performUndo(store, {
      itemId: "x",
      serializedBlock: "- café ☕\n",
      offsetBefore: 10,
    });

    assert.deepEqual(outcome, { ok: true });
    assert.equal(store.content, "- earlier\n");
  });
});
