import { test, expect } from "@playwright/test";
import { launch, type Harness } from "./harness";

/**
 * The quickstart's manual scenarios, automated.
 *
 * `specs/005-weekly-review-ritual/quickstart.md` describes eight checks to run
 * by hand in the running app. Three were already covered by `review.spec.ts`
 * (§1, §3, §8). These are §2, §5, §6, and §7 — the ones a spec can hold,
 * driven through the real windows against a real vault on disk.
 *
 * §4 is deliberately absent. "One threshold governs both subjects" is fully
 * proved by `review-shared-threshold.test.ts` at the core level, using a
 * recording policy module to assert both subjects reach exactly one decision
 * point. Re-staging that through a GUI would be slower and would test less:
 * the guarantee is structural, and a screenshot of two stale things cannot show
 * that they share a rule.
 *
 * What remains manual after this file is visual judgement — that the windows
 * read well — which is what T111 is for.
 */

let h: Harness;

test.beforeEach(async () => {
  h = await launch();
});

test.afterEach(async () => {
  await h.close();
});

/** Walks to a named step from a freshly started review. */
async function advanceTo(view: Awaited<ReturnType<Harness["reviewView"]>>, steps: number): Promise<void> {
  await view.click("#advance");
  for (let i = 0; i < steps; i++) await view.click("#advance");
}

function project(title: string, status: string, extra = ""): string {
  return `# ${title}\n\nstatus: ${status}\nnext action: Something to do\n${extra}`;
}

// §2 ------------------------------------------------------------------------

test("a paused review resumes where it was left, and the position is derived", async () => {
  for (const slug of ["alpha", "bravo", "charlie"]) {
    h.writeVaultFile(`projects/${slug}.md`, project(slug, "active"));
  }

  await h.openReview();
  let view = await h.reviewView();
  await advanceTo(view, 1);
  await expect(view.locator("#step-projects")).toBeVisible();

  // Decide about the first project, then leave.
  await view.click("#project button:has-text('Nothing to change')");
  await expect(view.locator("#walk-position")).toContainText("2 of 3");

  // "Quit and come back" — the window is dismissed and reopened, which re-reads
  // the log from disk exactly as a cold start would.
  await view.keyboard.press("Escape");
  await h.openReview();
  view = await h.reviewView();

  // Resumes on the walk, not at the beginning, with the first decision kept.
  await expect(view.locator("#step-projects")).toBeVisible();
  await expect(view.locator("#walk-position")).toContainText("2 of 3");

  // The position is *derived*, not stored: deleting the recorded line by hand
  // puts that project back in the queue (research R3).
  const week = h.vaultDir("log")[0] ?? "";
  const log = h.vaultFile(`log/${week}`);
  h.writeVaultFile(`log/${week}`, log.replace(/^- .*alpha.*$\n/m, ""));

  await h.openReview();
  view = await h.reviewView();
  await expect(view.locator("#walk-position")).toContainText("1 of 3");
});

// §5 ------------------------------------------------------------------------

test("the ledger entry is the verb's, not the surface's", async () => {
  // Only one project in the walk, so the card on screen is unambiguously this
  // one — the walk order is core's, and a test that guessed it would be
  // asserting against the wrong file the day the order changed.
  h.writeVaultFile("projects/migration.md", project("Migration", "active"));

  // One status change from inside the review…
  await h.openReview();
  const view = await h.reviewView();
  await advanceTo(view, 1);
  await expect(view.locator("#project")).toContainText("Migration");
  await view.click("#project button:has-text('Move to waiting')");

  await expect
    .poll(() => h.vaultFile("projects/migration.md"))
    .toMatch(/- \d{4}-\d{2}-\d{2} status active → waiting/);

  // …and one from the projects window. The entries differ only in which project
  // they are on: the verb writes them, so the surface leaves no fingerprint.
  h.writeVaultFile("projects/hiring.md", project("Hiring", "active"));
  await h.openProjects();
  const projects = await h.projectsView();
  await projects.click('#project-list [data-project="hiring"]');
  await projects.selectOption("#status-select", "waiting");

  await expect
    .poll(() => h.vaultFile("projects/hiring.md"))
    .toMatch(/- \d{4}-\d{2}-\d{2} status active → waiting/);

  const entry = /- \d{4}-\d{2}-\d{2} (status .*)/;
  expect(entry.exec(h.vaultFile("projects/migration.md"))?.[1]).toEqual(
    entry.exec(h.vaultFile("projects/hiring.md"))?.[1],
  );
});

