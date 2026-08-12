/**
 * Turning a title into a filename, and matching titles to existing files.
 *
 * Slug equality is a better duplicate test than string equality: "Roof
 * Repair", "roof repair", and "  Roof  Repair  " all collapse to `roof-repair`
 * and correctly resolve to one project (FR-012).
 *
 * Same cleanup rules as the repo's create-new-feature.sh, so there is one
 * convention across the project. See research R6.
 */

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A slug not already taken by a *different* title.
 *
 * An exact slug match is a match, not a collision — that is FR-012 doing its
 * job, and callers resolve it to the existing destination before ever getting
 * here. Suffixes only appear when two genuinely different titles would land on
 * the same filename.
 */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;

  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
