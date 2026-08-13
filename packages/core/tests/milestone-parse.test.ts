import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseMilestone, renderMilestone } from "../src/projects/milestone";

/**
 * The milestone line format.
 *
 * Fields are parsed right-to-left from strict tail patterns, which is what
 * makes a definition of done containing ` — ` or `@` safe (research R2).
 *
 * See specs/003-project-structure/contracts/project-format.md
 */

describe("parseMilestone", () => {
  test("reads an open milestone with a verifier", () => {
    const m = parseMilestone("- [ ] Materials delivered on site — @me");
    assert.deepEqual(m, {
      definitionOfDone: "Materials delivered on site",
      verifier: "me",
      done: false,
      completedOn: null,
      raw: "- [ ] Materials delivered on site — @me",
    });
  });

  test("reads a done milestone with a verifier and a date", () => {
    const m = parseMilestone("- [x] Estimate approved by insurer — @Priya — done 2026-08-14");
    assert.equal(m?.done, true);
    assert.equal(m?.definitionOfDone, "Estimate approved by insurer");
    assert.equal(m?.verifier, "Priya");
    assert.equal(m?.completedOn, "2026-08-14");
  });

  test("reads a milestone with no verifier", () => {
    const m = parseMilestone("- [ ] No verifier on this one");
    assert.equal(m?.definitionOfDone, "No verifier on this one");
    assert.equal(m?.verifier, null);
    assert.equal(m?.completedOn, null);
  });

  test("reads a done milestone with a date but no verifier", () => {
    const m = parseMilestone("- [x] Book the room — done 2026-07-02");
    assert.equal(m?.done, true);
    assert.equal(m?.definitionOfDone, "Book the room");
    assert.equal(m?.verifier, null);
    assert.equal(m?.completedOn, "2026-07-02");
  });

  test("accepts an uppercase X", () => {
    // Hand-editing is a supported way to complete a milestone, and a user
    // typing X is not making a mistake.
    assert.equal(parseMilestone("- [X] Done by hand")?.done, true);
  });

  describe("a definition of done that contains the separators", () => {
    test("keeps an em-dash inside the text", () => {
      const m = parseMilestone("- [ ] Draft the plan — decide budget vs — headcount — @dana");
      assert.equal(m?.definitionOfDone, "Draft the plan — decide budget vs — headcount");
      assert.equal(m?.verifier, "dana");
    });

    test("keeps an @ inside the text when no verifier tail follows", () => {
      const m = parseMilestone("- [ ] Email finance@example.com about the budget");
      assert.equal(m?.definitionOfDone, "Email finance@example.com about the budget");
      assert.equal(m?.verifier, null);
    });

    test("takes only the last @tail as the verifier", () => {
      const m = parseMilestone("- [ ] Ask @dana — @sam");
      assert.equal(m?.definitionOfDone, "Ask @dana");
      assert.equal(m?.verifier, "sam");
    });

    test("a verifier may itself contain an @", () => {
      const m = parseMilestone("- [ ] Draft the plan — @dana@example.com");
      assert.equal(m?.verifier, "dana@example.com");
    });
  });

  describe("things that are not a milestone", () => {
    test("a non-task-list line returns null", () => {
      assert.equal(parseMilestone("Just a sentence."), null);
      assert.equal(parseMilestone("- a plain list item"), null);
      assert.equal(parseMilestone("## Milestones"), null);
      assert.equal(parseMilestone(""), null);
    });

    test("a malformed checkbox returns null rather than throwing", () => {
      assert.equal(parseMilestone("- [] No space"), null);
      assert.equal(parseMilestone("- [y] Not a state"), null);
    });

    test("an empty definition of done returns null", () => {
      assert.equal(parseMilestone("- [ ] "), null);
      assert.equal(parseMilestone("- [ ]"), null);
    });
  });

  describe("tails that only look like fields", () => {
    test("a malformed date is left in the text rather than parsed as a date", () => {
      const m = parseMilestone("- [x] Ship it — done soon");
      assert.equal(m?.definitionOfDone, "Ship it — done soon");
      assert.equal(m?.completedOn, null);
    });

    test("a date tail on an open milestone is still read, not discarded", () => {
      // The app never writes this, but a hand-edit can. Dropping it silently
      // would destroy something the user typed.
      const m = parseMilestone("- [ ] Half-edited — done 2026-01-01");
      assert.equal(m?.completedOn, "2026-01-01");
      assert.equal(m?.done, false);
    });

    test("an empty verifier tail stays part of the text", () => {
      const m = parseMilestone("- [ ] Trailing at sign — @");
      assert.equal(m?.definitionOfDone, "Trailing at sign — @");
      assert.equal(m?.verifier, null);
    });
  });
});

describe("renderMilestone", () => {
  test("renders an open milestone with a verifier", () => {
    assert.equal(
      renderMilestone({
        definitionOfDone: "Materials delivered on site",
        verifier: "me",
        done: false,
        completedOn: null,
      }),
      "- [ ] Materials delivered on site — @me",
    );
  });

  test("renders a done milestone with a verifier and a date", () => {
    assert.equal(
      renderMilestone({
        definitionOfDone: "Estimate approved",
        verifier: "Priya",
        done: true,
        completedOn: "2026-08-14",
      }),
      "- [x] Estimate approved — @Priya — done 2026-08-14",
    );
  });

  test("omits absent fields entirely rather than writing empty ones", () => {
    assert.equal(
      renderMilestone({
        definitionOfDone: "Bare",
        verifier: null,
        done: false,
        completedOn: null,
      }),
      "- [ ] Bare",
    );
  });
});
