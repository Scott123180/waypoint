import { contextBridge, ipcRenderer } from "electron";

export type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

export interface Notice {
  id?: string;
  level: "info" | "error";
  message: string;
  recoverableText?: string;
}

/**
 * The entire surface the renderer can reach. Nothing else crosses the bridge.
 */
export type TranscribeResponse =
  | { status: "ok"; text: string }
  | { status: "no-speech" }
  | { status: "failed"; message: string };

const api = {
  submit(text: string, source: "typed" | "dictated"): Promise<SubmitResponse> {
    return ipcRenderer.invoke("capture:submit", text, source);
  },

  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResponse> {
    return ipcRenderer.invoke("capture:transcribe", samples, sampleRate);
  },

  /** Test seam: lets the E2E suite drive dictation without a microphone. */
  onFakeDictation(callback: (result: TranscribeResponse) => void): void {
    ipcRenderer.on("capture:fake-dictation", (_event, result: TranscribeResponse) =>
      callback(result),
    );
  },

  undo(id: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke("capture:undo", id);
  },

  ackNotice(id: string): void {
    ipcRenderer.send("capture:notice-ack", id);
  },

  dismiss(): void {
    ipcRenderer.send("capture:dismiss");
  },

  /**
   * Dictation began or ended — the microphone is open, or a transcript is still
   * on its way back.
   *
   * Main needs this because clicking away hides the box, and hiding does not
   * stop a recording: the box has to stay put until dictation is finished with
   * it.
   */
  dictating(active: boolean): void {
    ipcRenderer.send("capture:dictating", active);
  },

  onReset(callback: (mode: "type" | "dictate") => void): void {
    ipcRenderer.on("capture:reset", (_event, mode: "type" | "dictate" = "type") => callback(mode));
  },

  /** Dictation asked for on a box that was already open, so nothing is reset. */
  onStartDictation(callback: () => void): void {
    ipcRenderer.on("capture:start-dictation", () => callback());
  },

  onNotice(callback: (notice: Notice) => void): void {
    ipcRenderer.on("capture:notice", (_event, notice: Notice) => callback(notice));
  },
};

/**
 * Sort channels. Pass-throughs only — the renderer has no way to express what
 * a destination *is*, only which one the user picked.
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */
export interface ItemRef {
  start: number;
  end: number;
  raw: string;
}

export type SortDecision =
  | { to: "project"; slug: string }
  | { to: "project"; createTitle: string }
  | { to: "area"; slug: string }
  | { to: "area"; createTitle: string }
  | { to: "waiting"; owner: string }
  | { to: "calendar" }
  | { to: "trash" };

export type SortNextResponse =
  | { item: { text: string; capturedAt: string | null; ref: ItemRef } }
  | { item: null };

export type SortDecideResponse =
  | { ok: true; destination: string }
  | { ok: false; reason: string; message: string };

const sortApi = {
  next(): Promise<SortNextResponse> {
    return ipcRenderer.invoke("sort:next");
  },

  destinations(): Promise<{
    projects: { slug: string; title: string }[];
    areas: { slug: string; title: string }[];
  }> {
    return ipcRenderer.invoke("sort:destinations");
  },

  count(): Promise<number> {
    return ipcRenderer.invoke("sort:count");
  },

  decide(ref: ItemRef, decision: SortDecision): Promise<SortDecideResponse> {
    return ipcRenderer.invoke("sort:decide", ref, decision);
  },

  dismiss(): void {
    ipcRenderer.send("sort:dismiss");
  },

  onRefresh(callback: () => void): void {
    ipcRenderer.on("sort:refresh", () => callback());
  },

  /**
   * The inbox changed while this view was open.
   *
   * The channel is `inbox:changed`, not `sort:something`: it is named for the
   * file, so capture, undo, sort, and any client added later all raise the one
   * event, and a future view subscribes to it without a new channel.
   */
  onInboxChanged(callback: () => void): void {
    ipcRenderer.on("inbox:changed", () => callback());
  },

  onRecovered(callback: (report: { completed: number; abandoned: number }) => void): void {
    ipcRenderer.on("sort:recovered", (_event, report) => callback(report));
  },

  onNotice(callback: (notice: Notice) => void): void {
    ipcRenderer.on("sort:notice", (_event, notice: Notice) => callback(notice));
  },
};

