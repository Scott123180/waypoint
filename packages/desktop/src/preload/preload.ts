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
  dri: string | null;
  milestones: MilestoneView[];
  completedOn: string | null;
  unprocessed: UnprocessedView[];
  /** Derived by the core and sent with the project, so status cannot affect it. */
  gaps: StructureGap[];
  /** Reported by the core; the view renders these rather than counting (FR-017). */
  milestonesDone: number;
  milestonesTotal: number;
}

export interface ProjectSummaryView {
  slug: string;
  title: string;
  status: ProjectStatus;
  milestonesDone: number;
  milestonesTotal: number;
  gaps: StructureGap[];
  completedOn: string | null;
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
  | { ok: false; reason: string; message: string; open?: string[] };

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

contextBridge.exposeInMainWorld("waypoint", {
  ...api,
  sort: sortApi,
  projects: projectsApi,
  areas: areasApi,
});

export type WaypointApi = typeof api & {
  sort: typeof sortApi;
  projects: typeof projectsApi;
  areas: typeof areasApi;
};
export type WaypointSortApi = typeof sortApi;
export type WaypointProjectsApi = typeof projectsApi;
export type WaypointAreasApi = typeof areasApi;
