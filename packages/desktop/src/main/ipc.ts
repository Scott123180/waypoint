import { ipcMain } from "electron";

import {
  CaptureService,
  EmptyCaptureError,
  type AreaService,
  type AreaStatus,
  type ItemRef,
  type MilestoneRef,
  type ProjectService,
  type ProjectStatus,
  type SortDecision,
  type SortService,
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
  onVaultChange: () => void,
): void {
  ipcMain.on("projects:dismiss", () => hideProjects());

  /** Raises the change signal on any successful write, and nothing else. */
  const announce = <T extends { ok: boolean }>(outcome: T): T => {
    if (outcome.ok) onVaultChange();
    return outcome;
  };

  // The core decides which projects are active (FR-032); the renderer renders
  // what it is handed.
  ipcMain.handle("projects:list-active", async () => projects.listActive());
  ipcMain.handle("projects:list", async () => projects.list());

  ipcMain.handle("projects:get", async (_event, slug: string) => {
    const project = await projects.get(slug);
    return project === null ? null : serializeProject(project);
  });

  ipcMain.handle("projects:create", async (_event, title: string) =>
    announce(await projects.create(title)),
  );

  ipcMain.handle(
    "projects:set-field",
    async (_event, slug: string, field: ProjectFieldName, expected: string | null, next: string | null) => {
      switch (field) {
        case "outcome":
          return announce(await projects.setOutcome(slug, expected, next));
        case "next-action":
          return announce(await projects.setNextAction(slug, expected, next));
        case "dri":
          return announce(await projects.setDri(slug, expected, next));
        case "title":
          return announce(await projects.setTitle(slug, expected ?? "", next ?? ""));
      }
    },
  );

  ipcMain.handle(
    "projects:set-status",
    async (_event, slug: string, expected: ProjectStatus, next: ProjectStatus) =>
      announce(await projects.setStatus(slug, expected, next)),
  );

  ipcMain.handle(
    "projects:add-milestone",
    async (_event, slug: string, definitionOfDone: string, verifier: string | null) =>
      announce(await projects.addMilestone(slug, definitionOfDone, verifier)),
  );

  ipcMain.handle(
    "projects:edit-milestone",
    async (_event, slug: string, ref: MilestoneRef, definitionOfDone: string, verifier: string | null) =>
      announce(await projects.editMilestone(slug, ref, definitionOfDone, verifier)),
  );

  ipcMain.handle("projects:remove-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    announce(await projects.removeMilestone(slug, ref)),
  );

  ipcMain.handle("projects:complete-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    announce(await projects.completeMilestone(slug, ref)),
  );

  ipcMain.handle("projects:reopen-milestone", async (_event, slug: string, ref: MilestoneRef) =>
    announce(await projects.reopenMilestone(slug, ref)),
  );

  ipcMain.handle(
    "projects:complete",
    async (_event, slug: string, opts?: { confirmOpenMilestones?: boolean }) =>
      announce(await projects.complete(slug, opts)),
  );

  ipcMain.handle(
    "projects:reopen",
    async (_event, slug: string, to: Exclude<ProjectStatus, "done">) =>
      announce(await projects.reopen(slug, to)),
  );

  ipcMain.handle(
    "projects:dismiss-unprocessed",
    async (_event, slug: string, index: number, expectedRaw: string) =>
      announce(await projects.dismissUnprocessed(slug, index, expectedRaw)),
  );

  ipcMain.handle("areas:list", async () => areas.list());

  ipcMain.handle("areas:get", async (_event, slug: string) => {
    const area = await areas.get(slug);
    return area === null ? null : { ...area, unprocessed: area.unprocessed.map(serializeItem) };
  });

  ipcMain.handle("areas:create", async (_event, title: string) => announce(await areas.create(title)));

  ipcMain.handle(
    "areas:set-title",
    async (_event, slug: string, expected: string, next: string) =>
      announce(await areas.setTitle(slug, expected, next)),
  );

  ipcMain.handle(
    "areas:set-status",
    async (_event, slug: string, expected: AreaStatus, next: AreaStatus) =>
      announce(await areas.setStatus(slug, expected, next)),
  );

  ipcMain.handle(
    "areas:dismiss-unprocessed",
    async (_event, slug: string, index: number, expectedRaw: string) =>
      announce(await areas.dismissUnprocessed(slug, index, expectedRaw)),
  );
}

/**
 * A `Date` cannot cross the bridge, and a hand-written item must not acquire
 * one on the way — null stays null, exactly as `sort:next` handles it.
 */
function serializeItem(item: { capturedAt: Date | null }): unknown {
  return { ...item, capturedAt: item.capturedAt ? item.capturedAt.toISOString() : null };
}

function serializeProject(project: {
  unprocessed: { capturedAt: Date | null }[];
}): unknown {
  return { ...project, unprocessed: project.unprocessed.map(serializeItem) };
}
