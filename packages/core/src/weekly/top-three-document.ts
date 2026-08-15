import { isWeekId } from "./iso-week";
import type { Outcome, Week, WeekId } from "./types";

/**
 * Reading and writing `top-three.md`.
 *
 * The same two rules that govern `projects/document.ts`:
 *
 *   1. **Parsing never fails.** Unknown headings, prose under a week, a
 *      hand-edited fourth outcome and odd spacing are all carried through
 *      untouched. A file the app refuses to open is a file the app has taken
 *      hostage.
 *
 *   2. **Writing is surgical.** Only the lines of the week being changed are
 *      altered; everything else is reproduced byte for byte, because the vault
 *      is git-tracked and a read that reformats turns every app open into a
 *      diff.
 *
 * **On not reusing `parseMilestone`.** The line *shape* is deliberately the
 * milestone shape — `- [x] text — done YYYY-MM-DD` — because the user already
 * knows what it means (Principle VII). The parsing is local because the
 * semantics differ in one way that matters: a milestone has a verifier tail,
 * and an outcome has nobody to name. Running an outcome through the milestone
 * parser would read a hand-typed `— @Priya` as a verifier and silently drop it
 * the next time that line was rewritten. Only the ` — done <date>` tail is
 * interpreted here; everything else before it is the user's text, verbatim.
 *
 * See specs/004-top-three-wip-limit/contracts/data-files.md
 */

const H2 = /^##\s+(.+?)\s*$/;
const TASK_LINE = /^- \[([ xX])\] (.*)$/;
const DONE_TAIL = / — done (\d{4}-\d{2}-\d{2})$/;

export const SEPARATOR = " — ";

/** What an outcome line carries, before it knows where it sits. */
export type OutcomeFields = Pick<Outcome, "text" | "done" | "completedOn">;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every week in the file, in file order (newest first by convention). */
/**
 * A week as the *file* describes it.
 *
 * `current` and `writable` are both answers about the clock, which this module
 * does not have. The service adds them (Feature 5 widened the pair from one).
 */
export type ParsedWeek = Omit<Week, "current" | "writable">;

export function parseTopThree(content: string | null): ParsedWeek[] {
  if (content === null || content.length === 0) return [];
  const lines = content.split("\n");

  const weeks: ParsedWeek[] = [];
  let current: { id: WeekId; outcomes: Outcome[] } | null = null;

  for (const line of lines) {
    const heading = H2.exec(line);
    if (heading) {
      if (current) weeks.push(current);
      const id = (heading[1] ?? "").trim();
      // An unrecognized heading closes the previous week without opening one,
      // so a `## Notes` section is never read as a week (FR-015).
      current = isWeekId(id) ? { id, outcomes: [] } : null;
      continue;
    }
    if (!current) continue;

    const outcome = parseOutcome(line, current.outcomes.length);
    if (outcome) current.outcomes.push(outcome);
  }
  if (current) weeks.push(current);

  return weeks;
}

/** One line, or null when it is not an outcome at all. Never throws. */
export function parseOutcome(line: string, index: number): Outcome | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;

  const state = match[1] ?? " ";
  let rest = match[2] ?? "";

  let completedOn: string | null = null;
  const done = DONE_TAIL.exec(rest);
  if (done) {
    completedOn = done[1] ?? null;
    rest = rest.slice(0, done.index);
  }

  const text = rest.trim();
  // A checkbox with nothing after it is a line the user is halfway through
  // typing, not a nameless outcome.
  if (text.length === 0) return null;

  return {
    index,
    text,
    done: state.toLowerCase() === "x",
    completedOn,
    raw: line,
  };
}

/** The raw lines of one week's section, or `[]` when it is not present. */
export function weekLines(content: string | null, week: WeekId): string[] {
  if (content === null) return [];
  const range = sectionRange(content.split("\n"), week);
  return range ? content.split("\n").slice(range.start, range.end) : [];
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function renderOutcome(o: OutcomeFields): string {
  let line = `- [${o.done ? "x" : " "}] ${o.text}`;
  if (o.completedOn !== null) line += `${SEPARATOR}done ${o.completedOn}`;
  return line;
}

/**
 * Replaces one week's body, leaving every other byte alone.
 *
 * When the week is absent it is inserted at the top of the file — newest first,
 * which is where a user opening the file wants the current week, and which is
 * what guarantees no existing week is touched when a new one is set (FR-011).
 */
export function setWeekLines(content: string | null, week: WeekId, lines: string[]): string {
  const existing = content ?? `# Top three\n`;
  const all = existing.split("\n");
  const range = sectionRange(all, week);

  if (range) {
    const next = [...all.slice(0, range.start), ...lines, ...all.slice(range.end)];
    return next.join("\n");
  }

  const at = insertionPoint(all);
  const block = [`## ${week}`, "", ...lines, ""];
  return [...all.slice(0, at), ...block, ...all.slice(at)].join("\n");
}

// ---------------------------------------------------------------------------

/** Body range of a `## <week>`, exclusive of the heading itself. */
function sectionRange(lines: string[], week: WeekId): { start: number; end: number } | null {
  const head = lines.findIndex((l) => {
    const m = H2.exec(l);
    return m !== null && (m[1] ?? "").trim() === week;
  });
  if (head === -1) return null;

  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (H2.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start: head + 1, end };
}

/** Just before the first `##`, or at the end of the preamble. */
function insertionPoint(lines: string[]): number {
  const firstHeading = lines.findIndex((l) => H2.test(l));
  if (firstHeading !== -1) return firstHeading;

  // No sections yet: append after the title and any preamble, trimming the
  // trailing empty element `split` leaves so the file does not grow blank lines
  // on every insert.
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim().length === 0) end--;
  return end === 0 ? lines.length : end + 1;
}
