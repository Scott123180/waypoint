import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { REPORT_LABELS, renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * Nothing is generated, summarized, ranked, or editorialized (FR-053, SC-015).
 *
 * The user's own words for this feature were "it shows me what I did; the
 * writing is mine to do", and this is the test that holds the application to
 * it. Every other assertion in the suite checks that the right things are
 * *shown*; this one checks that nothing else is.
 *
 * The method: fixture every user-supplied string as a distinctive marker, then
 * assert that every word in the rendered report is either one of those markers
 * or a word from `REPORT_LABELS` — the enumerable set of fixed strings the
 * renderer is allowed to contribute. A summary, a paraphrase, an inserted
 * adjective, or a helpful "(missing date?)" all fail, because none of them can
 * come from either source.
 *
 * This is why `REPORT_LABELS` exists as a value rather than as inline strings.
 * Without it, "nothing was invented" is a promise nobody can check.
 */

/** Every word `REPORT_LABELS` permits, plus markdown's own furniture. */
function allowedVocabulary(): Set<string> {
  const words = new Set<string>();
  for (const label of Object.values(REPORT_LABELS)) {
    for (const word of tokenize(label)) words.add(word);
  }
  return words;
}

/** Words, with markdown punctuation and quoting stripped. */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[#\-*`"'(\[]+/, "").replace(/[)\]`"'.,:;]+$/, ""))
    .filter((w) => w.length > 0);
}

/** Dates, counts, durations, and week ids are data, not vocabulary. */
function isDatum(word: string): boolean {
  return /^[\d(]/.test(word) || /^\d{4}-W\d{2}$/.test(word) || /^\d+d$/.test(word);
}

describe("every word in a report is either the user's or a fixed label", () => {
  // Nonsense markers, so a real English word appearing in the output can only
  // have come from the renderer.
  const MARKERS = [
    "zzqqx",
    "vvbbn",
    "wwkkm",
    "ttllp",
    "rrmmz",
    "ggddh",
    "nnjjc",
    "ppffs",
  ];

  const VAULT = {
    "projects/zzqqx.md": projectFile({
      slug: "zzqqx",
      title: "zzqqx",
      status: "done",
      completed: "2026-06-30",
      milestones: [
        { text: "vvbbn", done: true, completedOn: "2026-06-10" },
        { text: "wwkkm", done: true },
      ],
      ledger: ["- 2026-01-02 status created → active"],
    }),
    "top-three.md": topThreeFile([
      { week: "2026-W24", outcomes: [{ text: "ttllp", done: true, completedOn: "2026-06-11" }] },
    ]),
    "log/2026-W24.md": logFile({
      week: "2026-W24",
      note: "rrmmz ggddh",
      slipped: ["nnjjc"],
      summary: { provider: "ppffs", text: "ppffs" },
    }),
  };

  test("an unnarrowed report invents no word", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-30"));
    const text = renderReport(r);

    const allowed = allowedVocabulary();
    const markers = new Set(MARKERS);

    const invented = tokenize(text).filter(
      (w) => !allowed.has(w) && !markers.has(w) && !isDatum(w) && !STRUCTURAL.has(w),
    );

    assert.deepEqual(invented, [], `the report invented: ${invented.join(", ")}`);
  });

  test("a narrowed report invents no word either", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-30", "zzqqx"));
    const text = renderReport(r);

    const allowed = allowedVocabulary();
    const markers = new Set(MARKERS);
    const invented = tokenize(text).filter(
      (w) => !allowed.has(w) && !markers.has(w) && !isDatum(w) && !STRUCTURAL.has(w),
    );

    assert.deepEqual(invented, [], `the report invented: ${invented.join(", ")}`);
  });

  test("the test has teeth: a smuggled word is caught", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-30"));
    // What a well-meaning "helpful" addition would look like.
    const text = `${renderReport(r)}\nA productive quarter overall.\n`;

    const allowed = allowedVocabulary();
    const markers = new Set(MARKERS);
    const invented = tokenize(text).filter(
      (w) => !allowed.has(w) && !markers.has(w) && !isDatum(w) && !STRUCTURAL.has(w),
    );

    assert.ok(invented.length > 0, "an editorializing sentence must not pass unnoticed");
  });

  test("the user's note is reproduced verbatim, unprefixed and unwrapped", async () => {
    const note = "Rough week.\nThe cutover ate three days I had planned for the vendor decision.";
    const { service } = serviceFor({
      ...VAULT,
      "log/2026-W24.md": logFile({ week: "2026-W24", note }),
    });

    const r = await readOk(service, range("2026-06-01", "2026-06-30"));
    const text = renderReport(r);

    assert.ok(text.includes(note), "the note must appear exactly as written");
    assert.doesNotMatch(text, /^> /m, "a blockquote is four characters the user did not write");
  });

  test("no figure other than a count appears (FR-010g)", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-01", "2026-06-30"));
    const text = renderReport(r);

    for (const forbidden of [/%/, /\bper\s+(week|month|quarter)\b/i, /\baverage\b/i, /\bstreak\b/i]) {
      assert.doesNotMatch(text, forbidden, String(forbidden));
    }
  });
});

/**
 * Words that are structure rather than prose: status values, ledger verbs, and
 * the arrow the ledger already uses. All of them come from the user's files —
 * they are just not marker-shaped, because the formats define them.
 */
const STRUCTURAL = new Set(["status", "created", "→", "active", "waiting", "parked", "done"]);
