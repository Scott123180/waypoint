/**
 * Reading `key: value` lines and `- item` lists out of a plain config file.
 *
 * The vault's config files — `identity.md`, `policy.md` — use the same shapes
 * projects and areas do, so a user reads them with the mental model they
 * already have (004 contracts/data-files.md).
 *
 * Deliberately here rather than reused from `projects/document.ts`: the policy
 * module must not import from `projects/`, and a config file is not a project.
 * The regexes match `document.ts`'s so the two never disagree about what a
 * `key: value` line is.
 */

/** `key: value`, tolerant of the spacing a hand-edit produces. */
const FIELD = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s?(.*)$/;
const H2 = /^##\s+(.+?)\s*$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

/**
 * The value of `key` in the preamble — everything before the first `##`.
 *
 * Returns null when absent or blank, so "not set" has one representation.
 * Never throws: an unparseable file is a file with no fields, not an error.
 */
export function readField(content: string, key: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    if (H2.test(line)) break;
    const m = FIELD.exec(line);
    if (m && (m[1] ?? "").trim().toLowerCase() === key.toLowerCase()) {
      const value = (m[2] ?? "").trim();
      return value.length === 0 ? null : value;
    }
  }
  return null;
}

/**
 * The `- item` lines under `## heading`, trimmed, blanks dropped.
 *
 * An absent section and an empty one both yield `[]` — for an alias list those
 * mean the same thing, and inventing a distinction would be a distinction the
 * file cannot express.
 */
export function readListSection(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const head = lines.findIndex((l) => {
    const m = H2.exec(l);
    return m !== null && (m[1] ?? "").toLowerCase() === heading.toLowerCase();
  });
  if (head === -1) return [];

  const items: string[] = [];
  for (let i = head + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (H2.test(line)) break;
    const m = LIST_ITEM.exec(line);
    if (!m) continue;
    const item = (m[1] ?? "").trim();
    if (item.length > 0) items.push(item);
  }
  return items;
}

/**
 * A whole positive integer from a config value, or null when it is not one.
 *
 * Zero is valid and is honored rather than corrected — a limit of zero that
 * refuses everything is a coherent thing to have configured (FR-060).
 */
export function readCount(content: string, key: string): number | null {
  const raw = readField(content, key);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
