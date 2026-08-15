import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { parseProject } from "../src/projects/document";
import { FixedClock, seedProject } from "./project-fakes";

/**
 * Who writes the ledger, and in how many writes.
 *
 * **The core verb performing the action writes the entry** — never the review,
 * never a client. The same status change made from the projects window, from
 * the review, or from a later API produces an identical entry, because there is
 * one place that produces it (FR-092).
 *
 * **One write.** The entry and the `status:` line are composed into a single
 * content transform. Two writes could be interrupted between them, leaving a
 * status the ledger does not explain — so the write count is asserted, not just
 * the content.
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

function service(content: string, now = "2026-08-14T10:00:00-04:00") {
  const vault = seedProject("p", content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock(now) }) };
}

const WAITING_SINCE_JULY = `# P

status: waiting

## Ledger

- 2026-07-14 status active → waiting
`;

describe("setStatus", () => {
  test("appends one entry naming the status left and the status entered", async () => {
    const { vault, projects } = service("# P\n\nstatus: active\n");

    await projects.setStatus("p", "active", "waiting");

    const ledger = parseProject(vault.files.get("projects/p.md") ?? "", "p").ledger;
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.on, "2026-08-14");
    assert.equal(ledger[0]?.action, "status");
    assert.equal(ledger[0]?.detail, "active → waiting");
  });

  test("the entry and the status line land in one write", async () => {
    const { vault, projects } = service("# P\n\nstatus: active\n");

    await projects.setStatus("p", "active", "parked");

    const writes = vault.writeLog.filter((p) => p === "projects/p.md");
    assert.equal(
      writes.length,
      1,
      "two writes could be interrupted between them, leaving a status the ledger does not explain",
    );

    const content = vault.files.get("projects/p.md") ?? "";
    assert.match(content, /^status: parked$/m);
    assert.match(content, /^- 2026-08-14 status active → parked$/m);
  });

  test("records how long the ended state had lasted, when the ledger knows", async () => {
    const { vault, projects } = service(WAITING_SINCE_JULY, "2026-08-14T10:00:00-04:00");

    await projects.setStatus("p", "waiting", "active");

    assert.match(
      vault.files.get("projects/p.md") ?? "",
      /^- 2026-08-14 status waiting → active — after 31d waiting$/m,
    );
  });

  test("says nothing about a duration it cannot observe", async () => {
    // No prior entry entering `active`, so there is no date to measure from. A
    // substituted one would be the invented capture timestamp the inbox already
    // refuses (FR-094).
    const { vault, projects } = service("# P\n\nstatus: active\n");

    await projects.setStatus("p", "active", "done");

    assert.match(vault.files.get("projects/p.md") ?? "", /^- 2026-08-14 status active → done$/m);
    assert.doesNotMatch(vault.files.get("projects/p.md") ?? "", /after/);
  });

  test("a no-op change appends nothing", async () => {
    const { vault, projects } = service("# P\n\nstatus: active\n");

    await projects.setStatus("p", "active", "active");

    const content = vault.files.get("projects/p.md") ?? "";
    assert.equal(parseProject(content, "p").ledger.length, 0);
    assert.doesNotMatch(
      content,
      /## Ledger/,
      "an entry records a change; a non-change would be noise that also resets the duration clock",
    );
  });

  test("a refused change writes no entry", async () => {
    const { vault, projects } = service("# P\n\nstatus: active\n");

    const outcome = await projects.setStatus("p", "parked", "waiting");

    assert.equal(outcome.ok, false, "the expected status does not match the file");
    assert.equal(vault.writeLog.length, 0, "nothing was written, so nothing was recorded");
  });
});

describe("complete", () => {
  test("records the status change alongside the completion date, in one write", async () => {
    const { vault, projects } = service(WAITING_SINCE_JULY);

    const outcome = await projects.complete("p");
    assert.ok(outcome.ok);

    const writes = vault.writeLog.filter((p) => p === "projects/p.md");
    assert.equal(writes.length, 1);

    const content = vault.files.get("projects/p.md") ?? "";
    assert.match(content, /^status: done$/m);
    assert.match(content, /^completed: 2026-08-14$/m);
    assert.match(content, /^- 2026-08-14 status waiting → done — after 31d waiting$/m);
  });

  test("completing a project that is already done appends nothing", async () => {
    const { vault, projects } = service("# P\n\nstatus: done\ncompleted: 2026-08-01\n");

    await projects.complete("p");

    assert.equal(parseProject(vault.files.get("projects/p.md") ?? "", "p").ledger.length, 0);
  });
});

describe("reopen", () => {
  test("records the status change alongside clearing the date, in one write", async () => {
    const { vault, projects } = service(`# P

status: done
completed: 2026-08-01

## Ledger

- 2026-08-01 status active → done
`);

    const outcome = await projects.reopen("p", "active");
    assert.ok(outcome.ok);

    const writes = vault.writeLog.filter((p) => p === "projects/p.md");
    assert.equal(writes.length, 1);

    const content = vault.files.get("projects/p.md") ?? "";
    assert.match(content, /^status: active$/m);
    assert.doesNotMatch(content, /^completed:/m);
    assert.match(content, /^- 2026-08-14 status done → active — after 13d done$/m);
  });
});

describe("what the ledger does not record", () => {
  test("only status changes, this feature", async () => {
    // The shape generalises, but an entry must not duplicate state the file
    // already carries — a milestone's completion date stays on the milestone
    // (FR-090).
    const { vault, projects } = service(`# P

status: active

## Milestones

- [ ] Ship the runbook
`);

    await projects.setNextAction("p", null, "Call the vendor");
    await projects.completeMilestone("p", { index: 0, raw: "- [ ] Ship the runbook" });
    await projects.setOutcome("p", null, "The cluster is off.");

    assert.equal(parseProject(vault.files.get("projects/p.md") ?? "", "p").ledger.length, 0);
  });
});
