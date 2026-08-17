import type { WeekId } from "./types";

/**
 * The ISO-8601 week a local date falls in, as `YYYY-Www`.
 *
 * Written rather than depended on. It is fifteen lines of arithmetic for logic
 * that will never change — ISO-8601 is frozen — and any dependency would be a
 * supply-chain surface and an install on a machine whose stated rule is that it
 * never runs one. `Temporal.PlainDate.weekOfYear` is the right long-term answer
 * and is not available unflagged on Node 22; this signature is shaped so its
 * body can be swapped without touching a caller (research R1).
 *
 * Three rules, and the third is the one that surprises people:
 *
 *   1. Weeks begin on Monday.
 *   2. Week 01 is the week containing the first Thursday of the year.
 *   3. The label carries the **ISO week-numbering year**, not the calendar year
 *      of the date. So 1 January 2027 reads `2026-W53`. That looks wrong at a
 *      glance and is correct: it is what makes every week belong to exactly one
 *      identifier, with none skipped and none shared (FR-003b).
 *
 * The date is read in **local** time throughout. "Which week is it" is a
 * question about the user's midnight, not UTC's.
 *
 * See specs/004-top-three-wip-limit/contracts/top-three-api.md
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoWeek(date: Date): WeekId {
  // Move to UTC midnight of the same calendar day, so the arithmetic below
  // cannot be shifted by a daylight-saving transition mid-week.
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  // The Thursday of this week is what fixes both the year and the number.
  const thursday = new Date(day + (3 - mondayBased(day)) * DAY_MS);
  const year = thursday.getUTCFullYear();

  // 4 January is always in week 01, by rule 2 — so the Thursday of its week is
  // the anchor every other week counts from.
  const jan4 = Date.UTC(year, 0, 4);
  const firstThursday = jan4 + (3 - mondayBased(jan4)) * DAY_MS;

  const week = 1 + Math.round((thursday.getTime() - firstThursday) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Day of week with Monday as 0, which is the ISO convention. */
function mondayBased(utcMs: number): number {
  return (new Date(utcMs).getUTCDay() + 6) % 7;
}

/** Whether a string is shaped like a week identifier. */
export function isWeekId(value: string): boolean {
  return /^\d{4}-W\d{2}$/.test(value);
}

/**
 * The Monday a week identifier names, as a local date.
 *
 * The inverse of `isoWeek`, and built from the same anchor it uses — 4 January
 * is always in week 01, so the Monday of week 01 is the Monday on or before it,
 * and every other week is a multiple of seven days from there.
 *
 * Local rather than UTC, so `isoWeek(weekStart(id)) === id` holds in every time
 * zone. A UTC midnight is the previous day west of Greenwich, which would put
 * the answer in the wrong week for anyone in the Americas.
 */
export function weekStart(id: WeekId): Date {
  const [yearPart = "", weekPart = ""] = id.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);

  const jan4 = new Date(year, 0, 4);
  const mondayOfWeek1 = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7));

  const monday = new Date(mondayOfWeek1);
  monday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);
  return monday;
}

/**
 * The Sunday a week identifier ends on, as a local date.
 *
 * `weekStart` plus six days, and here rather than in the one module that needs
 * it for the reason `daysBetween` states about itself: one definition, because
 * two would disagree. Week arithmetic has exactly one home, and a three-line
 * copy elsewhere is the kind that is tempting to write and impossible to spot.
 *
 * Added by Feature 6, which shows each week's span beside its identifier so a
 * week only partly inside a date range is legible as such (006 FR-028).
 */
export function weekEnd(id: WeekId): Date {
  const sunday = weekStart(id);
  sunday.setDate(sunday.getDate() + 6);
  return sunday;
}

/**
 * The week after this one.
 *
 * Deliberately *not* `week + 1`, and deliberately not `+ 7 days` on a parsed
 * date either. Both are wrong at a year boundary: 2026 has 53 ISO weeks, so
 * `2026-W53` is followed by `2027-W01` rather than `2026-W54`, and a naive
 * increment produces an identifier no parser will accept. Round-tripping
 * through `isoWeek` means there is exactly one implementation of week
 * arithmetic in the repo, and this is not it (research R9).
 */
export function nextWeek(id: WeekId): WeekId {
  const monday = weekStart(id);
  monday.setDate(monday.getDate() + 7);
  return isoWeek(monday);
}
