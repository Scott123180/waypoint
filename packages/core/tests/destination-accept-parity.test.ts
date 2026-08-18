import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SortService } from "../src/sort/sort-service";
import type { SortDecision } from "../src/sort/decision";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";
import { RecordingTransport, areaFile, projectFile } from "./suggest-fakes";

/**
 * FR-030, FR-032, FR-033: accepting a proposal is the same act as choosing by
 * hand — and the files prove it, byte for byte.
 *
 * There is no `accept()` verb anywhere. A client that has shown a proposal and
 * heard yes calls `sort.sort(ref, proposal.decision)`: the same call, the same
 * validation, the same item-changed verification, the same refusals, the same
 * journalling and recovery, the same policy consultation. Nothing distinguishes
 * the two at the call site because `SortDecision` has no field in which the
 * difference could be recorded.
 *
 * The refusal case at the end matters most. A refusal is the moment a system
 * that wanted to be helpful would work around something — retry, pick a
 * different destination, quietly create what is missing. This one hands the
 * user Feature 2's words and stops.
 */

const ITEM = "- 2026-08-17T09:14:22-04:00 chase Priya about the vendor contract\n";

function vault(): FakeVaultStore {
  const v = new FakeVaultStore();
  v.files.set("projects/vendor-consolidation.md", projectFile("Vendor Consolidation", "Contracts renewed by Q4."));
  v.files.set("areas/home.md", areaFile("Home"));
  return v;
}

function sortOver(v: FakeVaultStore, inbox: FakeInboxDocument): SortService {
  return new SortService({ inbox, vault: v, journal: new FakeSortJournal(), clock: fixedClock() });
}

/** Everything the vault holds afterwards, as one comparable value. */
function snapshot(v: FakeVaultStore, inbox: FakeInboxDocument): string {
  return JSON.stringify({
    files: [...v.files.entries()].sort(([a], [b]) => a.localeCompare(b)),
    inbox: inbox.content,
  });
}

/** Sorting by hand: the decision goes straight to `sort()`. */
async function byHand(decision: SortDecision): Promise<string> {
  const v = vault();
  const inbox = new FakeInboxDocument(ITEM);
  const sort = sortOver(v, inbox);

  const item = await sort.next();
  assert.ok(item);
  const outcome = await sort.sort(item.ref, decision);
  assert.equal(outcome.ok, true, `sorting by hand to ${decision.to} failed`);

  return snapshot(v, inbox);
}

/** Accepting a proposal: the same call, after a round trip through a model. */
async function byAccepting(response: Record<string, unknown>): Promise<string> {
  const v = vault();
  const inbox = new FakeInboxDocument(ITEM);
  const sort = sortOver(v, inbox);

  const suggest = new SuggestionService({
    catalog: catalogOf(v),
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply: JSON.stringify(response) })),
  });

  const item = await sort.next();
  assert.ok(item);

  const prepared = await suggest.prepareDestination(item.text);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  const outcome = await prepared.prepared.run();
  assert.equal(outcome.ok, true, "the fixture must produce a proposal to accept");
  if (!outcome.ok) throw new Error("unreachable");

  // The whole of "accepting": the client calls the same verb it would have
  // called anyway, with the decision the proposal carried.
  const sorted = await sort.sort(item.ref, outcome.proposal.decision);
  assert.equal(sorted.ok, true);

  return snapshot(v, inbox);
}

describe("accepting produces byte-identical files to deciding by hand", () => {
  const CASES: { name: string; decision: SortDecision; response: Record<string, unknown> }[] = [
    {
      name: "an existing project",
      decision: { to: "project", slug: "vendor-consolidation" },
      response: { destination: "project", slug: "vendor-consolidation", reason: "the vendor work" },
    },
    {
      name: "an existing area",
      decision: { to: "area", slug: "home" },
      response: { destination: "area", slug: "home", reason: "ongoing" },
    },
    {
      name: "waiting for someone",
      decision: { to: "waiting", owner: "Priya" },
      response: { destination: "waiting", owner: "Priya", reason: "she owes it" },
    },
    {
      name: "the calendar",
      decision: { to: "calendar" },
      response: { destination: "calendar", reason: "it happens at a time" },
    },
    {
      name: "the trash",
      decision: { to: "trash" },
      response: { destination: "trash", reason: "nothing worth keeping" },
    },
    {
      name: "creating a project",
      decision: { to: "project", createTitle: "Board Pack Q4" },
      response: { destination: "project", createTitle: "Board Pack Q4", reason: "new work with an end" },
    },
    {
      name: "creating an area",
      decision: { to: "area", createTitle: "Vendor Relationships" },
      response: { destination: "area", createTitle: "Vendor Relationships", reason: "ongoing" },
    },
  ];

  for (const { name, decision, response } of CASES) {
    test(name, async () => {
      assert.equal(await byAccepting(response), await byHand(decision));
    });
  }

  test("nothing anywhere records that a suggestion occurred", async () => {
    for (const { response } of CASES) {
      const written = await byAccepting(response);
      assert.doesNotMatch(written, /suggest|proposal|model|assisted|confidence|reason/i);
    }
  });

  test("the reason is displayed and never written", async () => {
    const written = await byAccepting({
      destination: "trash",
      reason: "MARKER-REASON-NEVER-WRITTEN",
    });
    assert.doesNotMatch(written, /MARKER-REASON-NEVER-WRITTEN/);
  });
});

