import type { Clock, VaultStore } from "../ports/index";
import { localDate } from "../vault/lists";
import { parseUnreadable, parseWaiting, tryAppendAction } from "./waiting-document";
import type { UnreadableLine, WaitingItem, WaitingOutcome, WaitingRef } from "./types";

/**
 * The single entry point for delegated work.
 *
 * Small, because there is very little to decide: an item is recorded as chased
 * or as arrived, and **nothing is ever deleted**. A received item stays in the
 * file with its whole history — the habit `trash.md` established, where the
 * file grows and pruning is the user's business (FR-043c).
 *
 * What is *not* here is the point: there is no verb that sends a message,
 * schedules a reminder, or contacts an owner. "Waiting for Priya" is a note to
 * self, and a nudge sent on the user's behalf would be the application speaking
 * in their name (FR-046).
 *
 * The same two habits as `ProjectService`: every read fresh, and every write
 * verifies its own entry first.
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

export const WAITING_PATH = "waiting.md";

export interface WaitingServiceDeps {
  vault: VaultStore;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export class WaitingService {
  private readonly vault: VaultStore;
  private readonly clock: Clock;
  /** Tail of the write queue. Same discipline as `TopThreeService`. */
  private writes: Promise<void> = Promise.resolve();

  constructor(deps: WaitingServiceDeps) {
    this.vault = deps.vault;
    this.clock = deps.clock ?? systemClock;
  }

  /** Every item in the file, in file order. An absent file has none. */
  async list(): Promise<WaitingItem[]> {
    const content = await this.vault.read(WAITING_PATH);
    return content === null ? [] : parseWaiting(content);
  }

  /**
   * The lines this grammar cannot read, for a surface to show as they read.
   *
   * Separate from `list()` because they are a different kind of thing: an item
   * can be chased or received, and one of these can only be looked at and fixed
   * by hand. Folding them into the item list would mean inventing an owner and
   * a date for a line whose whole problem is not having them (FR-044).
   */
  async unreadable(): Promise<UnreadableLine[]> {
    const content = await this.vault.read(WAITING_PATH);
    return content === null ? [] : parseUnreadable(content);
  }

  /**
   * Both halves of the file, from **one** read (009 FR-011a).
   *
   * Additive beside `list()` and `unreadable()`, which keep their behaviour and
   * their callers. It exists because those two each read `waiting.md`, and a
   * surface that shows the items *and* the lines that would otherwise go
   * missing would spend two reads on one file to get one answer.
   *
   * Not a replacement for either: migrating `ReviewService.waitingStep()` onto
   * this would touch shipped, covered behaviour for no gain to the caller that
   * needed it.
   */
  async read(): Promise<{ items: WaitingItem[]; unreadable: UnreadableLine[] }> {
    const content = await this.vault.read(WAITING_PATH);
    if (content === null) return { items: [], unreadable: [] };
    return { items: parseWaiting(content), unreadable: parseUnreadable(content) };
  }

  /** Chased. The item stays outstanding; its `since` is untouched (FR-041). */
  async recordFollowUp(ref: WaitingRef): Promise<WaitingOutcome> {
    return this.append(ref, "followed-up");
  }

  /** Arrived. The line and its history stay in the file (FR-043c). */
  async recordReceived(ref: WaitingRef): Promise<WaitingOutcome> {
    return this.append(ref, "received");
  }

  private append(ref: WaitingRef, kind: "followed-up" | "received"): Promise<WaitingOutcome> {
    return this.serialize(async () => {
      const content = await this.vault.read(WAITING_PATH);
      if (content === null) {
        // No file, so nothing to append to — and none is created. A vault gains
        // `waiting.md` by sorting something into it, never by being asked about
        // one (Principle IV).
        return refuse("not-found", "There is no waiting-for list yet. Nothing was written.");
      }

      const next = tryAppendAction(content, ref, { kind, on: localDate(this.clock.now()) });
      if (next === null) {
        return refuse(
          "entry-changed",
          "That item changed on disk since it was shown, so nothing was written. " +
            "Here is the list as it now reads.",
        );
      }

      await this.vault.write(WAITING_PATH, next);

      const written = parseWaiting(next)[ref.index];
      return written === undefined
        ? refuse("not-found", "That item is no longer in the list. Nothing was written.")
        : { ok: true, item: written };
    });
  }

  /**
   * One write at a time.
   *
   * Every write here is a read-modify-write of one file, so two overlapping
   * calls would both read the same content and the second would silently
   * discard the first. The review chases several items in a row, which is
   * exactly the shape that produces the race.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work, work);
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function refuse(reason: "entry-changed" | "not-found", message: string): WaitingOutcome {
  return { ok: false, reason, message };
}
