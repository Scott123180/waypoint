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
    // pass the test above and fall over on a large inbox. `toLines` did
    // exactly that until 2026-08-19: it recomputed `Buffer.byteLength(doc)`
    // once per line, so 16,000 items took 1.7s and every doubling cost ~4x.
    //
    // **Best-of-N, not a single shot.** Jitter on a shared runner only ever
    // *adds* time, so the minimum of several runs is the cleanest signal
    // available and needs no artificial floor on the baseline. The previous
    // floor (`Math.max(small, 1)`) was worse than noise: it inflated the
    // denominator, and a sub-millisecond baseline could hide a genuinely
    // quadratic parser under the threshold. That is how the defect above
    // survived a test written to catch it.
    const best = (count: number, runs = 5): number => {
      const doc = build(count);
      let min = Infinity;
      for (let run = 0; run < runs; run++) {
        const started = process.hrtime.bigint();
        parseInbox(doc);
        min = Math.min(min, Number(process.hrtime.bigint() - started) / 1e6);
      }
      return min;
    };

    // Both sizes are large enough that the measurement is well clear of timer
    // resolution, so the ratio means something.
    const small = best(2000);
    const large = best(16000);

    // 8x the input costs ~8x the time when the parse is linear, and ~64x when
    // it is quadratic. 30x sits between the two with room on both sides:
    // generous enough to absorb runner jitter, tight enough that the defect
    // this test exists to catch cannot slip under it.
    const ratio = large / small;
    assert.ok(
      ratio < 30,
      `8x input cost ${ratio.toFixed(1)}x time (${small.toFixed(1)}ms → ${large.toFixed(1)}ms)`,
    );
  });
});