/**
 * Project and area channels. Pass-throughs only.
 *
 * The renderer cannot write a file, set a completion date, compute the
 * structure flag, or decide which projects are active — those verbs simply do
 * not exist here.
 *
 * See specs/003-project-structure/contracts/ipc-projects.md
 */
export type ProjectStatus = "active" | "parked" | "waiting" | "done";
export type AreaStatus = "active" | "parked";
export type StructureGap = "outcome" | "milestones" | "next-action";
export type ProjectFieldName = "outcome" | "next-action" | "dri" | "title";

export interface MilestoneRef {
  index: number;
  raw: string;
}

export interface MilestoneView {
  index: number;
  definitionOfDone: string;
  verifier: string | null;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

export interface UnprocessedView {
  text: string;
  capturedAt: string | null;
  index: number;
  raw: string;
}

export interface ProjectView {
  slug: string;
  title: string;
  status: ProjectStatus;
  outcome: string | null;
  nextAction: string | null;
  /** The DRI as written in the file — free text, rendered as-is. */
  dri: string | null;
  /** How that name relates to the user. Decided by the core (Feature 4). */
  driResolution: ResolvedDriView;
  /** No DRI named. Its own signal, never part of `gaps` (Feature 4). */
  needsDri: boolean;
  milestones: MilestoneView[];
  completedOn: string | null;
  unprocessed: UnprocessedView[];
  /** Derived by the core and sent with the project, so status cannot affect it. */
  gaps: StructureGap[];
  /** Reported by the core; the view renders these rather than counting (FR-017). */
  milestonesDone: number;
  milestonesTotal: number;
}

export type DriResolution = "mine" | "theirs" | "unassigned" | "ambiguous";

export interface ResolvedDriView {
  resolution: DriResolution;
  raw: string | null;
  collidesWith?: string[];
}

export interface ProjectSummaryView {
  slug: string;
  title: string;
  status: ProjectStatus;
  milestonesDone: number;
  milestonesTotal: number;
  gaps: StructureGap[];
  completedOn: string | null;
  /** Feature 4: who the DRI is, relative to the user. Decided by the core. */
  dri: ResolvedDriView;
  /** Feature 4: its own signal, never folded into `gaps`. */
  needsDri: boolean;
}

export interface AreaView {
  slug: string;
  title: string;
  status: AreaStatus;
  rawStatus: string;
  unprocessed: UnprocessedView[];
}

export type ProjectResponse =
  | { ok: true; project: ProjectView }
  | {
      ok: false;
      reason: string;
      message: string;
      /** The still-open milestones. Only for `open-milestones`. */
      open?: string[];
      /** Projects to finish or park. Only for `wip-limit` — never `open`. */
      subjects?: string[];
    };

export type AreaResponse =
  | { ok: true; area: AreaView }
  | { ok: false; reason: string; message: string };

const projectsApi = {
  /** The active list, as the core defines it. The renderer does not filter. */
  listActive(): Promise<ProjectSummaryView[]> {
    return ipcRenderer.invoke("projects:list-active");
  },

  /** Finished projects, likewise decided by the core. */
  listCompleted(): Promise<ProjectSummaryView[]> {
    return ipcRenderer.invoke("projects:list-completed");
  },

  list(): Promise<ProjectSummaryView[]> {
    return ipcRenderer.invoke("projects:list");
  },

  get(slug: string): Promise<ProjectView | null> {
    return ipcRenderer.invoke("projects:get", slug);
  },

  create(title: string): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:create", title);
  },

