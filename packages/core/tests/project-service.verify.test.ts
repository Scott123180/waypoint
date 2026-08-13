import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { FixedClock, seedProject } from "./project-fakes";
import { STRUCTURED } from "./project-fixtures";

/**
 * Field-level verify-before-write (FR-045a–FR-045e).
 *
 * Feature 2's rule, narrowed from a whole item to a single field. Both halves
 * matter equally:
 *
 *   - a field changed on disk cancels the write, because overwriting a
 *     deliberate hand-edit is the one unforgivable bug in a plain-text tool;
 *   - a change to a *different* field must NOT cancel, because a refusal the
 *     user cannot act on is a refusal they learn to click past.
 */

function service() {
  const vault = seedProject("roof-repair", STRUCTURED);
  return { vault, projects: new ProjectService({ vault, clock: new FixedClock() }) };
}

const path = "projects/roof-repair.md";

describe("a field changed on disk", () => {
  test("cancels the write and returns a refusal as a value, not an exception", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    const outcome = await projects.setDri("roof-repair", "me", "Alex");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });

  test("leaves the file byte-for-byte unchanged", async () => {
    const { vault, projects } = service();
    const edited = (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam");
    vault.files.set(path, edited);
    vault.writeLog.length = 0;

    await projects.setDri("roof-repair", "me", "Alex");
    assert.equal(vault.files.get(path), edited);
    assert.deepEqual(vault.writeLog, [], "a cancelled decision must write nothing");
  });

  test("tells the caller what the field now says, so they can re-decide", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    const outcome = await projects.setDri("roof-repair", "me", "Alex");
    assert.ok(outcome.ok === false);
    assert.match(outcome.message, /Sam/, "the message must carry the current value");
  });

  test("applies to the outcome section too, not just preamble fields", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("The roof survives", "Something else"));

    const outcome = await projects.setOutcome("roof-repair", "The roof survives a full winter with no leak, and the insurance claim is settled.", "New");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });

  test("applies to status", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("status: active", "status: parked"));

    const outcome = await projects.setStatus("roof-repair", "active", "waiting");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "field-changed");
  });

  test("a cancelled write leaves nothing queued, retried, or pending (FR-045e)", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    await projects.setDri("roof-repair", "me", "Alex");
    // Nothing may land later. A second unrelated read must see the hand-edit
    // still standing, with no deferred write having replayed over it.
    assert.equal((await projects.get("roof-repair"))?.dri, "Sam");
    assert.deepEqual(vault.writeLog, []);
  });
});

describe("a DIFFERENT field changed on disk (FR-045c)", () => {
  test("does not cancel the write", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    const outcome = await projects.setOutcome(
      "roof-repair",
      "The roof survives a full winter with no leak, and the insurance claim is settled.",
      "A new outcome.",
    );
    assert.ok(outcome.ok, "an unrelated hand-edit must not block this write");
  });

  test("and the unrelated hand-edit survives the write", async () => {
    const { vault, projects } = service();
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    await projects.setOutcome(
      "roof-repair",
      "The roof survives a full winter with no leak, and the insurance claim is settled.",
      "A new outcome.",
    );

    const p = await projects.get("roof-repair");
    assert.equal(p?.dri, "Sam", "the hand-edit must not be overwritten");
    assert.equal(p?.outcome, "A new outcome.");
  });

  test("content the app knows nothing about survives a write", async () => {
    const { vault, projects } = service();
    vault.files.set(path, `${vault.files.get(path) ?? ""}\n## Notes\n\nMine, not yours.\n`);

    await projects.setDri("roof-repair", "me", "Alex");
    assert.match(vault.files.get(path) ?? "", /Mine, not yours\./);
  });
});

describe("verification reads fresh, never a copy from when the view opened", () => {
  test("a stale expectation from an earlier read is refused", async () => {
    const { vault, projects } = service();
    // Caller read this a while ago and has been sitting on it.
    const stale = (await projects.get("roof-repair"))?.dri ?? null;
    vault.files.set(path, (vault.files.get(path) ?? "").replace("dri: me", "dri: Sam"));

    const outcome = await projects.setDri("roof-repair", stale, "Alex");
    assert.equal(outcome.ok, false);
  });

  test("the project disappearing between read and write refuses rather than recreating it", async () => {
    const { vault, projects } = service();
    vault.files.delete(path);

    const outcome = await projects.setDri("roof-repair", "me", "Alex");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.reason, "not-found");
    assert.equal(vault.files.size, 0, "must not recreate a project the user deleted");
  });
});
