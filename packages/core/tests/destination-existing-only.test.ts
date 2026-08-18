import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import type { DestinationOutcome } from "../src/suggest/types";
import { RecordingTransport, areaFile, projectFile, seedIntelligence } from "./suggest-fakes";

/**
 * FR-022 and FR-024: only a project or area that **exists** may be proposed as
 * existing, and the set of what exists is re-read for every request.
 *
 * The failure this rules out is the expensive one. A proposal naming a project
 * the user does not have is not merely wrong — accepted, it would either
 * refuse at the write (confusing) or silently create something (worse). The
 * slug in the answer is checked against the catalogue read for *this* request,
 * and an unknown one makes the whole response `unusable`.
 *
 * Proposing something *new* is a separate, visible thing: a `createTitle`,
 * marked `isNew`, which the user confirms (FR-023).
 */

const VAULT = {
  "projects/vendor-consolidation.md": projectFile("Vendor Consolidation", "Every contract renewed or ended by Q4."),
  "projects/roof-repair.md": projectFile("Roof repair", "The roof survives a full winter."),
  "projects/hiring-backend.md": projectFile("Backend hiring", "A backend engineer starts."),
  "areas/home.md": areaFile("Home"),
  "areas/finance.md": areaFile("Finance"),
};

const EXISTING_PROJECTS = ["vendor-consolidation", "roof-repair", "hiring-backend"];
const EXISTING_AREAS = ["home", "finance"];

async function propose(
  response: unknown,
  files: Record<string, string> = VAULT,
): Promise<{ outcome: DestinationOutcome; vault: ReturnType<typeof seedIntelligence>["vault"] }> {
  const { vault, catalog } = seedIntelligence(files);
  const service = new SuggestionService({
    catalog,
    intelligence: createDefaultIntelligence(
      new RecordingTransport({ reply: typeof response === "string" ? response : JSON.stringify(response) }),
    ),
  });

  const prepared = await service.prepareDestination("chase the vendor contract");
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return { outcome: await prepared.prepared.run(), vault };
}

/** Twenty-one answers a model might plausibly give, across all five destinations. */
const CORPUS: { name: string; response: Record<string, unknown> }[] = [
  ...EXISTING_PROJECTS.map((slug) => ({
    name: `an existing project: ${slug}`,
    response: { destination: "project", slug, reason: "it belongs to that work" },
  })),
  ...EXISTING_AREAS.map((slug) => ({
    name: `an existing area: ${slug}`,
    response: { destination: "area", slug, reason: "an ongoing responsibility" },
  })),
  { name: "a new project", response: { destination: "project", createTitle: "Board Pack Q4", reason: "new work with an end" } },
  { name: "a new project with punctuation", response: { destination: "project", createTitle: "Renew the O'Brien contract", reason: "new work" } },
  { name: "a new area", response: { destination: "area", createTitle: "Vendor Relationships", reason: "ongoing" } },
  { name: "waiting on a named person", response: { destination: "waiting", owner: "Priya", reason: "she owes the contract" } },
  { name: "waiting on nobody named", response: { destination: "waiting", owner: "", reason: "someone else has it" } },
  { name: "calendar", response: { destination: "calendar", reason: "it happens at a time" } },
  { name: "trash", response: { destination: "trash", reason: "nothing worth keeping" } },
  { name: "a long reason", response: { destination: "trash", reason: "x".repeat(400) } },
  { name: "a non-ASCII reason", response: { destination: "trash", reason: "rien à faire — 日本語" } },
  { name: "a fenced answer", response: { destination: "trash", reason: "wrapped in a code fence" } },
  { name: "extra fields, ignored", response: { destination: "trash", reason: "fine", confidence: 0.9, rank: 1 } },
  { name: "another existing project", response: { destination: "project", slug: "roof-repair", reason: "the roof again" } },
  { name: "another existing area", response: { destination: "area", slug: "finance", reason: "money" } },
  { name: "a new project named like an existing one", response: { destination: "project", createTitle: "Roof repair", reason: "looks similar, still new" } },
  { name: "waiting on a full name", response: { destination: "waiting", owner: "Priya Raghunathan", reason: "she owes the signed copy" } },
  { name: "a third existing project", response: { destination: "project", slug: "hiring-backend", reason: "the hiring work" } },
];