  setField(
    slug: string,
    field: ProjectFieldName,
    expected: string | null,
    next: string | null,
  ): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:set-field", slug, field, expected, next);
  },

  setStatus(slug: string, expected: ProjectStatus, next: ProjectStatus): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:set-status", slug, expected, next);
  },

  addMilestone(slug: string, definitionOfDone: string, verifier: string | null): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:add-milestone", slug, definitionOfDone, verifier);
  },

  editMilestone(
    slug: string,
    ref: MilestoneRef,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:edit-milestone", slug, ref, definitionOfDone, verifier);
  },

  removeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:remove-milestone", slug, ref);
  },

  completeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:complete-milestone", slug, ref);
  },

  reopenMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:reopen-milestone", slug, ref);
  },

  /**
   * Refuses with `open-milestones` unless confirmed. The renderer renders the
   * refusal and calls again with the flag — it never decides when to ask.
   */
  complete(slug: string, opts?: { confirmOpenMilestones?: boolean }): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:complete", slug, opts);
  },

  reopen(slug: string, to: Exclude<ProjectStatus, "done">): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:reopen", slug, to);
  },

  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<ProjectResponse> {
    return ipcRenderer.invoke("projects:dismiss-unprocessed", slug, index, expectedRaw);
  },

  dismiss(): void {
    ipcRenderer.send("projects:dismiss");
  },

  /**
   * How much the user is driving, and whether there is room for more.
   *
   * A finished answer: the count comes from the core and the comparison from
   * the policy module. The renderer must not recompute either (Feature 4).
   */
  load(): Promise<ProjectLoad> {
    return ipcRenderer.invoke("projects:load");
  },

  /** The window was shown. Redraw everything. */
  onRefresh(callback: () => void): void {
    ipcRenderer.on("projects:refresh", () => callback());
  },

  /**
   * A project or area file changed while this view was open.
   *
   * Named for the fact, never the cause — a writer added later needs no new
   * channel. Separate from `inbox:changed`, which fires on every capture and is
   * noise here.
   */
  onVaultChanged(callback: () => void): void {
    ipcRenderer.on("vault:changed", () => callback());
  },
};

const areasApi = {
  list(): Promise<{ slug: string; title: string; status: AreaStatus; rawStatus: string }[]> {
    return ipcRenderer.invoke("areas:list");
  },

  get(slug: string): Promise<AreaView | null> {
    return ipcRenderer.invoke("areas:get", slug);
  },

  create(title: string): Promise<AreaResponse> {
    return ipcRenderer.invoke("areas:create", title);
  },

  setTitle(slug: string, expected: string, next: string): Promise<AreaResponse> {
    return ipcRenderer.invoke("areas:set-title", slug, expected, next);
  },

  setStatus(slug: string, expected: AreaStatus, next: AreaStatus): Promise<AreaResponse> {
    return ipcRenderer.invoke("areas:set-status", slug, expected, next);
  },

  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<AreaResponse> {
    return ipcRenderer.invoke("areas:dismiss-unprocessed", slug, index, expectedRaw);
  },
};

/**
 * The weekly top three.
 *
 * Note what is missing: nothing here computes the current week, decides whether
 * a week may be edited, or formats a refusal. The renderer asks and renders;
 * `Week.current` and every message arrive from the core.
 */
const topThreeApi = {
  /** The week the clock is in. Empty rather than absent when never set. */
  current(): Promise<TopThreeWeek> {
    return ipcRenderer.invoke("top-three:current");
  },

  /** Every week on file, newest first, current one included. */
  history(): Promise<TopThreeWeek[]> {
    return ipcRenderer.invoke("top-three:history");
  },

  /**
   * The two weeks that may be written: this one and the next.
   *
   * Asked for rather than worked out. Which weeks are writable is a rule, and
   * a renderer computing it would be a client holding one.
   */
  writableWeeks(): Promise<{ current: TopThreeWeek; ahead: TopThreeWeek }> {
    return ipcRenderer.invoke("top-three:writable");
  },

  /**
   * Refuses `outcome-cap` at the configured maximum.
   *
   * `week` targets the current week when omitted. The writable window is this
   * week and the next; anything further out refuses with `future-week` and a
   * message naming the weeks that work.
   */
  add(text: string, week?: string): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:add", text, week);
  },

  edit(ref: TopThreeRef, text: string): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:edit", ref, text);
  },

  remove(ref: TopThreeRef): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:remove", ref);
  },

  complete(ref: TopThreeRef): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:complete", ref);
  },

  reopen(ref: TopThreeRef): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:reopen", ref);
  },

  dismiss(): void {
    ipcRenderer.send("top-three:dismiss");
  },

  /** Redraw everything — sent when the window opens. */
  onRefresh(handler: () => void): void {
    ipcRenderer.on("top-three:refresh", () => handler());
  },

  /**
   * A vault file changed while this view was open.
   *
   * The same generic signal the projects view listens to, and deliberately not
   * a `top-three:changed` of its own: `top-three.md` is written through the
   * same `VaultStore`, so a hand-edit, another window, or a future API client
   * all arrive here with nothing to remember (research R9).
   */
  onVaultChanged(handler: () => void): void {
    ipcRenderer.on("vault:changed", () => handler());
  },
};

