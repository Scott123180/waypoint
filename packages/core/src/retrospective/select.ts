import type { Project } from "../projects/types";
import { parseOutcome, weekLines } from "../weekly/top-three-document";
import type { Outcome, WeekId } from "../weekly/types";
import type {
  Completion,
  DateRange,
  OutcomeCompletion,
  OutcomeWeekGroup,
  UnreadableSource,
} from "./types";

/**
 * Which records a range contains, and in what order.
 *
 * Pure throughout: no I/O, no clock. Everything here is a function of records
 * already parsed, which is what lets the selection rules be tested without a
 * filesystem — the same split `projects/gaps.ts` uses beside its service.
 *
 * See specs/006-retrospective-view/research.md R3, R8
 */

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a string is a real local calendar date.
 *
 * Shape is not enough, and this is the whole reason this function exists rather
 * than a bare regexp. `parseMilestone`'s date tail is `/(\d{4}-\d{2}-\d{2})$/`,
 * so a hand-typed `— done 2026-13-45` reaches `completedOn` intact and matches
 * every shape check in the repo. Comparing it as text would sort it after every
 * real December date and place it in any range that reaches 2026; handing it to
 * `daysBetween` would produce a number. It is not a date, and the only honest
 * answer is to say so and show it verbatim (FR-018).
 *
 * The round-trip is what rejects it: `new Date(2026, 12, 45)` rolls over into
 * 2027 and no longer reads back as the parts it was built from.
 */
export function isLocalDate(value: string): boolean {
  const m = LOCAL_DATE.exec(value);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Whether a local calendar date falls in a range, both endpoints inclusive.
 *
 * Text comparison, deliberately, and not a shortcut: `YYYY-MM-DD` sorts
 * lexicographically in calendar order, and parsing to instants is precisely
 * what would let a timezone or a DST transition move a completion across a
 * boundary — the recalculation FR-052 forbids (FR-001, FR-002).
 */
export function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** A completion's date, split three ways: dated, undated, or written-but-not-a-date. */
function classify(recorded: string | null): { completedOn: string | null; rawDate: string | null } {
  if (recorded === null || recorded.trim().length === 0) return { completedOn: null, rawDate: null };
  return isLocalDate(recorded)
    ? { completedOn: recorded, rawDate: null }
    : { completedOn: null, rawDate: recorded };
}

/**
 * Every completion a project records, before the range is applied.
 *
 * Both kinds come from the same pass over the same parsed file, because both
 * live in it — there is no second read and no join.
 */
export function completionsOf(project: Project): Completion[] {
  const out: Completion[] = [];

  // Either half is enough, and the disjunction is the point. `status: done`
  // with no date is a completion the user never dated, and belongs in the
  // undated set rather than vanishing. A date while the status says `active` is
  // a hand-edited state the format permits, and dropping it would be the reader
  // quietly deciding the file is wrong (FR-016, FR-019).
  if (project.status === "done" || project.completedOn !== null) {
    out.push({
      kind: "project",
      text: project.title,
      projectSlug: project.slug,
      projectTitle: project.title,
      ...classify(project.completedOn),
      index: -1,
    });
  }

  for (const m of project.milestones) {
    if (!m.done) continue;
    out.push({
      kind: "milestone",
      text: m.definitionOfDone,
      projectSlug: project.slug,
      projectTitle: project.title,
      ...classify(m.completedOn),
      index: m.index,
    });
  }

  return out;
}

/**
 * Ordering: newest first, with a tie-break made of data.
 *
 * Two things finished on the same day have no recorded order, so one is
 * invented — but it is invented from the slug and the milestone index, both of
 * which are part of a record's identity. Nothing depends on read order,
 * filesystem order, or insertion order, which is what makes the same fixture
 * render to the same bytes on any machine (SC-003, research R8).
 */
export function compareCompletions(a: Completion, b: Completion): number {
  const dateA = a.completedOn ?? "";
  const dateB = b.completedOn ?? "";
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  if (a.projectSlug !== b.projectSlug) return a.projectSlug < b.projectSlug ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "project" ? -1 : 1;
  return a.index - b.index;
}

/** The dated-in-range set and the undated set, from every project given. */
export function selectCompletions(
  projects: readonly Project[],
  range: DateRange,
): { completions: Completion[]; undated: Completion[] } {
  const completions: Completion[] = [];
  const undated: Completion[] = [];

  for (const project of projects) {
    for (const c of completionsOf(project)) {
      if (c.completedOn !== null) {
        if (inRange(c.completedOn, range)) completions.push(c);
      } else {
        // Undated records are shown, never placed. A range cannot contain them,
        // and inferring one is the single thing this feature exists not to do
        // (FR-016, FR-017).
        undated.push(c);
      }
    }
  }

  completions.sort(compareCompletions);
  undated.sort(compareCompletions);
  return { completions, undated };
}

// ---------------------------------------------------------------------------
// Weekly outcomes
// ---------------------------------------------------------------------------

/**
 * Outcomes completed in range, grouped by the week they were committed to.
 *
 * The grouping and the date answer different questions — an outcome promised
 * for W20 and finished in W23 belongs under W20 and carries its W23 date — so
 * both are kept (FR-011, FR-013).
 */
export function selectOutcomes(
  weeks: ReadonlyArray<{ id: WeekId; outcomes: readonly Outcome[] }>,
  range: DateRange,
): { groups: OutcomeWeekGroup[]; undated: OutcomeCompletion[] } {
  const groups: OutcomeWeekGroup[] = [];
  const undated: OutcomeCompletion[] = [];

  for (const week of weeks) {
    const outcomes: OutcomeCompletion[] = [];
    for (const o of week.outcomes) {
      if (!o.done) continue;
      const entry: OutcomeCompletion = {
        week: week.id,
        text: o.text,
        ...classify(o.completedOn),
        index: o.index,
      };
      if (entry.completedOn === null) undated.push(entry);
      else if (inRange(entry.completedOn, range)) outcomes.push(entry);
    }
    if (outcomes.length > 0) groups.push({ week: week.id, outcomes });
  }

  groups.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
  undated.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : a.index - b.index));
  return { groups, undated };
}

/**
 * Lines inside an in-range week section that are not outcomes.
 *
 * `parseTopThree` drops these — correctly, for its callers, which want the
 * outcomes. FR-020 says they must not be dropped silently, so this walks the
 * same sections again with the same exported, total `parseOutcome`. One
 * grammar; this reader just keeps the rejects (research R6).
 */
export function unreadableOutcomeLines(
  content: string | null,
  path: string,
  weeks: readonly string[],
): UnreadableSource[] {
  if (content === null) return [];
  const all = content.split("\n");
  const out: UnreadableSource[] = [];

  for (const week of weeks) {
    for (const raw of weekLines(content, week)) {
      if (raw.trim().length === 0) continue;
      if (raw.startsWith("#")) continue;
      if (parseOutcome(raw, 0) !== null) continue;
      out.push({
        path,
        // 1-based, matching the editor gutter. `indexOf` is exact here because
        // the line came out of this same content.
        line: all.indexOf(raw) + 1,
        raw,
        reason: "unreadable-line",
      });
    }
  }
  return out;
}
