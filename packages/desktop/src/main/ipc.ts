import { ipcMain } from "electron";

import {
  CaptureService,
  EmptyCaptureError,
  structureGaps,
  type AreaService,
  type AreaStatus,
  type ItemRef,
  type MilestoneRef,
  type Project,
  type ProjectService,
  type ProjectStatus,
  type OutcomeRef,
  type SortDecision,
  type SortService,
  type TopThreeService,
} from "@waypoint/core";

import { toWhisperWav } from "./audio-encode";
import type { CaptureWindow } from "./capture-window";

export type SubmitResponse = { ok: true; id: string } | { ok: false; error: "empty" };

/**
 * Thin pass-throughs to the core.
 *
 * Deliberately absent: any channel that would let the renderer set a
 * timestamp, write the inbox directly, or store a transcript unseen. The
 * client cannot hold domain logic it has no way to express.
 */
export function registerIpc(
  service: CaptureService,
  window: CaptureWindow,
  sort?: SortService,
  hideSort?: () => void,
  /**
   * Called whenever something may have opened or closed the undo window, so the
   * tray menu can follow. Linux never gets a menu-open event to refresh on, so
   * the change has to be pushed from here.
   */
  onUndoableChange?: () => void,
): void {
  if (sort) registerSortIpc(sort, service, hideSort, onUndoableChange);

  ipcMain.handle(
    "capture:transcribe",
    async (_event, samples: Float32Array, sampleRate: number) => {
      // Encoding happens here rather than in the renderer so the client stays
      // thin and the conversion is covered by the fast test suite.
      const wav = toWhisperWav(Float32Array.from(samples), sampleRate);
      return service.transcribe(wav);
    },
  );

  ipcMain.handle(
    "capture:submit",
    async (_event, text: string, source: "typed" | "dictated"): Promise<SubmitResponse> => {
      try {
        const result = await service.submit(text, source);
        onUndoableChange?.();
        return { ok: true, id: result.id };
      } catch (err) {
        if (err instanceof EmptyCaptureError) {
          return { ok: false, error: "empty" };
        }
        throw err;
      }
    },
  );

  ipcMain.handle("capture:undo", async (_event, id: string) => {
    const outcome = await service.undo(id);
    onUndoableChange?.();
    return outcome;
  });

  ipcMain.on("capture:notice-ack", (_event, id: string) => {
    window.acknowledgeNotice(id);
  });

  ipcMain.on("capture:dismiss", () => {
    // Deliberately does NOT expire the undo window. Submitting closes the box
    // via this same channel, and expiring here would destroy the undo window
    // the moment it was created. The window expires when the next capture
    // begins, which submit() handles.
    window.hide();
  });
}

/**
 * Sort channels. Every one is a pass-through to `SortService`.
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */
function registerSortIpc(
  sort: SortService,
  capture: CaptureService,
  hideSort?: () => void,
  onUndoableChange?: () => void,
): void {
  ipcMain.on("sort:dismiss", () => hideSort?.());

  ipcMain.handle("sort:next", async () => {
    const item = await sort.next();
    if (!item) return { item: null };
    return {
      item: {
        text: item.text,
        // Crosses as a string; null stays null so the renderer shows no
        // timestamp rather than inventing today's date (FR-027a).
        capturedAt: item.capturedAt ? item.capturedAt.toISOString() : null,
        ref: item.ref,
      },
    };
  });

  ipcMain.handle("sort:destinations", async () => sort.destinations());

  ipcMain.handle("sort:count", async () => sort.count());

  ipcMain.handle("sort:decide", async (_event, ref: ItemRef, decision: SortDecision) => {
    const outcome = await sort.sort(ref, decision);

    if (outcome.ok) {
      // The inbox has been spliced, so any open capture undo window now points
      // at stale offsets. performUndo already refuses safely in that state
      // (research R4b); expiring it turns a confusing refusal into no
      // affordance at all.
      capture.expireUndoWindow();
      onUndoableChange?.();
    }

    return outcome;
  });
}

