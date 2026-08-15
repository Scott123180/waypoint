/**
 * Public surface of @waypoint/core.
 *
 * Everything a client is allowed to touch is exported here and nowhere else.
 * See specs/001-quick-capture/contracts/core-api.md
 */

export type { InboxStore, TranscriptionPort, Clock } from "./ports/index";

/**
 * The policy seam. Internal by intent: these types exist so the project can use
 * the seam deliberately, not so a third party can register against it. No
 * loader, no discovery, no registration API (FR-064).
 */
export { DECISION_POINTS } from "./ports/index";
export type {
  PolicyModule,
  DecisionPoint,
  DecisionVerdict,
  Decision,
  DecisionContext,
  StatusChangeContext,
  MilestoneAddContext,
  OutcomeRecordContext,
} from "./ports/index";
export { createDefaultPolicy } from "./policy/default-policy";
export { DEFAULT_POLICY_CONFIG, parsePolicyConfig } from "./policy/policy-config";
export type { PolicyConfig } from "./policy/policy-config";
export { EmptyCaptureError, TranscriptionFailedError, InboxWriteError } from "./errors";

export type { CaptureItem, CaptureSource } from "./capture/capture-item";
export { CaptureService } from "./capture/capture-service";
export type { SubmitResult, CaptureServiceDeps } from "./capture/capture-service";

export type { InboxDocument, VaultStore, SortJournal, JournalEntry } from "./ports/index";
export { VaultWriteError } from "./errors";

export { parseInbox, isInboxEmpty } from "./inbox/parse";
export type { ParsedItem } from "./inbox/parse";

export { ProjectService, MILESTONE_CAP } from "./projects/project-service";
export type { ProjectServiceDeps, OverLimitState } from "./projects/project-service";
export { AreaService } from "./projects/area-service";
export type { AreaServiceDeps } from "./projects/area-service";
export { structureGaps, needsStructure } from "./projects/gaps";

/**
 * Identity resolution: a fact about the data, in core.
 *
 * Reachable without importing anything from the policy module, so Feature 5's
 * review, Feature 6's retrospective and any future client can ask "is this DRI
 * the user?" without depending on policy (FR-053).
 */
export { parseIdentity, isConfigured, IDENTITY_PATH } from "./identity/identity-config";
export { normalizeName } from "./identity/normalize";
export { buildCorpus } from "./identity/corpus";
export { resolveDri } from "./identity/resolve";
export type { Identity, DriResolution, ResolvedDri, NameCorpus } from "./identity/types";
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

export { TopThreeService, TOP_THREE_PATH } from "./weekly/top-three-service";
export type { TopThreeServiceDeps } from "./weekly/top-three-service";
export { isoWeek } from "./weekly/iso-week";
export type {
  WeekId,
  Week,
  Outcome,
  OutcomeRef,
  TopThreeRefusal,
  TopThreeOutcomeResult,
} from "./weekly/types";

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
