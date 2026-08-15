/**
 * Formatting differences only, never a guess at identity.
 *
 * The four rules, and nothing beyond them (FR-022–FR-025):
 *
 *   - case is ignored
 *   - surrounding whitespace is trimmed
 *   - repeated internal whitespace collapses to one space
 *   - one trailing period is ignored, so `Scott R.` and `Scott R` are the same
 *
 * The result is a **word list**, not a string, because the one question that
 * depends on this — is `Scott` also somebody's shorter name? — is a question
 * about words. Comparing characters would make `Scott` collide with `Scottie`,
 * who is a different person by any reading (research R7).
 *
 * What this must never do, and what FR-026 makes a prohibition rather than a
 * preference: stem, expand initials, drop middle names, compare by edit
 * distance, or match on prefixes. Two people on a team can share a first name,
 * and merging them would misattribute one person's work to the other.
 *
 * See specs/004-top-three-wip-limit/contracts/identity-api.md
 */

export function normalizeName(name: string | null): string[] {
  if (name === null) return [];

  let value = name.trim();
  // One trailing period, then trim again — `Scott R. ` and `Scott R.` are the
  // same name written twice.
  if (value.endsWith(".")) value = value.slice(0, -1).trim();

  return value
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** Two normalized names are the same name. Exact, word for word. */
export function sameName(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

/**
 * Whether `shorter` is a strict leading run of words of `longer`.
 *
 * `["scott"]` against `["scott", "r"]` — the shape of "two people share a
 * first name". Equality is not a prefix: a name does not collide with itself.
 */
export function isStrictLeadingPrefix(shorter: readonly string[], longer: readonly string[]): boolean {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  return shorter.every((word, i) => word === longer[i]);
}
