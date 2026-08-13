import type { Milestone } from "./types";

/**
 * The milestone line format, both directions.
 *
 *   - [x] <definition of done> — @<verifier> — done <YYYY-MM-DD>
 *
 * Parsed right-to-left from strict tail patterns: strip a trailing
 * `— done <date>`, then a trailing `— @<verifier>`, and whatever remains is the
 * definition of done, verbatim. That ordering is what makes a definition of
 * done containing ` — ` or an `@` safe — ordinary prose does not match a tail
 * pattern, and anything that fails to match stays part of the text rather than
 * becoming an error (research R2).
 *
 * See specs/003-project-structure/contracts/project-format.md
 */

/** What a milestone line carries, before it knows where it sits in the file. */
export type MilestoneFields = Omit<Milestone, "index" | "raw">;

const TASK_LINE = /^- \[([ xX])\] (.*)$/;
const DONE_TAIL = / — done (\d{4}-\d{2}-\d{2})$/;
const VERIFIER_TAIL = / — @(\S.*)$/;

export const MILESTONE_SEPARATOR = " — ";

/**
 * Reads one line, or null when it is not a milestone at all.
 *
 * Never throws. A line under `## Milestones` that does not parse is simply not
 * a milestone, and the caller leaves it exactly where it is.
 */
export function parseMilestone(line: string): Omit<Milestone, "index"> | null {
  const match = TASK_LINE.exec(line);
  if (!match) return null;

  const state = match[1] ?? " ";
  let rest = match[2] ?? "";

  // Right to left: the date tail first, since it sits outside the verifier.
  let completedOn: string | null = null;
  const doneMatch = DONE_TAIL.exec(rest);
  if (doneMatch) {
    completedOn = doneMatch[1] ?? null;
    rest = rest.slice(0, doneMatch.index);
  }

  let verifier: string | null = null;
  const verifierMatch = VERIFIER_TAIL.exec(rest);
  if (verifierMatch) {
    verifier = (verifierMatch[1] ?? "").trim();
    rest = rest.slice(0, verifierMatch.index);
  }

  const definitionOfDone = rest.trim();
  // A checkbox with nothing after it is not a milestone; it is a line the user
  // is halfway through typing, and inventing an empty milestone from it would
  // put a nameless entry in their file.
  if (definitionOfDone.length === 0) return null;

  return {
    definitionOfDone,
    verifier,
    done: state.toLowerCase() === "x",
    completedOn,
    raw: line,
  };
}

/**
 * Writes one line.
 *
 * Absent fields are omitted entirely rather than written empty — the same rule
 * Feature 2's stub follows, for the same reason: a placeholder is metadata the
 * user has to maintain before it means anything.
 */
export function renderMilestone(m: MilestoneFields): string {
  let line = `- [${m.done ? "x" : " "}] ${m.definitionOfDone}`;
  if (m.verifier !== null && m.verifier.length > 0) line += `${MILESTONE_SEPARATOR}@${m.verifier}`;
  if (m.completedOn !== null) line += `${MILESTONE_SEPARATOR}done ${m.completedOn}`;
  return line;
}

/** Whether a line is a milestone, without paying for a full parse. */
export function isMilestoneLine(line: string): boolean {
  return parseMilestone(line) !== null;
}
