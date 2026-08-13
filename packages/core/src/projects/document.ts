import { parseInbox } from "../inbox/parse";
import { parseMilestone } from "./milestone";
import {
  AREA_STATUSES,
  PROJECT_STATUSES,
  type Area,
  type AreaStatus,
  type Milestone,
  type Project,
  type ProjectStatus,
  type UnprocessedItem,
} from "./types";

/**
 * Reading and writing a project or area file.
 *
 * Two rules govern everything here:
 *
 *   1. **Parsing never fails.** Unknown keys, unknown sections, malformed
 *      milestones and hand-shaped ordering are all carried through untouched; a
 *      field that is absent or unparseable reads as not set. The vault is a
 *      directory the user is invited to edit, and a file the app refuses to
 *      open is a file the app has taken hostage (FR-045).
 *
 *   2. **Writing is surgical.** Only the lines belonging to the field being
 *      changed are altered. Everything else is reproduced byte for byte,
 *      because the vault is git-tracked and a read that reformats turns every
 *      app open into a diff (research R3).
 *
 * See specs/003-project-structure/contracts/project-format.md
 */

/**
 * A file as lines.
 *
 * `split("\n")` / `join("\n")` is exactly lossless — including the trailing
 * newline, which survives as a final empty element — so the round-trip gate
 * (SC-014) holds by construction rather than by careful reassembly.
 */
export interface ProjectDocument {
  lines: string[];
}

export function parseDocument(content: string): ProjectDocument {
  return { lines: content.split("\n") };
}

export function renderDocument(doc: ProjectDocument): string {
  return doc.lines.join("\n");
}

const TITLE = /^#\s+(.*)$/;
const H2 = /^##\s+(.+?)\s*$/;
/** `key: value`, tolerant of the spacing a hand-edit produces. */
const FIELD = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s?(.*)$/;

export const OUTCOME_HEADING = "Outcome";
export const MILESTONES_HEADING = "Milestones";
export const UNPROCESSED_HEADING = "Unprocessed";

// ---------------------------------------------------------------------------
// Locating things
// ---------------------------------------------------------------------------

function titleIndex(lines: string[]): number {
  return lines.findIndex((l) => TITLE.test(l));
}

