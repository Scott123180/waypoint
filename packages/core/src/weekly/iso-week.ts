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
