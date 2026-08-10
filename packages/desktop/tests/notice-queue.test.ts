import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { NoticeQueue } from "../src/main/notice-queue";

describe("NoticeQueue", () => {
  test("delivers immediately when the box is visible", () => {
    const queue = new NoticeQueue();
    const delivered = queue.push({ level: "info", message: "hello" }, true);

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.message, "hello");
  });

  test("holds a notice raised while the box is hidden", () => {
    const queue = new NoticeQueue();
    const delivered = queue.push({ level: "error", message: "hotkey taken" }, false);

    // Nothing is delivered now, but it must not be lost either.
    assert.equal(delivered.length, 0);
    assert.equal(queue.pendingCount(), 1);
  });

  test("replays held notices when the box opens", () => {
    const queue = new NoticeQueue();
    queue.push({ level: "error", message: "hotkey taken" }, false);
    queue.push({ level: "error", message: "bad config" }, false);

    const replayed = queue.onShow();
    assert.deepEqual(
      replayed.map((n) => n.message),
      ["hotkey taken", "bad config"],
    );
  });

  test("a one-shot notice is not replayed twice", () => {
    const queue = new NoticeQueue();
    queue.push({ level: "error", message: "hotkey taken" }, false);

    assert.equal(queue.onShow().length, 1);
    assert.equal(queue.onShow().length, 0);
  });

  test("a notice carrying recoverable text is replayed until acknowledged", () => {
    const queue = new NoticeQueue();
    queue.push(
      { level: "error", message: "write failed", recoverableText: "call the roofer" },
      false,
    );

    // The thought is only recoverable while this is still on screen, so it must
    // survive being missed on the first open.
    assert.equal(queue.onShow().length, 1);
    assert.equal(queue.onShow().length, 1);
    assert.equal(queue.onShow().length, 1);
  });

  test("acknowledging a sticky notice stops the replay", () => {
    const queue = new NoticeQueue();
    queue.push(
      { level: "error", message: "write failed", recoverableText: "call the roofer" },
      false,
    );

    const [shown] = queue.onShow();
    queue.acknowledge(shown!.id);

    assert.equal(queue.onShow().length, 0);
    assert.equal(queue.pendingCount(), 0);
  });

  test("a sticky notice raised while visible is still tracked for replay", () => {
    const queue = new NoticeQueue();
    const delivered = queue.push(
      { level: "error", message: "write failed", recoverableText: "a thought" },
      true,
    );

    // Delivered now, but the user may dismiss the box without reading it.
    assert.equal(delivered.length, 1);
    assert.equal(queue.pendingCount(), 1);
    assert.equal(queue.onShow().length, 1);
  });

  test("assigns each notice a distinct id", () => {
    const queue = new NoticeQueue();
    const [a] = queue.push({ level: "info", message: "one" }, true);
    const [b] = queue.push({ level: "info", message: "two" }, true);

    assert.notEqual(a?.id, b?.id);
  });

  test("acknowledging an unknown id is harmless", () => {
    const queue = new NoticeQueue();
    queue.acknowledge("no-such-id");
    assert.equal(queue.pendingCount(), 0);
  });

  test("preserves the recoverable text verbatim", () => {
    const queue = new NoticeQueue();
    const text = "  call the roofer\nand ask about gutters  ";
    const [shown] = queue.push({ level: "error", message: "failed", recoverableText: text }, true);

    assert.equal(shown?.recoverableText, text);
  });
});
