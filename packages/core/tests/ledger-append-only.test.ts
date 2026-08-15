import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { parseProject } from "../src/projects/document";
import { FixedClock, seedProject } from "./project-fakes";
import type { ProjectStatus } from "../src/projects/types";

/**
 * Append-only, over a long run.
 *
 * There is no verb that edits an entry, and this is where that claim is worth
 * something: twenty status changes, each one checked against everything written
 * before it. Nothing rewritten, nothing reordered, nothing compacted away
 * (FR-091, SC-012d).
 *
 * A hand-written entry is included deliberately. The system's own entries and
 * the user's are the same kind of thing, and the file is the record whoever
 * wrote the line.
 */

const CYCLE: ProjectStatus[] = ["waiting", "active", "parked", "active"];

describe("twenty status changes", () => {
  test("leave every earlier entry unaltered and in place", async () => {
    const clock = new FixedClock("2026-01-05T10:00:00-05:00");
    const vault = seedProject(
      "p",
      `# P

status: active

## Ledger

- 2025-11-30 status parked → active    written by hand, before any of this
`,
    );
    const projects = new ProjectService({ vault, clock });

    let from: ProjectStatus = "active";
    // The user's own entry is the first thing every later write must not touch.
    const seen: string[] = ["- 2025-11-30 status parked → active    written by hand, before any of this"];

    for (let i = 0; i < 20; i++) {
      // A day apart, so each entry is distinguishable and each duration real.
      clock.set(`2026-01-${String(6 + i).padStart(2, "0")}T10:00:00-05:00`);
      const to = CYCLE[i % CYCLE.length] as ProjectStatus;

      const outcome = await projects.setStatus("p", from, to);
      assert.ok(outcome.ok, `change ${i} (${from} → ${to}) was refused`);
      from = to;

      const ledger = parseProject(vault.files.get("projects/p.md") ?? "", "p").ledger;
      const raws = ledger.map((e) => e.raw);

      assert.deepEqual(
        raws.slice(0, seen.length),
        seen,
        `change ${i} disturbed an entry written before it`,
      );
      assert.equal(raws.length, seen.length + 1, `change ${i} wrote something other than one entry`);
      seen.push(raws[raws.length - 1] as string);
    }

    const finalContent = vault.files.get("projects/p.md") ?? "";
    assert.equal(parseProject(finalContent, "p").ledger.length, 21, "twenty, plus the hand-written one");
    assert.match(
      finalContent,
      /- 2025-11-30 status parked → active {4}written by hand, before any of this/,
      "the user's own entry survived twenty writes",
    );
  });

  test("the section holds one heading no matter how many entries land in it", async () => {
    const clock = new FixedClock("2026-01-05T10:00:00-05:00");
    const vault = seedProject("p", "# P\n\nstatus: active\n");
    const projects = new ProjectService({ vault, clock });

    let from: ProjectStatus = "active";
    for (let i = 0; i < 20; i++) {
      const to = CYCLE[i % CYCLE.length] as ProjectStatus;
      await projects.setStatus("p", from, to);
      from = to;
    }

    assert.equal((vault.files.get("projects/p.md") ?? "").match(/## Ledger/g)?.length, 1);
  });
});
