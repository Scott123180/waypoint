/**
 * Public surface of @waypoint/core.
 *
 * Everything a client is allowed to touch is exported here and nowhere else.
 * See specs/001-quick-capture/contracts/core-api.md
 */

export type { InboxStore, TranscriptionPort, Clock } from "./ports/index";
export { EmptyCaptureError, TranscriptionFailedError, InboxWriteError } from "./errors";

export type { CaptureItem, CaptureSource } from "./capture/capture-item";
export { CaptureService } from "./capture/capture-service";
export type { SubmitResult, CaptureServiceDeps } from "./capture/capture-service";

export type { InboxDocument, VaultStore, SortJournal, JournalEntry } from "./ports/index";
export { VaultWriteError } from "./errors";

export { parseInbox, isInboxEmpty } from "./inbox/parse";
export type { ParsedItem } from "./inbox/parse";

export { ProjectService, MILESTONE_CAP } from "./projects/project-service";
export type { ProjectServiceDeps } from "./projects/project-service";
export { AreaService } from "./projects/area-service";
export type { AreaServiceDeps } from "./projects/area-service";
export { structureGaps, needsStructure } from "./projects/gaps";
export { parseProject, parseArea } from "./projects/document";
export { parseMilestone, renderMilestone } from "./projects/milestone";
export { PROJECT_STATUSES, AREA_STATUSES } from "./projects/types";
export type {
  Project,
  ProjectStatus,
  ProjectSummary,
  ProjectOutcome,
  ProjectField,
  Milestone,
  MilestoneRef,
  Area,
  AreaStatus,
  AreaSummary,
  AreaOutcome,
  UnprocessedItem,
  StructureGap,
  RefusalReason,
} from "./projects/types";

export { SortService } from "./sort/sort-service";
export type { SortServiceDeps } from "./sort/sort-service";
export type {
  ItemRef,
  SortDecision,
  SortOutcome,
  SortRefusal,
  InboxItemView,
  DestinationRef,
  RecoveryReport,
} from "./sort/decision";
