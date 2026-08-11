import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { InboxMutex } from "../src/main/inbox-mutex";

describe("InboxMutex", () => {
  test("serializes overlapping operations", async () => {
    const mutex = new InboxMutex();
    const order: string[] = [];

    const slow = mutex.run(async () => {
      order.push("a:start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a:end");
    });
    const fast = mutex.run(async () => {
      order.push("b:start");
      order.push("b:end");
    });

    await Promise.all([slow, fast]);

    // b must not interleave into a's critical section.
    assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  });

  test("releases the lock when the operation throws", async () => {
    const mutex = new InboxMutex();

    await assert.rejects(mutex.run(() => Promise.reject(new Error("boom"))), /boom/);

    // A leaked lock here would wedge capture permanently.
    assert.equal(await mutex.run(() => Promise.resolve("still works")), "still works");
  });

  test("returns the operation's value", async () => {
    const mutex = new InboxMutex();
    assert.equal(await mutex.run(() => Promise.resolve(42)), 42);
  });

  test("preserves FIFO order across many waiters", async () => {
    const mutex = new InboxMutex();
    const seen: number[] = [];

    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        mutex.run(async () => {
          await new Promise((r) => setTimeout(r, 5 - n));
          seen.push(n);
        }),
      ),
    );

    assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  });
});
