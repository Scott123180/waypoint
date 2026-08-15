/**
 * Ports the core depends on, implemented by the client/adapter layer and
 * injected in. The core owns the rules; adapters own the I/O.
 *
 * See specs/001-quick-capture/contracts/core-api.md
 */

import type { ResolvedDri } from "../identity/types";

/** Appends bytes to the inbox and reports where they landed. */
export interface InboxStore {
  /**
   * Atomically appends `block`. Resolves with the file length BEFORE this
   * append, which undo uses as its truncation target. Creates the file and any
   * missing parent directories. Never rewrites existing content.
   */
  append(block: string): Promise<{ offsetBefore: number }>;

  /** Current byte length, for undo tail verification. */
  size(): Promise<number>;

  /** The trailing `byteCount` bytes, for undo tail verification. */
  readTail(byteCount: number): Promise<string>;

  /** Truncates to `length`. Only ever called by a verified undo. */
  truncate(length: number): Promise<void>;
}

/** Turns spoken audio into text. */
export interface TranscriptionPort {
  /**
   * @param wav 16 kHz mono 16-bit PCM in a WAV container, in memory only.
   * @throws TranscriptionFailedError when the underlying engine fails.
   */
  transcribe(wav: Uint8Array): Promise<string>;
}

/** Injected so tests control time and items get deterministic timestamps. */
export interface Clock {
  now(): Date;
}

/**
 * Drafts a summary of a finished week from the review's own record.
 *
 * A port in the same sense `TranscriptionPort` is: core owns the interface and
 * the single call site, a client supplies the engine. **No provider ships**
 * (005 FR-103), and none is required — the review completes normally with none
 * supplied, offline, with no summary affordance shown at all.
 *
 * Two things are enforced by this signature rather than by discipline:
 *
 *   - **The payload boundary.** `draft` receives a `ReviewRecord` and not a
 *     `VaultStore`, a path, or a fetcher. A provider that wanted the project
 *     files would have to change core to get them, which is a visible change
 *     rather than a quiet one (005 FR-108).
 *
 *   - **Acceptance.** Nothing here writes. What a provider returns is a
 *     proposal; only what the caller hands back to `complete()` is recorded
 *     (005 FR-105).
 *
 * Internal by intent: exported as a type so the project can use the seam
 * deliberately, not so a third party can register against it. No loader, no
 * discovery, no public extension API (005 FR-112).
 *
 * See specs/005-weekly-review-ritual/contracts/summary-port.md
 */
export interface SummaryProvider {
  /** Attribution, recorded beside the text and shown before the provider runs. */
  readonly name: string;
  draft(record: ReviewRecord): Promise<string>;
}

/**
 * Exactly what a provider sees: the parsed review for that week, and nothing
 * else. No project file, inbox, identity, or policy content reaches it.
 */
export interface ReviewRecord {
  week: string;
  started: string;
  inbox: InboxStepRecordLike | null;
  projects: ProjectReviewRecordLike[];
  waiting: WaitingReviewRecordLike[];
  topThree: TopThreeStepRecordLike | null;
  note: string | null;
}

// Structural shapes, so `ports/` describes the payload without depending on the
// review module that owns it — the same discipline `ProjectLike` follows.
export interface InboxStepRecordLike {
  count: number;
  verdict: DecisionVerdict;
  on: string;
}

export interface ProjectReviewRecordLike {
  slug: string;
  action: string;
  detail: string | null;
  on: string;
}

export interface WaitingReviewRecordLike {
  text: string;
  owner: string;
  days: number;
  subject: "item" | "project";
  action: string;
  on: string;
}

export interface TopThreeStepRecordLike {
  finished: string[];
  slipped: string[];
  committed: string[];
  forWeek: string | null;
}

/**
 * Read/modify access to the inbox, for sorting.
 *
 * Distinct from `InboxStore`, which is append-only and belongs to capture.
 * See specs/002-inbox-view-sort/contracts/sort-api.md
 */
export interface InboxDocument {
  /** Full current contents. Empty string when the file does not exist. */
  read(): Promise<string>;

  /**
   * Removes bytes [start, end) — but only if what is currently there exactly
   * equals `expected`. Returns 'mismatch' without writing anything otherwise.
   *
   * Implementations MUST be atomic (a reader sees before or after, never
   * mid-write) and MUST NOT discard a concurrent append. An implementation
   * that rebuilds the file has to serialize against every other writer in its
   * process and detect out-of-process growth before committing — a capture
   * landing mid-removal has to survive it (FR-020e, research R4a).
   */
  removeRange(start: number, end: number, expected: string): Promise<"removed" | "mismatch">;
}

/**
 * Raw file access within the vault.
 *
 * Deliberately has no concept of a destination: an adapter can write bytes to
 * a path, but only the core decides which path and which bytes (Principle II).
 */
export interface VaultStore {
  /**
   * Slugs of the markdown files in a vault subdirectory. Empty when absent.
   *
   * `log` joined the union for Feature 5: past reviews cannot be enumerated by
   * guessing week identifiers, because only the directory knows which weeks
   * exist. Its "slugs" are therefore week ids (005 research R12).
   */
  list(dir: "projects" | "areas" | "log"): Promise<string[]>;

  /** File contents, or null when absent. Path is vault-relative. */
  read(relPath: string): Promise<string | null>;

  /** Writes atomically, creating parent directories. Path is vault-relative. */
  write(relPath: string, content: string): Promise<void>;

  /** Appends a line, creating the file if absent and guaranteeing a preceding newline. */
  appendLine(relPath: string, line: string): Promise<void>;
}

/** One in-flight sort decision, recorded before anything is written. */
export interface JournalEntry {
  id: string;
  ref: { start: number; end: number; raw: string };
  decision: unknown;
  destinationWritten: boolean;
  startedAt: string;
}

