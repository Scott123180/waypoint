/**
 * What identity resolution answers, as plain data.
 *
 * A fact about the data, derived on every read and never stored — the same
 * discipline as Feature 3's structure flag, for the same reason: stored derived
 * state drifts the first time the user edits a file in a text editor.
 *
 * See specs/004-top-three-wip-limit/contracts/identity-api.md
 */

/** Who the user is, as configured in `identity.md`. */
export interface Identity {
  /** The canonical spelling. null when the file is absent or names none. */
  canonical: string | null;
  /** Other spellings the user has deliberately claimed. File order. */
  aliases: string[];
}

/**
 * What a DRI value turns out to be. Exactly four possibilities (FR-021).
 *
 * These are the spec's four answers under their internal names: `mine` is
 * "the user's", `theirs` is "someone else's". They are never displayed — a
 * client renders a phrase core gives it — so the short forms cost nothing.
 */
export type DriResolution =
  /** Matches the canonical value or an alias, with no collision. */
  | "mine"
  /** A name, but not one of the user's. */
  | "theirs"
  /** No DRI on the project at all. Not the same as "not the user's" (FR-041). */
  | "unassigned"
  /** Matches an identity value but collides with a distinct longer name (FR-028). */
  | "ambiguous";

/** A resolution plus the evidence, so a client can explain an ambiguous one. */
export interface ResolvedDri {
  resolution: DriResolution;
  /** The DRI exactly as written in the file. null when unassigned. */
  raw: string | null;
  /**
   * Present only when `resolution` is `ambiguous`: the other names, as written,
   * this value could also refer to. Never empty when present (FR-029).
   */
  collidesWith?: string[];
}

/**
 * Every distinct person name on the projects, with its normalized form.
 *
 * An intermediate value built per read and discarded, never persisted
 * (FR-020b). Passed to `resolveDri` as an argument rather than fetched by it —
 * which is what forces the caller to have parsed the projects once, and makes
 * the quadratic implementation the hard one to write (research R6).
 */
export type NameCorpus = ReadonlyArray<{ raw: string; words: string[] }>;
