/**
 * Ports the core depends on, implemented by the client/adapter layer and
 * injected in. The core owns the rules; adapters own the I/O.
 *
 * See specs/001-quick-capture/contracts/core-api.md
 */

import type { ResolvedDri } from "../identity/types";
import type { SortDecision } from "../sort/decision";

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

  /**
   * Replaces bytes [start, end) with `replacement` — but only if what is
   * currently there exactly equals `expected`. Returns 'mismatch' without
   * writing anything otherwise.
   *
   * Added by 008 for `SortService.split`, with exactly the guarantees
   * `removeRange` documents above: atomic to a reader, and never discarding a
   * concurrent append. Strictly additive — `removeRange` keeps its signature
   * and its behaviour, and implementations share one splice so the two cannot
   * drift (008 research R8).
   *
   * A split is **one** call to this. That is what makes 008 FR-014's
   * all-or-nothing the rename's own guarantee rather than a journalled
   * two-step with a crash window between the halves (008 research R9).
   */
  replaceRange(
    start: number,
    end: number,
    expected: string,
    replacement: string,
  ): Promise<"replaced" | "mismatch">;
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
 * One point, three subjects.
 *
 * A delegated item that has gone quiet, a project parked in `waiting`, and a
 * thought flagged for the calendar and never scheduled are the same rule
 * applied to three things, and they share one threshold. Splitting them into
 * separate points would make separate thresholds the easy next step; keeping
 * one means a contributor who wanted them to diverge has to change
 * `DECISION_POINTS`, where it is visible (005 research R6, 009 research R5).
 *
 * Feature 9 widened `subject` and added nothing else. `DECISION_POINTS` is
 * unchanged and still five.
 */
export interface WaitingStaleContext {
  point: "waiting.stale.check";
  /**
   * Which kind of thing is being asked about.
   *
   * **The subject decides the message and never the decision.** The comparison,
   * the inclusive boundary, the `allow` for an unreadable or future date, and
   * the configured threshold are identical for all three. Where they differ is
   * only in what the user can do about it: an item is chased, a project is
   * parked, a flag is put in a calendar.
   */
  subject: "item" | "project" | "calendar";
  /**
   * Local date the subject was last touched: the last follow-up, or the date it
   * started waiting; for a project, the date it entered `waiting`; for a
   * calendar flag, the date it was flagged.
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

// ---------------------------------------------------------------------------
// The intelligence seams
// ---------------------------------------------------------------------------

/**
 * Seam one: *what intelligence does*, in Waypoint's own vocabulary.
 *
 * Two ports rather than one, because FR-003 requires the two kinds of help to
 * be independently requestable and asking for one must not send the other's
 * content. Two interfaces make that a fact about the shape rather than a rule
 * the caller has to keep.
 *
 * Ports in the strict sense the rest of this file means it: core declares the
 * interface and the single call site, someone else supplies the behaviour.
 * **Internal by intent** — no loader, no discovery, no registration API, the
 * same restraint `PolicyModule` and `SummaryProvider` follow (008 FR-057).
 *
 * See specs/008-llm-assisted-inbox-organization/contracts/intelligence-ports.md
 */

/**
 * A request rendered but not yet sent.
 *
 * The provider verb *prepares* rather than *proposes*, and this is why. FR-041
 * requires the exact content to be shown before it is sent, and FR-045
 * requires the shown content and the sent content to be the same value rather
 * than two renderings compared for equality. A single `propose(request)` that
 * both rendered and sent would leave a caller no way to read the payload
 * except by rendering it a second time — which is the discrepancy FR-045
 * forbids, reintroduced one layer down.
 *
 * `send` is a closure over the same `payload` binding this exposes. It takes
 * only a signal: the content is already fixed, so there is no argument through
 * which different content could be supplied (008 research R4).
 *
 * Preparing performs no I/O and sends nothing.
 */
export interface PreparedProposal<T> {
  /** The exact content that would be sent. Rendered once, here. */
  readonly payload: string;
  send(signal: AbortSignal): Promise<T>;
}

/**
 * Proposes how one inbox item divides into distinct thoughts.
 *
 * Returns groupings of *segment numbers*, never text. Core slices the original
 * to build each piece, so a piece cannot contain words the user did not say —
 * not because the provider is trusted, but because it never handles the text
 * (008 FR-010a, 008 research R3).
 */
export interface SplitProvider {
  /** Attribution, shown before the provider runs. Never written to disk. */
  readonly name: string;
  prepareSplit(request: SplitRequest): PreparedProposal<SplitResponse>;
}

export interface SplitRequest {
  /** The item's own text. Nothing else about the vault (008 FR-042). */
  readonly text: string;
  /** The partition core computed. `segments.join("") === text`, byte for byte. */
  readonly segments: ReadonlyArray<{ index: number; text: string }>;
}

export interface SplitResponse {
  /** One array of segment indices per proposed piece. */
  readonly pieces: ReadonlyArray<ReadonlyArray<number>>;
  /** True when the item holds a single thought (008 FR-011). */
  readonly nothingToSplit: boolean;
}

/**
 * Proposes where one item — or one piece of a split one — belongs.
 *
 * Constrained to Feature 2's five destinations by reusing `SortDecision`. A
 * sixth destination is not expressible, and neither is a hint that a machine
 * proposed this one, because `SortDecision` has no field for either (008
 * FR-020, 008 FR-032).
 */
export interface DestinationProvider {
  readonly name: string;
  prepareDestination(request: DestinationRequest): PreparedProposal<DestinationResponse>;
}

/**
 * The whole payload boundary for a destination request.
 *
 * There is deliberately **no field** for a milestone, a next action, a DRI, a
 * status, a ledger entry, an `## Unprocessed` item, another inbox item, or any
 * configuration value. A provider that wanted them would have to change core to
 * get them, which is a visible change rather than a quiet one — Feature 5's
 * `ReviewRecord` discipline applied to a second port (008 FR-043).
 */
export interface DestinationRequest {
  /** The item's or piece's own text. */
  readonly item: string;
  /** Title and stated outcome only. Nothing else from the project file. */
  readonly projects: ReadonlyArray<{ slug: string; title: string; outcome: string | null }>;
  /** Areas have no outcome, so a title alone. */
  readonly areas: ReadonlyArray<{ slug: string; title: string }>;
}

export interface DestinationResponse {
  readonly decision: SortDecision;
  readonly reason: string;
}

/**
 * Seam two: *how a model is reached*.
 *
 * Carries request content out and brings response content back. Nothing about
 * projects, areas, inbox items, destinations, or sorting appears here, and
 * nothing should ever be added: a transport that needed to know what it was
 * carrying would be an intelligence module wearing the wrong interface.
 *
 * The 120-second bound is core's, not the transport's. Core arms one
 * `AbortController` per request and passes its signal down; a transport honours
 * it and implements no timeout of its own, so the one number cannot drift
 * between two implementations (008 FR-066a, 008 research R15).
 */
export interface Transport {
  /** Named for display in a failure message and in the preview. */
  readonly name: string;
  /**
   * @param request the exact content to send
   * @param signal aborted by core at 120 seconds, or when the user abandons
   */
  send(request: string, signal: AbortSignal): Promise<string>;
}
