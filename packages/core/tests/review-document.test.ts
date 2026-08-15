import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  appendToSection,
  INBOX_HEADING,
  NOTE_HEADING,
  parseReview,
  PROJECTS_HEADING,
  renderInboxLine,
  renderNewReview,
  renderProjectLine,
  renderTopThreeLines,
  renderWaitingItemLine,
  renderWaitingProjectLine,
  reviewPath,
  setPreambleField,
  setSectionBody,
  summaryHeadingFor,
  TOP_THREE_HEADING,
  WAITING_HEADING,
} from "../src/review/review-document";

/**
 * Reading and writing `log/YYYY-Www.md`.
 *
 * Two properties matter more than any single grammar rule: a hand-edited file
 * survives untouched, and an append changes exactly one line. The vault is
 * git-tracked, so a write that reformats turns every review into a noisy diff.
 */

const WEEK = "2026-W33";

describe("review document — the file's shape", () => {
  test("the path derives from the week identifier", () => {
    assert.equal(reviewPath(WEEK), "log/2026-W33.md");
  });

  test("a new review names its week and says plainly that it is unfinished", () => {
    const content = renderNewReview(WEEK, "2026-08-14");
    assert.match(content, /^# Weekly review 2026-W33$/m);
    assert.match(content, /^status: in progress$/m);
    assert.match(content, /^started: 2026-08-14$/m);
    assert.match(content, /^step: inbox$/m);
  });

  test("every section exists from the start, so an empty one means 'nothing yet'", () => {
    const content = renderNewReview(WEEK, "2026-08-14");
    for (const heading of [INBOX_HEADING, PROJECTS_HEADING, WAITING_HEADING, TOP_THREE_HEADING, NOTE_HEADING]) {
      assert.match(content, new RegExp(`^## ${heading}$`, "m"), `missing ## ${heading}`);
    }
  });

  test("a fresh review parses as in progress with nothing recorded", () => {
    const review = parseReview(renderNewReview(WEEK, "2026-08-14"), WEEK);
    assert.equal(review.status, "in-progress");
    assert.equal(review.step, "inbox");
    assert.equal(review.completed, null);
    assert.equal(review.inbox, null);
    assert.deepEqual(review.projects, []);
    assert.deepEqual(review.waiting, []);
    assert.equal(review.topThree, null);
    assert.equal(review.note, null);
    assert.equal(review.summary, null);
  });
});

describe("review document — line grammars", () => {
  test("the inbox line records the count and the verdict it was passed under", () => {
    const content = appendToSection(
      renderNewReview(WEEK, "2026-08-14"),
      INBOX_HEADING,
      renderInboxLine("2026-08-14", 11, "warn"),
    );
    const { inbox } = parseReview(content, WEEK);
    assert.equal(inbox?.count, 11);
    // The *line* reads "warned"; the *verdict* is `warn`. This assertion said
    // "warned" until US6, codifying a round-trip bug: a record read back from
    // the file was a different shape from one just decided.
    assert.equal(inbox?.verdict, "warn");
    assert.equal(inbox?.on, "2026-08-14");
  });

  test("an empty inbox reads as clear rather than as zero items", () => {
    const content = appendToSection(
      renderNewReview(WEEK, "2026-08-14"),
      INBOX_HEADING,
      renderInboxLine("2026-08-14", 0, "allow"),
    );
    assert.match(content, /- 2026-08-14 inbox clear/);
    assert.equal(parseReview(content, WEEK).inbox?.count, 0);
  });

  test("one item is one item, not one items", () => {
    assert.equal(renderInboxLine("2026-08-14", 1, "warn"), "- 2026-08-14 1 item, warned, proceeded");
  });

  test("each project action round-trips", () => {
    const cases = [
      { action: "none" as const, detail: null, expect: "no change" },
      { action: "status" as const, detail: "active → parked", expect: "status active → parked" },
      { action: "milestone-done" as const, detail: "Runbook reviewed", expect: "milestone done Runbook reviewed" },
      { action: "next-action" as const, detail: "changed", expect: "next action changed" },
      { action: "structure" as const, detail: "dri", expect: "dri set" },
    ];

    for (const c of cases) {
      const line = renderProjectLine("2026-08-14", "migration-cutover", c.action, c.detail);
      assert.equal(line, `- 2026-08-14 migration-cutover ${c.expect}`);

      const content = appendToSection(renderNewReview(WEEK, "2026-08-14"), PROJECTS_HEADING, line);
      const [record] = parseReview(content, WEEK).projects;
      assert.equal(record?.slug, "migration-cutover");
      assert.equal(record?.action, c.action);
      if (c.detail !== null) assert.equal(record?.detail, c.detail);
    }
  });

  test("a reviewed-with-no-change project is a record, not an absence", () => {
    const content = appendToSection(
      renderNewReview(WEEK, "2026-08-14"),
      PROJECTS_HEADING,
      renderProjectLine("2026-08-14", "vendor-review", "none", null),
    );
    const { projects } = parseReview(content, WEEK);
    assert.equal(projects.length, 1, "walked-and-unchanged must be distinguishable from never reached");
    assert.equal(projects[0]?.action, "none");
  });

  test("a waiting-for item line carries owner, age, action, and text", () => {
    const line = renderWaitingItemLine("2026-08-14", "Priya", 21, "followed-up", "Confirm the window moved");
    assert.equal(line, "- 2026-08-14 @Priya 21d followed up — Confirm the window moved");

    const content = appendToSection(renderNewReview(WEEK, "2026-08-14"), WAITING_HEADING, line);
    const [record] = parseReview(content, WEEK).waiting;
    assert.equal(record?.owner, "Priya");
    assert.equal(record?.days, 21);
    assert.equal(record?.action, "followed-up");
    assert.equal(record?.subject, "item");
    assert.equal(record?.text, "Confirm the window moved");
  });

  test("a stale waiting project is recorded as surfaced and left", () => {
    const line = renderWaitingProjectLine("2026-08-14", "docs-refresh", 74);
    assert.equal(line, "- 2026-08-14 project docs-refresh 74d left waiting");

    const content = appendToSection(renderNewReview(WEEK, "2026-08-14"), WAITING_HEADING, line);
    const [record] = parseReview(content, WEEK).waiting;
    assert.equal(record?.subject, "project");
    assert.equal(record?.owner, "docs-refresh");
    assert.equal(record?.days, 74);
  });

  test("the top three step records what was finished, what slipped, and what was committed", () => {
    let content = renderNewReview(WEEK, "2026-08-14");
    for (const line of renderTopThreeLines({
      finished: ["Ship the runbook"],
      slipped: ["Rewrite the rota"],
      committed: ["Land the cutover"],
      forWeek: "2026-W34",
    })) {
      content = appendToSection(content, TOP_THREE_HEADING, line);
    }

    const { topThree } = parseReview(content, WEEK);
    assert.deepEqual(topThree?.finished, ["Ship the runbook"]);
    assert.deepEqual(topThree?.slipped, ["Rewrite the rota"]);
    assert.deepEqual(topThree?.committed, ["Land the cutover"]);
    assert.equal(topThree?.forWeek, "2026-W34", "commitments name the week they landed in");
  });

  test("the note is recorded verbatim, newlines and all", () => {
    const note = "Cutover slipped because the vendor sat on the contract.\n\nChase earlier next time.";
    const content = setSectionBody(renderNewReview(WEEK, "2026-08-14"), NOTE_HEADING, note);
    assert.equal(parseReview(content, WEEK).note, note);
  });

  test("a generated summary is attributed in its own heading, separate from the note", () => {
    let content = setSectionBody(renderNewReview(WEEK, "2026-08-14"), NOTE_HEADING, "my own words");
    content = setSectionBody(content, summaryHeadingFor("stub-provider"), "the machine's words");

    const review = parseReview(content, WEEK);
    assert.equal(review.note, "my own words");
    assert.equal(review.summary?.text, "the machine's words");
    assert.equal(review.summary?.provider, "stub-provider");
    assert.match(content, /## Summary \(generated by stub-provider\)/);
  });
});

describe("review document — preamble writes", () => {
  test("completing flips the status and adds a completion date", () => {
    let content = renderNewReview(WEEK, "2026-08-14");
    content = setPreambleField(content, "status", "complete");
    content = setPreambleField(content, "completed", "2026-08-15");

    const review = parseReview(content, WEEK);
    assert.equal(review.status, "complete");
    assert.equal(review.completed, "2026-08-15");
    assert.equal(review.started, "2026-08-14", "the start date is not disturbed");
  });

  test("the step advances in place rather than accumulating lines", () => {
    let content = renderNewReview(WEEK, "2026-08-14");
    content = setPreambleField(content, "step", "projects");
    content = setPreambleField(content, "step", "waiting");

    assert.equal(parseReview(content, WEEK).step, "waiting");
    assert.equal(content.match(/^step:/gm)?.length, 1, "one step line, not three");
  });

  test("a half-typed status reads as still in progress, never as finished", () => {
    const content = setPreambleField(renderNewReview(WEEK, "2026-08-14"), "status", "compl");
    assert.equal(parseReview(content, WEEK).status, "in-progress");
  });
});

describe("review document — the vault is the user's", () => {
  test("appending a line touches only that section", () => {
    const before = appendToSection(
      renderNewReview(WEEK, "2026-08-14"),
      PROJECTS_HEADING,
      renderProjectLine("2026-08-14", "one", "none", null),
    );
    const after = appendToSection(
      before,
      PROJECTS_HEADING,
      renderProjectLine("2026-08-14", "two", "none", null),
    );

    // Everything outside the Projects section is byte-identical.
    const strip = (s: string): string => s.split(`## ${PROJECTS_HEADING}`)[0] ?? "";
    assert.equal(strip(after), strip(before));
    assert.match(after, /- 2026-08-14 one no change\n- 2026-08-14 two no change/);
  });

  test("an unknown section and prose under a heading are carried through untouched", () => {
    const handEdited = [
      renderNewReview(WEEK, "2026-08-14"),
      "## My own notes",
      "",
      "something I typed while thinking",
      "",
    ].join("\n");

    const after = appendToSection(
      handEdited,
      PROJECTS_HEADING,
      renderProjectLine("2026-08-14", "one", "none", null),
    );
    assert.match(after, /## My own notes/);
    assert.match(after, /something I typed while thinking/);
  });

  test("prose the user wrote inside a step's section survives an append", () => {
    let content = renderNewReview(WEEK, "2026-08-14");
    content = setSectionBody(content, PROJECTS_HEADING, "I was interrupted here");
    content = appendToSection(content, PROJECTS_HEADING, renderProjectLine("2026-08-14", "one", "none", null));

    assert.match(content, /I was interrupted here/);
    assert.equal(parseReview(content, WEEK).projects.length, 1);
  });

  test("parsing a hand-edited file never throws", () => {
    const garbage = ["# Weekly review", "status:", "## Projects", "- not a real record", "###", ""].join("\n");
    const review = parseReview(garbage, WEEK);
    assert.equal(review.status, "in-progress");
    // The line does not match the grammar's slug+action shape closely enough to
    // become a record, and that is fine: it is shown as it reads.
    assert.ok(Array.isArray(review.projects));
  });

  test("a section lost to a hand-edit is restored rather than the record being dropped", () => {
    const withoutProjects = ["# Weekly review 2026-W33", "", "status: in progress", ""].join("\n");
    const after = appendToSection(withoutProjects, PROJECTS_HEADING, renderProjectLine("2026-08-14", "one", "none", null));
    assert.match(after, /## Projects/);
    assert.equal(parseReview(after, WEEK).projects.length, 1);
  });
});
