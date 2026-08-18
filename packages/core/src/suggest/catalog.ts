/**
 * The suggestion service's only read source.
 *
 * Feature 6 made its read-only guarantee structural by narrowing a dependency
 * to `Pick<VaultStore, "list" | "read">`. That gives write-immunity but still
 * typechecks `read("identity.md")`. This goes one step further: the directory
 * is a parameter constrained to two values, and the slug is separate — so
 * there is no argument that names `identity.md`, `policy.md`, `trash.md`,
 * `calendar.md`, `top-three.md`, or anything under `log/`.
 *
 * "This feature never reads those files" is therefore a thing the type cannot
 * express, rather than a rule a contributor has to remember (research R6).
 */

import type { VaultStore } from "../ports/index";

export type CatalogDir = "projects" | "areas";

export interface DestinationCatalog {
  /** Slugs in one of the two destination directories. Fresh on every call. */
  list(dir: CatalogDir): Promise<string[]>;
  /** One destination file's contents, or null when absent. */
  read(dir: CatalogDir, slug: string): Promise<string | null>;
}

/**
 * A slug that could reach outside its directory.
 *
 * The in-memory store used by tests would simply miss on such a key, but a
 * filesystem-backed store joins paths, so the guard belongs here — at the
 * boundary that promises the narrowing, not in whichever adapter is behind it.
 */
function escapes(slug: string): boolean {
  return slug.includes("/") || slug.includes("\\") || slug.includes("..") || slug.length === 0;
}

/**
 * The whole adapter. Reads through to the store on every call, so a project
 * created in another window is proposable with no restart (FR-024).
 */
export function catalogOf(vault: Pick<VaultStore, "list" | "read">): DestinationCatalog {
  return {
    list: (dir) => vault.list(dir),
    read: (dir, slug) => (escapes(slug) ? Promise.resolve(null) : vault.read(`${dir}/${slug}.md`)),
  };
}
