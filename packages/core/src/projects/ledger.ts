import { daysBetween } from "../vault/lists";
import type { LedgerEntry, ProjectStatus } from "./types";

/**
 * The project ledger's grammar, and the one thing derived from it.
 *
 * ```text
 * entry := "- " date " " action " " detail [" — after " days "d " state]
 * ```
 *
 * An append-only history in the project's own file. Two properties are worth
 * naming, because both are easy to lose without noticing:
 *
 *   1. **There is no verb that edits an entry.** Nothing here rewrites,
 *      reorders, or removes one — including entries the user typed by hand. The
 *      only write is an append (FR-091).
 *
 *   2. **The tail is written only when the ledger knows.** A duration is
 *      observable at the transition and nowhere else. With no prior entry
 *      entering the state that just ended, the entry simply carries no
 *      ` — after …` — the same refusal to invent a date that keeps a
 *      hand-written inbox line from getting a capture timestamp (FR-094).
 *
 * `status` is the only action this feature writes, but the shape generalises:
 * `- 2026-08-15 milestone done Ship the runbook` parses here today, so a later
 * record type can carry a ledger without changing what a project's ledger means
 * (FR-096).
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

export type { LedgerEntry } from "./types";

const ENTRY = /^- (\d{4}-\d{2}-\d{2}) (\S+) (.+)$/;
/** The optional duration tail, matched off the end of `detail`. */
const TAIL = /^(.*?) — after (\d+)d (\S+)$/;

/** The arrow a status entry's detail is built around. */
const ARROW = "→";

export const LEDGER_ACTION_STATUS = "status";

/**
 * One line, or null when the line is not an entry.
 *
 * Null covers a blank line, a note the user left in the section, and a line
 * whose date is not a date. All of them stay in the file exactly as they are;
 * "not an entry" means "not counted", never "removed" (FR-091).
 */
export function parseLedgerLine(line: string): LedgerEntry | null {
  const m = ENTRY.exec(line);
  if (!m) return null;

  const on = m[1] ?? "";
  // A syntactically well-formed date that is not a real one — 2026-13-99 — is
  // not an entry. Accepting it would put an unorderable date in a history whose
  // whole value is its order.
  if (!isRealDate(on)) return null;

  const rest = (m[3] ?? "").trim();
  const tail = TAIL.exec(rest);

  return {
    on,
    action: m[2] ?? "",
    detail: tail ? (tail[1] ?? "") : rest,
    afterDays: tail ? Number(tail[2]) : null,
    afterState: tail ? (tail[3] ?? null) : null,
    raw: line,
  };
}

export function renderLedgerLine(entry: Omit<LedgerEntry, "raw">): string {
  const tail =
    entry.afterDays === null || entry.afterState === null
      ? ""
      : ` — after ${entry.afterDays}d ${entry.afterState}`;
  return `- ${entry.on} ${entry.action} ${entry.detail}${tail}`;
}

/**
 * The line a status change writes.
 *
 * `since` is the date the ending state began, or null when the ledger does not
 * say — which is the only thing that decides whether a duration is recorded.
 */
export function renderStatusChange(input: {
  on: string;
  from: ProjectStatus;
  to: ProjectStatus;
  since: string | null;
}): string {
  const days = input.since === null ? null : daysBetween(input.since, input.on);
  return renderLedgerLine({
    on: input.on,
    action: LEDGER_ACTION_STATUS,
    detail: `${input.from} ${ARROW} ${input.to}`,
    // A negative span means the file's dates disagree with each other, which a
    // hand-edit can always arrange. Recording "after -3d" would be the system
    // reporting nonsense with a straight face.
    afterDays: days === null || days < 0 ? null : days,
    afterState: days === null || days < 0 ? null : input.from,
  });
}

/**
 * The date the given status was entered, or null when the ledger does not say.
 *
 * **Last match, not first.** A project that has bounced between statuses is
 * asking about its current spell; reading the first match would date it from
 * the first time it was ever in that state and leave it permanently stale.
 *
 * Only `status` entries answer: another action's detail may happen to contain
 * an arrow, and letting it count would date a status from an unrelated event.
 */
export function statusSince(entries: readonly LedgerEntry[], status: string): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || entry.action !== LEDGER_ACTION_STATUS) continue;
    if (entered(entry.detail) === status.trim().toLowerCase()) return entry.on;
  }
  return null;
}

/** The right-hand side of `from → to`, or null when the detail is not a transition. */
function entered(detail: string): string | null {
  const at = detail.lastIndexOf(ARROW);
  if (at === -1) return null;
  const to = detail.slice(at + ARROW.length).trim().toLowerCase();
  return to.length === 0 ? null : to;
}

function isRealDate(value: string): boolean {
  const [y = "", m = "", d = ""] = value.split("-");
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}
