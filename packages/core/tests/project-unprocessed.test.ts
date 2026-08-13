import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED, STUB_WITH_UNPROCESSED } from "./project-fixtures";

/**
 * The raw material sort left behind: shown while structuring, dismissable once
 * handled, never converted into a field by anything but the user's typing
 * (FR-046a–FR-046e).
 *
 * Dismissal is a soft delete to `trash.md`, following the decision Feature 2
 * recorded: a captured thought is never destroyed by a single click. The user
 * has usually already retyped it into a field by then, so the trash line is
 * harmless noise — whereas losing a thought they only *thought* they had
 * transferred is not recoverable (research R9).
 */

const path = "projects/roof-repair.md";

function service(content = STUB_WITH_UNPROCESSED) {
  const vault = seedProject("roof-repair", content);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

describe("reading unprocessed items", () => {
  test("returns them in file order with their text", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    assert.equal(p?.unprocessed.length, 3);
    assert.deepEqual(p?.unprocessed.map((u) => u.index), [0, 1, 2]);
    assert.equal(p?.unprocessed[0]?.text, "Call the roofer back about the estimate");
  });

  test("keeps a capture timestamp where there is one", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    assert.ok(p?.unprocessed[0]?.capturedAt instanceof Date);
  });

  test("leaves a hand-written item's timestamp null rather than substituting one", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    assert.equal(p?.unprocessed[1]?.capturedAt, null);
    assert.equal(p?.unprocessed[1]?.text, "Buy a tarp before it rains");
  });

  test("carries the raw block for verification", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    assert.match(p?.unprocessed[0]?.raw ?? "", /^- 2026-08-11T09:14:02-04:00 /);
  });

  test("a project with no Unprocessed section reports none", async () => {
    const { projects } = service("# Roof repair\n\nstatus: active\n");
    const p = await projects.get("roof-repair");
    assert.deepEqual(p?.unprocessed, []);
  });
});

describe("dismissUnprocessed", () => {
  test("removes the item from the project", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[1];
    assert.ok(item);

    const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    assert.ok(outcome.ok);
    assert.equal(outcome.project.unprocessed.length, 2);
    assert.ok(!outcome.project.unprocessed.some((u) => u.text.includes("tarp")));
  });

  test("keeps the remaining items in their original order", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[1];
    assert.ok(item);

    const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    assert.ok(outcome.ok);
    assert.deepEqual(
      outcome.project.unprocessed.map((u) => u.text),
      ["Call the roofer back about the estimate", "Ask about the insurance claim"],
    );
  });

  test("appends it to trash.md with text and capture timestamp intact", async () => {
    const { vault, projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[0];
    assert.ok(item);

    await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    const trash = vault.files.get("trash.md") ?? "";
    assert.match(trash, /Call the roofer back about the estimate/);
    assert.match(trash, /2026-08-11T09:14:02-04:00/, "the capture timestamp must survive");
    assert.match(trash, /^- 2026-08-12 /m, "the discard date is today");
  });

  test("writes to trash BEFORE removing from the project", async () => {
    // The failure mode is then a duplicate, which the user can see and fix,
    // rather than a loss, which they cannot (research R9).
    const { vault, projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[0];
    assert.ok(item);

    await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    assert.deepEqual(vault.writeLog, ["trash.md", path]);
  });

  test("a hand-written item is discarded without a fabricated timestamp", async () => {
    const { vault, projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[1];
    assert.ok(item);

    await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    assert.match(vault.files.get("trash.md") ?? "", /^- 2026-08-12 — Buy a tarp before it rains$/m);
  });

  test("dismissing every item is not an error and leaves the section", async () => {
    const { vault, projects } = service();
    for (let i = 0; i < 3; i++) {
      const p = await projects.get("roof-repair");
      const item = p?.unprocessed[0];
      assert.ok(item);
      const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
      assert.ok(outcome.ok);
    }
    const p = await projects.get("roof-repair");
    assert.deepEqual(p?.unprocessed, []);
    assert.match(vault.files.get(path) ?? "", /^## Unprocessed$/m);
  });

  test("an emptied section does not affect the structure flag", async () => {
    const { projects } = service();
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[0];
    assert.ok(item);
    const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    assert.ok(outcome.ok);
    // Still a stub with no outcome/milestones/next action — unchanged by this.
    assert.equal(outcome.project.outcome, null);
  });

  describe("nothing is ever converted into structure (FR-046c)", () => {
    test("dismissing does not populate any field", async () => {
      const { projects } = service();
      const p = await projects.get("roof-repair");
      const item = p?.unprocessed[0];
      assert.ok(item);

      const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
      assert.ok(outcome.ok);
      assert.equal(outcome.project.outcome, null);
      assert.equal(outcome.project.nextAction, null);
      assert.deepEqual(outcome.project.milestones, []);
    });

    test("no promote or convert verb exists on the service", async () => {
      const surface = new Set(Object.getOwnPropertyNames(Object.getPrototypeOf(service().projects)));
      for (const name of ["promote", "convert", "promoteUnprocessed", "convertUnprocessed"]) {
        assert.ok(!surface.has(name), `${name}() belongs to a later feature`);
      }
    });
  });

  describe("verification", () => {
    test("an item changed on disk refuses rather than dismissing the wrong one", async () => {
      const { vault, projects } = service();
      const p = await projects.get("roof-repair");
      const item = p?.unprocessed[1];
      assert.ok(item);
      vault.files.set(path, (vault.files.get(path) ?? "").replace("Buy a tarp", "Buy a bigger tarp"));
      vault.writeLog.length = 0;

      const outcome = await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok === false && outcome.reason, "field-changed");
      assert.deepEqual(vault.writeLog, [], "nothing may be written, not even to trash");
    });

    test("a stale index refuses", async () => {
      const { projects } = service();
      const outcome = await projects.dismissUnprocessed("roof-repair", 9, "- nothing here");
      assert.equal(outcome.ok, false);
    });
  });

  test("dismissing leaves the project's structure byte-for-byte alone", async () => {
    const { vault, projects } = service(STRUCTURED);
    const p = await projects.get("roof-repair");
    const item = p?.unprocessed[0];
    assert.ok(item);

    await projects.dismissUnprocessed("roof-repair", item.index, item.raw);
    const after = vault.files.get(path) ?? "";
    assert.match(after, /^## Outcome$/m);
    assert.match(after, /- \[x\] Estimate approved by insurer — @Priya — done 2026-08-14/);
    assert.match(after, /^next action: Call the roofer back for a revised estimate$/m);
  });
});
