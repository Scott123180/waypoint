/**
 * The weekly review view.
 *
 * Rendering and input only. Everything this file appears to "know" arrives from
 * the core: which step comes next, whether a step may be passed, how many items
 * are in the inbox, and every word of every warning and refusal. If a rule ever
 * looks like it belongs here, it belongs in `ReviewService` (Principle II).
 *
 * See specs/005-weekly-review-ritual/contracts/review-api.md
 */

/**
 * Types are declared locally and every top-level name is prefixed `rv` — the
 * renderer files are scripts, not modules, so they share one global scope, and
 * `projects.ts` and `top-three.ts` already own the short names.
 *
 * Importing from the preload would pull it into the *renderer* TypeScript
 * program, compile it as ESM, and overwrite the CommonJS build Electron needs
 * — the app then starts with no `window.waypoint` at all.
 * `preload-is-commonjs.test.ts` fails if anyone reintroduces it.
 */
type RvStep = "inbox" | "projects" | "waiting" | "top-three";

interface RvReview {
  week: string;
  started: string;
  step: RvStep;
  status: "in-progress" | "complete";
  completed: string | null;
  inbox: { count: number; verdict: string; on: string } | null;
  projects: { slug: string; action: string; detail: string | null; on: string }[];
  waiting: {
    text: string;
    owner: string;
    days: number;
    subject: "item" | "project";
    action: string;
    on: string;
  }[];
  topThree: { finished: string[]; slipped: string[]; committed: string[]; forWeek: string | null } | null;
  note: string | null;
  summary: { text: string; provider: string } | null;
}

type RvResponse =
  | { ok: true; review: RvReview }
  | {
      ok: false;
      reason: string;
      message: string;
      confirmable?: boolean;
      /** The still-open milestones, when the refusal is the completion confirmation. */
      open?: string[];
      /** What to finish or park, when the refusal is the WIP limit. */
      subjects?: string[];
    };

