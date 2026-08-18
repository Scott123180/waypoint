import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { RecordingTransport, seedIntelligence } from "./suggest-fakes";

/**
 * FR-043: each project's title and stated outcome, each area's title, and
 * nothing else.
 *
 * The same planted-marker sweep as `split-payload.test.ts`, extended with the
 * part that makes this payload different: a project file is *read*, so the
 * question is not only "which files" but "which parts of this file". A
 * milestone, a next action, a DRI, a status, a ledger entry, and an
 * `## Unprocessed` item are each planted inside a project the payload
 * legitimately carries — and none may appear, while the outcome must.
 *
 * That asymmetry is the test. A payload boundary that only proved absence
 * would also pass for a payload that sent nothing useful.
 */

const M = {
  identity: "MARKER-IDENTITY-4c2d",
  policy: "MARKER-POLICY-55aa",
  trash: "MARKER-TRASH-91ab",
  calendar: "MARKER-CALENDAR-7d13",
  topThree: "MARKER-TOPTHREE-e7f1",
  log: "MARKER-LOG-3f80",
  waiting: "MARKER-WAITING-6b22",
  milestone: "MARKER-MILESTONE-dd04",
  nextAction: "MARKER-NEXT-ACTION-ee05",
  dri: "MARKER-DRI-ff06",
  ledger: "MARKER-LEDGER-1107",
  unprocessed: "MARKER-UNPROCESSED-2208",
  completedOn: "MARKER-COMPLETED-3310",
} as const;

const PROJECT_TITLE = "Vendor Consolidation";
const PROJECT_OUTCOME = "Every vendor contract renewed or ended by Q4, with one owner named for each.";
const AREA_TITLE = "Home";

function plantedVault(): Record<string, string> {
  return {
    "identity.md": `me: ${M.identity}\n`,
    "policy.md": `wip limit: 3\n# ${M.policy}\n`,
    "trash.md": `- 2020-01-01 — ${M.trash}\n`,
    "calendar.md": `- 2026-09-01 — ${M.calendar}\n`,
    "top-three.md": `# ${M.topThree}\n`,
    "waiting.md": `- 2026-08-01 @${M.waiting} — ${M.waiting}\n`,
    "log/2026-W33.md": `# ${M.log}\n`,
    "projects/vendor-consolidation.md": [
      `# ${PROJECT_TITLE}`,
      "",
      "status: active",
      `dri: ${M.dri}`,
      `next action: ${M.nextAction}`,
      `completed: ${M.completedOn}`,
      "",
      "## Outcome",
      "",
      PROJECT_OUTCOME,
      "",
      "## Milestones",
      "",
      `- [ ] ${M.milestone}`,
      "",
      "## Unprocessed",
      "",
      `- ${M.unprocessed}`,
      "",
      "## Ledger",
      "",
      `- 2026-01-02 ${M.ledger}`,
      "",
    ].join("\n"),
    "areas/home.md": [`# ${AREA_TITLE}`, "", "status: active", `dri: ${M.dri}`, ""].join("\n"),
  };
}

const ITEM_TEXT = "chase Priya about the vendor contract before the board pack goes out";

async function destinationPayload(): Promise<string> {
  const { catalog } = seedIntelligence(plantedVault());
  const service = new SuggestionService({
    catalog,
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply: "{}" })),
  });

  const prepared = await service.prepareDestination(ITEM_TEXT);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) throw new Error("unreachable");
  return prepared.prepared.payload;
}

describe("what the destination payload carries", () => {
  test("the item's own text", async () => {
    assert.ok((await destinationPayload()).includes(ITEM_TEXT));
  });

  test("each project's title and its stated outcome", async () => {
    const payload = await destinationPayload();
    assert.ok(payload.includes(PROJECT_TITLE), "a project must be nameable to be proposable");
    assert.ok(payload.includes(PROJECT_OUTCOME), "the outcome is what makes a project distinguishable");
  });

  test("each project's slug, so the answer can name one exactly", async () => {
    assert.ok((await destinationPayload()).includes("vendor-consolidation"));
  });

  test("each area's title, and areas have no outcome to carry", async () => {
    const payload = await destinationPayload();
    assert.ok(payload.includes(AREA_TITLE));
    assert.ok(payload.includes("home"));
  });
});

describe("what it must never carry", () => {
  test("no marker from any file this feature must not read", async () => {
    const payload = await destinationPayload();

    for (const [name, marker] of Object.entries(M)) {
      assert.doesNotMatch(payload, new RegExp(marker), `${name} reached the destination payload`);
    }
  });

  test("specifically: no milestone, next action, DRI, status, ledger, or unprocessed item", async () => {
    const payload = await destinationPayload();

    // Named individually rather than only in the loop above, because these are
    // the ones inside a file the payload *does* read — the ones a change to
    // `readProjects` would leak first.
    assert.doesNotMatch(payload, new RegExp(M.milestone));
    assert.doesNotMatch(payload, new RegExp(M.nextAction));
    assert.doesNotMatch(payload, new RegExp(M.dri));
    assert.doesNotMatch(payload, new RegExp(M.ledger));
    assert.doesNotMatch(payload, new RegExp(M.unprocessed));
    assert.doesNotMatch(payload, /status:\s*active/, "a status reached the payload");
  });

  test("no segment numbering — that belongs to the other request kind", async () => {
    assert.doesNotMatch(await destinationPayload(), /nothingToSplit/);
  });

  test("the fixture really does contain everything proved absent", () => {
    const { vault } = seedIntelligence(plantedVault());
    const project = vault.files.get("projects/vendor-consolidation.md") ?? "";

    // Without this, every assertion above would also pass against an empty
    // vault — which is how a payload test quietly stops testing anything.
    for (const marker of [M.milestone, M.nextAction, M.dri, M.ledger, M.unprocessed]) {
      assert.ok(project.includes(marker), `the fixture is missing ${marker}`);
    }
    assert.ok(vault.files.size >= 9);
  });
});

describe("which files were opened at all", () => {
  test("only projects and areas — never identity, policy, trash, calendar, top-three, or log", async () => {
    const { vault, catalog } = seedIntelligence(plantedVault());
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(new RecordingTransport({ reply: "{}" })),
    });

    await service.prepareDestination(ITEM_TEXT);

    for (const path of vault.readLog) {
      assert.ok(
        path.startsWith("projects/") || path.startsWith("areas/"),
        `${path} was read, and this feature has no business reading it`,
      );
    }
    assert.ok(vault.readLog.length > 0, "nothing was read at all, so this proves nothing");
  });

  test("each destination file is read at most once per request", async () => {
    const { vault, catalog } = seedIntelligence(plantedVault());
    const service = new SuggestionService({
      catalog,
      intelligence: createDefaultIntelligence(new RecordingTransport({ reply: "{}" })),
    });

    await service.prepareDestination(ITEM_TEXT);

    assert.equal(new Set(vault.readLog).size, vault.readLog.length, "a file was read twice");
  });
});
