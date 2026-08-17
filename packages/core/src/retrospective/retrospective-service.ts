import type { VaultStore } from "../ports/index";
import type { Project } from "../projects/types";
import { LOG_DIR, parseReview, reviewPath } from "../review/review-document";
import { isWeekId } from "../weekly/iso-week";
import { parseTopThree } from "../weekly/top-three-document";
import { TOP_THREE_PATH } from "../weekly/top-three-service";
import {
  isLocalDate,
  selectCompletions,
  selectOutcomes,
  unreadableOutcomeLines,
} from "./select";
import type {
  Narrative,
  ProjectHistory,
  ProjectScoped,
  Retrospective,
  RetrospectiveQuery,
  RetrospectiveResult,
  UnreadableSource,
  WeekNarrative,
} from "./types";
import { REPORT_LABELS } from "./report";
import { weeksOverlapping, weekSpan } from "./weeks";

/**
 * The single entry point for the retrospective.
 *
 * The same habits as the other services — injected ports, every read fresh,
 * refusals as values a caller renders rather than exceptions — and two that are
 * this feature's own:
 *
 *   - **It cannot write.** Not by convention: `vault` is
 *     `Pick<VaultStore, "list" | "read">`, so `write` and `appendLine` do not
 *     typecheck, and the project and week sources are structural read-only
 *     shapes rather than the services that satisfy them. The byte-for-byte test
 *     is a regression net over something the compiler already holds (FR-051).
 *
 *   - **It consults no policy.** There is no `policy` dependency to consult —
 *     absent rather than accepted-and-unused, so a future contributor who
 *     wanted a rule here would have to change this constructor, which is a
 *     visible edit. A date range is a question, not a commitment, and nothing
 *     here is an allow, warn, or block (FR-058, research R11).
 *
 * There is also no clock. Nothing needs today: the endpoints come from the
 * caller, selection compares against them, and week enumeration derives from
 * the range.
 *
 * See specs/006-retrospective-view/contracts/retrospective-api.md
 */

/**
 * Just the part of `ProjectService` this reads.
 *
 * Structural rather than `Pick<ProjectService, "listDetailed">` so that it also
 * declares that only `project` is used and not `summary` — and so that a test
 * can satisfy it without standing up identity resolution. `ProjectService`
 * satisfies it by construction. The same discipline `ProjectLike` in `ports/`
 * already follows.
 */
export interface ProjectSource {
  listDetailed(): Promise<ReadonlyArray<{ project: Project }>>;
}

export interface RetrospectiveServiceDeps {
  projects: ProjectSource;
  /** Read-only by type. No write verb is reachable from here (FR-051). */
  vault: Pick<VaultStore, "list" | "read">;
}

/**
 * Why the outcome and narrative sections are omitted under a project filter.
 *
 * Core's words rather than a client's, because both are statements about the
 * user's data and a renderer composing them would be holding domain vocabulary
 * (Principle VII, FR-032, FR-033). Re-exported from `REPORT_LABELS` rather than
 * defined here: that object's contract is every fixed string the report can
 * emit, and a sentence defined outside it is one the FR-053 vocabulary check
 * cannot see.
 */
export const OUTCOMES_NOT_PROJECT_SCOPED = REPORT_LABELS.outcomesNotProjectScoped;
export const NARRATIVE_NOT_PROJECT_SCOPED = REPORT_LABELS.narrativeNotProjectScoped;

export class RetrospectiveService {
  private readonly projects: ProjectSource;
  private readonly vault: Pick<VaultStore, "list" | "read">;

  constructor(deps: RetrospectiveServiceDeps) {
    this.projects = deps.projects;
    this.vault = deps.vault;
  }

  /**
   * One reading: one answer to one range, complete, read at one moment.
   *
   * Returns a value with no notion of freshness. Whether what it describes is
   * still true is the window's problem, not this module's — a core that knew
   * would need view lifecycle it has no business holding (research R9).
   */
  async read(query: RetrospectiveQuery): Promise<RetrospectiveResult> {
    const refusal = validate(query);
    if (refusal) return refusal;

    const unreadable: UnreadableSource[] = [];
    const narrowed = query.project;

    // ---- projects ---------------------------------------------------------
    const detailed = await this.projects.listDetailed();
    const all = detailed.map((d) => d.project);
    const scope = narrowed === null ? all : all.filter((p) => p.slug === narrowed);

    const target = narrowed === null ? undefined : scope[0];

    // A slug with no file behind it — picked from the list, then deleted in an
    // editor before Show was pressed. Refused rather than answered emptily: an
    // empty reading here still omits the outcome and narrative sections *with
    // their project-scoping reasons*, so it behaves as narrowed while naming no
    // project and carrying no history, and exports as a document claiming to
    // cover everything (FR-046, SC-014a; see the note on `RetrospectiveRefusal`).
    if (narrowed !== null && target === undefined) {
      return {
        ok: false,
        reason: "unknown-project",
        message: `No project in the vault has the name "${narrowed}".`,
      };
    }

    const { completions, undated } = selectCompletions(scope, query.range);

    // ---- weekly outcomes --------------------------------------------------
    let outcomes: ProjectScoped<ReturnType<typeof selectOutcomes>["groups"]>;
    let undatedOutcomes: ProjectScoped<ReturnType<typeof selectOutcomes>["undated"]>;

    if (narrowed !== null) {
      outcomes = { applies: false, reason: OUTCOMES_NOT_PROJECT_SCOPED };
      undatedOutcomes = { applies: false, reason: OUTCOMES_NOT_PROJECT_SCOPED };
    } else {
      // One read, both answers. `TopThreeService.history()` would read the same
      // file a second time — and would add the current week whether or not the
      // file records it, which is a fact about the clock that a retrospective
      // over a past range has no use for. `parseTopThree` is exported and total,
      // so reading here costs no duplication and keeps the file to one read
      // (SC-019, research R6).
      const content = await this.vault.read(TOP_THREE_PATH);
      const selected = selectOutcomes(parseTopThree(content), query.range);
      outcomes = { applies: true, value: selected.groups };
      undatedOutcomes = { applies: true, value: selected.undated };

      const spanned = weeksOverlapping(query.range);
      unreadable.push(...unreadableOutcomeLines(content, TOP_THREE_PATH, spanned));
    }

    // ---- the narrative ----------------------------------------------------
    const narrative: ProjectScoped<Narrative> =
      narrowed !== null
        ? { applies: false, reason: NARRATIVE_NOT_PROJECT_SCOPED }
        : { applies: true, value: await this.readNarrative(query, unreadable) };

    return {
      ok: true,
      retrospective: {
        query,
        projectTitle: target?.title ?? null,
        completions,
        undated,
        outcomes,
        undatedOutcomes,
        narrative,
        history: target ? historyOf(target) : null,
        unreadable,
      },
    };
  }

