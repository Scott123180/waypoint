import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { ReviewService } from "../src/review/review-service";
import { WaitingService } from "../src/waiting/waiting-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { FakeInbox, MutableClock } from "./review-fakes";
import { FakeVaultStore } from "./sort-fakes";

/**
 * Two clients, one vault, identical answers.
 *
 * This is what "the rules live with the data" buys. The desktop app today, and
 * the local API and the LLM layer later, are separately constructed services
 * that never talk to each other — and they agree because they read the same
 * `policy.md`, not because anyone remembered to keep them in sync (FR-081,
 * SC-011).
 *
 * Constructed independently and deliberately: shared instances would prove
 * nothing, since a shared object agrees with itself by definition.
 */

const IDENTITY = "me: Scott Rodgers\n";

function vaultOf(policy?: string): FakeVaultStore {
  const vault = new FakeVaultStore();
  const files: Record<string, string> = {
    "identity.md": IDENTITY,
    "projects/one.md": "# One\n\nstatus: active\ndri: Scott Rodgers\n",
    "projects/two.md": "# Two\n\nstatus: active\ndri: Scott Rodgers\n",
    "projects/three.md": "# Three\n\nstatus: active\ndri: Scott Rodgers\n",
    "projects/candidate.md": "# Candidate\n\nstatus: parked\ndri: Scott Rodgers\n",
    "projects/quiet.md": [
      "# Quiet",
      "",
      "status: waiting",
      "",
      "## Ledger",
      "",
      "- 2026-06-01 status active → waiting",
      "",
    ].join("\n"),
    "waiting.md": "- 2026-06-02 @Priya — Confirm the window\n",
    ...(policy === undefined ? {} : { "policy.md": policy }),
  };
  for (const [path, content] of Object.entries(files)) vault.files.set(path, content);
  return vault;
}

/** A whole client stack, built from nothing but the vault. */
function client(vault: FakeVaultStore, inbox: string) {
  const clock = new MutableClock("2026-08-14T09:00:00-04:00");
  return new ReviewService({
    vault,
    projects: new ProjectService({ vault, clock }),
    topThree: new TopThreeService({ vault, clock }),
    waiting: new WaitingService({ vault, clock }),
    inbox: new FakeInbox(inbox),
    clock,
  });
}

describe("two independently constructed services over the same vault", () => {
  test("give the same answer at the inbox gate", async () => {
    const a = client(vaultOf(), "- one\n- two\n");
    const b = client(vaultOf(), "- one\n- two\n");
    await a.start();
    await b.start();

    const fromA = await a.advance();
    const fromB = await b.advance();

    assert.equal(fromA.ok, false);
    assert.equal(fromB.ok, false);
    if (!fromA.ok && !fromB.ok) {
      assert.equal(fromA.reason, fromB.reason);
      assert.equal(fromA.message, fromB.message);
      assert.equal(fromA.confirmable, fromB.confirmable);
    }
  });

  test("give the same answer at the WIP limit", async () => {
    const a = client(vaultOf(), "");
    const b = client(vaultOf(), "");
    await a.start();
    await b.start();

    const fromA = await a.recordStatus("candidate", "parked", "active");
    const fromB = await b.recordStatus("candidate", "parked", "active");

    assert.equal(fromA.ok, false);
    assert.equal(fromB.ok, false);
    if (!fromA.ok && !fromB.ok) {
      assert.equal(fromA.reason, fromB.reason);
      assert.equal(fromA.message, fromB.message);
    }
  });

  test("surface the same stale subjects", async () => {
    const a = client(vaultOf(), "");
    const b = client(vaultOf(), "");
    await a.start();
    await b.start();

    const walkA = await a.projectStep();
    const walkB = await b.projectStep();
    assert.deepEqual(
      walkA.map((e) => [e.project.slug, e.stale?.reason ?? null]),
      walkB.map((e) => [e.project.slug, e.stale?.reason ?? null]),
    );

    const itemsA = await a.waitingStep();
    const itemsB = await b.waitingStep();
    assert.deepEqual(itemsA, itemsB);
  });
});

describe("a configuration change is seen by both", () => {
  test("without either being told", async () => {
    const configured = "inbox gate: block\nstaleness days: 100\n";
    const a = client(vaultOf(configured), "- one\n- two\n");
    const b = client(vaultOf(configured), "- one\n- two\n");
    await a.start();
    await b.start();

    const fromA = await a.advance({ confirmed: true });
    const fromB = await b.advance({ confirmed: true });
    assert.equal(fromA.ok, false, "blocked for A");
    assert.equal(fromB.ok, false, "and for B, for the same reason");
    if (!fromA.ok && !fromB.ok) assert.equal(fromA.message, fromB.message);

    assert.equal((await a.projectStep()).find((e) => e.project.slug === "quiet")?.stale, null);
    assert.equal((await b.projectStep()).find((e) => e.project.slug === "quiet")?.stale, null);
  });

  test("written by one client and seen by the other on the next decision", async () => {
    // One vault, two clients — the shape the local API will actually have.
    const vault = vaultOf();
    const a = client(vault, "- one\n- two\n");
    const b = client(vault, "- one\n- two\n");
    await a.start();

    assert.equal((await b.advance()).ok, false);

    vault.files.set("policy.md", "inbox gate: block\n");

    const now = await b.advance({ confirmed: true });
    assert.equal(now.ok, false, "config is read on every decision, by every client");
  });
});