/**
 * Write-ahead log making the two-file commit effectively-once.
 *
 * See specs/002-inbox-view-sort/research.md R2.
 */
export interface SortJournal {
  begin(entry: JournalEntry): Promise<void>;
  markDestinationWritten(id: string): Promise<void>;
  clear(id: string): Promise<void>;
  pending(): Promise<JournalEntry[]>;
}

// ---------------------------------------------------------------------------
// The policy seam
// ---------------------------------------------------------------------------

/**
 * Where rules are consulted, and what they may answer.
 *
 * This is a port in the strict sense the rest of this file means it: core
 * declares the interface and the call sites, someone else supplies the
 * behaviour. Core knows *where* rules are asked, never *what* they are
 * (Principle V).
 *
 * **This interface is internal.** There is no loader, no discovery, and no
 * documented way for a third party to register a module (FR-064). It is
 * written down so it can be used deliberately inside the project, not so it
 * can be depended on from outside — publishing an extension API is a promise
 * that is expensive to take back.
 *
 * See specs/004-top-three-wip-limit/contracts/policy-seam.md
 */

/**
 * Exactly three, and no others (FR-063a).
 *
 * Declared as a value as well as a type so the count is assertable. A decision
 * point with no rule registered against it must not be declared speculatively:
 * when a future feature needs a fourth, it adds it then.
 */
export const DECISION_POINTS = [
  "project.status.change",
  "project.milestone.add",
  "week.outcome.record",
  // Feature 5 added these two, each with a rule registered against it. The
  // count is a guard, not a limit: a point is declared when a rule needs it.
  "review.inbox.advance",
  "waiting.stale.check",
] as const;

export type DecisionPoint = (typeof DECISION_POINTS)[number];

/** The closed set of answers. Nothing else is representable (FR-055). */
export type DecisionVerdict = "allow" | "warn" | "block";

export interface Decision {
  verdict: DecisionVerdict;
  /** Displayable, complete, written for the user. Empty only when `allow`. */
  reason: string;
  /**
   * Named items the user would act on — the projects to finish or park, the
   * milestones still open. Lets a client render remediation without computing
   * it (FR-046).
   */
  subjects?: string[];
}

/**
 * What a rule is told, per point.
 *
 * Cheap facts are values; expensive ones are functions. Core cannot compute
 * the WIP count only when the target status is `active`, because "only when
 * active" *is* the rule — but listing every project on every status change
 * would make parking a project as costly as rendering the whole list. A lazy
 * accessor satisfies both: core offers the capability unconditionally, and the
 * module decides whether to pay for it (research R4).
 */
export interface StatusChangeContext {
  point: "project.status.change";
  project: ProjectLike;
  from: ProjectStatusLike;
  to: ProjectStatusLike;
  /** Resolved by core. Policy never resolves identity itself (FR-053). */
  dri: ResolvedDri;
  /**
   * Definitions of done for milestones still open on this project.
   *
   * A value rather than an accessor: core has already parsed the project to
   * build this context, so it costs nothing, and a rule that needs it needs it
   * before deciding anything else.
   */
  openMilestones: string[];
  /** Active projects resolving to `mine`, excluding the one being changed. */
  activeProjectsDrivenByUser: () => Promise<ProjectSummaryLike[]>;
}

export interface MilestoneAddContext {
  point: "project.milestone.add";
  project: ProjectLike;
  /** Current count, so the rule does not walk the array itself. */
  milestoneCount: number;
}

export interface OutcomeRecordContext {
  point: "week.outcome.record";
  week: string;
  outcomeCount: number;
}

export interface ReviewInboxAdvanceContext {
  point: "review.inbox.advance";
  /**
   * Derived from the file at the moment of the attempt, never cached, so a
   * hand-edit or a sort done mid-review is reflected (005 FR-014).
   */
  inboxCount: number;
}

/**
 * One point, two subjects.
 *
 * A delegated item that has gone quiet and a project parked in `waiting` are
 * the same rule applied to two things, and they share one threshold. Splitting
 * them into two points would make separate thresholds the easy next step;
 * keeping one means a contributor who wanted them to diverge has to change
 * `DECISION_POINTS`, where it is visible (005 research R6).
 */
export interface WaitingStaleContext {
  point: "waiting.stale.check";
  /** For the message only. The rule and the threshold are identical for both. */
  subject: "item" | "project";
  /**
   * Local date the subject was last touched: the last follow-up, or the date it
   * started waiting; for a project, the date it entered `waiting`.
   *
   * A subject whose date is unknown is never asked — core does not substitute a
   * date to make the question askable (005 FR-094).
   */
  since: string;
  /** Local date today, supplied by core so the rule needs no clock of its own. */
  today: string;
}

export type DecisionContext =
  | StatusChangeContext
  | MilestoneAddContext
  | OutcomeRecordContext
  | ReviewInboxAdvanceContext
  | WaitingStaleContext;

/**
 * A registered set of rules.
 *
 * `decide` takes the context alone: `point` is its discriminant, so passing
 * both would allow a mismatched pair to typecheck.
 */
export interface PolicyModule {
  decide(context: DecisionContext): Promise<Decision>;
}

// The seam describes domain-shaped payloads without importing the domain
// modules that own them, which is what keeps `ports/` free of a cycle. The
// aliases are structural on purpose: a rule reads these fields and nothing
// more.
export type ProjectStatusLike = "active" | "parked" | "waiting" | "done";

export interface ProjectLike {
  slug: string;
  title: string;
  status: ProjectStatusLike;
  dri: string | null;
}

export interface ProjectSummaryLike {
  slug: string;
  title: string;
  status: ProjectStatusLike;
}
