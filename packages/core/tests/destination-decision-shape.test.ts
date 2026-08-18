import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import type { DestinationOutcome } from "../src/suggest/types";
import { RecordingTransport, areaFile, projectFile, seedIntelligence } from "./suggest-fakes";

/**
 * FR-020, FR-021, FR-025: a proposal is one of Feature 2's five destinations,
 * with a brief reason.
 *
 * "No sixth destination" is not enforced here — it is *inexpressible*. The
 * proposal carries a `SortDecision`, Feature 2's own union, so a destination
 * outside the five has no shape to arrive in. The same type's deliberate lack
 * of a `suggestedBy` field is why FR-032 needs no enforcement either: there is
 * nowhere to record that a machine proposed this, and Feature 2 removed that
 * possibility on purpose.
 */

const VAULT = {
  "projects/vendor-consolidation.md": projectFile("Vendor Consolidation", "Contracts renewed by Q4."),
  "areas/home.md": areaFile("Home"),
};

async function propose(response: unknown, item = "chase Priya about the vendor contract"): Promise<DestinationOutcome> {
  const { catalog } = seedIntelligence(VAULT);
  const service = new SuggestionService({
    catalog,
    intelligence: createDefaultIntelligence(
      new RecordingTransport({ reply: typeof response === "string" ? response : JSON.stringify(response) }),
    ),
  });

  const prepared = await service.prepareDestination(item);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.run();
}

describe("exactly Feature 2's five destinations", () => {
  const VALID = [
    { destination: "project", slug: "vendor-consolidation", reason: "the vendor work" },
    { destination: "project", createTitle: "Board Pack", reason: "new work" },
    { destination: "area", slug: "home", reason: "ongoing" },
    { destination: "area", createTitle: "Vendors", reason: "ongoing, new" },
    { destination: "waiting", owner: "Priya", reason: "she owes it" },
    { destination: "calendar", reason: "it happens at a time" },
    { destination: "trash", reason: "nothing to keep" },
  ];

  for (const response of VALID) {
    test(`${response.destination}${"createTitle" in response ? " (new)" : ""} is expressible`, async () => {
      const outcome = await propose(response);
      assert.equal(outcome.ok, true);
      if (!outcome.ok) return;
      assert.equal(outcome.proposal.decision.to, response.destination);
    });
  }

  test("a sixth destination is not expressible, and is unusable", async () => {
    for (const invented of ["someday", "reference", "delegate", "later", "maybe", "archive"]) {
      const outcome = await propose({ destination: invented, reason: "a new idea" });
      assert.equal(outcome.ok, false, `"${invented}" was accepted as a destination`);
      if (outcome.ok) return;
      assert.equal(outcome.reason, "unusable");
    }
  });

  test("the decision carries no field recording that a machine proposed it", async () => {
    const outcome = await propose({ destination: "trash", reason: "nothing to keep", suggestedBy: "a-model" });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(Object.keys(outcome.proposal.decision).sort(), ["to"]);
    assert.equal("suggestedBy" in outcome.proposal.decision, false);
  });

  test("a proposal carries exactly a decision, a reason, and whether it is new", async () => {
    const outcome = await propose({ destination: "trash", reason: "nothing to keep" });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(Object.keys(outcome.proposal).sort(), ["decision", "isNew", "reason"]);
  });

  test("no ranking, no score, and never more than one destination", async () => {
    const outcome = await propose({
      destination: "trash",
      reason: "nothing to keep",
      alternatives: [{ destination: "calendar" }],
      confidence: 0.82,
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Extra fields are ignored, not carried: there is nowhere for a ranked
    // list or a score to live, so a client cannot render one.
    assert.equal("alternatives" in outcome.proposal, false);
    assert.equal("confidence" in outcome.proposal, false);
  });
});

describe("the reason", () => {
  test("is carried, in the item's own terms", async () => {
    const outcome = await propose({
      destination: "waiting",
      owner: "Priya",
      reason: "Priya owes the vendor contract before the board pack",
    });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.proposal.reason, "Priya owes the vendor contract before the board pack");
  });

  test("an absent reason is unusable rather than shown without one", async () => {
    // A destination with no reason is a bare instruction, and the whole point
    // of this feature is that it proposes rather than instructs (FR-021).
    const outcome = await propose({ destination: "trash" });

    assert.equal(outcome.ok, false, "a proposal was shown with nothing to justify it");
    if (outcome.ok) return;
    assert.equal(outcome.reason, "unusable");
  });

  test("an empty or whitespace reason is unusable too", async () => {
    for (const reason of ["", "   ", "\n"]) {
      const outcome = await propose({ destination: "trash", reason });
      assert.equal(outcome.ok, false, `a reason of ${JSON.stringify(reason)} was accepted`);
    }
  });

  test("a reason of the wrong type is unusable", async () => {
    const outcome = await propose({ destination: "trash", reason: 42 });
    assert.equal(outcome.ok, false);
  });
});

describe("waiting-for carries an owner the user can edit", () => {
  test("drawn from the item text when it names somebody", async () => {
    const outcome = await propose({ destination: "waiting", owner: "Priya", reason: "she owes it" });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.decision, { to: "waiting", owner: "Priya" });
  });

  test("left empty when the text names nobody, rather than invented", async () => {
    // An owner the model made up would be a name written into `waiting.md`
    // that the user never said. Empty is the honest answer, and the sort
    // refuses an empty owner anyway — so the user has to fill it in.
    const outcome = await propose(
      { destination: "waiting", owner: "", reason: "somebody else has this" },
      "waiting on the contract to come back",
    );

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.decision, { to: "waiting", owner: "" });
  });

  test("an absent owner field is the same as an empty one", async () => {
    const outcome = await propose({ destination: "waiting", reason: "somebody has it" });

    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.proposal.decision, { to: "waiting", owner: "" });
  });

  test("an owner of the wrong type is unusable", async () => {
    const outcome = await propose({ destination: "waiting", owner: ["Priya"], reason: "x" });
    assert.equal(outcome.ok, false);
  });
});