export interface ProjectLoad {
  driving: number;
  subjects: string[];
  hasRoom: boolean;
  message: string;
  identityConfigured: boolean;
}

export interface TopThreeOutcome {
  index: number;
  text: string;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

export interface TopThreeWeek {
  id: string;
  outcomes: TopThreeOutcome[];
  current: boolean;
  /** Whether the core will accept writes to this week. Decided there, not here. */
  writable: boolean;
}

export interface TopThreeRef {
  week: string;
  index: number;
  raw: string;
}

export type TopThreeResponse =
  | { ok: true; week: TopThreeWeek }
  | { ok: false; reason: string; message: string };

export interface ReviewStepRecordShape {
  count?: number;
  verdict?: string;
  on?: string;
}

export interface ReviewShape {
  week: string;
  started: string;
  step: "inbox" | "projects" | "waiting" | "top-three";
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
  topThree: {
    finished: string[];
    slipped: string[];
    committed: string[];
    forWeek: string | null;
  } | null;
  note: string | null;
  summary: { text: string; provider: string } | null;
}

export interface ReviewSummaryShape {
  week: string;
  started: string;
  status: "in-progress" | "complete";
  completed: string | null;
}

export type ReviewResponse =
  | { ok: true; review: ReviewShape }
  | {
      ok: false;
      reason: string;
      message: string;
      confirmable?: boolean;
      /** The still-open milestones, when the refusal is the completion confirmation. */
      open?: string[];
      /** Named items to act on, when the refusal is the WIP limit. */
      subjects?: string[];
    };

/**
 * One project as the walk presents it.
 *
 * Everything here is computed by the core. The renderer decides nothing about
 * which projects are walked, whether one is stale, how many days that is, or
 * what to say about it — it renders `stale.reason` as the policy module worded
 * it (FR-023, FR-025).
 */
export interface WalkEntryShape {
  project: {
    slug: string;
    title: string;
    status: string;
    milestonesDone: number;
    milestonesTotal: number;
    gaps: string[];
    completedOn: string | null;
    dri: { resolution: string; raw: string | null; collidesWith?: string[] };
    needsDri: boolean;
    statusSince: string | null;
  };
  outcome: string | null;
  nextAction: string | null;
  milestones: {
    index: number;
    definitionOfDone: string;
    verifier: string | null;
    done: boolean;
    completedOn: string | null;
    raw: string;
  }[];
  stale: { reason: string; days: number } | null;
  reviewed: boolean;
}

export type SummaryDraft =
  | { available: false; failure?: string }
  | { available: true; text: string; provider: string };

/**
 * One delegated item the staleness rule flagged.
 *
 * `days` is how long it has gone *untouched* — chasing it counts as touching
 * it — while `item.since` is how long it has been outstanding in total. Both
 * are shown, because "waiting three months, chased weekly" is a different
 * situation from "waiting three months, never mentioned again".
 */
export interface StaleWaitingShape {
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

/**
 * The weekly review.
 *
 * Deliberately absent: any method that decides which step comes next, whether a
 * step may be passed, how stale something is, or how to phrase a refusal. The
 * renderer asks and renders; every message arrives from the core.
 */
const reviewApi = {
  /** The current week's review, or null when none has been started. */
  current(): Promise<ReviewShape | null> {
    return ipcRenderer.invoke("review:current");
  },

  /** Starts this week's review, or resumes it. Idempotent. */
  start(): Promise<ReviewShape> {
    return ipcRenderer.invoke("review:start");
  },

  history(): Promise<ReviewSummaryShape[]> {
    return ipcRenderer.invoke("review:history");
  },

  get(week: string): Promise<ReviewShape | null> {
    return ipcRenderer.invoke("review:get", week);
  },

  /**
   * Derived from the file on every call, never cached.
   *
   * `notice` is the policy module's complaint about its own configuration, if
   * it has one. Rendered as a notice, never as a refusal.
   */
  inboxStep(): Promise<{ count: number; notice: string }> {
    return ipcRenderer.invoke("review:step-inbox");
  },

  /** The walk, already filtered, ordered, and flagged by the core. */
  projectStep(): Promise<WalkEntryShape[]> {
    return ipcRenderer.invoke("review:step-projects");
  },

  /** The first project with no record against it. Derived, never a stored cursor. */
  nextProject(): Promise<WalkEntryShape | null> {
    return ipcRenderer.invoke("review:next-project");
  },

  /**
   * Outstanding items, with the quiet ones already flagged by the rule.
   *
   * Deliberately absent from this whole surface: anything that sends, notifies,
   * reminds, or contacts. A follow-up is a note to self (FR-046).
   */
  waitingStep(): Promise<{
    total: number;
    stale: StaleWaitingShape[];
    unreadable: { line: number; raw: string }[];
  }> {
    return ipcRenderer.invoke("review:step-waiting");
  },

  /**
   * The reviewed week and the week ahead, both live.
   *
   * Reading, so it goes through the review's own channel: the step is a
   * juxtaposition core composes — this week's outcomes beside next week's — and
   * assembling it here from two top-three calls would put that composition in
   * the client. Writing is the other way round; see `addOutcome` below.
   */
  topThreeStep(): Promise<{ reviewed: TopThreeWeek; ahead: TopThreeWeek }> {
    return ipcRenderer.invoke("review:step-top-three");
  },

  /** Refuses `inbox-not-empty`; a `confirmable` refusal may be retried. */
  advance(opts?: { confirmed?: boolean }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:advance", opts);
  },

  // The recording verbs. Each performs the change through the service that owns
  // it and then records what was decided; a refusal comes back as the owning
  // verb phrased it, WIP limit and open-milestone confirmation included.

  recordStatus(
    slug: string,
    expected: string,
    next: string,
    opts?: { confirmOpenMilestones?: boolean },
  ): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-status", slug, expected, next, opts);
  },

