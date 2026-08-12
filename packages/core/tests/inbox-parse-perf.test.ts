import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseInbox } from "../src/inbox/parse";

/**
 * SC-002a: parsing a 1,000-item inbox stays under 50ms, so the sort loop's
 * per-decision budget is spent on the disk write rather than on re-reading.
 *
 * Treat a CI failure as a regression signal, not an absolute measurement.
 */

describe("parser performance", () => {
  const build = (count: number): string =>
    Array.from(
      { length: count },
      (_, i) =>
        `- 2026-08-09T${String(i % 24).padStart(2, "0")}:00:00-04:00 item ${i} with some text\n` +
        (i % 5 === 0 ? "  and a continuation line\n" : ""),
    ).join("");

  test("parses 1,000 items in under 50ms", () => {
    const doc = build(1000);

    const started = process.hrtime.bigint();
    const items = parseInbox(doc);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.equal(items.length, 1000);
    assert.ok(elapsedMs < 50, `parsing took ${elapsedMs.toFixed(1)}ms, budget is 50ms`);
  });

  test("scales roughly linearly, not quadratically", () => {
    // A naive implementation that re-encodes the whole buffer per line would
    // pass the test above and fall over on a large inbox.
    const time = (count: number): number => {
      const doc = build(count);
      const started = process.hrtime.bigint();
      parseInbox(doc);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    time(500); // warm up
    // Floor the baseline at 1ms: on a noisy shared runner, a sub-millisecond
    // `small` measurement makes the ratio swing wildly even when scaling is
    // in fact linear.
    const small = Math.max(time(500), 1);
    const large = time(4000);

    // 8x the input should not cost more than ~40x the time. Generous enough
    // to absorb shared-runner jitter while still catching quadratic blowups
    // (which would cost ~64x).
    assert.ok(large / small < 40, `8x input cost ${(large / small).toFixed(1)}x time`);
  });
});