describe("the whole corpus, and what it proves", () => {
  let checked = 0;
  let invented = 0;

  for (const { name, response } of CORPUS) {
    test(name, async () => {
      const wire =
        name === "a fenced answer"
          ? "```json\n" + JSON.stringify(response) + "\n```"
          : response;
      const { outcome } = await propose(wire);

      assert.equal(outcome.ok, true, "a valid answer must produce a proposal");
      if (!outcome.ok) return;
      checked += 1;

      const decision = outcome.proposal.decision;
      if ((decision.to === "project" || decision.to === "area") && "slug" in decision) {
        const known = decision.to === "project" ? EXISTING_PROJECTS : EXISTING_AREAS;
        if (!known.includes(decision.slug)) invented += 1;
        assert.ok(known.includes(decision.slug), `${decision.slug} does not exist in the fixture`);
        assert.equal(outcome.proposal.isNew, false, "an existing destination is not new");
      }
    });
  }

  test("the corpus was exercised, and nothing was invented", () => {
    assert.equal(CORPUS.length, 21, "at least twenty proposals, or this proves less than it claims");
    assert.equal(checked, CORPUS.length);
    assert.equal(invented, 0, "a name was presented as existing when it does not exist");
  });
});

describe("a slug that does not exist", () => {
  for (const [name, response] of [
    ["a project nobody has", { destination: "project", slug: "not-a-real-project", reason: "invented" }],
    ["an area nobody has", { destination: "area", slug: "not-a-real-area", reason: "invented" }],
    ["a project slug that names an area", { destination: "project", slug: "home", reason: "wrong directory" }],
    ["an area slug that names a project", { destination: "area", slug: "roof-repair", reason: "wrong directory" }],
    ["a slug with a path in it", { destination: "project", slug: "../identity", reason: "reaching" }],
  ] as const) {
    test(`${name} makes the whole response unusable`, async () => {
      const { outcome } = await propose(response);

      assert.equal(outcome.ok, false, "an invented destination was shown as though it existed");
      if (outcome.ok) return;
      assert.equal(outcome.reason, "unusable");
      assert.ok(!("proposal" in outcome), "nothing partial survived");
    });
  }

  test("it is not quietly turned into a create", async () => {
    // Silently converting an unknown slug into "create a project called that"
    // would be the system deciding, and the user confirming something they
    // were never shown as new (FR-023).
    const { outcome } = await propose({ destination: "project", slug: "brand-new", reason: "x" });
    assert.equal(outcome.ok, false);
  });
});

describe("proposing something new is visibly new", () => {
  test("a createTitle decision is marked isNew", async () => {
    const { outcome } = await propose({
      destination: "project",
      createTitle: "Board Pack Q4",
      reason: "new work with an end",
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.isNew, true);
    assert.deepEqual(outcome.proposal.decision, { to: "project", createTitle: "Board Pack Q4" });
  });

  test("isNew is derived from the decision's shape, not from the response", async () => {
    // A response claiming `isNew: false` alongside a createTitle must not be
    // believed — the shape is the fact.
    const { outcome } = await propose({
      destination: "area",
      createTitle: "Vendor Relationships",
      reason: "ongoing",
      isNew: false,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.isNew, true);
  });

  test("both a slug and a createTitle is contradictory, and unusable", async () => {
    const { outcome } = await propose({
      destination: "project",
      slug: "roof-repair",
      createTitle: "Roof repair",
      reason: "both",
    });

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("a project or area naming neither is unusable", async () => {
    const { outcome } = await propose({ destination: "project", reason: "which one?" });
    assert.equal(outcome.ok, false);
  });

  test("an empty createTitle is unusable rather than a proposal to create nothing", async () => {
    const { outcome } = await propose({ destination: "project", createTitle: "   ", reason: "x" });
    assert.equal(outcome.ok, false);
  });
});

describe("the catalogue is read fresh, every request", () => {
  test("a project created in another window is proposable with no restart", async () => {
    const { vault, catalog } = seedIntelligence(VAULT);
    const transport = new RecordingTransport({
      reply: JSON.stringify({ destination: "project", slug: "made-elsewhere", reason: "new" }),
    });
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(transport),
    });

    // Before: the slug does not exist, so an answer naming it is unusable.
    const first = await service.prepareDestination("x");
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal((await first.prepared.run()).ok, false);

    // Another window creates it. No restart, no cache to invalidate.
    vault.files.set("projects/made-elsewhere.md", projectFile("Made Elsewhere", "It exists now."));

    const second = await service.prepareDestination("x");
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const outcome = await second.prepared.run();
    assert.equal(outcome.ok, true, "the new project was not visible to the second request");
  });

  test("a project deleted in another window stops being proposable", async () => {
    const { vault, catalog } = seedIntelligence(VAULT);
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(
        new RecordingTransport({
          reply: JSON.stringify({ destination: "project", slug: "roof-repair", reason: "the roof" }),
        }),
      ),
    });

    vault.files.delete("projects/roof-repair.md");

    const prepared = await service.prepareDestination("x");
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;
    assert.equal((await prepared.prepared.run()).ok, false, "a deleted project was still proposable");
  });

  test("an empty vault proposes no existing destination, and does not fail", async () => {
    const { outcome } = await propose(
      { destination: "project", createTitle: "The First One", reason: "nothing exists yet" },
      {},
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.isNew, true);
  });
});