  recordNextAction(slug: string, expected: string | null, next: string | null): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-next-action", slug, expected, next);
  },

  recordMilestoneDone(slug: string, ref: { index: number; raw: string }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-milestone-done", slug, ref);
  },

  recordMilestoneAdded(
    slug: string,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-milestone-added", slug, definitionOfDone, verifier);
  },

  recordStructure(
    slug: string,
    field: "outcome" | "dri" | "next-action",
    expected: string | null,
    next: string | null,
  ): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-structure", slug, field, expected, next);
  },

  /** "I looked at it and there is nothing to change." A decision, and recorded. */
  recordNoChange(slug: string): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-no-change", slug);
  },

  /** Chased. The item stays outstanding and its `since` is untouched. */
  recordFollowUp(ref: { index: number; raw: string }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-follow-up", ref);
  },

  /** Arrived. The line and its history stay in the file; nothing is deleted. */
  recordReceived(ref: { index: number; raw: string }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-received", ref);
  },

  /** A stale subject surfaced and left. Records that it was seen; changes nothing. */
  recordLeft(ref: { index: number; raw: string } | { slug: string }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:record-left", ref);
  },

  goTo(step: ReviewShape["step"]): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:go-to", step);
  },

  /**
   * Opens the sort window, leaving the review where it is.
   *
   * Navigation, not sorting: Feature 2 owns that surface, and returning simply
   * re-reads the count (FR-016).
   */
  openSort(): void {
    ipcRenderer.send("review:open-sort");
  },

  /**
   * The week ahead is written through the **top three's own channels**.
   *
   * Deliberately not `review:add-outcome`. A review-shaped wrapper would be a
   * second path to a verb the client already has, with its own chance to drift
   * from the cap and the writable window (contracts/review-api.md).
   */
  addOutcome(text: string, week: string): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:add", text, week);
  },

  completeOutcome(ref: TopThreeRef): Promise<TopThreeResponse> {
    return ipcRenderer.invoke("top-three:complete", ref);
  },

  /** `{ available: false }` with no provider — the shipped configuration. */
  draftSummary(): Promise<SummaryDraft> {
    return ipcRenderer.invoke("review:draft-summary");
  },

  /** Only what is passed here is recorded. A draft is never written unasked. */
  complete(input: {
    note?: string | null;
    summary?: { text: string; provider: string };
  }): Promise<ReviewResponse> {
    return ipcRenderer.invoke("review:complete", input);
  },

  dismiss(): void {
    ipcRenderer.send("review:dismiss");
  },

  onRefresh(handler: () => void): void {
    ipcRenderer.on("review:refresh", () => handler());
  },

  /** The same generic signal every other view listens to. */
  onVaultChanged(handler: () => void): void {
    ipcRenderer.on("vault:changed", () => handler());
  },

  /**
   * `inbox.md` changed.
   *
   * The review is the second view to want this. Sorting from inside the inbox
   * step leaves this window open, so nothing else tells it the count moved
   * (FR-016).
   */
  onInboxChanged(handler: () => void): void {
    ipcRenderer.on("inbox:changed", () => handler());
  },
};


