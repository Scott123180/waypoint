import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Weekly outcomes, grouped by the week they were committed to.
 *
 * The grouping and the date answer different questions, and both are shown: an
 * outcome promised for W20 and finished in W23 belongs under W20 and carries
 * its W23 date. That is what makes a commitment finished late legible as one
 * (FR-011, FR-013).
 */

const TOP_THREE = topThreeFile([
  {
    week: "2026-W20",
    outcomes: [
      { text: "Ship the migration plan", done: true, completedOn: "2026-05-14" },
      { text: "Close the vendor decision", done: true, completedOn: "2026-05-15" },
      { text: "Never finished", done: false },
    ],
  },
  {
    week: "2026-W21",
    outcomes: [
      // Committed to in W21, finished in W23 — a straggler.
      { text: "Write the incident review", done: true, completedOn: "2026-06-02" },
    ],
  },
  {
    week: "2026-W40",
    outcomes: [{ text: "Out of range", done: true, completedOn: "2026-10-01" }],
  },
]);

describe("selection", () => {
  test("only outcomes with a completion date in range appear", async () => {
    const { service } = serviceFor({ "top-three.md": TOP_THREE });
    const r = await readOk(service, range("2026-05-01", "2026-06-30"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(
      r.outcomes.value.flatMap((g) => g.outcomes.map((o) => o.text)),
      ["Write the incident review", "Ship the migration plan", "Close the vendor decision"],
    );
  });

  test("outcomes never marked done appear nowhere", async () => {
    const { service } = serviceFor({ "top-three.md": TOP_THREE });
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));

    assert.ok(r.outcomes.applies && r.undatedOutcomes.applies);
    if (!r.outcomes.applies || !r.undatedOutcomes.applies) return;
    const all = [
      ...r.outcomes.value.flatMap((g) => g.outcomes.map((o) => o.text)),
      ...r.undatedOutcomes.value.map((o) => o.text),
    ];
    assert.ok(!all.includes("Never finished"));
  });
});

describe("grouping", () => {
  test("a straggler appears under the week it was committed to, with its own date", async () => {
    const { service } = serviceFor({ "top-three.md": TOP_THREE });
    const r = await readOk(service, range("2026-05-01", "2026-06-30"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    const w21 = r.outcomes.value.find((g) => g.week === "2026-W21");
    assert.equal(w21?.outcomes[0]?.text, "Write the incident review");
    assert.equal(w21?.outcomes[0]?.completedOn, "2026-06-02", "the date it was actually finished");
  });

  test("weeks descend, outcomes keep file order within a week", async () => {
    const { service } = serviceFor({ "top-three.md": TOP_THREE });
    const r = await readOk(service, range("2026-05-01", "2026-06-30"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(r.outcomes.value.map((g) => g.week), ["2026-W21", "2026-W20"]);
    assert.deepEqual(
      r.outcomes.value[1]?.outcomes.map((o) => o.index),
      [0, 1],
    );
  });

  test("a week with no in-range outcomes contributes no empty group", async () => {
    const { service } = serviceFor({ "top-three.md": TOP_THREE });
    const r = await readOk(service, range("2026-05-14", "2026-05-14"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(r.outcomes.value.map((g) => g.week), ["2026-W20"]);
  });
});

describe("undated outcomes", () => {
  test("an outcome done with no date is undated, exactly as a milestone is", async () => {
    const { service } = serviceFor({
      "top-three.md": topThreeFile([
        { week: "2026-W22", outcomes: [{ text: "Talk to finance", done: true }] },
      ]),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.ok(r.undatedOutcomes.applies);
    if (!r.undatedOutcomes.applies) return;
    assert.deepEqual(r.undatedOutcomes.value.map((o) => [o.week, o.text]), [
      ["2026-W22", "Talk to finance"],
    ]);
  });

  test("an outcome dated with something that is not a date keeps it verbatim", async () => {
    const { service } = serviceFor({
      "top-three.md": topThreeFile([
        { week: "2026-W22", outcomes: [{ text: "Talk to finance", done: true, completedOn: "2026-13-45" }] },
      ]),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.ok(r.undatedOutcomes.applies);
    if (!r.undatedOutcomes.applies) return;
    assert.equal(r.undatedOutcomes.value[0]?.rawDate, "2026-13-45");
  });
});

describe("the ISO year boundary (SC-009)", () => {
  test("a 53-week year groups every outcome into the identifier the existing rule produces", async () => {
    const { service } = serviceFor({
      "top-three.md": topThreeFile([
        // 2026 has 53 ISO weeks; 2027-01-01 belongs to 2026-W53.
        { week: "2026-W53", outcomes: [{ text: "Year end", done: true, completedOn: "2027-01-01" }] },
        { week: "2027-W01", outcomes: [{ text: "New year", done: true, completedOn: "2027-01-05" }] },
      ]),
    });

    const r = await readOk(service, range("2026-12-01", "2027-01-31"));
    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(r.outcomes.value.map((g) => g.week), ["2027-W01", "2026-W53"]);
  });
});

describe("an absent file (FR-015)", () => {
  test("no top-three.md reports none recorded and leaves everything else working", async () => {
    const { service } = serviceFor({});
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(r.outcomes.value, []);
    assert.match(renderReport(r), /^## Weekly outcomes \(0\)$/m);
    assert.match(renderReport(r), /No weekly outcomes were completed in this range\./);
  });
});
