import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The glance, end to end (SC-002, SC-010, SC-011).
 *
 * Four panels present **together** against a populated vault, the same screen
 * from cold after a close and a reopen, and a vault that is byte-for-byte
 * unchanged afterwards.
 *
 * Everything asserted here is a decision the core made and the renderer only
 * displayed — which projects are the user's, which items have gone quiet, how
 * many days that has been, and what to say about it.
 */

let h: Harness;

const TODAY = new Date();
const iso = (daysAgo: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Dates are relative to the day the suite runs, not fixed.
 *
 * A fixture pinned to a literal date would surface everything in it forever and
 * would stop testing the boundary the moment it aged past the threshold. The
 * unit suite pins the arithmetic with a fixed clock; here the point is that the
 * rows reach the screen at all.
 */
const VAULT = {
  "identity.md": "# Identity\n\nme: Scott Hansen\n",
  "projects/roof.md": [
    "# Roof repair",
    "",
    "status: active",
    "next action: Call the second contractor",
    "dri: Scott Hansen",
    "",
    "## Milestones",
    "",
    "- [x] Estimate approved — done 2026-01-10",
    "- [ ] Scaffolding booked",
    "",
  ].join("\n"),
  "projects/fence.md": ["# Fix the fence", "", "status: active", "dri: Priya Raman", ""].join("\n"),
  "waiting.md": `- ${iso(40)} @Priya — Confirm the migration window moved\n`,
  "calendar.md": `- ${iso(20)} — Quarterly planning day\n`,
};

test.beforeEach(async () => {
  h = await launch({ seedVault: VAULT });
});

test.afterEach(async () => {
  await h.close();
});

test("all four panels are present together, with the expected members", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  // Together, not in sequence. Every panel is on screen at once; there is no
  // step to advance and nothing to visit first (FR-001, FR-002).
  await expect(view.locator("section.panel#panel-top-three")).toBeVisible();
  await expect(view.locator("section.panel#panel-projects")).toBeVisible();
  await expect(view.locator("section.panel#panel-waiting")).toBeVisible();
  await expect(view.locator("section.panel#panel-calendar")).toBeVisible();

  // Only the roof is active-and-mine; the fence is Priya's.
  await expect(view.locator("#projects li.row")).toHaveCount(1);
  await expect(view.locator("#projects")).toContainText("Roof repair");
  await expect(view.locator("#projects")).toContainText("Call the second contractor");
  // Open milestones only — the approved estimate cannot be marked done again.
  await expect(view.locator("#projects ul.milestones li")).toHaveCount(1);
  await expect(view.locator("#projects ul.milestones")).toContainText("Scaffolding booked");

  await expect(view.locator("#waiting li.row")).toHaveCount(1);
  await expect(view.locator("#waiting")).toContainText("Confirm the migration window moved");
  await expect(view.locator("#waiting")).toContainText("@Priya");

  await expect(view.locator("#calendar li.row")).toHaveCount(1);
  await expect(view.locator("#calendar")).toContainText("Quarterly planning day");
});

test("the reasons shown are the policy module's words", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#waiting .reason")).toContainText("Chase it, or let it go.");
  await expect(view.locator("#calendar .reason")).toContainText("Put it in your calendar, or let it go.");
});

test("nothing on the screen numbers, sequences, or completes anything", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  const body = (await view.locator("body").textContent()) ?? "";

  for (const forbidden of [/\bstep\b/i, /\bnext\b(?! action)/i, /finish/i, /\bdone for (the day|today)\b/i]) {
    expect(body).not.toMatch(forbidden);
  }
  // Nothing presents as complete, incomplete, passed, skipped, or in progress,
  // because there is nothing here to be in progress (FR-004, FR-005).
  await expect(view.locator("progress")).toHaveCount(0);
});

test("an empty week says so rather than proposing anything", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#top-three-empty")).toBeVisible();
  await expect(view.locator("#top-three li.row")).toHaveCount(0);
});

test("closing and reopening gives the same screen from cold, with no resume", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();
  const before = await view.locator("body").innerText();

  await h.closeShutdown();
  expect(await h.isShutdownVisible()).toBe(false);

  await h.openShutdown();
  const after = await view.locator("body").innerText();

  expect(after).toEqual(before);
  // No prompt, no "pick up where you left off", no partial state.
  await expect(view.locator("#error")).toHaveText("");
});

test("a fresh reading is taken on the second opening, not the first one's answer", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();
  await expect(view.locator("#calendar li.row")).toHaveCount(1);

  // A hand-edit made while the window was hidden. The window subscribes to no
  // change signal, so it is the *opening* that picks this up.
  await h.closeShutdown();
  h.writeVaultFile("calendar.md", `- ${iso(20)} — Quarterly planning day\n- ${iso(30)} — Renew the passport\n`);

  await h.openShutdown();
  await expect(view.locator("#calendar li.row")).toHaveCount(2);
  await expect(view.locator("#calendar")).toContainText("Renew the passport");
});

test("the vault is byte-for-byte unchanged afterwards", async () => {
  const before = Object.fromEntries(Object.keys(VAULT).map((p) => [p, h.vaultFile(p)]));

  await h.openShutdown();
  const view = await h.shutdownView();
  await expect(view.locator("#waiting li.row")).toHaveCount(1);

  await h.closeShutdown();
  await h.openShutdown();
  await h.closeShutdown();

  for (const [path, content] of Object.entries(before)) {
    expect(h.vaultFile(path), `${path} changed`).toEqual(content);
  }
  // And nothing new appeared — in particular, no record that a shutdown ran.
  expect(h.vaultDir("log")).toEqual([]);
});
