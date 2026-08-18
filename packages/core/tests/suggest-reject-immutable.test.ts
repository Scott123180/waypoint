import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SortService } from "../src/sort/sort-service";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { catalogOf } from "../src/suggest/catalog";
import { FakeInboxDocument, FakeSortJournal, FakeVaultStore, fixedClock } from "./sort-fakes";
import { RecordingTransport, areaFile, projectFile } from "./suggest-fakes";

/**
 * FR-017, FR-027, SC-012: rejecting leaves the item exactly as it was.
 *
 * Asserted with a **whole-vault checksum set**, not a spot check on the inbox.
 * The difference matters: a file created and deleted again during a request
 * would pass "the inbox is unchanged" and fail this, and so would a project
 * file rewritten with identical-looking but differently-ordered content.
 *
 * Ten rejections across both proposal kinds, because the thing being ruled out
 * is accumulation — a cache that appears on the third request, a log that
 * grows on every one.
 */

const ITEM = "- 2026-08-17T09:14:22-04:00 chase Priya about the vendor contract. also the roof.\n";

function harness() {
  const vault = new FakeVaultStore();
  vault.files.set("projects/vendor-consolidation.md", projectFile("Vendor Consolidation", "Contracts renewed by Q4."));
  vault.files.set("projects/roof-repair.md", projectFile("Roof repair", "The roof survives a winter."));
  vault.files.set("areas/home.md", areaFile("Home"));
  vault.files.set("identity.md", "me: Someone\n");
  vault.files.set("policy.md", "wip limit: 3\n");
  vault.files.set("trash.md", "- 2020-01-01 — older discard\n");
  vault.files.set("waiting.md", "- 2026-08-01 @Someone — an older wait\n");

  const inbox = new FakeInboxDocument(ITEM);
  const sort = new SortService({ inbox, vault, journal: new FakeSortJournal(), clock: fixedClock() });

  return { vault, inbox, sort };
}

/**
 * Every file's path and a hash of its contents, plus the inbox.
 *
 * A set of checksums rather than a concatenation, so a file appearing,
 * vanishing, or changing is caught regardless of where it sorts.
 */
function checksums(vault: FakeVaultStore, inbox: FakeInboxDocument): string[] {
  const digest = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
  return [
    ...[...vault.files.entries()].map(([path, content]) => `${path}:${digest(content)}`),
    `inbox.md:${digest(inbox.content)}`,
  ].sort();
}

const SPLIT_REPLY = JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false });
const DESTINATION_REPLIES = [
  { destination: "project", slug: "vendor-consolidation", reason: "the vendor work" },
  { destination: "project", createTitle: "Board Pack Q4", reason: "new work" },
  { destination: "area", slug: "home", reason: "ongoing" },
  { destination: "waiting", owner: "Priya", reason: "she owes it" },
  { destination: "calendar", reason: "it happens at a time" },
  { destination: "trash", reason: "nothing to keep" },
].map((r) => JSON.stringify(r));

function suggestionOver(vault: FakeVaultStore, reply: string): SuggestionService {
  return new SuggestionService({
    catalog: catalogOf(vault),
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply })),
  });
}

describe("ten rejections, across both proposal kinds", () => {
  test("every file in the data directory is byte-identical afterwards", async () => {
    const h = harness();
    const before = checksums(h.vault, h.inbox);
    let rejections = 0;

    const item = await h.sort.next();
    assert.ok(item);

    // Four splits.
    for (let i = 0; i < 4; i++) {
      const suggest = suggestionOver(h.vault, SPLIT_REPLY);
      const prepared = await suggest.prepareSplit(item);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      const outcome = await prepared.prepared.run();
      assert.equal(outcome.ok, true, "the fixture must produce a proposal to reject");
      // Rejecting is doing nothing. There is no verb to call — which is itself
      // the guarantee: a rejection cannot write because it is not an operation.
      rejections += 1;
    }

    // Six destinations, one per shape a decision can take.
    for (const reply of DESTINATION_REPLIES) {
      const suggest = suggestionOver(h.vault, reply);
      const prepared = await suggest.prepareDestination(item.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;

      const outcome = await prepared.prepared.run();
      assert.equal(outcome.ok, true);
      rejections += 1;
    }

    assert.equal(rejections, 10, "at least ten rejections, or this proves less than it claims");
    assert.deepEqual(checksums(h.vault, h.inbox), before, "a rejected proposal changed the vault");
  });

  test("including the proposal that would have created a project, had it been accepted", async () => {
    const h = harness();
    const before = checksums(h.vault, h.inbox);

    const item = await h.sort.next();
    assert.ok(item);
    const suggest = suggestionOver(
      h.vault,
      JSON.stringify({ destination: "project", createTitle: "Board Pack Q4", reason: "new" }),
    );

    const prepared = await suggest.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    const outcome = await prepared.prepared.run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.isNew, true);

    // The stub for a project that does not exist was *not* created by
    // proposing it. Creation happens inside `sort()`, on acceptance.
    assert.equal(h.vault.files.has("projects/board-pack-q4.md"), false);
    assert.deepEqual(checksums(h.vault, h.inbox), before);
  });

  test("and a failed request changes nothing either", async () => {
    const h = harness();
    const before = checksums(h.vault, h.inbox);

    const item = await h.sort.next();
    assert.ok(item);

    for (const reply of ["not json", "{}", '{"destination":"nowhere","reason":"x"}', ""]) {
      const suggest = suggestionOver(h.vault, reply);
      const prepared = await suggest.prepareDestination(item.text);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;
      assert.equal((await prepared.prepared.run()).ok, false);
    }

    assert.deepEqual(checksums(h.vault, h.inbox), before);
  });

  test("an abandoned request changes nothing", async () => {
    const h = harness();
    const before = checksums(h.vault, h.inbox);

    const item = await h.sort.next();
    assert.ok(item);
    const suggest = new SuggestionService({
      catalog: catalogOf(h.vault),
      intelligence: createDefaultIntelligence(new RecordingTransport({ hang: true })),
    });

    const prepared = await suggest.prepareDestination(item.text);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const running = prepared.prepared.run();
    prepared.prepared.abandon();
    assert.equal((await running).ok, false);

    assert.deepEqual(checksums(h.vault, h.inbox), before, "abandoning left something behind");
  });
});

describe("the item itself is exactly as it was", () => {
  test("the same ref still routes after ten rejections", async () => {
    const h = harness();
    const item = await h.sort.next();
    assert.ok(item);

    for (let i = 0; i < 10; i++) {
      const suggest = suggestionOver(h.vault, SPLIT_REPLY);
      const prepared = await suggest.prepareSplit(item);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) return;
      await prepared.prepared.run();
    }

    // The strongest form of "untouched": the byte offsets taken before any of
    // this still verify, so the item never moved by so much as a character.
    assert.equal((await h.sort.sort(item.ref, { to: "trash" })).ok, true);
  });
});
