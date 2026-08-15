import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseTopThree,
  renderOutcome,
  setWeekLines,
  weekLines,
} from "../src/weekly/top-three-document";

/**
 * Reading and writing `top-three.md`.
 *
 * Same two rules as `projects/document.ts`: parsing never fails, and writing is
 * surgical. The vault is a directory the user is invited to edit, and a file
 * the app refuses to open is a file the app has taken hostage.
 */

const FILE = [
  "# Top three",
  "",
  "## 2026-W33",
  "",
  "- [x] Ship the policy seam — done 2026-08-14",
  "- [ ] Decide the license",
  "",
  "## 2026-W32",
  "",
  "- [x] Land inbox sort recovery — done 2026-08-08",
  "",
].join("\n");

describe("top-three document", () => {
  describe("parsing", () => {
    test("reads weeks newest first, as written", () => {
      const weeks = parseTopThree(FILE);
      assert.deepEqual(
        weeks.map((w) => w.id),
        ["2026-W33", "2026-W32"],
      );
    });

    test("reads an outcome's text, done state, and date", () => {
      const [first] = parseTopThree(FILE);
      const [done, open] = first?.outcomes ?? [];

      assert.equal(done?.text, "Ship the policy seam");
      assert.equal(done?.done, true);
      assert.equal(done?.completedOn, "2026-08-14");
      assert.equal(done?.index, 0);

      assert.equal(open?.text, "Decide the license");
      assert.equal(open?.done, false);
      assert.equal(open?.completedOn, null, "a date is never invented for an open outcome");
    });

    test("an absent or empty file has no weeks", () => {
      assert.deepEqual(parseTopThree(null), []);
      assert.deepEqual(parseTopThree(""), []);
    });

    test("a hand-edited week over the cap is read as it stands", () => {
      // The cap governs what the system will write, never what it will show
      // (FR-015). Silently dropping the fourth would be the app editing the
      // user's file to match its own rule.
      const four = ["## 2026-W33", "", "- [ ] a", "- [ ] b", "- [ ] c", "- [ ] d", ""].join("\n");
      assert.equal(parseTopThree(four)[0]?.outcomes.length, 4);
    });

    test("a non-task line under a week is not an outcome and is not lost", () => {
      const withProse = ["## 2026-W33", "", "Some note I typed.", "- [ ] a", ""].join("\n");
      const week = parseTopThree(withProse)[0];
      assert.equal(week?.outcomes.length, 1);
      assert.equal(week?.outcomes[0]?.text, "a");
    });

    test("a checkbox with no text is not an outcome", () => {
      // A line the user is halfway through typing. Feature 3's rule, unchanged.
      assert.equal(parseTopThree(["## 2026-W33", "- [ ] ", ""].join("\n"))[0]?.outcomes.length, 0);
    });

    test("an unrecognized heading is not read as a week", () => {
      const weeks = parseTopThree(["## Notes", "", "- [ ] not an outcome", ""].join("\n"));
      assert.deepEqual(weeks, []);
    });

    test("text containing an em dash survives", () => {
      // Right-to-left tail parsing: only a strict ` — done <date>` tail is
      // stripped, so ordinary prose keeps its punctuation.
      const week = parseTopThree(["## 2026-W33", "- [ ] Ship it — properly this time", ""].join("\n"));
      assert.equal(week[0]?.outcomes[0]?.text, "Ship it — properly this time");
    });

    test("an @ mention stays part of the text", () => {
      // Unlike a milestone, an outcome has no verifier — there is nobody to
      // name. Interpreting a trailing @ would silently drop it on rewrite.
      const week = parseTopThree(["## 2026-W33", "- [ ] Chase the estimate — @Priya", ""].join("\n"));
      assert.equal(week[0]?.outcomes[0]?.text, "Chase the estimate — @Priya");
    });
  });

  describe("round trip", () => {
    test("reading and rewriting a week unchanged is byte-identical", () => {
      const lines = weekLines(FILE, "2026-W33");
      assert.equal(setWeekLines(FILE, "2026-W33", lines), FILE);
    });

    test("a hand-shaped file survives a write to a different week", () => {
      const odd = [
        "# Top three",
        "",
        "some preamble prose",
        "",
        "## 2026-W33",
        "- [ ] a",
        "",
        "",
        "## Notes",
        "kept",
        "",
      ].join("\n");
      const out = setWeekLines(odd, "2026-W33", ["- [ ] a", "- [ ] b"]);
      assert.match(out, /some preamble prose/);
      assert.match(out, /## Notes\nkept/);
    });

    test("a trailing newline is preserved exactly", () => {
      assert.ok(FILE.endsWith("\n"));
      assert.ok(setWeekLines(FILE, "2026-W33", weekLines(FILE, "2026-W33")).endsWith("\n"));
    });
  });

  describe("rendering", () => {
    test("an open outcome carries no date", () => {
      assert.equal(renderOutcome({ text: "a", done: false, completedOn: null }), "- [ ] a");
    });

    test("a done outcome carries its date", () => {
      assert.equal(
        renderOutcome({ text: "a", done: true, completedOn: "2026-08-14" }),
        "- [x] a — done 2026-08-14",
      );
    });

    test("render and parse are inverses", () => {
      const line = renderOutcome({ text: "Ship it — properly", done: true, completedOn: "2026-08-14" });
      const week = parseTopThree(["## 2026-W33", line, ""].join("\n"))[0];
      assert.equal(week?.outcomes[0]?.text, "Ship it — properly");
      assert.equal(week?.outcomes[0]?.completedOn, "2026-08-14");
    });
  });

  describe("readable and editable as plain text (FR-014, SC-004)", () => {
    test("a stored week is legible with no application running", () => {
      // The promise the format exists to keep: what is on disk is what a person
      // reads in an editor — a heading and checkboxes, nothing encoded.
      for (const line of FILE.split("\n")) {
        assert.ok(
          line === "" ||
            line.startsWith("# ") ||
            line.startsWith("## ") ||
            /^- \[[ x]\] /.test(line),
          `line is not plainly legible: ${JSON.stringify(line)}`,
        );
      }
    });

    test("a week typed by hand in an editor parses identically to a written one", () => {
      const byHand = ["## 2026-W30", "- [x] did a thing — done 2026-07-24", ""].join("\n");
      const week = parseTopThree(byHand)[0];
      assert.equal(week?.id, "2026-W30");
      assert.equal(week?.outcomes[0]?.done, true);
      assert.equal(week?.outcomes[0]?.completedOn, "2026-07-24");
    });
  });
});
