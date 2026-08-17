import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * What the logs say, shown as they say it.
 *
 * The narrative comes from the logs; the completions come from the recorded
 * dates; the two are never reconciled. That is the user's own distinction and
 * it is load-bearing: a log's account of what slipped is a record of what they
 * believed at the time, not a claim to be re-checked against today's files
 * (FR-021, FR-022, FR-023).
 */

const NOTE = "Rough week. The migration cutover ate three days I had planned for the vendor decision.";

const VAULT = {
  "log/2026-W20.md": logFile({
    week: "2026-W20",
    started: "2026-05-15",
    note: NOTE,
    slipped: ["Write the incident review"],
    waiting: [{ owner: "dana", days: 12, action: "followed-up", text: "invoice approval" }],
  }),
  "log/2026-W21.md": logFile({ week: "2026-W21", started: "2026-05-22" }),
  "log/2026-W22.md": logFile({ week: "2026-W22", started: "2026-05-29", complete: false }),
};

async function narrativeOf(files: Record<string, string>, from: string, to: string) {
  const { service } = serviceFor(files);
  const r = await readOk(service, range(from, to));
  assert.ok(r.narrative.applies);
  if (!r.narrative.applies) throw new Error("unreachable");
  return { narrative: r.narrative.value, text: renderReport(r) };
}

describe("a week that was reviewed", () => {
  test("its note is carried verbatim", async () => {
    const { narrative } = await narrativeOf(VAULT, "2026-05-11", "2026-05-17");
    assert.equal(narrative.weeks[0]?.note, NOTE);
  });

  test("the note renders unprefixed — no blockquote, no rewrapping", async () => {
    const { text } = await narrativeOf(VAULT, "2026-05-11", "2026-05-17");
    assert.ok(text.includes(NOTE), "the sentence must survive intact on one line");
    assert.doesNotMatch(text, /^> /m);
  });

  test("what the log called slipped is shown as the log recorded it", async () => {
    const { narrative, text } = await narrativeOf(VAULT, "2026-05-11", "2026-05-17");
    assert.deepEqual(narrative.weeks[0]?.slipped, ["Write the incident review"]);
    assert.match(text, /^Slipped:$/m);
    assert.match(text, /^- Write the incident review$/m);
  });

  test("its waiting records come through", async () => {
    const { narrative } = await narrativeOf(VAULT, "2026-05-11", "2026-05-17");
    assert.equal(narrative.weeks[0]?.waiting.length, 1);
    assert.equal(narrative.weeks[0]?.waiting[0]?.owner, "dana");
  });

  test("the span is stated beside the identifier", async () => {
    const { narrative, text } = await narrativeOf(VAULT, "2026-05-11", "2026-05-17");
    assert.deepEqual(narrative.weeks[0]?.span, { from: "2026-05-11", to: "2026-05-17" });
    assert.match(text, /^### 2026-W20 \(2026-05-11 to 2026-05-17\)$/m);
  });

  test("a week only partly in range still states its whole span", async () => {
    // The range starts mid-week, so the note covers days the range does not.
    const { text } = await narrativeOf(VAULT, "2026-05-14", "2026-05-17");
    assert.match(text, /^### 2026-W20 \(2026-05-11 to 2026-05-17\)/m);
  });
});

describe("a week that recorded no note", () => {
  test("says so, distinguishably from a week with no log at all", async () => {
    const { narrative, text } = await narrativeOf(VAULT, "2026-05-18", "2026-05-24");
    assert.equal(narrative.weeks[0]?.week, "2026-W21");
    assert.equal(narrative.weeks[0]?.note, null);
    assert.match(text, /^Note: none recorded\.$/m);
    // And it is not in the unreviewed list — it *was* reviewed.
    assert.ok(!narrative.unreviewed.weeks.includes("2026-W21"));
  });
});

describe("a review still in progress (FR-026)", () => {
  test("is shown as it stands and marked incomplete", async () => {
    const { narrative, text } = await narrativeOf(VAULT, "2026-05-25", "2026-05-31");
    assert.equal(narrative.weeks[0]?.status, "in-progress");
    assert.match(text, /^### 2026-W22 \(.*\) — review incomplete$/m);
  });

  test("is not counted as unreviewed — the review happened, it just did not finish", async () => {
    const { narrative } = await narrativeOf(VAULT, "2026-05-25", "2026-05-31");
    assert.ok(!narrative.unreviewed.weeks.includes("2026-W22"));
  });
});

describe("an accepted summary (FR-027)", () => {
  test("keeps its attribution and stays separate from the user's note", async () => {
    const { narrative, text } = await narrativeOf(
      {
        "log/2026-W20.md": logFile({
          week: "2026-W20",
          note: NOTE,
          summary: { provider: "acme-llm", text: "A drafted paragraph." },
        }),
      },
      "2026-05-11",
      "2026-05-17",
    );

    assert.equal(narrative.weeks[0]?.summary?.provider, "acme-llm");
    assert.match(text, /^Summary \(acme-llm\):$/m);
    // The user's words and the generated ones are separate blocks.
    assert.ok(text.indexOf(NOTE) < text.indexOf("A drafted paragraph."));
    assert.match(text, /^Note:$/m);
  });
});

describe("the narrative is not reconciled with the data (FR-023)", () => {
  test("a completion in a week the log never mentions still appears", async () => {
    const { service } = serviceFor({
      ...VAULT,
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Done quietly", done: true, completedOn: "2026-05-13" }],
      }),
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));
    assert.deepEqual(r.completions.map((c) => c.text), ["Done quietly"]);
    // And the log's own account is untouched by that fact.
    assert.ok(r.narrative.applies);
    if (!r.narrative.applies) return;
    assert.deepEqual(r.narrative.value.weeks[0]?.slipped, ["Write the incident review"]);
  });
});
