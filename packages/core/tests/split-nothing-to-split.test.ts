import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import type { SplitOutcome } from "../src/suggest/types";
import { RecordingTransport, seedIntelligence } from "./suggest-fakes";

/**
 * FR-011: an item holding one thought is said to hold one thought.
 *
 * Not proposed as a one-piece split. The difference is what the user does
 * next: "this is already one thing" is an answer they can act on, while a
 * proposal to replace one item with an identical one is a decision they have
 * to make about nothing — and an accept that writes the file for no reason.
 */

async function split(text: string, reply: unknown): Promise<SplitOutcome> {
  const transport = new RecordingTransport({ reply: JSON.stringify(reply) });
  const { catalog } = seedIntelligence({});
  const service = new SuggestionService({ catalog, intelligence: createDefaultIntelligence(transport) });

  const prepared = await service.prepareSplit({ text, capturedAt: null, ref: { start: 0, end: 0, raw: "" } });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.run();
}

describe("a single thought", () => {
  test("is reported as nothing to split, with no pieces", async () => {
    const outcome = await split("Call the roofer about the estimate.", {
      pieces: [],
      nothingToSplit: true,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.nothingToSplit, true);
    assert.deepEqual(outcome.proposal.pieces, []);
  });

  test("reports nothing uncovered, because nothing was proposed to be dropped", async () => {
    const outcome = await split("One thought. Spread over two sentences.", {
      pieces: [],
      nothingToSplit: true,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // The whole item is uncovered in the arithmetic sense, and reporting that
    // would be alarming and wrong: nothing is being dropped, because nothing
    // is being changed.
    assert.deepEqual(outcome.proposal.uncovered, []);
  });

  test("a one-piece grouping is a proposal, not a nothing-to-split", async () => {
    // The distinction is the model's to make and core's to preserve. A model
    // that grouped everything into one piece has proposed a split that happens
    // to be trivial, and the user sees it as such.
    const outcome = await split("A. B.", { pieces: [[0, 1]], nothingToSplit: false });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.nothingToSplit, false);
    assert.equal(outcome.proposal.pieces.length, 1);
  });

  test("nothing to split alongside pieces is contradictory, and unusable", async () => {
    const outcome = await split("A. B.", { pieces: [[0], [1]], nothingToSplit: true });

    assert.equal(outcome.ok, false, "an answer that says both things must not be guessed at");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("a missing nothingToSplit field is unusable rather than assumed false", async () => {
    const outcome = await split("A. B.", { pieces: [[0], [1]] });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });
});

describe("an item with a single segment", () => {
  test("can still be answered as nothing to split", async () => {
    const outcome = await split("just one line with no terminator", { pieces: [], nothingToSplit: true });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.nothingToSplit, true);
  });
});