test("a project hand-edited into waiting has an unknown duration and is never stale", async () => {
  // No ledger entry for the transition, because a text editor wrote it. The
  // duration is unknowable, so none is invented (FR-094).
  h.writeVaultFile("projects/handedited.md", project("Hand edited", "waiting"));

  await h.openReview();
  const view = await h.reviewView();
  await advanceTo(view, 1);

  await expect(view.locator("#project")).toContainText("Hand edited");
  await expect(view.locator("#project")).not.toContainText("has been waiting");
  // Nothing is written on the way past, either.
  expect(h.vaultFile("projects/handedited.md")).not.toContain("## Ledger");
});

// §6 ------------------------------------------------------------------------

test("waiting-for actions accumulate and nothing is ever deleted", async () => {
  const since = "2026-01-05";
  // Two items, both long overdue. The first already carries a follow-up from
  // months ago — which is what makes it stale *again* and lets a second one be
  // recorded from the step. Chasing something resets its untouched clock by
  // design, so an item chased today leaves the stale list immediately; a test
  // that clicked twice in a row would be asserting against a bug.
  h.writeVaultFile(
    "waiting.md",
    `- ${since} @Priya — The signed contract\n  - followed up 2026-02-01\n- ${since} @roofer — The revised estimate\n`,
  );

  await h.openReview();
  const view = await h.reviewView();
  await advanceTo(view, 2);
  await expect(view.locator("#step-waiting")).toBeVisible();
  await expect(view.locator("#waiting-total")).toContainText("2 outstanding");

  await view.click("li:has-text('Priya') button:has-text('I followed up')");
  await expect.poll(() => (h.vaultFile("waiting.md").match(/followed up/g) ?? []).length).toEqual(2);

  await view.click("li:has-text('roofer') button:has-text('It arrived')");
  await expect.poll(() => h.vaultFile("waiting.md")).toContain("received");

  const file = h.vaultFile("waiting.md");
  // The original waiting-since dates survive every action, so total age stays
  // visible beside the untouched-since clock (FR-043a).
  expect(file).toContain(`- ${since} @Priya — The signed contract`);
  expect(file).toContain(`- ${since} @roofer — The revised estimate`);
  // The earlier follow-up was not replaced (FR-043b).
  expect(file).toContain("followed up 2026-02-01");
  // Received, so it drops out of the outstanding count — and stays in the file
  // with its whole history (FR-043c).
  await expect(view.locator("#waiting-total")).toContainText("1 outstanding");
});

// §7 ------------------------------------------------------------------------

test("commitments land in the next week, and the ordinary window can write it too", async () => {
  await h.openReview();
  const view = await h.reviewView();
  await advanceTo(view, 3);
  await expect(view.locator("#step-top-three")).toBeVisible();

  // The step paints from disk after the click resolves, so wait on the text
  // rather than reading it and racing the first paint.
  await expect(view.locator("#ahead-week")).toContainText(/\d{4}-W\d{2}/);
  const ahead = (await view.locator("#ahead-week").textContent()) ?? "";
  const aheadWeek = /(\d{4}-W\d{2})/.exec(ahead)?.[1] ?? "";

  await view.fill("#ahead-text", "Ship the thing");
  await view.click("#ahead-add");

  await expect.poll(() => h.vaultFile("top-three.md")).toContain(`## ${aheadWeek}`);
  expect(h.vaultFile("top-three.md")).toContain("Ship the thing");

  // The widening is a property of the top three, not a review-only power: the
  // ordinary window offers the same week (FR-049a).
  await h.openTopThree();
  const t3 = await h.topThreeView();
  await expect(t3.locator("#ahead-section")).toBeVisible();
  await expect(t3.locator("#ahead-id")).toContainText(aheadWeek);

  await t3.fill("#ahead-text", "Written from the ordinary window");
  await t3.click("#ahead-add");
  await expect.poll(() => h.vaultFile("top-three.md")).toContain("Written from the ordinary window");
});
