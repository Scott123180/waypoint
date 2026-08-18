import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { parseInbox } from "../src/inbox/parse";
import { SortService } from "../src/sort/sort-service";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";
import { RecordingTransport, areaFile, projectFile } from "./suggest-fakes";

/**
 * FR-026: after a split, each resulting piece can be asked about on its own.
 *
 * This is the sequence the feature exists for — one rambling dictation becomes
 * three items, and each is placed. Two things have to hold through it, and
 * neither is obvious:
 *
 *   - **Each request carries that piece's text alone.** A piece is not an
 *     inbox item yet at the moment the user might ask, and once it is, its
 *     siblings are ordinary items that have nothing to do with it. A payload
 *     carrying all three would be one item's worth of thought leaking into
 *     another's request.
 *
 *   - **Each piece is routed by its own `sort()` call.** There is no batch
 *     verb, and one refusal must not take the other two with it.
 */

const DICTATION = "roof estimate. dentist thursday. deploy pipeline.";
const ITEM = `- 2026-08-17T09:14:22-04:00 ${DICTATION}\n`;

function harness() {
  const vault = new FakeVaultStore();
  vault.files.set("projects/roof-repair.md", projectFile("Roof repair", "The roof survives a winter."));
  vault.files.set("areas/home.md", areaFile("Home"));

  const inbox = new FakeInboxDocument(ITEM);
  const sort = new SortService({ inbox, vault, journal: new FakeSortJournal(), clock: fixedClock() });

  return { vault, inbox, sort };
}

function suggestionOver(vault: FakeVaultStore, reply: string | ((request: string) => string)) {
  return new SuggestionService({
    catalog: catalogOf(vault),
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply })),
  });
}

/** Splits the seeded item into its three sentences and accepts. */
async function splitIntoThree(h: ReturnType<typeof harness>): Promise<void> {
  const suggest = suggestionOver(
    h.vault,
    JSON.stringify({ pieces: [[0], [1], [2]], nothingToSplit: false }),
  );

  const item = await h.sort.next();
  assert.ok(item);
  const prepared = await suggest.prepareSplit(item);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const outcome = await prepared.prepared.run();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const written = await h.sort.split(item.ref, outcome.proposal.pieces.map((p) => p.text.trim()));
  assert.equal(written.ok, true);
}

describe("after a split, each piece is asked about individually", () => {
  test("three pieces produce three separate requests", async () => {
    const h = harness();
    await splitIntoThree(h);

    const seen: string[] = [];
    const transport = new RecordingTransport({
      reply: JSON.stringify({ destination: "trash", reason: "stubbed" }),
    });
    const suggest = new SuggestionService({
      catalog: catalogOf(h.vault),
      intelligence: createDefaultIntelligence(transport),
    });

    for (const piece of parseInbox(h.inbox.content)) {
      const prepared = await suggest.prepareDestination(piece.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;
      seen.push(prepared.prepared.payload);
      await prepared.prepared.run();
    }

    assert.equal(seen.length, 3);
    assert.equal(transport.calls, 3, "one request per piece, never one for all three");
  });

  test("each payload carries that piece's text and no sibling's", async () => {
    const h = harness();
    await splitIntoThree(h);

    const suggest = suggestionOver(h.vault, JSON.stringify({ destination: "trash", reason: "x" }));
    const pieces = parseInbox(h.inbox.content).map((i) => i.text);
    assert.deepEqual(pieces, ["roof estimate.", "dentist thursday.", "deploy pipeline."]);

    for (const piece of pieces) {
      const prepared = await suggest.prepareDestination(piece);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      assert.ok(prepared.prepared.payload.includes(piece), "the piece's own text must be sent");
      for (const sibling of pieces.filter((p) => p !== piece)) {
        assert.ok(
          !prepared.prepared.payload.includes(sibling),
          `${JSON.stringify(sibling)} leaked into another piece's request`,
        );
      }
    }
  });

  test("a piece can be asked about before it is an inbox item at all", async () => {
    // `prepareDestination` takes text, not an item. That is what makes it
    // askable about a proposed piece the user has not yet accepted.
    const h = harness();
    const suggest = suggestionOver(h.vault, JSON.stringify({ destination: "trash", reason: "x" }));

    const prepared = await suggest.prepareDestination("a piece that exists only on screen");

    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.ok(prepared.prepared.payload.includes("a piece that exists only on screen"));
    assert.equal(h.inbox.content, ITEM, "asking about a piece wrote nothing");
  });
});

describe("each piece is routed by its own sort call", () => {
  test("three pieces go to three different destinations", async () => {
    const h = harness();
    await splitIntoThree(h);

    const answers: Record<string, Record<string, unknown>> = {
      "roof estimate.": { destination: "project", slug: "roof-repair", reason: "the roof" },
      "dentist thursday.": { destination: "calendar", reason: "it happens at a time" },
      "deploy pipeline.": { destination: "trash", reason: "already fixed" },
    };

    // One transport, answering according to which piece it was handed — the
    // per-piece behaviour a batch verb could not express.
    const suggest = suggestionOver(h.vault, (request) => {
      const match = Object.keys(answers).find((piece) => request.includes(piece));
      return JSON.stringify(answers[match ?? ""] ?? { destination: "trash", reason: "x" });
    });

    // Re-read each time: routing the first piece moves the bytes of the rest.
    for (let i = 0; i < 3; i++) {
      const item = await h.sort.next();
      assert.ok(item, "an item must remain");

      const prepared = await suggest.prepareDestination(item.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;
      const outcome = await prepared.prepared.run();
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;

      assert.equal((await h.sort.sort(item.ref, outcome.proposal.decision)).ok, true);
    }

    assert.equal(h.inbox.content, "", "every piece was routed");
    assert.match(h.vault.files.get("projects/roof-repair.md") ?? "", /roof estimate/);
    assert.match(h.vault.files.get("calendar.md") ?? "", /dentist thursday/);
    assert.match(h.vault.files.get("trash.md") ?? "", /deploy pipeline/);
  });

  test("one piece refusing leaves the others routable", async () => {
    const h = harness();
    await splitIntoThree(h);

    const suggest = suggestionOver(
      h.vault,
      JSON.stringify({ destination: "project", slug: "roof-repair", reason: "the roof" }),
    );

    const first = await h.sort.next();
    assert.ok(first);
    const prepared = await suggest.prepareDestination(first.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    // The project vanishes before this one lands.
    h.vault.files.delete("projects/roof-repair.md");
    assert.equal((await h.sort.sort(first.ref, outcome.proposal.decision)).ok, false);

    // The other two are untouched and still ordinary inbox items.
    assert.equal(parseInbox(h.inbox.content).length, 3);
    const still = await h.sort.next();
    assert.ok(still);
    assert.equal((await h.sort.sort(still.ref, { to: "trash" })).ok, true);
  });

  test("there is no verb that routes more than one piece", () => {
    assert.equal(SortService.prototype.sort.length, 2, "one ref, one decision");
    for (const name of Object.getOwnPropertyNames(SortService.prototype)) {
      assert.doesNotMatch(name, /all|batch|many|each/i, `${name} would route more than one item`);
    }
  });
});