/**
 * The retrospective.
 *
 * No write verb crosses this bridge, because there is none to cross: the core
 * service's dependencies are narrowed so no write is reachable from it.
 *
 * `render` goes to main rather than being done here, deliberately. The window
 * holds a `Retrospective` and could format it itself — and that second
 * rendering path is exactly what would turn "the export is what I was looking
 * at" from an identity into two pieces of code that must agree forever
 * (006 research R2).
 *
 * `onChanged` is a *notice*, not a refresh. Everything else in this app
 * re-reads on a vault change; this one tells the user and waits, because
 * entries moving under them mid-read breaks the copy in their clipboard
 * (FR-010a, FR-010b).
 */
const retrospectiveApi = {
  read(query: RetrospectiveQueryShape): Promise<unknown> {
    return ipcRenderer.invoke("retrospective:read", query);
  },

  render(retrospective: unknown): Promise<string> {
    return ipcRenderer.invoke("retrospective:render", retrospective);
  },

  copy(text: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke("retrospective:copy", text);
  },

  save(text: string, suggestedName: string): Promise<{ saved: boolean; path?: string }> {
    return ipcRenderer.invoke("retrospective:save", text, suggestedName);
  },

  dismiss(): void {
    ipcRenderer.send("retrospective:dismiss");
  },

  /** A write landed somewhere in the vault. The fact, never the cause. */
  onChanged(handler: () => void): void {
    ipcRenderer.on("retrospective:changed", () => handler());
  },
};

export interface RetrospectiveQueryShape {
  range: { from: string; to: string };
  project: string | null;
}

contextBridge.exposeInMainWorld("waypoint", {
  ...api,
  sort: sortApi,
  projects: projectsApi,
  areas: areasApi,
  topThree: topThreeApi,
  review: reviewApi,
  retrospective: retrospectiveApi,
});

export type WaypointApi = typeof api & {
  sort: typeof sortApi;
  projects: typeof projectsApi;
  areas: typeof areasApi;
  topThree: typeof topThreeApi;
  review: typeof reviewApi;
  retrospective: typeof retrospectiveApi;
};
export type WaypointSortApi = typeof sortApi;
export type WaypointProjectsApi = typeof projectsApi;
export type WaypointAreasApi = typeof areasApi;
export type WaypointTopThreeApi = typeof topThreeApi;
export type WaypointReviewApi = typeof reviewApi;
export type WaypointRetrospectiveApi = typeof retrospectiveApi;
