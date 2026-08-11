import { randomUUID } from "node:crypto";

import type { Clock, InboxDocument, SortJournal, VaultStore } from "../ports/index";
import { calendarLine, trashLine, waitingLine, type RoutableItem } from "../vault/lists";
import { insertUnprocessed } from "../vault/unprocessed";
import { newEntry, planRecovery, type SortJournalEntry } from "./journal";
import type { ItemRef, SortDecision, SortOutcome } from "./decision";

/**
 * The four-step commit: journal → destination → inbox removal → clear.
 *
 * This is the one place where a bug loses a thought, so the ordering is
 * deliberate and the failure modes are all spelled out. See research R2.
 */

export interface CommitDeps {
  inbox: InboxDocument;
  vault: VaultStore;
  journal: SortJournal;
  clock: Clock;
}

/** Where a decision's item is written, and what it writes there. */
interface Target {
  /** Vault-relative path, also the value reported back to the caller. */
  path: string;
  /** Appends the item, idempotently. */
  apply(deps: CommitDeps, item: RoutableItem, now: Date): Promise<void>;
}

function listTarget(
  path: string,
  render: (item: RoutableItem, now: Date) => string,
): Target {
  return {
    path,
    async apply(deps, item, now) {
      const line = render(item, now);
      const existing = (await deps.vault.read(path)) ?? "";
      // Idempotent: replaying a completed step must not duplicate the line.
      if (existing.includes(`${line}\n`)) return;
      await deps.vault.appendLine(path, line);
    },
  };
}

function sectionTarget(path: string, block: string): Target {
  return {
    path,
    async apply(deps) {
      const existing = await deps.vault.read(path);
      if (existing === null) {
        // FR-020c: a destination the user deleted is never silently recreated.
        // Reaching here means the caller already checked, so this is a race.
        throw new DestinationMissing(path);
      }
      if (existing.includes(`${block}\n`)) return;
      await deps.vault.write(path, insertUnprocessed(existing, block));
    },
  };
}

class DestinationMissing extends Error {
  constructor(readonly path: string) {
    super(`destination ${path} no longer exists`);
    this.name = "DestinationMissing";
  }
}

/** Renders the block a project or area file receives. */
function unprocessedBlock(item: RoutableItem): string {
  const { text, capturedAt } = item;
  const [first = "", ...rest] = text.split("\n");
  const prefix = capturedAt ? `${isoLocal(capturedAt)} ` : "";
  let out = `- ${prefix}${first}`;
  for (const line of rest) out += line.length === 0 ? "\n" : `\n  ${line}`;
  return out;
}

// Re-exported through serialize to keep one timestamp format in the codebase.
import { formatTimestamp as isoLocal } from "../inbox/serialize";

export function targetFor(decision: SortDecision, item: RoutableItem, now: Date): Target {
  switch (decision.to) {
    case "waiting":
      return listTarget("waiting.md", (i, n) => waitingLine(i, ownerOf(decision), n));
    case "calendar":
      return listTarget("calendar.md", calendarLine);
    case "trash":
      return listTarget("trash.md", trashLine);
    case "project":
    case "area": {
      const dir = decision.to === "project" ? "projects" : "areas";
      const slug = "slug" in decision ? decision.slug : "";
      return sectionTarget(`${dir}/${slug}.md`, unprocessedBlock(item));
    }
  }
}

function ownerOf(decision: SortDecision): string {
  return decision.to === "waiting" ? decision.owner : "";
}

/**
 * Runs the full commit for one decision.
 *
 * Ordering rationale:
 * - The inbox is verified *before* anything is written, so an ordinary refusal
 *   leaves every file untouched.
 * - The destination is written before the inbox is touched, so an interruption
 *   leaves a recoverable duplicate rather than a lost thought (FR-020).
 * - The journal brackets both, so the next launch can finish the pair
 *   (FR-020d).
 */
export async function commitDecision(
  deps: CommitDeps,
  ref: ItemRef,
  decision: SortDecision,
  item: RoutableItem,
): Promise<SortOutcome> {
  const now = deps.clock.now();

  const before = await deps.inbox.read();
  if (!bytesMatch(before, ref)) {
    return {
      ok: false,
      reason: "item-changed",
      message:
        "The item changed on disk since it was shown, so nothing was written. " +
        "Here it is as it now reads.",
    };
  }

  const target = targetFor(decision, item, now);
  const entry = newEntry(randomUUID(), ref, decision, now);

  await deps.journal.begin(entry);

  try {
    await target.apply(deps, item, now);
  } catch (err) {
    await deps.journal.clear(entry.id);
    if (err instanceof DestinationMissing) {
      return {
        ok: false,
        reason: "destination-missing",
        message: `${target.path} no longer exists. Nothing was written; choose again.`,
      };
    }
    return {
      ok: false,
      reason: "write-failed",
      message: `Could not write ${target.path}. Nothing was removed from the inbox.`,
    };
  }

  await deps.journal.markDestinationWritten(entry.id);

  let removal: "removed" | "mismatch";
  try {
    removal = await deps.inbox.removeRange(ref.start, ref.end, ref.raw);
  } catch {
    // The destination has the item and the inbox still does. Leaving the entry
    // pending lets the next launch finish the removal.
    return {
      ok: false,
      reason: "write-failed",
      message:
        `Saved to ${target.path}, but the inbox could not be updated. ` +
        "The item is safe; it will be tidied up on the next start.",
    };
  }

  await deps.journal.clear(entry.id);

  if (removal === "mismatch") {
    // The item changed in the window between our check and the write. The
    // destination copy exists, so this is the FR-020 duplicate — recoverable,
    // and reported rather than hidden.
    return {
      ok: false,
      reason: "item-changed",
      message:
        `The item changed while it was being filed. A copy was saved to ${target.path}, ` +
        "and the inbox still holds the edited version — remove whichever you do not want.",
    };
  }

  return { ok: true, destination: target.path };
}

/** Replays whatever was in flight when the process last stopped. */
export async function recoverPending(
  deps: CommitDeps,
  itemOf: (entry: SortJournalEntry) => RoutableItem,
): Promise<{ completed: number; abandoned: number }> {
  const pending = (await deps.journal.pending()) as SortJournalEntry[];
  let completed = 0;
  let abandoned = 0;

  for (const entry of pending) {
    const inbox = await deps.inbox.read();
    const action = planRecovery(entry, inbox);

    if (action.do === "abandon") {
      await deps.journal.clear(entry.id);
      abandoned += 1;
      continue;
    }

    const item = itemOf(entry);
    const now = new Date(entry.startedAt);
    const target = targetFor(entry.decision, item, now);

    if (action.do === "write-destination-then-remove") {
      await target.apply(deps, item, now);
      await deps.journal.markDestinationWritten(entry.id);
    }

    await deps.inbox.removeRange(entry.ref.start, entry.ref.end, entry.ref.raw);
    await deps.journal.clear(entry.id);
    completed += 1;
  }

  return { completed, abandoned };
}

function bytesMatch(doc: string, ref: ItemRef): boolean {
  const actual = Buffer.from(doc, "utf8").subarray(ref.start, ref.end).toString("utf8");
  return actual === ref.raw;
}