/** Lines after the title, up to the first `##` heading. */
function preambleRange(lines: string[]): { start: number; end: number } {
  const title = titleIndex(lines);
  const start = title + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (H2.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Body range of a `## Heading`, exclusive of the heading itself.
 *
 * The section runs to the next `##` at the same level or to end of file — a
 * `###` inside it belongs to it, matching the rule Feature 2 established for
 * `## Unprocessed`.
 */
function sectionRange(lines: string[], heading: string): { head: number; start: number; end: number } | null {
  const head = lines.findIndex((l) => {
    const m = H2.exec(l);
    return m !== null && (m[1] ?? "").toLowerCase() === heading.toLowerCase();
  });
  if (head === -1) return null;

  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) {
    if (H2.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { head, start: head + 1, end };
}

function sectionBody(lines: string[], heading: string): string | null {
  const range = sectionRange(lines, heading);
  if (!range) return null;
  const body = lines.slice(range.start, range.end).join("\n").trim();
  return body.length === 0 ? null : body;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readField(lines: string[], key: string): string | null {
  const { start, end } = preambleRange(lines);
  for (let i = start; i < end; i++) {
    const m = FIELD.exec(lines[i] ?? "");
    if (m && (m[1] ?? "").trim().toLowerCase() === key.toLowerCase()) {
      const value = (m[2] ?? "").trim();
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

function readTitle(lines: string[]): string {
  const idx = titleIndex(lines);
  if (idx === -1) return "";
  return (TITLE.exec(lines[idx] ?? "")?.[1] ?? "").trim();
}

function readMilestones(lines: string[]): Milestone[] {
  const range = sectionRange(lines, MILESTONES_HEADING);
  if (!range) return [];

  const milestones: Milestone[] = [];
  for (let i = range.start; i < range.end; i++) {
    const parsed = parseMilestone(lines[i] ?? "");
    // A line that is not a milestone is somebody else's — a note, a blank, a
    // sub-heading. It stays where it is and is not counted.
    if (parsed) milestones.push({ ...parsed, index: milestones.length });
  }
  return milestones;
}

/**
 * Routed items, in the grammar sort wrote them in.
 *
 * Each block is `- <text>` with continuation lines indented two spaces. The
 * leading `- ` is stripped and the remainder handed to the inbox parser, so the
 * same thought is read the same way wherever it landed.
 */
function readUnprocessed(lines: string[]): UnprocessedItem[] {
  const range = sectionRange(lines, UNPROCESSED_HEADING);
  if (!range) return [];

  const items: UnprocessedItem[] = [];
  let current: string[] | null = null;

  const flush = (): void => {
    if (!current) return;
    // Handed to the inbox parser whole, `- ` included: that leading marker is
    // part of the item grammar Feature 1 defined and Feature 2 wrote here, so
    // the same thought is read the same way wherever it landed.
    const raw = current.join("\n");
    const parsed = parseInbox(raw)[0];

    // A timestamped line has its `- ` consumed by the capture grammar. A
    // hand-written one does not, and here the marker is list syntax rather
    // than something the user typed — sort adds it to every routed item.
    const text = (parsed?.text ?? raw).replace(parsed?.capturedAt ? /^/ : /^-\s?/, "");

    items.push({
      text: parsed?.capturedAt ? text : text.trim(),
      capturedAt: parsed?.capturedAt ?? null,
      index: items.length,
      raw,
    });
    current = null;
  };

  for (let i = range.start; i < range.end; i++) {
    const line = lines[i] ?? "";
    if (/^-\s/.test(line)) {
      flush();
      current = [line];
    } else if (current && line.trim().length > 0) {
      current.push(line);
    } else if (line.trim().length === 0) {
      flush();
    }
  }
  flush();

  return items;
}

function readStatus(lines: string[]): { status: ProjectStatus; raw: string } {
  const raw = readField(lines, "status") ?? "active";
  const normalized = raw.trim().toLowerCase();
  const status = PROJECT_STATUSES.find((s) => s === normalized) ?? "active";
  return { status, raw };
}

export function parseProject(content: string, slug: string): Project {
  const { lines } = parseDocument(content);
  const outcome = sectionBody(lines, OUTCOME_HEADING);

  return {
    slug,
    title: readTitle(lines),
    status: readStatus(lines).status,
    outcome,
    nextAction: readField(lines, "next action"),
    dri: readField(lines, "dri"),
    milestones: readMilestones(lines),
    completedOn: readField(lines, "completed"),
    unprocessed: readUnprocessed(lines),
  };
}

export function parseArea(content: string, slug: string): Area {
  const { lines } = parseDocument(content);
  const rawStatus = readField(lines, "status") ?? "active";
  const normalized = rawStatus.trim().toLowerCase();
  // A hand-edit may have put `done` or `waiting` here. It stays visible as
  // written; the usable status falls back to active so the area still works
  // (FR-041c). Nothing is rewritten on read.
  const status: AreaStatus = AREA_STATUSES.find((s) => s === normalized) ?? "active";

  return {
    slug,
    title: readTitle(lines),
    status,
    rawStatus,
    unprocessed: readUnprocessed(lines),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function setTitleLine(content: string, title: string): string {
  const doc = parseDocument(content);
  const idx = titleIndex(doc.lines);
  const line = `# ${title.trim()}`;
  if (idx === -1) doc.lines.unshift(line);
  else doc.lines[idx] = line;
  return renderDocument(doc);
}

/**
 * Adds, updates, or removes one preamble `key: value` line.
 *
 * A new key lands after the last field already there, so the block stays
 * together and the diff is one line.
 */
export function setPreambleField(content: string, key: string, value: string | null): string {
  const doc = parseDocument(content);
  const { start, end } = preambleRange(doc.lines);

  let existing = -1;
  let lastField = -1;
  for (let i = start; i < end; i++) {
    const m = FIELD.exec(doc.lines[i] ?? "");
    if (!m) continue;
    lastField = i;
    if ((m[1] ?? "").trim().toLowerCase() === key.toLowerCase() && existing === -1) existing = i;
  }

  if (value === null) {
    if (existing !== -1) doc.lines.splice(existing, 1);
    return renderDocument(doc);
  }

  const line = `${key}: ${value}`;
  if (existing !== -1) {
    doc.lines[existing] = line;
  } else if (lastField !== -1) {
    doc.lines.splice(lastField + 1, 0, line);
  } else {
    // No preamble at all: open one, separated from the title by a blank line.
    const title = titleIndex(doc.lines);
    doc.lines.splice(title + 1, 0, "", line);
  }

  return renderDocument(doc);
}

/**
 * Where a section this feature adds should go.
 *
 * Before `## Unprocessed` when it exists, so raw material from sort stays below
 * the structure it is meant to become; otherwise at the end.
 */
function insertionPoint(lines: string[]): number {
  const unprocessed = sectionRange(lines, UNPROCESSED_HEADING);
  if (unprocessed) return unprocessed.head;

  // Past any trailing blank lines, so the new section joins the content rather
  // than landing after the file's trailing newline.
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
  return end;
}

function insertSection(lines: string[], heading: string, bodyLines: string[]): void {
  const at = insertionPoint(lines);
  const block = ["", `## ${heading}`, "", ...bodyLines];
  // Keep exactly one blank line between this section and whatever follows.
  if (at < lines.length && (lines[at] ?? "").trim().length > 0) block.push("");
  lines.splice(at, 0, ...block);
}

/** Replaces a section's body, creates the section, or removes it entirely. */
export function setSectionBody(content: string, heading: string, body: string | null): string {
  const doc = parseDocument(content);
  const range = sectionRange(doc.lines, heading);

  if (body === null) {
    if (range) {
      // Take the blank line that separated this section from the next with it,
      // so removing a section does not leave a gap growing in the file.
      let from = range.head;
      while (from > 0 && (doc.lines[from - 1] ?? "").trim().length === 0) from -= 1;
      doc.lines.splice(from, range.end - from);
    }
    return renderDocument(doc);
  }

  const bodyLines = body.split("\n");

  if (!range) {
    insertSection(doc.lines, heading, bodyLines);
    return renderDocument(doc);
  }

  // Preserve the blank line that separates this section from the next.
  let end = range.end;
  while (end > range.start && (doc.lines[end - 1] ?? "").trim().length === 0) end -= 1;
  doc.lines.splice(range.start, end - range.start, "", ...bodyLines);
  return renderDocument(doc);
}

/**
 * Replaces the task-list lines under `## Milestones`, positionally.
 *
 * Non-milestone content in the section — a note the user wrote, a blank line —
 * is left exactly where it is. Extra milestones are appended after the last
 * existing one rather than at the section's end, so they join the list rather
 * than landing after the user's trailing note.
 */
export function setMilestoneLines(content: string, next: string[]): string {
  const doc = parseDocument(content);
  const range = sectionRange(doc.lines, MILESTONES_HEADING);

  if (!range) {
    if (next.length === 0) return content;
    insertSection(doc.lines, MILESTONES_HEADING, next);
    return renderDocument(doc);
  }

  const existing: number[] = [];
  for (let i = range.start; i < range.end; i++) {
    if (parseMilestone(doc.lines[i] ?? "")) existing.push(i);
  }

  const overlap = Math.min(existing.length, next.length);
  for (let i = 0; i < overlap; i++) doc.lines[existing[i]!] = next[i]!;

  if (next.length > existing.length) {
    const after = existing.length > 0 ? existing[existing.length - 1]! + 1 : range.start;
    doc.lines.splice(after, 0, ...next.slice(existing.length));
  } else {
    // Remove from the end backwards, so earlier indices stay valid.
    for (let i = existing.length - 1; i >= next.length; i--) doc.lines.splice(existing[i]!, 1);
  }

  return renderDocument(doc);
}

/**
 * Replaces the item blocks under `## Unprocessed`.
 *
 * Used only to remove a dismissed item — this feature never adds one; sort
 * owns that (FR-046).
 */
export function setUnprocessedBlocks(content: string, next: string[]): string {
  const doc = parseDocument(content);
  const range = sectionRange(doc.lines, UNPROCESSED_HEADING);
  if (!range) return content;

  const body = next.length === 0 ? [""] : ["", ...next.join("\n\n").split("\n")];

  let end = range.end;
  while (end > range.start && (doc.lines[end - 1] ?? "").trim().length === 0) end -= 1;
  doc.lines.splice(range.start, end - range.start, ...body);

  return renderDocument(doc);
}
