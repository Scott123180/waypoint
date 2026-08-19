import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * Acting on what the screen shows, in the running app (SC-012, FR-010b).
 *
 * **This is where SC-012 and FR-010b are proven**, because "the row updated in
 * place and its neighbours did not move" is a renderer behaviour core cannot
 * express: `ShutdownService` performs no action at all, so from core's side
 * there is nothing to observe. The core suite pins the two halves that surround
 * this — the held value is unchanged by the writes, and a fresh reading does
 * change — and this spec pins the half in the middle.
 */

let h: Harness;

const iso = (daysAgo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const today = iso(0);

/**
 * The ISO week the clock is in, so the fixture's section is the one the panel
 * reads. Computed rather than pinned: a literal week id would stop being the
 * current one the day after it was written.
 */
function isoWeek(now: Date): string {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

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
    "- [ ] Scaffolding booked",
    "- [ ] Tiles delivered",
    "",
  ].join("\n"),
  "waiting.md": [
    `- ${iso(40)} @Priya — Confirm the migration window moved`,
    `- ${iso(50)} @Sam — The signed contract`,
    "",
  ].join("\n"),
  "calendar.md": `- ${iso(20)} — Quarterly planning day\n`,
  "top-three.md": `## ${isoWeek(new Date())}\n\n- [ ] Ship the seam\n- [ ] Book the offsite\n\n`,
};

test.beforeEach(async () => {
  h = await launch({ seedVault: VAULT });
});

test.afterEach(async () => {
  await h.close();
});

test("marking an outcome done records it and updates only that row", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#top-three li.row")).toHaveCount(2);

  await view.locator("#top-three li.row").first().locator("input[type=checkbox]").click();

  await expect(view.locator("#top-three li.row.done")).toHaveCount(1);
  await expect(view.locator("#top-three li.row").first().locator(".date")).toHaveText(today);
  // The neighbour did not move and did not change.
  await expect(view.locator("#top-three li.row")).toHaveCount(2);
  await expect(view.locator("#top-three li.row").nth(1)).toContainText("Book the offsite");
  await expect(view.locator("#top-three li.row").nth(1)).not.toHaveClass(/done/);

  expect(h.vaultFile("top-three.md")).toContain(`- [x] Ship the seam — done ${today}`);
});

test("marking a milestone done records it, ledger line included", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#projects ul.milestones li")).toHaveCount(2);
  await view.locator("#projects ul.milestones li").first().locator("input[type=checkbox]").click();

  await expect(view.locator("#projects ul.milestones li.done")).toHaveCount(1);
  // The other milestone stayed exactly where it was.
  await expect(view.locator("#projects ul.milestones li")).toHaveCount(2);
  await expect(view.locator("#projects ul.milestones li").nth(1)).toContainText("Tiles delivered");

  expect(h.vaultFile("projects/roof.md")).toContain(`- [x] Scaffolding booked — done ${today}`);
});

test("replacing a next action changes only that field", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#projects .next-action-text")).toContainText("Call the second contractor");

  await view.click("#projects .edit-next-action");
  await view.fill("#projects .next-action-input", "Chase the scaffolding quote");
  await view.click("#projects .save-next-action");

  await expect(view.locator("#projects .next-action-text")).toContainText("Chase the scaffolding quote");

  const file = h.vaultFile("projects/roof.md");
  expect(file).toContain("next action: Chase the scaffolding quote");
  expect(file).toContain("dri: Scott Hansen");
  expect(file).toContain("- [ ] Tiles delivered");
});

test("both waiting verbs are offered on every item, with neither preferred", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#waiting li.row")).toHaveCount(2);
  await expect(view.locator("#waiting .record-follow-up")).toHaveCount(2);
  await expect(view.locator("#waiting .record-received")).toHaveCount(2);
});

test("chasing one and receiving another writes both, and leaves membership alone", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  const rows = view.locator("#waiting li.row");
  await rows.nth(0).locator(".record-follow-up").click();
  await expect(rows.nth(0)).toContainText("Recorded followed up");

  await rows.nth(1).locator(".record-received").click();
  await expect(rows.nth(1)).toContainText("Recorded received");

  const file = h.vaultFile("waiting.md");
  expect(file).toContain(`  - followed up ${today}`);
  expect(file).toContain(`  - received ${today}`);

  // Membership and order are unchanged for the rest of this opening — a fresh
  // reading would drop both rows, and that is exactly what must not happen while
  // the screen is open (FR-010a, SC-012).
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Confirm the migration window moved");
  await expect(rows.nth(1)).toContainText("The signed contract");

  // And no record of the ritual anywhere.
  expect(h.vaultDir("log")).toEqual([]);
});

test("reopening rebuilds: the chased and received items are gone", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  const rows = view.locator("#waiting li.row");
  await rows.nth(0).locator(".record-follow-up").click();
  await expect(rows.nth(0)).toContainText("Recorded followed up");
  await rows.nth(1).locator(".record-received").click();
  await expect(rows.nth(1)).toContainText("Recorded received");

  await h.closeShutdown();
  await h.openShutdown();

  await expect(view.locator("#waiting li.row")).toHaveCount(0);
  await expect(view.locator("#waiting-empty")).toBeVisible();
});

test("a refused write shows the core's message and changes nothing", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  // Edited in a text editor between being shown and being written — the race
  // this screen is most exposed to, because it is meant to be left open.
  const before = h.vaultFile("waiting.md");
  h.writeVaultFile(
    "waiting.md",
    before.replace("Confirm the migration window moved", "Please confirm the migration window"),
  );
  const edited = h.vaultFile("waiting.md");

  await view.locator("#waiting li.row").nth(0).locator(".record-follow-up").click();

  // The weekly review's words for the same refusal, verbatim.
  await expect(view.locator("#error")).toContainText("changed on disk since it was shown");
  await expect(view.locator("#error")).toContainText("Here is the list as it now reads");
  expect(h.vaultFile("waiting.md")).toEqual(edited);
});

test("nothing offers a bypass, an override, or a way to stop being told", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  const body = (await view.locator("body").textContent()) ?? "";
  for (const forbidden of [/don.?t ask/i, /override/i, /ignore/i, /snooze/i, /dismiss/i, /mute/i]) {
    expect(body).not.toMatch(forbidden);
  }
});

test("a calendar flag carries no affordance at all", async () => {
  await h.openShutdown();
  const view = await h.shutdownView();

  await expect(view.locator("#calendar li.row")).toHaveCount(1);
  await expect(view.locator("#calendar button")).toHaveCount(0);
  await expect(view.locator("#calendar input")).toHaveCount(0);

  const before = h.vaultFile("calendar.md");
  await view.locator("#calendar li.row").click();
  expect(h.vaultFile("calendar.md")).toEqual(before);
});
