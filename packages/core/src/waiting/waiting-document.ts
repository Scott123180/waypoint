import { parseInbox } from "../inbox/parse";
import type { UnreadableLine, WaitingAction, WaitingItem, WaitingRef } from "./types";

/**
 * Reading and writing `waiting.md`.
 *
 * ```text
 * item-line    := "- " since " @" owner " — " [capture-timestamp " "] text
 * action-line  := "  - " ("followed up" | "received") " " date
 * continuation := "  " anything-else
 * ```
 *
 * **The item line is Feature 2's, unchanged.** This module reads it and never
 * rewrites it. What is new is everything nested beneath it.
 *
 * **Why a nested bullet rather than a bare indented line.** Feature 2 already
 * uses two-space indentation for the continuation lines of a multi-line
 * thought, so `  followed up 2026-08-20` would be ambiguous with the second
 * line of something the user typed. Resolving that ambiguity wrongly would
 * either swallow their words or invent a follow-up that never happened. A
 * nested bullet is unambiguous against the existing grammar, renders correctly
 * as markdown, and greps cleanly (research R8).
 *
 * The same two rules as every other document here: parsing never fails, and
 * writing is surgical.
 *
 * See specs/005-weekly-review-ritual/contracts/project-ledger.md
 */

const INDENT = "  ";

const ITEM = /^- (\d{4}-\d{2}-\d{2}) @(\S+) — (.*)$/;
const ACTION = /^ {2}- (followed up|received) (\d{4}-\d{2}-\d{2})\s*$/;

export function renderActionLine(action: WaitingAction): string {
  const word = action.kind === "followed-up" ? "followed up" : "received";
  return `${INDENT}- ${word} ${action.on}`;
}

/**
 * Every well-formed item, in file order.
 *
 * A line matching no grammar is not an item and is not counted — and, crucially,
 * is not removed either. It stays exactly where the user put it (FR-044).
 *
 * Not an item is not the same as not there, though, which is what
 * `parseUnreadable` is for: preserving a line on disk while no surface can show
 * it means the user's own words go quietly missing from the one view of their
 * delegated work.
 */
export function parseWaiting(content: string): WaitingItem[] {
  return read(content).items;
}

/**
 * Every non-blank line the parser could not attribute to an item, verbatim,
 * with the 1-based line number the user will find it on.
 *
 * A line inside an open item's block is *not* unreadable — it is that item's
 * second line of text, and it is already shown. What comes back here is only
 * what would otherwise vanish: a malformed item line, and anything orphaned
 * beneath one.
 *
 * The line number is the point. "Something in waiting.md does not parse" sends
 * the user hunting; "line 14 does not parse" sends them to line 14.
 */
export function parseUnreadable(content: string): UnreadableLine[] {
  return read(content).unreadable;
}

function read(content: string): { items: WaitingItem[]; unreadable: UnreadableLine[] } {
  const lines = content.split("\n");
  const items: WaitingItem[] = [];
  const unreadable: UnreadableLine[] = [];

  let open: { block: string[]; since: string; owner: string; rest: string } | null = null;

  const flush = (): void => {
    if (open === null) return;

    const actions: WaitingAction[] = [];
    const textLines: string[] = [];

    for (const line of open.block.slice(1)) {
      const action = ACTION.exec(line);
      if (action) {
        actions.push({
          kind: action[1] === "received" ? "received" : "followed-up",
          on: action[2] ?? "",
        });
        continue;
      }
      // Not an action, so it is the user's own second line. Its indentation is
      // list syntax rather than something they typed, so it comes off.
      textLines.push(line.startsWith(INDENT) ? line.slice(INDENT.length) : line);
    }

    // The item's own text goes through the inbox parser, so a capture timestamp
    // is read the same way it is everywhere else in the vault.
    const parsed = parseInbox(`- ${open.rest}`)[0];

    items.push({
      index: items.length,
      since: open.since,
      owner: open.owner,
      text: [parsed?.capturedAt ? parsed.text : open.rest.trim(), ...textLines].join("\n"),
      capturedAt: parsed?.capturedAt ?? null,
      actions,
      raw: open.block.join("\n"),
    });
    open = null;
  };

  for (const [at, line] of lines.entries()) {
    const item = ITEM.exec(line);
    if (item) {
      flush();
      open = { block: [line], since: item[1] ?? "", owner: item[2] ?? "", rest: item[3] ?? "" };
      continue;
    }

    // A line that starts a new list item but is not a well-formed one ends the
    // current block rather than being absorbed into it — otherwise a malformed
    // line would silently become part of the item above.
    if (/^-\s/.test(line)) {
      flush();
      unreadable.push({ line: at + 1, raw: line });
      continue;
    }

    if (open !== null && line.trim().length > 0) {
      open.block.push(line);
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }

    // Non-blank, not a list item, and no item open above it to belong to.
    unreadable.push({ line: at + 1, raw: line });
  }
  flush();

  return { items, unreadable };
}

/**
 * Appends one action beneath its item.
 *
 * Refuses by returning null when the block on disk is not the one the caller
 * was shown — the write itself has no opinion about *why*; the service turns
 * that into a refusal the user reads.
 */
export function appendAction(
  content: string,
  ref: WaitingRef,
  action: WaitingAction,
): string {
  const applied = tryAppendAction(content, ref, action);
  // Callers that have already verified use this directly; the null case is the
  // service's to handle.
  return applied ?? content;
}

export function tryAppendAction(
  content: string,
  ref: WaitingRef,
  action: WaitingAction,
): string | null {
  const items = parseWaiting(content);
  const item = items[ref.index];
  if (!item || item.raw !== ref.raw) return null;

  const lines = content.split("\n");
  const blockLines = item.raw.split("\n");

  // Locate the block by its exact text rather than by counting: a malformed
  // line elsewhere in the file shifts no index this way.
  const start = indexOfBlock(lines, blockLines);
  if (start === -1) return null;

  lines.splice(start + blockLines.length, 0, renderActionLine(action));
  return lines.join("\n");
}

function indexOfBlock(lines: string[], block: string[]): number {
  const first = block[0];
  if (first === undefined) return -1;

  for (let i = 0; i <= lines.length - block.length; i++) {
    if (lines[i] !== first) continue;
    if (block.every((line, offset) => lines[i + offset] === line)) return i;
  }
  return -1;
}
