import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SortService } from "../src/sort/sort-service";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";
import { RecordingTransport, projectFile } from "./suggest-fakes";

/**
 * FR-070 and SC-010: this feature stores nothing.
 *
 * No cache, no index, no history of what was accepted or rejected, no
 * per-user tuning signal, no scratch file. Nothing about a request survives
 * the request — which is what makes "learning from the user's decisions"
 * structurally out of scope rather than merely unimplemented (FR-046).
 *
 * Asserted the way Feature 4's `policy-no-files-created.test.ts` asserts it:
 * by diffing the **full path set** before and after, not by checking a list of
 * names someone remembered to write down. A cache invented next year under a
 * name nobody predicted still fails this test.
 */

const ITEM = "- 2026-08-17T09:14:22-04:00 roof estimate. dentist thursday\n";

function harness() {
  const vault = new FakeVaultStore();
  vault.files.set("projects/roof-repair.md", projectFile("Roof repair", "The roof survives a winter."));
  vault.files.set("areas/home.md", projectFile("Home"));

  const inbox = new FakeInboxDocument(ITEM);
  const journal = new FakeSortJournal();
  const sort = new SortService({ inbox, vault, journal, clock: fixedClock() });

  return { vault, inbox, journal, sort };
}

/** Every path in the vault, with its contents, as one comparable snapshot. */
function snapshot(vault: FakeVaultStore, inbox: FakeInboxDocument): string {
  const files = [...vault.files.entries()].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ files, inbox: inbox.content });
}

function paths(vault: FakeVaultStore): string[] {
  return [...vault.files.keys()].sort();
}

function suggestion(vault: FakeVaultStore, reply: string): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vault),
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply })),
  });
}

describe("a prepare, a run, and a rejection", () => {
  test("leave the vault byte-identical", async () => {
    const { vault, inbox, sort } = harness();
    const before = snapshot(vault, inbox);

    const item = await sort.next();
    assert.ok(item);

    const service = suggestion(vault, JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }));
    const prepared = await service.prepareSplit(item);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true, "the fixture must produce a real proposal to reject");

    // Rejecting is doing nothing. There is no verb to call, which is itself
    // the point: a rejection cannot write because it is not an operation.

    assert.equal(snapshot(vault, inbox), before, "something was written by asking and refusing");
  });

  test("create no path that was not there before", async () => {
    const { vault, inbox, sort } = harness();
    const before = paths(vault);

    const item = await sort.next();
    assert.ok(item);
    const service = suggestion(vault, JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }));
    const prepared = await service.prepareSplit(item);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await prepared.prepared.run();

    assert.deepEqual(paths(vault), before);
    void inbox;
  });

  test("the same holds for a destination proposal", async () => {
    const { vault, inbox, sort } = harness();
    const before = snapshot(vault, inbox);

    const item = await sort.next();
    assert.ok(item);
    const service = suggestion(
      vault,
      JSON.stringify({ destination: "project", slug: "roof-repair", reason: "it is about the roof" }),
    );
    const prepared = await service.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    await prepared.prepared.run();

    assert.equal(snapshot(vault, inbox), before, "reading the catalogue wrote something");
  });
});

describe("a prepare, a run, and an acceptance", () => {
  test("write exactly what sorting writes, and nothing beside it", async () => {
    const { vault, inbox, sort } = harness();

    const item = await sort.next();
    assert.ok(item);
    const service = suggestion(
      vault,
      JSON.stringify({ destination: "project", slug: "roof-repair", reason: "it is about the roof" }),
    );
    const prepared = await service.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    // Accepting is the client calling `sort()`. There is no accept verb.
    const sorted = await sort.sort(item.ref, outcome.proposal.decision);
    assert.equal(sorted.ok, true);

    // The project file changed, and the inbox shrank. Nothing else appeared.
    assert.deepEqual(paths(vault), ["areas/home.md", "projects/roof-repair.md"]);
    assert.equal(inbox.content, "");
  });

  test("accepting a split writes only the inbox", async () => {
    const { vault, inbox, sort } = harness();
    const before = paths(vault);

    const item = await sort.next();
    assert.ok(item);
    const service = suggestion(vault, JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }));
    const prepared = await service.prepareSplit(item);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const written = await sort.split(item.ref, outcome.proposal.pieces.map((p) => p.text.trim()));
    assert.equal(written.ok, true);

    assert.deepEqual(paths(vault), before, "a split created a file outside the inbox");
    assert.notEqual(inbox.content, ITEM, "the split did land");
  });
});

describe("nothing accumulates over many requests", () => {
  test("ten cycles leave the same path set as none", async () => {
    const { vault, inbox, sort } = harness();
    const before = paths(vault);

    for (let i = 0; i < 10; i++) {
      const item = await sort.next();
      assert.ok(item);
      const service = suggestion(vault, JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }));
      const prepared = await service.prepareSplit(item);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;
      await prepared.prepared.run();
    }

    assert.deepEqual(paths(vault), before);
    assert.equal(inbox.content, ITEM, "ten proposals, zero writes");
  });

  test("no proposal is retrievable after the fact, because none is held", async () => {
    const { vault, sort } = harness();
    const item = await sort.next();
    assert.ok(item);

    const service = suggestion(vault, JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }));
    await (await service.prepareSplit(item)).ok;

    // There is no verb that could return a past proposal, and no field holding
    // one. The surface is the guarantee.
    const surface = Object.getOwnPropertyNames(SuggestionService.prototype);
    for (const name of surface) {
      assert.doesNotMatch(name, /history|recent|last|cache|previous/i, `${name} implies something was kept`);
    }
  });
});
