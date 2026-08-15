import type { WaitingItem } from "./types";

/**
 * The two things derived from a waiting-for item. Neither is ever stored.
 *
 * Derived rather than kept as fields for the same reason `gaps` and `needsDri`
 * are: a stored copy drifts the first time the user edits the file by hand, and
 * hand-editing is the whole promise of a plain-text vault.
 */

/**
 * Still waiting on someone? False once anything has been received (FR-042).
 *
 * Asked of the whole history rather than the last action, because a hand-edited
 * file can put the lines in any order. The question is whether it arrived, not
 * when the line was typed.
 */
export function outstanding(item: WaitingItem): boolean {
  return !item.actions.some((action) => action.kind === "received");
}

/**
 * The date this item was last touched — the last action, or the date it started
 * waiting when there have been none (FR-037).
 *
 * This, not `since`, is what the staleness rule is asked about. **Chasing
 * something is touching it**: an item chased last Friday is not neglected,
 * however long it has been outstanding. `since` stays visible beside it, so the
 * review can show "waiting three months, chased weekly" rather than flattening
 * the two into one misleading number.
 */
export function untouchedSince(item: WaitingItem): string {
  const last = item.actions[item.actions.length - 1];
  return last?.on ?? item.since;
}
