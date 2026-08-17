import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Surfaced, never dropped, never repaired (FR-020).
 *
 * The vault is hand-edited, so lines the application would not have written are
 * ordinary. `parseTopThree` discards them — correctly, for its callers, which
 * want the outcomes — so this reader walks the same sections again with the
 * same exported, total `parseOutcome` and keeps the rejects instead (research
 * R6). One grammar, two consumers.
 */

describe("an unreadable line in top-three.md", () => {
  const VAULT = {
    "top-three.md": topThreeFile([
      {
        week: "2026-W20",
        outcomes: [
          { text: "Ship it", done: true, completedOn: "2026-05-14" },
          // Neither blank, a heading, nor an outcome: prose someone typed.
          "half a thought I never finished typing",
        ],
      },
    ]),
  };

  test("is reported with its path, 1-based line, and raw text", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-05-11", "2026-05-17"));

    assert.equal(r.unreadable.length, 1);
    assert.equal(r.unreadable[0]?.path, "top-three.md");
    assert.equal(r.unreadable[0]?.reason, "unreadable-line");
    assert.equal(r.unreadable[0]?.raw, "half a thought I never finished typing");
    assert.ok((r.unreadable[0]?.line ?? 0) > 0, "1-based, matching the editor gutter");
  });

  test("the readable outcomes around it are unaffected", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-05-11", "2026-05-17"));

    assert.ok(r.outcomes.applies);
    if (!r.outcomes.applies) return;
    assert.deepEqual(r.outcomes.value[0]?.outcomes.map((o) => o.text), ["Ship it"]);
  });

  test("lines in a week outside the range are not examined", async () => {
    const { service } = serviceFor({
      "top-three.md": topThreeFile([
        { week: "2026-W20", outcomes: [{ text: "in range", done: true, completedOn: "2026-05-14" }] },
        { week: "2026-W40", outcomes: ["prose in a week nobody asked about"] },
      ]),
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));
    assert.deepEqual(r.unreadable, []);
  });

  test("nothing is rewritten", async () => {
    const files = { ...VAULT };
    const before = files["top-three.md"];
    const { service, vault } = serviceFor(files);

    await readOk(service, range("2026-05-11", "2026-05-17"));
    assert.equal(await vault.read("top-three.md"), before);
  });
});

describe("a file in log/ that is not named for a week (research R4)", () => {
  test("is surfaced by path rather than parsed as a week or skipped", async () => {
    const { service } = serviceFor({
      "log/2026-W20.md": logFile({ week: "2026-W20", note: "real" }),
      // What a hand-made copy actually looks like on disk.
      "log/2026-W20 copy.md": logFile({ week: "2026-W20", note: "a duplicate" }),
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));

    assert.deepEqual(
      r.unreadable.map((u) => [u.path, u.reason]),
      [["log/2026-W20 copy.md", "not-a-week-file"]],
    );
    // And the real one is still read, with no winner picked between them.
    assert.ok(r.narrative.applies);
    if (!r.narrative.applies) return;
    assert.equal(r.narrative.value.weeks.length, 1);
    assert.equal(r.narrative.value.weeks[0]?.note, "real");
  });

  test("its presence does not make the week look reviewed twice", async () => {
    const { service } = serviceFor({
      "log/2026-W20 copy.md": logFile({ week: "2026-W20", note: "a duplicate" }),
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));
    assert.ok(r.narrative.applies);
    if (!r.narrative.applies) return;
    assert.deepEqual(r.narrative.value.weeks, []);
    assert.deepEqual(r.narrative.value.unreviewed.weeks, ["2026-W20"]);
  });
});

describe("the report's section (T048a)", () => {
  test("appears only when something could not be read", async () => {
    const clean = serviceFor({ "projects/a.md": projectFile({ slug: "a" }) });
    const text = renderReport(await readOk(clean.service, range("2026-01-01", "2026-12-31")));
    assert.doesNotMatch(text, /## Could not be read/);
  });

  test("names each source and prints the raw text with no speculation (A1)", async () => {
    const { service } = serviceFor({
      // Prose, not a checkbox: `- [x] ship it` would parse perfectly well as an
      // outcome, which is the point — only genuinely unreadable lines appear.
      "top-three.md": topThreeFile([{ week: "2026-W20", outcomes: ["ship it (I think?)"] }]),
      "log/2026-W20 copy.md": logFile({ week: "2026-W20" }),
    });

    const text = renderReport(await readOk(service, range("2026-05-11", "2026-05-17")));

    assert.match(text, /^## Could not be read \(2\)$/m);
    assert.match(text, /shown as they sit on disk/);
    assert.match(text, /^- log\/2026-W20 copy\.md — not a week file — 2026-W20 copy$/m);
    assert.match(text, /^- top-three\.md:\d+ — unreadable line — ship it \(I think\?\)$/m);
    // No guessing at the cause. An earlier draft of the format guessed.
    assert.doesNotMatch(text, /missing date\?/);
    assert.doesNotMatch(text, /did you mean/i);
  });
});

describe("degraded sources still leave a usable reading (SC-017, T066a)", () => {
  test("a garbled log leaves every other section intact", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Done", done: true, completedOn: "2026-05-13" }],
      }),
      // Not a review log at all — someone pasted something in.
      "log/2026-W20.md": "%%% not a review %%%\n\nnonsense\n",
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));

    assert.deepEqual(r.completions.map((c) => c.text), ["Done"]);
    assert.ok(r.narrative.applies);
    if (!r.narrative.applies) return;
    // `parseReview` is total: it reads what it can and shows the rest as absent.
    assert.equal(r.narrative.value.weeks.length, 1);
    assert.equal(r.narrative.value.weeks[0]?.note, null);
    assert.ok(renderReport(r).length > 0);
  });

  test("a malformed completion date leaves every other section intact", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [
          { text: "Bad date", done: true, completedOn: "2026-13-45" },
          { text: "Good date", done: true, completedOn: "2026-05-13" },
        ],
      }),
      "top-three.md": topThreeFile([
        { week: "2026-W20", outcomes: [{ text: "Ship", done: true, completedOn: "2026-05-14" }] },
      ]),
    });

    const r = await readOk(service, range("2026-05-11", "2026-05-17"));

    assert.deepEqual(r.completions.map((c) => c.text), ["Good date"]);
    assert.deepEqual(r.undated.map((c) => c.rawDate), ["2026-13-45"]);
    assert.ok(r.outcomes.applies && r.outcomes.value.length === 1);
  });
});
