import { localDate } from "../vault/lists";
import { isoWeek, nextWeek, weekEnd, weekStart } from "../weekly/iso-week";
import type { WeekId } from "../weekly/types";
import type { DateRange } from "./types";

/**
 * Which weeks a date range touches, and what each one spans.
 *
 * Pure. Walks with `nextWeek` rather than adding seven days, which is that
 * function's own instruction: 2026 has 53 ISO weeks, so `2026-W53` is followed
 * by `2027-W01` and a naive increment produces an identifier no parser accepts.
 * Round-tripping through `isoWeek` keeps one implementation of week arithmetic
 * in the repo, and this is not a second one (research R5).
 *
 * See specs/006-retrospective-view/data-model.md
 */

/** A local `YYYY-MM-DD` read back to a local Date at midday. */
function atMidday(date: string): Date {
  const [y = "0", m = "1", d = "1"] = date.split("-");
  // Midday, not midnight: the arithmetic below never crosses a DST boundary
  // from the middle of a day, so a week's Monday cannot slip to the Sunday.
  return new Date(Number(y), Number(m) - 1, Number(d), 12);
}

/** The Monday and Sunday a week identifier spans, as local calendar dates. */
export function weekSpan(id: WeekId): DateRange {
  return { from: localDate(weekStart(id)), to: localDate(weekEnd(id)) };
}

/**
 * Every week overlapping the range, ascending.
 *
 * Overlap at any single day is enough (FR-028). Including only fully-covered
 * weeks would silently drop the note for the week a quarter ends in, which is
 * usually the most relevant one; stating each week's span is what keeps the
 * partial overlap honest instead.
 */
export function weeksOverlapping(range: DateRange): WeekId[] {
  const first = isoWeek(atMidday(range.from));
  const out: WeekId[] = [];

  let week = first;
  // Guarded by the range's own end rather than by a count: a week is in as soon
  // as it starts on or before `to`, because it then shares at least one day.
  for (let guard = 0; guard < MAX_WEEKS; guard += 1) {
    if (localDate(weekStart(week)) > range.to) break;
    out.push(week);
    week = nextWeek(week);
  }
  return out;
}

/**
 * A ceiling on the walk, so a malformed range cannot spin forever.
 *
 * Two hundred years of weeks. Not a cap on what the user may ask for — the
 * result is never capped (FR-006a) — but a guard against an endpoint that got
 * past validation, which would otherwise be an unkillable loop rather than a
 * wrong answer.
 */
const MAX_WEEKS = 200 * 53;