/** What a scalar `projects:set-field` call may target. */
export type ProjectFieldName = "outcome" | "next-action" | "dri" | "title";

/**
 * Project and area channels. Every one is a pass-through.
 *
 * Deliberately absent: any channel that would let the renderer write a project
 * file directly, set a completion date, compute the incomplete flag, decide
 * which projects are active, or mark a project done without going through the
 * confirmation path. The client cannot hold domain logic it has no way to
 * express (Principle II).
 *
 * See specs/003-project-structure/contracts/ipc-projects.md
 */
export function registerProjectsIpc(
  projects: ProjectService,
  areas: AreaService,
  hideProjects: () => void,
): void {
  ipcMain.on("projects:dismiss", () => hideProjects());

  // Deliberately absent: any raising of the vault change signal. It used to be
  // wrapped around each verb here, which meant only writes the projects view
  // asked for were announced — sorting an item into a project changed the same
  // file and told nobody. `FsVaultStore` raises it now, so a writer that never
  // reaches this function still reaches every open view.

  // The core decides which projects are active and which are finished
  // (FR-032); the renderer renders what it is handed.
  ipcMain.handle("projects:list-active", async () => projects.listActive());
  ipcMain.handle("projects:list-completed", async () => projects.listCompleted());
  ipcMain.handle("projects:list", async () => projects.list());

  ipcMain.handle("projects:get", async (_event, slug: string) => {
    // `getResolved` rather than `get`: the detail view must give the same
    // answer about the DRI as the list does, which means resolving against the
    // whole vault rather than this one file (Feature 4, FR-020a).
    const resolved = await projects.getResolved(slug);
    if (resolved === null) return null;
    return {
      ...serializeProject(resolved.project),
      // A distinct key: `dri` is the raw name the detail view renders as text,
      // and overwriting it with the resolution object rendered "[object
      // Object]" into the field. Two meanings, two names.
      driResolution: resolved.dri,
      needsDri: resolved.needsDri,
    };
  });

  // Deliberately absent: a channel for `identityConfigured()`. It was
  // registered and never reachable — no preload method, no caller — because
  // `projects:load` already carries the answer. Core still exposes the verb for
  // Feature 5 and Feature 6; an unused channel is surface a client could come
  // to depend on without anyone deciding it should exist.

  // How much the user is driving, and whether the rules leave room. The
  // comparison is policy's and the count is core's; the view renders the
  // finished answer rather than computing either (Feature 4, FR-050).
  ipcMain.handle("projects:load", async () => projects.overLimitState());

  ipcMain.handle("projects:create", async (_event, title: string) =>
    projects.create(title),
  );

  ipcMain.handle(
    "projects:set-field",
    async (_event, slug: string, field: ProjectFieldName, expected: string | null, next: string | null) => {
      switch (field) {
        case "outcome":
          return await projects.setOutcome(slug, expected, next);
        case "next-action":
          return await projects.setNextAction(slug, expected, next);
        case "dri":
          return await projects.setDri(slug, expected, next);
        case "title":
          return await projects.setTitle(slug, expected ?? "", next ?? "");
      }
    },
  );

  ipcMain.handle(
    "projects:set-status",
    async (_event, slug: string, expected: ProjectStatus, next: ProjectStatus) =>
      projects.setStatus(slug, expected, next),
  );

  ipcMain.handle(
    "projects:add-milestone",
    async (_event, slug: string, definitionOfDone: string, verifier: string | null) =>
      projects.addMilestone(slug, definitionOfDone, verifier),
  );

  ipcMain.handle(
    "projects:edit-milestone",
    async (_event, slug: string, ref: MilestoneRef, definitionOfDone: string, verifier: string | null) =>
      projects.editMilestone(slug, ref, definitionOfDone, verifier),
  );

  ipcMain.handle("projects:remove-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    projects.removeMilestone(slug, ref),
  );

  ipcMain.handle("projects:complete-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    projects.completeMilestone(slug, ref),
  );

  ipcMain.handle("projects:reopen-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    projects.reopenMilestone(slug, ref),
  );

  ipcMain.handle(
    "projects:complete",
    async (_event, slug: string, opts?: { confirmOpenMilestones?: boolean }) =>
      projects.complete(slug, opts),
  );

  ipcMain.handle(
    "projects:reopen",
    async (_event, slug: string, to: Exclude<ProjectStatus, "done">) =>
      projects.reopen(slug, to),
  );

  ipcMain.handle(
    "projects:dismiss-unprocessed",
    async (_event, slug: string, index: number, expectedRaw: string) =>
      projects.dismissUnprocessed(slug, index, expectedRaw),
  );

  ipcMain.handle("areas:list", async () => areas.list());

  ipcMain.handle("areas:get", async (_event, slug: string) => {
    const area = await areas.get(slug);
    return area === null ? null : { ...area, unprocessed: area.unprocessed.map(serializeItem) };
  });

  ipcMain.handle("areas:create", async (_event, title: string) => areas.create(title));

  ipcMain.handle(
    "areas:set-title",
    async (_event, slug: string, expected: string, next: string) =>
      areas.setTitle(slug, expected, next),
  );

  ipcMain.handle(
    "areas:set-status",
    async (_event, slug: string, expected: AreaStatus, next: AreaStatus) =>
      areas.setStatus(slug, expected, next),
  );

  ipcMain.handle(
    "areas:dismiss-unprocessed",
    async (_event, slug: string, index: number, expectedRaw: string) =>
      areas.dismissUnprocessed(slug, index, expectedRaw),
  );
}

