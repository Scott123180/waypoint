import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { RecordingTransport, seedIntelligence } from "./suggest-fakes";

/**
 * FR-042: a split request carries the item's own text and nothing else.
 *
 * Guarded by counting what is **absent** — `summary-payload.test.ts`'s
 * technique. A test that only checked the payload's shape would pass while
 * leaking, because the shape it checked would be the shape it built.
 *
 * A marker is planted in every file this feature must never read and in every
 * part of a project file the payload must never carry. None may appear. The
 * assertion runs against `prepared.payload` — the value the user is shown and
 * the value the transport receives, which are the same value — so this is a
 * claim about what leaves the machine, not about an intermediate object.
 */

const MARKERS = {
  identity: "MARKER-IDENTITY-4c2d",
  policy: "MARKER-POLICY-55aa",
  trash: "MARKER-TRASH-91ab",
  calendar: "MARKER-CALENDAR-7d13",
  topThree: "MARKER-TOPTHREE-e7f1",
  log: "MARKER-LOG-3f80",
  waiting: "MARKER-WAITING-6b22",
  siblingItem: "MARKER-OTHER-ITEM-aa01",
  projectTitle: "MARKER-PROJECT-TITLE-bb02",
  projectOutcome: "MARKER-PROJECT-OUTCOME-cc03",
  milestone: "MARKER-MILESTONE-dd04",
  nextAction: "MARKER-NEXT-ACTION-ee05",
  dri: "MARKER-DRI-ff06",
  ledger: "MARKER-LEDGER-1107",
  unprocessed: "MARKER-UNPROCESSED-2208",
  areaTitle: "MARKER-AREA-TITLE-3309",
} as const;

function plantedVault(): Record<string, string> {
  return {
    "identity.md": [`me: ${MARKERS.identity}`, "", "## Aliases", "", `- ${MARKERS.identity}`, ""].join("\n"),
    "policy.md": ["wip limit: 3", `# ${MARKERS.policy}`, ""].join("\n"),
    "trash.md": [`- 2020-01-01 — ${MARKERS.trash}`, ""].join("\n"),
    "calendar.md": [`- 2026-09-01 — ${MARKERS.calendar}`, ""].join("\n"),
    "top-three.md": [`# ${MARKERS.topThree}`, "", `- [ ] ${MARKERS.topThree}`, ""].join("\n"),
    "waiting.md": [`- 2026-08-01 @${MARKERS.waiting} — ${MARKERS.waiting}`, ""].join("\n"),
    "log/2026-W33.md": [`# ${MARKERS.log}`, "", MARKERS.log, ""].join("\n"),
    "projects/one.md": [
      `# ${MARKERS.projectTitle}`,
      "",
      "status: active",
      `dri: ${MARKERS.dri}`,
      `next action: ${MARKERS.nextAction}`,
      "",
      "## Outcome",
      "",
      MARKERS.projectOutcome,
      "",
      "## Milestones",
      "",
      `- [ ] ${MARKERS.milestone}`,
      "",
      "## Unprocessed",
      "",
      `- ${MARKERS.unprocessed}`,
      "",
      "## Ledger",
      "",
      `- 2026-01-02 ${MARKERS.ledger}`,
      "",
    ].join("\n"),
    "areas/one.md": [`# ${MARKERS.areaTitle}`, "", "status: active", ""].join("\n"),
  };
}

const ITEM_TEXT = "call the roofer about the estimate. also the dentist on Thursday.";

async function splitPayload(): Promise<string> {
  const transport = new RecordingTransport({ reply: "{}" });
  const { catalog } = seedIntelligence(plantedVault());
  const service = new SuggestionService({ catalog, intelligence: createDefaultIntelligence(transport) });

  const prepared = await service.prepareSplit({
    text: ITEM_TEXT,
    capturedAt: new Date("2026-08-17T09:14:22-04:00"),
    ref: { start: 0, end: 0, raw: `- 2026-08-17T09:14:22-04:00 ${ITEM_TEXT}\n${MARKERS.siblingItem}` },
  });
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.payload;
}

describe("the split payload carries the item and nothing else", () => {
  test("no marker from any file in the vault reaches it", async () => {
    const payload = await splitPayload();

    for (const [name, marker] of Object.entries(MARKERS)) {
      assert.doesNotMatch(payload, new RegExp(marker), `${name} reached the split payload`);
    }
  });

  test("it does carry the item's own text, or it would be useless", async () => {
    const payload = await splitPayload();
    assert.ok(payload.includes("call the roofer about the estimate"), "the item itself must be sent");
    assert.ok(payload.includes("the dentist on Thursday"));
  });

  test("it carries the numbered segments the model answers about", async () => {
    const payload = await splitPayload();
    assert.match(payload, /\[0\]/, "the segments must be numbered for the model to name them");
    assert.match(payload, /\[1\]/);
  });

  test("nothing about the item's own storage travels with it", async () => {
    const payload = await splitPayload();

    // The ref's byte offsets and the raw block are how the *file* holds this
    // item. They are not the thought, and a model has no use for them.
    assert.doesNotMatch(payload, /2026-08-17T09:14:22/, "the capture timestamp reached the payload");
    assert.doesNotMatch(payload, /"start"|"end"|"raw"/, "the item's byte offsets reached the payload");
  });

  test("and the whole vault is readable, so absence is not an artefact of an empty fixture", async () => {
    // Without this, every assertion above would also pass against a vault with
    // no files in it — which is the way a payload test quietly stops testing.
    const { vault } = seedIntelligence(plantedVault());
    assert.ok(vault.files.size >= 9, "the fixture must actually contain the files it proves absent");
    assert.ok((vault.files.get("projects/one.md") ?? "").includes(MARKERS.milestone));
  });
});

describe("preparing a split reads nothing", () => {
  test("not one file, because a split needs no catalogue", async () => {
    const { vault, catalog } = seedIntelligence(plantedVault());
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(new RecordingTransport()),
    });

    await service.prepareSplit({ text: ITEM_TEXT, capturedAt: null, ref: { start: 0, end: 0, raw: "" } });

    assert.deepEqual(vault.readLog, [], "a split read a file it cannot have a use for");
  });
});