  /**
   * The weeks with a log, and the named report of the weeks without one.
   *
   * Read from `log/` directly rather than through `ReviewService`: standing that
   * service up requires projects, the top three, the inbox, waiting, and a
   * policy module — the entire review write surface — to read files. Everything
   * needed here is already exported and total (research R4).
   */
  private async readNarrative(
    query: RetrospectiveQuery,
    unreadable: UnreadableSource[],
  ): Promise<Narrative> {
    const spanned = weeksOverlapping(query.range);
    const inRange = new Set(spanned);

    const onDisk = await this.vault.list(LOG_DIR);
    const present = new Set<string>();

    for (const slug of onDisk) {
      if (!isWeekId(slug)) {
        // A hand-made copy — `2026-W12 copy.md`. Surfaced by path rather than
        // parsed as a week or silently skipped (research R4).
        unreadable.push({
          path: `${LOG_DIR}/${slug}.md`,
          line: null,
          raw: slug,
          reason: "not-a-week-file",
        });
        continue;
      }
      if (inRange.has(slug)) present.add(slug);
    }

    const weeks: WeekNarrative[] = [];
    // Weeks whose log actually produced content. Distinct from `present`, which
    // records only that the *directory listed* a file: a log deleted between
    // the listing and the read is present and unreadable, and counting it as
    // reviewed on the strength of the listing is how such a week went missing
    // from both sets (FR-028, SC-007).
    const read = new Set<string>();

    for (const week of [...present].sort().reverse()) {
      const content = await this.vault.read(reviewPath(week));
      if (content === null) {
        // Surfaced by path, never silently dropped (FR-020). No raw text: there
        // is nothing on disk left to quote. The week itself falls through to
        // the unreviewed report, which is what the files now say about it.
        unreadable.push({
          path: reviewPath(week),
          line: null,
          raw: "",
          reason: "unreadable-file",
        });
        continue;
      }
      read.add(week);
      const review = parseReview(content, week);
      weeks.push({
        week,
        span: weekSpan(week),
        status: review.status,
        note: review.note,
        slipped: review.topThree?.slipped ?? [],
        waiting: review.waiting,
        summary: review.summary,
      });
    }

    return {
      weeks,
      // Taken from what was *read*, not from what was listed, so every week
      // overlapping the range lands in exactly one of the two sets and the
      // accounting invariant holds by construction (SC-007).
      unreviewed: {
        weeks: spanned.filter((w) => !read.has(w)),
        weeksInRange: spanned.length,
      },
    };
  }
}

/**
 * A project's ledger, read and presented.
 *
 * Carried through unmapped, which is what makes FR-037 and FR-039 structural:
 * there is no field into which a computed duration could be smuggled, because
 * `afterDays` is the ledger's own and is already null wherever the record is
 * silent.
 *
 * Exported because FR-036b asks for a reader a later feature can render on
 * another surface *without reimplementing it*, and a module-private function is
 * one nobody else can reach. This feature still renders it in exactly one place
 * — the narrowed retrospective (FR-036a) — and exporting the reader does not
 * add a second surface.
 */
export function historyOf(project: Project): ProjectHistory {
  return {
    slug: project.slug,
    title: project.title,
    status: project.status,
    entries: project.ledger,
  };
}

function validate(query: RetrospectiveQuery): { ok: false; reason: "invalid-date" | "range-inverted"; message: string } | null {
  const { from, to } = query.range;

  // Checked first, so an inverted comparison is never performed on a value that
  // is not a date in the first place.
  for (const [label, value] of [
    ["start", from],
    ["end", to],
  ] as const) {
    if (!isLocalDate(value)) {
      return {
        ok: false,
        reason: "invalid-date",
        message: `The ${label} date "${value}" is not a calendar date. Use YYYY-MM-DD.`,
      };
    }
  }

  if (to < from) {
    return {
      ok: false,
      reason: "range-inverted",
      message: `The end date ${to} is before the start date ${from}. Nothing was read.`,
    };
  }

  return null;
}