interface RvMilestone {
  index: number;
  definitionOfDone: string;
  verifier: string | null;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

/**
 * One project as the walk hands it over.
 *
 * Every judgement in here was made by the core: which projects are walked, what
 * counts as a gap, whether a project is stale, how many days that is, and what
 * to say about it. This file renders those answers and sends back the reply.
 */
interface RvWalkEntry {
  project: {
    slug: string;
    title: string;
    status: string;
    milestonesDone: number;
    milestonesTotal: number;
    gaps: string[];
    dri: { resolution: string; raw: string | null };
    needsDri: boolean;
    statusSince: string | null;
  };
  outcome: string | null;
  nextAction: string | null;
  milestones: RvMilestone[];
  stale: { reason: string; days: number } | null;
  reviewed: boolean;
}

interface RvWaitingRef {
  index: number;
  raw: string;
}

/**
 * A line of `waiting.md` core could not read.
 *
 * Rendered verbatim with its line number and no action beside it — the fix is
 * an edit in the user's own text editor, and offering a button here would mean
 * the application guessing at what they meant to write (FR-044).
 */
interface RvUnreadable {
  line: number;
  raw: string;
}

/** One delegated item the staleness rule flagged. Decided entirely by the core. */
interface RvStaleWaiting {
  item: {
    index: number;
    since: string;
    owner: string;
    text: string;
    actions: { kind: string; on: string }[];
    raw: string;
  };
  reason: string;
  days: number;
}

interface RvOutcome {
  index: number;
  text: string;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

interface RvWeek {
  id: string;
  outcomes: RvOutcome[];
  current: boolean;
  writable: boolean;
}

type RvDraft =
  | { available: false; failure?: string }
  | { available: true; text: string; provider: string };

interface RvApi {
  current(): Promise<RvReview | null>;
  start(): Promise<RvReview>;
  history(): Promise<{ week: string; status: string; completed: string | null }[]>;
  get(week: string): Promise<RvReview | null>;
  inboxStep(): Promise<{ count: number; notice: string }>;
  projectStep(): Promise<RvWalkEntry[]>;
  waitingStep(): Promise<{
    total: number;
    stale: RvStaleWaiting[];
    unreadable: RvUnreadable[];
  }>;
  topThreeStep(): Promise<{ reviewed: RvWeek; ahead: RvWeek }>;
  advance(opts?: { confirmed?: boolean }): Promise<RvResponse>;
  recordStatus(
    slug: string,
    expected: string,
    next: string,
    opts?: { confirmOpenMilestones?: boolean },
  ): Promise<RvResponse>;
  recordNextAction(slug: string, expected: string | null, next: string | null): Promise<RvResponse>;
  recordMilestoneDone(slug: string, ref: { index: number; raw: string }): Promise<RvResponse>;
  recordMilestoneAdded(
    slug: string,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<RvResponse>;
  recordStructure(
    slug: string,
    field: "outcome" | "dri" | "next-action",
    expected: string | null,
    next: string | null,
  ): Promise<RvResponse>;
  recordNoChange(slug: string): Promise<RvResponse>;
  recordFollowUp(ref: RvWaitingRef): Promise<RvResponse>;
  recordReceived(ref: RvWaitingRef): Promise<RvResponse>;
  recordLeft(ref: RvWaitingRef | { slug: string }): Promise<RvResponse>;
  /**
   * The top three's own verbs, reached through the review's surface.
   *
   * Not review-specific wrappers: the same calls the top-three window makes, so
   * the cap and the writable window behave identically on both surfaces.
   */
  addOutcome(text: string, week: string): Promise<{ ok: boolean; message?: string }>;
  completeOutcome(ref: { week: string; index: number; raw: string }): Promise<{
    ok: boolean;
    message?: string;
  }>;
  goTo(step: RvStep): Promise<RvResponse>;
  openSort(): void;
  draftSummary(): Promise<RvDraft>;
  complete(input: {
    note?: string | null;
    summary?: { text: string; provider: string };
  }): Promise<RvResponse>;
  dismiss(): void;
  onRefresh(handler: () => void): void;
  onVaultChanged(handler: () => void): void;
  onInboxChanged(handler: () => void): void;
}

const rvwp = (window as unknown as { waypoint: { review: RvApi } }).waypoint.review;

function rv$(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el;
}

const RV_STEPS: RvStep[] = ["inbox", "projects", "waiting", "top-three"];
const RV_LABELS: Record<RvStep, string> = {
  inbox: "Inbox",
  projects: "Projects",
  waiting: "Waiting for",
  "top-three": "Top three",
};

let rvReview: RvReview | null = null;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function rvRenderRail(review: RvReview): void {
  const rail = rv$("rail");
  rail.replaceChildren();

  const at = RV_STEPS.indexOf(review.step);
  RV_STEPS.forEach((step, index) => {
    const chip = document.createElement("span");
    chip.className = "step";
    if (review.status === "complete" || index < at) chip.classList.add("passed");
    if (review.status !== "complete" && index === at) chip.classList.add("current");
    chip.textContent = RV_LABELS[step];
    rail.append(chip);
  });
}

function rvShowStep(step: RvStep | "complete"): void {
  for (const name of [...RV_STEPS, "complete"]) {
    const section = document.getElementById(`step-${name}`);
    if (section) section.hidden = name !== step;
  }
}

async function rvRenderInbox(): Promise<void> {
  const { count, notice } = await rvwp.inboxStep();
  rv$("inbox-count").textContent =
    count === 0
      ? "Your inbox is clear."
      : `${count} item${count === 1 ? "" : "s"} sitting in your inbox.`;

  // The policy module complaining about its own configuration, in its own
  // words. Shown, never acted on: a typo in `policy.md` must not stop the
  // ritual, so this goes in its own quiet line rather than the error slot
  // (FR-084).
  rv$("problems").textContent = notice;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const RV_STATUSES = ["active", "waiting", "parked", "done"];

const RV_GAP_LABELS: Record<string, string> = {
  outcome: "no outcome",
  milestones: "no milestones",
  "next-action": "no next action",
};

function rvEl(tag: string, className?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function rvButton(label: string, onClick: () => Promise<void>, className?: string): HTMLElement {
  const button = document.createElement("button");
  button.textContent = label;
  if (className !== undefined) button.className = className;
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
}

/**
 * One project, with everything the user needs to decide about it.
 *
 * Nothing here computes: the gaps, the DRI signal, the stale flag and its
 * wording all arrive decided (FR-024, FR-025).
 */
function rvProjectCard(entry: RvWalkEntry): HTMLElement {
  const { project } = entry;
  const card = rvEl("div", "project-card");

  card.append(rvEl("h3", undefined, project.title));

  const since = project.statusSince === null ? "" : ` since ${project.statusSince}`;
  card.append(rvEl("div", "muted", `${project.status}${since} · ${project.slug}`));

  if (entry.stale !== null) {
    // Policy's own words, day count included. A prompt and nothing more: no
    // status is changed here whatever the user answers (FR-022b).
    const stale = rvEl("div", "stale", entry.stale.reason);
    card.append(stale);
  }

  const flags: string[] = project.gaps.map((g) => RV_GAP_LABELS[g] ?? g);
  if (project.needsDri) flags.push("no DRI named");
  if (project.dri.resolution === "ambiguous") flags.push(`DRI is ambiguous (${project.dri.raw ?? ""})`);
  if (flags.length > 0) card.append(rvEl("div", "muted", flags.join(" · ")));

  card.append(rvEl("div", undefined, `Outcome: ${entry.outcome ?? "—"}`));
  card.append(rvEl("div", undefined, `Next action: ${entry.nextAction ?? "—"}`));
  card.append(
    rvEl("div", "muted", `DRI: ${project.dri.raw ?? "—"} (${project.dri.resolution})`),
  );

  card.append(rvMilestones(entry));
  card.append(rvProjectActions(entry));
  return card;
}

function rvMilestones(entry: RvWalkEntry): HTMLElement {
  const list = rvEl("ul");
  for (const milestone of entry.milestones) {
    const item = rvEl("li");
    item.append(
      rvEl(
        "span",
        milestone.done ? "muted" : undefined,
        `${milestone.done ? "✓" : "○"} ${milestone.definitionOfDone}`,
      ),
    );
    if (!milestone.done) {
      item.append(
        rvButton("Mark done", async () => {
          await rvRecord(() =>
            rvwp.recordMilestoneDone(entry.project.slug, {
              index: milestone.index,
              raw: milestone.raw,
            }),
          );
        }),
      );
    }
    list.append(item);
  }

  const add = rvEl("li");
  const text = document.createElement("input");
  text.type = "text";
  text.placeholder = "A milestone this project needs";
  add.append(text);
  add.append(
    rvButton("Add milestone", async () => {
      if (text.value.trim().length === 0) return;
      await rvRecord(() => rvwp.recordMilestoneAdded(entry.project.slug, text.value, null));
    }),
  );
  list.append(add);
  return list;
}

function rvProjectActions(entry: RvWalkEntry): HTMLElement {
  const slug = entry.project.slug;
  const actions = rvEl("div", "project-actions");

  const next = document.createElement("input");
  next.type = "text";
  next.value = entry.nextAction ?? "";
  next.placeholder = "What happens next";
  actions.append(next);
  actions.append(
    rvButton("Save next action", async () => {
      await rvRecord(() =>
        rvwp.recordNextAction(slug, entry.nextAction, next.value.trim() === "" ? null : next.value),
      );
    }),
  );

  if (entry.project.gaps.includes("outcome")) {
    const outcome = document.createElement("input");
    outcome.type = "text";
    outcome.placeholder = "What done looks like";
    actions.append(outcome);
    actions.append(
      rvButton("Save outcome", async () => {
        if (outcome.value.trim().length === 0) return;
        await rvRecord(() => rvwp.recordStructure(slug, "outcome", entry.outcome, outcome.value));
      }),
    );
  }

  if (entry.project.needsDri) {
    const dri = document.createElement("input");
    dri.type = "text";
    dri.placeholder = "Who is responsible";
    actions.append(dri);
    actions.append(
      rvButton("Save DRI", async () => {
        if (dri.value.trim().length === 0) return;
        await rvRecord(() => rvwp.recordStructure(slug, "dri", entry.project.dri.raw, dri.value));
      }),
    );
  }

  const statuses = rvEl("div", "statuses");
  for (const status of RV_STATUSES) {
    if (status === entry.project.status) continue;
    statuses.append(
      rvButton(`Move to ${status}`, async () => {
        // The WIP limit and the open-milestone confirmation both fire here,
        // exactly as they do in the projects window. Neither is re-implemented:
        // the refusal comes back as the owning verb phrased it.
        await rvRecord(
          () => rvwp.recordStatus(slug, entry.project.status, status),
          () => rvwp.recordStatus(slug, entry.project.status, status, { confirmOpenMilestones: true }),
        );
      }),
    );
  }
  actions.append(statuses);

  const decisions = rvEl("div", "decisions");
  decisions.append(
    rvButton("Nothing to change", async () => {
      await rvRecord(() => rvwp.recordNoChange(slug));
    }),
  );
  if (entry.stale !== null) {
    decisions.append(
      rvButton("Leave it waiting", async () => {
        await rvRecord(() => rvwp.recordLeft({ slug }));
      }, "link"),
    );
  }
  actions.append(decisions);

  return actions;
}

/**
 * Performs one recording verb and re-renders.
 *
 * `confirm` is the same call with the confirmation flag set — offered only when
 * the core came back asking, and never sent on its own.
 */
async function rvRecord(
  attempt: () => Promise<RvResponse>,
  confirm?: () => Promise<RvResponse>,
): Promise<void> {
  rvClearMessages();
  const result = await attempt();

  if (!result.ok) {
    rvShowRefusal(
      result,
      confirm === undefined
        ? undefined
        : async () => {
            await rvRecord(confirm);
          },
    );
    // The refusal may be about something that changed on disk, so re-read
    // rather than leaving the stale view the user was acting on.
    await rvRenderCurrentStep();
    return;
  }
  await rvRender();
}

/** Re-reads whichever step is on screen. Used after a refusal. */
async function rvRenderCurrentStep(): Promise<void> {
  if (rvReview?.step === "projects") await rvRenderProjects();
  if (rvReview?.step === "waiting") await rvRenderWaiting();
}

async function rvRenderProjects(): Promise<void> {
  const walk = await rvwp.projectStep();
  const host = rv$("project");
  host.replaceChildren();

  if (walk.length === 0) {
    rv$("walk-position").textContent = "No active or waiting projects to walk.";
    return;
  }

  // The position is derived, not stored: the next project is simply the first
  // with no record against it, which stays right when the walk set changes
  // mid-review (research R3).
  const entry = walk.find((e) => !e.reviewed);
  const done = walk.filter((e) => e.reviewed).length;

  if (entry === undefined) {
    rv$("walk-position").textContent = `All ${walk.length} walked. Next when you are ready.`;
    return;
  }

  rv$("walk-position").textContent = `${done + 1} of ${walk.length}`;
  host.append(rvProjectCard(entry));
}

// ---------------------------------------------------------------------------
// The waiting-for step
// ---------------------------------------------------------------------------

/**
 * Outstanding delegated work, with the quiet ones surfaced.
 *
 * Three actions, all of them notes to self: chased, arrived, or seen and left.
 * **None of them sends anything to anyone.** There is no channel here that
 * could — the client has no way to express contacting an owner, which is the
 * point (FR-046).
 */
async function rvRenderWaiting(): Promise<void> {
  const { total, stale, unreadable } = await rvwp.waitingStep();

  // Shown whether or not anything is stale: a line nobody can read is worth
  // knowing about on a quiet week too.
  rv$("waiting-unreadable").hidden = unreadable.length === 0;
  rv$("waiting-unreadable-list").replaceChildren(
    ...unreadable.map((u) => rvEl("li", "muted", `line ${u.line}: ${u.raw}`)),
  );

  rv$("waiting-total").textContent =
    total === 0
      ? "Nothing outstanding."
      : `${total} outstanding · ${stale.length} gone quiet`;

  const list = rv$("waiting-stale");
  list.replaceChildren();

  for (const entry of stale) {
    const item = rvEl("li");

    item.append(rvEl("div", undefined, `@${entry.item.owner} — ${entry.item.text}`));
    // Policy's words for the silence; the total age beside them, because
    // "waiting since May, chased weekly" is a different situation from
    // "waiting since May, never mentioned again".
    item.append(rvEl("div", "stale", entry.reason));
    item.append(
      rvEl(
        "div",
        "muted",
        `waiting since ${entry.item.since}` +
          (entry.item.actions.length === 0
            ? ", never chased"
            : ` · ${entry.item.actions.map((a) => `${a.kind} ${a.on}`).join(" · ")}`),
      ),
    );

    const ref = { index: entry.item.index, raw: entry.item.raw };
    const actions = rvEl("div", "project-actions");
    actions.append(
      rvButton("I followed up", async () => {
        await rvRecord(() => rvwp.recordFollowUp(ref));
      }),
    );
    actions.append(
      rvButton("It arrived", async () => {
        await rvRecord(() => rvwp.recordReceived(ref));
      }),
    );
    actions.append(
      rvButton(
        "Leave it",
        async () => {
          await rvRecord(() => rvwp.recordLeft(ref));
        },
        "link",
      ),
    );
    item.append(actions);

    list.append(item);
  }
}

// ---------------------------------------------------------------------------
// The week ahead
// ---------------------------------------------------------------------------

/**
 * What actually got done, then what next week is for.
 *
 * The reviewed week is editable — a Friday review is exactly when a straggler
 * gets marked done (FR-048). The week ahead **starts empty and stays empty
 * until the user types something**: nothing that slipped is carried forward,
 * suggested, pre-filled, or ranked. Deciding again is the point (FR-053).
 *
 * Both write through the top three's own verbs, so the cap and the refusals are
 * the same ones the top-three window gets.
 */
async function rvRenderTopThree(): Promise<void> {
  const { reviewed, ahead } = await rvwp.topThreeStep();
  rvAheadId = ahead.id;

  rv$("reviewed-week").textContent = `${reviewed.id} — what you set out to do`;

  const done = rv$("reviewed-outcomes");
  done.replaceChildren();
  if (reviewed.outcomes.length === 0) {
    done.append(rvEl("li", "muted", "Nothing was set for this week."));
  }
  for (const outcome of reviewed.outcomes) {
    const item = rvEl("li");
    item.append(
      rvEl(
        "span",
        outcome.done ? "muted" : undefined,
        `${outcome.done ? "✓" : "○"} ${outcome.text}` +
          (outcome.completedOn === null ? "" : ` — done ${outcome.completedOn}`),
      ),
    );
    if (!outcome.done) {
      item.append(
        rvButton("Actually, done", async () => {
          rvClearMessages();
          const result = await rvwp.completeOutcome({
            week: reviewed.id,
            index: outcome.index,
            raw: outcome.raw,
          });
          if (!result.ok) rv$("error").textContent = result.message ?? "";
          await rvRenderTopThree();
        }),
      );
    }
    done.append(item);
  }

  rv$("ahead-week").textContent = `${ahead.id} — what matters next week`;

  const next = rv$("ahead-outcomes");
  next.replaceChildren();
  for (const outcome of ahead.outcomes) {
    next.append(rvEl("li", undefined, `○ ${outcome.text}`));
  }
}

/** The week the add box targets. Set by the render that drew it. */
let rvAheadId = "";

async function rvAddAhead(): Promise<void> {
  const input = rv$("ahead-text") as HTMLInputElement;
  const text = input.value;
  if (text.trim().length === 0) return;

  rvClearMessages();
  input.value = "";

  // The top three's own verb, so the cap fires here exactly as it does in the
  // top-three window. The review is not a second way to write an outcome.
  const result = await rvwp.addOutcome(text, rvAheadId);
  if (!result.ok) {
    rv$("error").textContent = result.message ?? "";
    if (input.value === "") input.value = text;
  }
  await rvRenderTopThree();
}

/**
 * What a summary provider would be sent.
 *
 * Shown even in the shipped no-provider configuration, where it says what
 * *would* leave the machine if one were configured. Plain data the client
 * already holds, so showing it costs nothing and hiding it would be a choice
 * (FR-109).
 */
function rvRenderRecord(review: RvReview): void {
  rv$("record-json").textContent = JSON.stringify(
    {
      week: review.week,
      started: review.started,
      inbox: review.inbox,
      projects: review.projects,
      waiting: review.waiting,
      topThree: review.topThree,
      note: review.note,
    },
    null,
    2,
  );
}

/**
 * The permanent record: every past review, newest first.
 *
 * Outside the step sequence on purpose. Looking last month up is not part of
 * running this week, and a user opens this window to read as often as to work
 * (FR-071). Core sorts and identifies them; this renders the list and, on
 * selection, the week itself.
 *
 * There is no edit, re-run, or delete affordance anywhere in here, and adding
 * one would be the application offering to rewrite history it promised to keep
 * (FR-011, FR-069).
 */
async function rvRenderPast(): Promise<void> {
  const weeks = await rvwp.history();

  // Hidden rather than empty: a new user has no past, and an empty disclosure
  // is a promise of something missing.
  rv$("past-panel").hidden = weeks.length === 0;
  rv$("past-record").textContent = "";

  rv$("past-list").replaceChildren(
    ...weeks.map((summary) => {
      const label =
        summary.status === "complete"
          ? `${summary.week} — reviewed ${summary.completed ?? ""}`
          : // Never backfilled and never completed on the user's behalf, so it
            // is listed as what it is (FR-060).
            `${summary.week} — unfinished`;

      const row = rvEl("li", "past-week", label);
      row.addEventListener("click", () => {
        void rvShowPast(summary.week);
      });
      return row;
    }),
  );
}

/** One past week, read as it stands on disk and shown as a record. */
async function rvShowPast(week: string): Promise<void> {
  const review = await rvwp.get(week);
  if (review === null) return;

  const lines: string[] = [`${review.week} — ${review.status === "complete" ? `reviewed ${review.completed ?? ""}` : "unfinished"}`];

  if (review.inbox !== null) {
    lines.push("", `Inbox: ${review.inbox.count} at ${review.inbox.on}`);
  }
  if (review.projects.length > 0) {
    lines.push("", "Projects:");
    for (const p of review.projects) {
      lines.push(`  ${p.slug} — ${p.action}${p.detail === null ? "" : ` ${p.detail}`}`);
    }
  }
  if (review.waiting.length > 0) {
    lines.push("", "Waiting for:");
    for (const w of review.waiting) {
      lines.push(`  ${w.owner} — ${w.text} — ${w.action} after ${w.days}d`);
    }
  }
  if (review.topThree !== null) {
    const t = review.topThree;
    lines.push("", "Top three:");
    for (const o of t.finished) lines.push(`  done — ${o}`);
    for (const o of t.slipped) lines.push(`  slipped — ${o}`);
    for (const o of t.committed) lines.push(`  committed (${t.forWeek ?? "?"}) — ${o}`);
  }
  // The user's own words last, and the generated ones plainly apart from them,
  // exactly as they sit in the file (FR-106, FR-107).
  lines.push("", "Note:", review.note === null ? "  (none written)" : `  ${review.note}`);
  if (review.summary !== null) {
    lines.push("", `Summary (generated by ${review.summary.provider}):`, `  ${review.summary.text}`);
  }

  rv$("past-record").textContent = lines.join("\n");
}

async function rvRender(): Promise<void> {
  rvReview = await rvwp.current();
  await rvRenderPast();

  if (rvReview === null) {
    rv$("week-id").textContent = "No review started for this week.";
    rv$("rail").replaceChildren();
    rvShowStep("complete");
    for (const name of RV_STEPS) {
      const section = document.getElementById(`step-${name}`);
      if (section) section.hidden = true;
    }
    rv$("step-complete").hidden = true;
    (rv$("advance") as HTMLButtonElement).textContent = "Start this week's review";
    rv$("complete").hidden = true;
    rv$("back").hidden = true;
    return;
  }

  const review = rvReview;
  rv$("week-id").textContent =
    review.status === "complete"
      ? `${review.week} — reviewed ${review.completed ?? ""}`
      : `${review.week} — started ${review.started}`;

  rvRenderRail(review);
  rvRenderRecord(review);

  if (review.status === "complete") {
    // A finished review is a record: no affordance to re-run or overwrite it
    // in the app, while the file stays hand-editable (FR-011).
    rvShowStep("complete");
    (rv$("note") as HTMLTextAreaElement).value = review.note ?? "";
    (rv$("note") as HTMLTextAreaElement).disabled = true;
    rv$("advance").hidden = true;
    rv$("complete").hidden = true;
    rv$("back").hidden = true;
    rv$("summary-panel").hidden = true;
    return;
  }

  rv$("advance").hidden = false;
  rv$("back").hidden = RV_STEPS.indexOf(review.step) === 0;
  (rv$("advance") as HTMLButtonElement).textContent = "Next";

  const last = review.step === "top-three";
  rv$("complete").hidden = !last;
  rv$("advance").hidden = last;

  rvShowStep(review.step);
  // On the last step the note and the finish button sit *below* the week
  // ahead rather than replacing it. They shared a screen until US5 gave the
  // top-three step something to show, at which point swapping one for the
  // other meant the user could never see the week they were committing to.
  if (last) rv$("step-complete").hidden = false;
  if (review.step === "inbox") await rvRenderInbox();
  if (review.step === "projects") await rvRenderProjects();
  if (review.step === "waiting") await rvRenderWaiting();
  if (review.step === "top-three") await rvRenderTopThree();
  if (last) (rv$("note") as HTMLTextAreaElement).disabled = false;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function rvClearMessages(): void {
  rv$("error").textContent = "";
  rv$("warning").textContent = "";
}

/**
 * A refusal is rendered as the core phrased it, never reworded here.
 *
 * Two refusals can be carried past: the inbox gate's warning, and the
 * open-milestone confirmation. Both come back with the answer already made —
 * this file only offers the retry the core said was available.
 */
function rvShowRefusal(
  result: Extract<RvResponse, { ok: false }>,
  retry?: () => Promise<void>,
): void {
  const offerable = result.confirmable === true || result.reason === "open-milestones";

  if (offerable) {
    rv$("warning").textContent = `${result.message} `;
    const proceed = document.createElement("button");
    proceed.textContent = "Carry on anyway";
    proceed.addEventListener("click", () => {
      void (retry ?? ((): Promise<void> => rvAdvance(true)))();
    });
    rv$("warning").append(proceed);
    return;
  }

  rv$("error").textContent = result.message;
  // Named subjects — the projects to finish or park when the WIP limit refuses
  // — are the core's, listed so the refusal is something the user can act on.
  if (result.subjects !== undefined && result.subjects.length > 0) {
    rv$("error").append(rvEl("div", "muted", result.subjects.join(" · ")));
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function rvAdvance(confirmed = false): Promise<void> {
  rvClearMessages();

  if (rvReview === null) {
    await rvwp.start();
    await rvRender();
    return;
  }

  const result = await rvwp.advance(confirmed ? { confirmed: true } : undefined);
  if (!result.ok) {
    rvShowRefusal(result);
    // The count may have changed while the warning was on screen — a sort in
    // another window, a capture — so re-read rather than trusting the view.
    if (rvReview.step === "inbox") await rvRenderInbox();
    return;
  }
  await rvRender();
}

async function rvBack(): Promise<void> {
  rvClearMessages();
  if (rvReview === null) return;

  const at = RV_STEPS.indexOf(rvReview.step);
  const previous = RV_STEPS[at - 1];
  if (previous === undefined) return;

  const result = await rvwp.goTo(previous);
  if (!result.ok) {
    rvShowRefusal(result);
    return;
  }
  await rvRender();
}

async function rvComplete(): Promise<void> {
  rvClearMessages();

  const note = (rv$("note") as HTMLTextAreaElement).value;
  const result = await rvwp.complete({ note });
  if (!result.ok) {
    rvShowRefusal(result);
    return;
  }
  await rvRender();
}

/**
 * Offers a draft, if a provider is supplied.
 *
 * With none — the shipped configuration — nothing is shown at all, rather than
 * a disabled button implying something is missing (FR-103).
 */
async function rvOfferSummary(): Promise<void> {
  const draft = await rvwp.draftSummary();
  const panel = rv$("summary-panel");

  if (!draft.available) {
    panel.hidden = true;
    if (draft.failure !== undefined) {
      rv$("warning").textContent = `The summary provider did not answer (${draft.failure}). The review can still be finished.`;
    }
    return;
  }

  panel.hidden = false;
  rv$("summary-draft").textContent = draft.text;

  rv$("summary-accept").addEventListener(
    "click",
    () => {
      void (async (): Promise<void> => {
        const note = (rv$("note") as HTMLTextAreaElement).value;
        // Acceptance is explicit and is what carries the text into the log —
        // nothing is recorded by having asked for it (FR-105).
        const result = await rvwp.complete({
          note,
          summary: { text: draft.text, provider: draft.provider },
        });
        if (!result.ok) rvShowRefusal(result);
        await rvRender();
      })();
    },
    { once: true },
  );

  rv$("summary-decline").addEventListener(
    "click",
    () => {
      panel.hidden = true;
    },
    { once: true },
  );
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

rv$("advance").addEventListener("click", () => {
  void rvAdvance();
});

rv$("back").addEventListener("click", () => {
  void rvBack();
});

rv$("complete").addEventListener("click", () => {
  void rvComplete();
});

rv$("ahead-add").addEventListener("click", () => {
  void rvAddAhead();
});

rv$("ahead-text").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void rvAddAhead();
});

rv$("open-sort").addEventListener("click", () => {
  // Navigation only. Sorting is Feature 2's surface, and returning simply
  // re-reads the count (FR-016).
  rvwp.openSort();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") rvwp.dismiss();
});

rvwp.onRefresh(() => {
  void rvRender();
});

// A vault file changed — a project edited in another window, a hand-edit, or a
// future API client. Re-reading is the only account of the file that can be
// trusted anyway.
rvwp.onVaultChanged(() => {
  void rvRender();
});

// Re-derive the inbox count when the window regains focus, which is what
// happens on the way back from sorting.
window.addEventListener("focus", () => {
  if (rvReview?.step === "inbox") void rvRenderInbox();
});

// And on the signal itself, which does not depend on focus semantics. `inbox.md`
// has its own adapter and its own change signal, so a vault change never fires
// for it; the focus handler above covers the ordinary trip back from sorting,
// and this covers a write that lands while this window still has focus (FR-016).
rvwp.onInboxChanged(() => {
  if (rvReview?.step === "inbox") void rvRenderInbox();
});

void rvRender().then(() => rvOfferSummary());
