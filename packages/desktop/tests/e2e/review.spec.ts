import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The weekly review, end to end.
 *
 * A smoke test over the spine: open it, start it, walk the four steps, finish
 * it, and find a plain-text log on disk that reads correctly with the app
 * closed. That last assertion is the one that matters — every other test in
 * this feature checks an object, and this one checks the file the user is
 * actually left with (Principle IV).
 *
 * It also pins the two things nothing else can: that the review is reachable
 * only by an explicit action, and that no summary affordance appears in the
 * shipped configuration, where no provider is supplied (FR-006, FR-103).
 */

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

test("nothing starts a review on the user's behalf", async () => {
  await h.openReview();
  const view = await h.reviewView();

  // Opening the window is looking, not starting. The log directory does not
  // exist until the user says so (FR-062).
  await expect(view.locator("#week-id")).toContainText("No review started");
  await expect(view.locator("#advance")).toContainText("Start this week's review");
  expect(h.vaultDir("log")).toEqual([]);
});

test("a review runs to completion and leaves a readable log", async () => {
  await h.openReview();
  const view = await h.reviewView();

  await view.click("#advance");
  await expect(view.locator("#rail")).toContainText("Inbox");

  // Four steps, in order. An empty vault passes each with nothing to record,
  // which is the state a new user actually meets (FR-007).
  await view.click("#advance");
  await expect(view.locator("#step-projects")).toBeVisible();

  await view.click("#advance");
  await expect(view.locator("#step-waiting")).toBeVisible();

  await view.click("#advance");
  // The last step shows the week ahead *and* the finish panel: the note is
  // written while looking at what was committed to, not instead of it.
  await expect(view.locator("#step-top-three")).toBeVisible();
  await expect(view.locator("#step-complete")).toBeVisible();
  await expect(view.locator("#advance")).toBeHidden();

  await view.fill("#note", "Quiet week. Nothing on fire.");
  await view.click("#complete");

  await expect(view.locator("#week-id")).toContainText("reviewed");

  // The point of the whole feature: a file, in the user's own directory, that
  // says what happened and needs nothing to read it.
  const files = h.vaultDir("log");
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^\d{4}-W\d{2}\.md$/);

  const log = h.vaultFile(`log/${files[0] ?? ""}`);
  expect(log).toContain("status: complete");
  expect(log).toContain("## Note");
  expect(log).toContain("Quiet week. Nothing on fire.");
});

test("a finished review is a record, not a form", async () => {
  await h.openReview();
  const view = await h.reviewView();

  await view.click("#advance");
  for (let i = 0; i < 3; i++) await view.click("#advance");
  await view.fill("#note", "Done.");
  await view.click("#complete");

  // No affordance to re-run or overwrite it. The file stays hand-editable —
  // the app simply declines to be the one rewriting history (FR-011).
  await expect(view.locator("#advance")).toBeHidden();
  await expect(view.locator("#complete")).toBeHidden();
  await expect(view.locator("#note")).toBeDisabled();
});

test("past reviews are listed and readable, most recent first", async () => {
  // Two finished weeks already on disk, written by hand the way a user's
  // previous months would be. The point of the whole feature is that these
  // outlive the run that produced them (FR-069, FR-071).
  h.writeVaultFile(
    "log/2026-W31.md",
    "# Weekly review 2026-W31\n\nstatus: complete\nstarted: 2026-07-31\ncompleted: 2026-07-31\n\n## Note\n\nThe fence week.\n",
  );
  h.writeVaultFile(
    "log/2026-W32.md",
    "# Weekly review 2026-W32\n\nstatus: complete\nstarted: 2026-08-07\ncompleted: 2026-08-07\n\n## Note\n\nQuieter than it looked.\n",
  );

  await h.openReview();
  const view = await h.reviewView();

  // Collapsed by default — looking something up is a deliberate act, not a
  // permanent column of every week the user has ever reviewed.
  await view.click("#past-panel summary");

  const weeks = view.locator("#past-list li");
  await expect(weeks).toHaveCount(2);
  // Newest first: the user is looking for last week far more often than for
  // the week before it.
  await expect(weeks.nth(0)).toContainText("2026-W32");
  await expect(weeks.nth(1)).toContainText("2026-W31");

  await weeks.nth(1).click();
  await expect(view.locator("#past-record")).toContainText("The fence week.");

  // A record, not a form. Nothing here re-runs or overwrites a finished week —
  // correcting history is done in the text editor, on purpose (FR-011).
  await expect(view.locator("#past-record button")).toHaveCount(0);
});

test("an abandoned review is listed as the incomplete record it is", async () => {
  h.writeVaultFile(
    "log/2026-W30.md",
    "# Weekly review 2026-W30\n\nstatus: in progress\nstarted: 2026-07-24\nstep: projects\n",
  );

  await h.openReview();
  const view = await h.reviewView();
  await view.click("#past-panel summary");

  // Never backfilled, never completed on the user's behalf, and never hidden
  // for being untidy (FR-060).
  await expect(view.locator("#past-list li").first()).toContainText("2026-W30");
  await expect(view.locator("#past-list li").first()).toContainText("unfinished");
});

test("no summary affordance appears when no provider is supplied", async () => {
  await h.openReview();
  const view = await h.reviewView();

  await view.click("#advance");
  for (let i = 0; i < 3; i++) await view.click("#advance");

  // Not a disabled button implying something is missing — nothing at all. This
  // is the shipped configuration, and it is not a degraded one (FR-103).
  await expect(view.locator("#summary-panel")).toBeHidden();

  // What a provider *would* be sent is still shown, so the user can see what
  // would leave the machine if they ever configured one (FR-109).
  await expect(view.locator("#record-panel")).toBeVisible();
});

test("the inbox gate warns and can be carried past", async () => {
  // The inbox lives in the vault root beside the other running lists.
  h.writeInbox("- an unsorted thought\n- and another\n");

  await h.openReview();
  const view = await h.reviewView();
  await view.click("#advance");

  await expect(view.locator("#inbox-count")).toContainText("2 items");

  await view.click("#advance");
  // The policy module's own words, rendered verbatim by a client that computes
  // no part of them.
  await expect(view.locator("#warning")).toContainText("two items");
  await expect(view.locator("#warning button")).toContainText("Carry on anyway");

  await view.click("#warning button");
  await expect(view.locator("#step-projects")).toBeVisible();
});
