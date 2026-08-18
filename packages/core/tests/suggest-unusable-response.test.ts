import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeVaultStore } from "./sort-fakes";
import { RecordingTransport, projectFile } from "./suggest-fakes";
import type { InboxItemView } from "../src/sort/decision";

/**
 * FR-064: a completed request whose answer cannot be understood shows **no
 * partial or repaired proposal**.
 *
 * **The Red that matters is "a partial proposal was returned."** A green that
 * comes from the parser throwing before it can repair anything is the right
 * outcome by accident, and would keep being green if someone later added a
 * best-effort recovery path with a try/catch around it. So every case here
 * asserts the *returned value* — `ok: false`, and no `proposal` key — rather
 * than merely that nothing crashed.
 *
 * The one tolerance is a markdown code fence around the JSON. That is a
 * wrapper around the payload rather than a repair of it, and both shipped
 * transports meet it constantly (research R12).
 */

const ITEM: InboxItemView = {
  text: "chase the vendor contract. also the roof estimate. and the dentist.",
  capturedAt: null,
  ref: { start: 0, end: 0, raw: "" },
};

function vault(): FakeVaultStore {
  const v = new FakeVaultStore();
  v.files.set("projects/vendor-consolidation.md", projectFile("Vendor Consolidation", "Renewed by Q4."));
  return v;
}

function serviceWith(reply: string): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vault()),
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply })),
  });
}

async function split(reply: string) {
  const prepared = await serviceWith(reply).prepareSplit(ITEM);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.run();
}

async function destination(reply: string) {
  const prepared = await serviceWith(reply).prepareDestination(ITEM.text);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.run();
}

const UNREADABLE: { name: string; reply: string }[] = [
  { name: "not JSON at all", reply: "I think this should go in the roof project." },
  { name: "empty", reply: "" },
  { name: "whitespace only", reply: "   \n  \n" },
  { name: "a JSON array rather than an object", reply: "[1, 2, 3]" },
  { name: "a JSON string", reply: '"just a string"' },
  { name: "a JSON number", reply: "42" },
  { name: "JSON null", reply: "null" },
  { name: "valid JSON of the wrong shape", reply: '{"answer": "the roof project"}' },
  { name: "truncated mid-object", reply: '{"pieces": [[0], [1]], "nothingToSpl' },
  { name: "truncated mid-array", reply: '{"pieces": [[0], [1' },
  { name: "prose wrapped around valid JSON", reply: 'Here you go!\n{"pieces": [[0]], "nothingToSplit": false}\nHope that helps.' },
];

describe("a split answer that cannot be understood", () => {
  for (const { name, reply } of UNREADABLE) {
    test(`${name}: unusable, with no proposal at all`, async () => {
      const outcome = await split(reply);

      // The assertion that matters. "It did not crash" would pass for a
      // parser that repaired the answer and showed something.
      assert.equal(outcome.ok, false, "a proposal was returned for an answer that could not be read");
      if (outcome.ok) return;
      assert.equal(outcome.reason, "unusable");
      assert.equal("proposal" in outcome, false, "something partial survived the refusal");
      assert.ok(outcome.message.length > 0);
    });
  }

  test("a field of the wrong type is unusable, not coerced", async () => {
    for (const reply of [
      '{"pieces": "0,1", "nothingToSplit": false}',
      '{"pieces": [[0]], "nothingToSplit": "false"}',
      '{"pieces": [["0"]], "nothingToSplit": false}',
      '{"pieces": [[0.5]], "nothingToSplit": false}',
      '{"pieces": [[null]], "nothingToSplit": false}',
    ]) {
      const outcome = await split(reply);
      assert.equal(outcome.ok, false, `${reply} was coerced rather than refused`);
      if (outcome.ok) return;
      assert.equal(outcome.reason, "unusable");
    }
  });
});

describe("a destination answer that cannot be understood", () => {
  for (const { name, reply } of UNREADABLE) {
    test(`${name}: unusable, with no proposal at all`, async () => {
      const outcome = await destination(reply);

      assert.equal(outcome.ok, false, "a proposal was returned for an answer that could not be read");
      if (outcome.ok) return;
      assert.equal(outcome.reason, "unusable");
      assert.equal("proposal" in outcome, false);
    });
  }

  test("a field of the wrong type is unusable, not coerced", async () => {
    for (const reply of [
      '{"destination": 3, "reason": "x"}',
      '{"destination": "trash", "reason": 3}',
      '{"destination": "project", "slug": 3, "reason": "x"}',
      '{"destination": ["trash"], "reason": "x"}',
    ]) {
      const outcome = await destination(reply);
      assert.equal(outcome.ok, false, `${reply} was coerced rather than refused`);
    }
  });
});

describe("the one tolerance: a code fence around the payload", () => {
  test("a fenced split answer parses, and everything inside is parsed strictly", async () => {
    const outcome = await split('```json\n{"pieces": [[0], [1]], "nothingToSplit": false}\n```');

    assert.equal(outcome.ok, true, "a fenced answer must parse");
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.pieces.length, 2);
  });

  test("a fenced destination answer parses too", async () => {
    const outcome = await destination(
      '```\n{"destination": "trash", "reason": "nothing to keep"}\n```',
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.decision.to, "trash");
  });

  test("a leading fence with no closing one is still just a wrapper", async () => {
    // R12's tolerance is a leading *or* trailing fence, stripped
    // independently. A tool whose output was cut off before the closing fence
    // still sent complete JSON, and refusing it would be treating the wrapper
    // as part of the payload.
    const outcome = await split('```json\n{"pieces": [[0], [1]], "nothingToSplit": false}');

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.pieces.length, 2);
  });

  test("a fence around something invalid is still invalid", async () => {
    // Stripping the fence is not permission to repair what is inside it.
    const outcome = await split('```json\n{"pieces": [[99]], "nothingToSplit": false}\n```');
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("and nothing else is tolerated — prose around JSON is still unusable", async () => {
    const outcome = await destination('Sure! {"destination": "trash", "reason": "x"}');
    assert.equal(outcome.ok, false, "extracting JSON from prose is a repair, not a wrapper");
  });
});

describe("nothing is repaired, even when most of the answer is fine", () => {
  test("four good pieces and one bad one is refused entire", async () => {
    const outcome = await split('{"pieces": [[0], [1], [99]], "nothingToSplit": false}');

    assert.equal(outcome.ok, false, "the good pieces were shown and the bad one dropped");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("a valid destination with an invented slug is refused entire", async () => {
    const outcome = await destination(
      '{"destination": "project", "slug": "invented", "reason": "a perfectly good reason"}',
    );

    assert.equal(outcome.ok, false, "an invented destination was shown");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("asking again is the user's to do — the service never retries", async () => {
    const transport = new RecordingTransport({ reply: "not json" });
    const service = new SuggestionService({
      catalog: catalogOf(vault()),
      intelligence: createDefaultIntelligence(transport),
    });

    const prepared = await service.prepareSplit(ITEM);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await prepared.prepared.run();

    assert.equal(transport.calls, 1, "an unusable answer triggered another request");
  });
});