/**
 * A `Date` cannot cross the bridge, and a hand-written item must not acquire
 * one on the way — null stays null, exactly as `sort:next` handles it.
 */
function serializeItem(item: { capturedAt: Date | null }): unknown {
  return { ...item, capturedAt: item.capturedAt ? item.capturedAt.toISOString() : null };
}

/**
 * A project, plus the gaps the core derives for it.
 *
 * The gaps travel with the project rather than being looked up from a list,
 * because status must have no effect on the flag (FR-021) — sourcing them from
 * the *active* list would silently report a done project as fully structured.
 * `structureGaps` is the core's own function, so nothing is computed here.
 */
function serializeProject(project: Project): Record<string, unknown> {
  return {
    ...project,
    gaps: structureGaps(project),
    // Progress is reported by the core, not counted by the view (FR-017).
    milestonesDone: project.milestones.filter((m) => m.done).length,
    milestonesTotal: project.milestones.length,
    unprocessed: project.unprocessed.map(serializeItem),
  };
}

/**
 * The weekly top three.
 *
 * Thin pass-throughs, like every other block in this file. Deliberately absent:
 * any channel that would let the renderer decide which week is current, whether
 * a week is editable, or how to phrase a refusal — those are core's answers and
 * the view renders them (Principle II).
 *
 * See specs/004-top-three-wip-limit/contracts/top-three-api.md
 */
export function registerTopThreeIpc(topThree: TopThreeService, hideTopThree: () => void): void {
  ipcMain.on("top-three:dismiss", () => hideTopThree());

  // No raising of the vault change signal here, for the reason given above:
  // `FsVaultStore` raises it from its write path, so a writer that never
  // reaches this function still reaches every open view.
  ipcMain.handle("top-three:current", async () => topThree.current());
  ipcMain.handle("top-three:history", async () => topThree.history());

  ipcMain.handle("top-three:add", async (_event, text: string) => topThree.addOutcome(text));

  ipcMain.handle("top-three:edit", async (_event, ref: OutcomeRef, text: string) =>
    topThree.editOutcome(ref, text),
  );

  ipcMain.handle("top-three:remove", async (_event, ref: OutcomeRef) => topThree.removeOutcome(ref));

  ipcMain.handle("top-three:complete", async (_event, ref: OutcomeRef) =>
    topThree.completeOutcome(ref),
  );

  ipcMain.handle("top-three:reopen", async (_event, ref: OutcomeRef) => topThree.reopenOutcome(ref));
}
