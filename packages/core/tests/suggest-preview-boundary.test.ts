import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultIntelligence } from "../src/intelligence/default-intelligence";
import { SuggestionService } from "../src/suggest/suggestion-service";
import { RecordingTransport, seedIntelligence } from "./suggest-fakes";

/**
 * FR-041, FR-044, SC-007: the boundary, asserted through the thing the user
 * actually reads.
 *
 * `split-payload.test.ts` and `destination-payload.test.ts` each prove their
 * own request kind. This one exists because those could both pass while the
 * *preview* showed something else — and the preview is what the user inspects
 * before consenting. So every assertion here runs against `prepared.payload`,
 * for both kinds, in one place: whatever the user reads is the thing proved
 * clean, and it is the same value the transport receives.
 */

const MARKERS = [
  "MARKER-IDENTITY-4c2d",
  "MARKER-POLICY-55aa",
  "MARKER-TRASH-91ab",
  "MARKER-CALENDAR-7d13",
  "MARKER-TOPTHREE-e7f1",
  "MARKER-LOG-3f80",
  "MARKER-WAITING-6b22",
  "MARKER-SIBLING-ITEM-aa01",
  "MARKER-MILESTONE-dd04",
  "MARKER-NEXT-ACTION-ee05",
  "MARKER-DRI-ff06",
  "MARKER-LEDGER-1107",
  "MARKER-UNPROCESSED-2208",
] as const;

const VAULT: Record<string, string> = {
  "identity.md": "me: MARKER-IDENTITY-4c2d\n\n## Aliases\n\n- MARKER-IDENTITY-4c2d\n",
  "policy.md": "wip limit: 3\n# MARKER-POLICY-55aa\n",
  "trash.md": "- 2020-01-01 — MARKER-TRASH-91ab\n",
  "calendar.md": "- 2026-09-01 — MARKER-CALENDAR-7d13\n",
  "top-three.md": "# MARKER-TOPTHREE-e7f1\n\n- [ ] MARKER-TOPTHREE-e7f1\n",
  "waiting.md": "- 2026-08-01 @MARKER-WAITING-6b22 — MARKER-WAITING-6b22\n",
  "log/2026-W33.md": "# MARKER-LOG-3f80\n\nMARKER-LOG-3f80\n",
  "projects/one.md": [
    "# A Real Project",
    "",
    "status: active",
    "dri: MARKER-DRI-ff06",
    "next action: MARKER-NEXT-ACTION-ee05",
    "",
    "## Outcome",
    "",
    "A stated outcome that is allowed to travel.",
    "",
    "## Milestones",
    "",
    "- [ ] MARKER-MILESTONE-dd04",
    "",
    "## Unprocessed",
    "",
    "- MARKER-UNPROCESSED-2208",
    "",
    "## Ledger",
    "",
    "- 2026-01-02 MARKER-LEDGER-1107",
    "",
  ].join("\n"),
  "areas/one.md": "# A Real Area\n\nstatus: active\n",
};

const ITEM_TEXT = "chase the vendor contract. also the roof estimate.";

/** The other item in the inbox, which must never travel with this one. */
const SIBLING = "- 2026-08-17T09:15:00-04:00 MARKER-SIBLING-ITEM-aa01\n";

async function previews(): Promise<{ kind: string; payload: string }[]> {
  const { catalog } = seedIntelligence(VAULT);
  const service = new SuggestionService({
    catalog,
    intelligence: createDefaultIntelligence(new RecordingTransport({ reply: "{}" })),
  });

  const split = await service.prepareSplit({
    text: ITEM_TEXT,
    capturedAt: new Date("2026-08-17T09:14:22-04:00"),
    ref: { start: 0, end: 0, raw: `- 2026-08-17T09:14:22-04:00 ${ITEM_TEXT}\n${SIBLING}` },
  });
  const destination = await service.prepareDestination(ITEM_TEXT);

  assert.equal(split.ok, true);
  assert.equal(destination.ok, true);
  if (!split.ok || !destination.ok) throw new Error("unreachable");

  return [
    { kind: "split", payload: split.prepared.payload },
    { kind: "destination", payload: destination.prepared.payload },
  ];
}

describe("what the user reads before consenting", () => {
  for (const marker of MARKERS) {
    test(`${marker} appears in neither preview`, async () => {
      for (const { kind, payload } of await previews()) {
        assert.doesNotMatch(payload, new RegExp(marker), `${marker} is visible in the ${kind} preview`);
      }
    });
  }

  test("both previews carry the item's own text, or there is nothing to inspect", async () => {
    for (const { kind, payload } of await previews()) {
      assert.ok(payload.includes("chase the vendor contract"), `the ${kind} preview omits the item`);
    }
  });

  test("no preview carries another inbox item", async () => {
    for (const { kind, payload } of await previews()) {
      assert.doesNotMatch(payload, /MARKER-SIBLING/, `a sibling item is in the ${kind} preview`);
      assert.doesNotMatch(payload, /09:15:00/, `a sibling item's timestamp is in the ${kind} preview`);
    }
  });

  test("no preview carries a credential, a path, or anything about the transport", async () => {
    for (const { kind, payload } of await previews()) {
      // The preview shows the request content. It does not show how the
      // request travels — that is not part of what the user is consenting to
      // send, and a certificate path in a screenshot helps nobody.
      assert.doesNotMatch(payload, /BEGIN|PRIVATE KEY|\.pem\b|\.key\b/, `${kind} preview names credentials`);
      assert.doesNotMatch(payload, /https:\/\//, `${kind} preview names an endpoint`);
      assert.doesNotMatch(payload, /intelligence\.md/, `${kind} preview names its own configuration`);
    }
  });

  test("the preview is a string, so there is nothing hidden behind a getter", async () => {
    for (const { payload } of await previews()) {
      assert.equal(typeof payload, "string");
      assert.ok(payload.length > 0);
    }
  });
});

describe("the fixture is real, so absence means something", () => {
  test("every marker is genuinely present in the vault", () => {
    const all = Object.values(VAULT).join("\n") + SIBLING;
    for (const marker of MARKERS) {
      assert.ok(all.includes(marker), `${marker} is not in the fixture, so proving its absence proves nothing`);
    }
  });

  test("the project a preview legitimately reads carries five markers it must not leak", () => {
    const project = VAULT["projects/one.md"] ?? "";
    for (const marker of [
      "MARKER-DRI-ff06",
      "MARKER-NEXT-ACTION-ee05",
      "MARKER-MILESTONE-dd04",
      "MARKER-UNPROCESSED-2208",
      "MARKER-LEDGER-1107",
    ]) {
      assert.ok(project.includes(marker));
    }
  });

  test("and the outcome that is allowed through does appear", async () => {
    const [, destination] = await previews();
    assert.ok(
      destination?.payload.includes("A stated outcome that is allowed to travel."),
      "a boundary that let nothing through would pass every test above and be useless",
    );
  });
});
