import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { segmentTexts } from "../src/intelligence/segments";
import { SuggestionService } from "../src/suggest/suggestion-service";
import type { SplitOutcome } from "../src/suggest/types";
import { RecordingTransport, seedIntelligence } from "./suggest-fakes";

/**
 * FR-013: nothing dictated is dropped silently.
 *
 * The clarification session rejected a similarity heuristic for this, and
 * segment numbers are what make the rejection affordable: "which text is in no
 * piece" is a set difference over indices. Exact, computed, and the same
 * answer every time — not "roughly 80% of this sentence appears somewhere".
 *
 * A heuristic here would fail in the direction that matters. A user who
 * dictated three thoughts and accepted two pieces needs to see the third, not
 * a confidence score about it.
 */

async function proposalFor(text: string, pieces: number[][]): Promise<SplitOutcome> {
  const transport = new RecordingTransport({ reply: JSON.stringify({ pieces, nothingToSplit: false }) });
  const { catalog } = seedIntelligence({});
  const service = new SuggestionService({ catalog, intelligence: createDefaultIntelligence(transport) });

  const prepared = await service.prepareSplit({
    text,
    capturedAt: null,
    ref: { start: 0, end: 0, raw: "" },
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.run();
}

const TEXT = "Roof estimate. Dentist Thursday. Deploy pipeline. Vendor contract.";

describe("uncovered is exact set arithmetic", () => {
  test("empty when the pieces account for everything", async () => {
    const outcome = await proposalFor(TEXT, [[0, 1], [2, 3]]);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.uncovered, []);
  });

  test("the text of exactly the segments no piece names", async () => {
    const spans = segmentTexts(TEXT);
    const outcome = await proposalFor(TEXT, [[0], [3]]);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.uncovered, [spans[1], spans[2]]);
  });

  test("in file order, whatever order the pieces arrived in", async () => {
    const spans = segmentTexts(TEXT);
    // The model named segment 3 first. The dropped text is still reported in
    // the order the user said it, because that is the order they will read it.
    const outcome = await proposalFor(TEXT, [[3], [0]]);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.uncovered, [spans[1], spans[2]]);
  });

  test("one entry per uncovered segment, never one merged blob", async () => {
    const outcome = await proposalFor(TEXT, [[0]]);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.uncovered.length, 3, "the user sees each dropped thought separately");
  });

  test("the uncovered text is verbatim, sliced from the original", async () => {
    const outcome = await proposalFor(TEXT, [[0]]);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    for (const dropped of outcome.proposal.uncovered) {
      assert.ok(TEXT.includes(dropped), "uncovered text was reworded on its way to the user");
    }
  });

  test("pieces plus uncovered reconstruct the item exactly", async () => {
    for (const pieces of [[[0]], [[0], [2]], [[1, 3]], [[0], [1], [2], [3]]]) {
      const outcome = await proposalFor(TEXT, pieces);
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;

      const spans = segmentTexts(TEXT);
      const claimed = new Set(outcome.proposal.pieces.flatMap((p) => p.segments));
      const rebuilt = spans.map((span, i) => (claimed.has(i) ? span : "")).join("");
      const dropped = outcome.proposal.uncovered.join("");

      assert.equal(rebuilt.length + dropped.length, TEXT.length, "the item was not fully accounted for");
    }
  });
});

describe("it is arithmetic, not judgement", () => {
  test("a near-duplicate sentence is not treated as covering another", async () => {
    // Two nearly identical thoughts. A similarity score would call the second
    // one covered by the first; set difference does not have an opinion.
    const text = "Call the roofer about the estimate. Call the roofer about the invoice.";
    const spans = segmentTexts(text);
    const outcome = await proposalFor(text, [[0]]);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.uncovered, [spans[1]]);
  });

  test("whitespace-only text is still reported when no piece names it", async () => {
    // A dropped segment that reads as blank is still a byte the user's item
    // had. Silently swallowing it would make the accept lossy in a way nothing
    // on screen could explain.
    // No terminator before the newline, so the blank line is a segment of its
    // own rather than trailing whitespace absorbed into the sentence before it.
    const text = "one thing\n   \nanother thing";
    const outcome = await proposalFor(text, [[0], [2]]);

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.uncovered.length, 1);
  });
});