describe("a refusal reaches the caller verbatim, and is not worked around", () => {
  test("destination-missing when the proposed project is deleted before the accept", async () => {
    const v = vault();
    const inbox = new FakeInboxDocument(ITEM);
    const sort = sortOver(v, inbox);

    const transport = new RecordingTransport({
      reply: JSON.stringify({
        destination: "project",
        slug: "vendor-consolidation",
        reason: "the vendor work",
      }),
    });
    const suggest = new SuggestionService({
      catalog: catalogOf(v),
      intelligence: createDefaultIntelligence(transport),
    });

    const item = await sort.next();
    assert.ok(item);
    const prepared = await suggest.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    // Deleted in another window, between the proposal and the acceptance.
    v.files.delete("projects/vendor-consolidation.md");
    const before = snapshot(v, inbox);
    const callsBefore = transport.calls;

    const sorted = await sort.sort(item.ref, outcome.proposal.decision);

    assert.equal(sorted.ok, false);
    if (sorted.ok) return;

    // Feature 2's refusal, word for word — not reworded, not reshaped, not
    // wrapped in a second vocabulary for the assisted path (FR-033).
    assert.equal(sorted.reason, "destination-missing");
    assert.equal(
      sorted.message,
      "projects/vendor-consolidation.md no longer exists. Nothing was written; choose again.",
    );

    // And nothing tried to rescue it: no retry, no fresh proposal, no quiet
    // creation of the missing project.
    assert.equal(transport.calls, callsBefore, "a refusal triggered another request");
    assert.equal(snapshot(v, inbox), before, "a refusal wrote something");
  });

  test("item-changed when the item moved between the proposal and the accept", async () => {
    const v = vault();
    const inbox = new FakeInboxDocument(ITEM);
    const sort = sortOver(v, inbox);

    const suggest = new SuggestionService({
      catalog: catalogOf(v),
      intelligence: createDefaultIntelligence(
        new RecordingTransport({ reply: JSON.stringify({ destination: "trash", reason: "no" }) }),
      ),
    });

    const item = await sort.next();
    assert.ok(item);
    const prepared = await suggest.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    inbox.content = "- 2026-08-17T09:14:22-04:00 something else entirely\n";

    const sorted = await sort.sort(item.ref, outcome.proposal.decision);
    assert.equal(sorted.ok, false);
    if (sorted.ok) return;
    assert.equal(sorted.reason, "item-changed");
  });

  test("an empty waiting owner is refused exactly as it is by hand", async () => {
    const v = vault();
    const inbox = new FakeInboxDocument(ITEM);
    const sort = sortOver(v, inbox);

    const suggest = new SuggestionService({
      catalog: catalogOf(v),
      intelligence: createDefaultIntelligence(
        new RecordingTransport({
          reply: JSON.stringify({ destination: "waiting", owner: "", reason: "somebody has it" }),
        }),
      ),
    });

    const item = await sort.next();
    assert.ok(item);
    const prepared = await suggest.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    const sorted = await sort.sort(item.ref, outcome.proposal.decision);
    const byHandOutcome = await sortOver(vault(), new FakeInboxDocument(ITEM)).sort(item.ref, {
      to: "waiting",
      owner: "",
    });

    assert.deepEqual(sorted, byHandOutcome, "the assisted path got a different refusal");
  });
});

describe("there is no second path to a destination", () => {
  test("the suggestion service exposes no verb that writes", () => {
    const surface = Object.getOwnPropertyNames(SuggestionService.prototype);
    for (const name of surface) {
      assert.doesNotMatch(name, /accept|apply|commit|route|file|write/i, `${name} would be a second path`);
    }
  });

  test("accepting requires a SortService the suggestion service does not have", () => {
    // The client holds both. The suggestion service holds neither the sort
    // service nor anything it could reach one through, so "the assisted path
    // goes through sort()" is a fact about who can call what.
    const service = new SuggestionService({ catalog: catalogOf(vault()) });
    for (const key of Object.keys(service as unknown as Record<string, unknown>)) {
      assert.doesNotMatch(key, /sort|vault|inbox|journal/i, `${key} is a way to write from here`);
    }
  });
});
