import { isConfigured } from "./identity-config";
import { isStrictLeadingPrefix, normalizeName, sameName } from "./normalize";
import type { Identity, NameCorpus, ResolvedDri } from "./types";

/**
 * Does this DRI refer to the user?
 *
 * A **fact about the data**, which is why it lives in core rather than policy:
 * two users cannot reasonably configure who they are differently and both be
 * correct. Policy consumes this answer; the weekly review, the retrospective
 * view and any future client can use it without depending on policy (FR-053).
 *
 * Pure and synchronous. The corpus arrives as an argument rather than being
 * fetched, which keeps the whole matrix testable as a table with no fakes —
 * and forces the caller to have parsed the projects once, so the quadratic
 * read path is the hard one to write (research R6).
 *
 * See specs/004-top-three-wip-limit/contracts/identity-api.md
 */

export function resolveDri(dri: string | null, identity: Identity, corpus: NameCorpus): ResolvedDri {
  const words = normalizeName(dri);

  // No DRI at all. Deliberately its own answer: an unknown owner is not the
  // user (FR-041), and it is what drives the needs-a-DRI signal (FR-032).
  if (words.length === 0) return { resolution: "unassigned", raw: null };

  // Nobody has said who the user is. The project has an owner; it simply is not
  // known to be the user. Answering `unassigned` here would make every named
  // project look unowned the moment identity was missing (FR-031).
  if (!isConfigured(identity)) return { resolution: "theirs", raw: dri };

  const mine = identityNames(identity);
  if (!mine.some((name) => sameName(name, words))) {
    return { resolution: "theirs", raw: dri };
  }

  // Matched — but is this spelling also somebody else's shorter name?
  const collisions = corpus
    .filter(
      (entry) =>
        // A name is not evidence against itself, and neither is another
        // spelling of the user (FR-028c).
        !mine.some((name) => sameName(name, entry.words)) &&
        isStrictLeadingPrefix(words, entry.words),
    )
    .map((entry) => entry.raw);

  if (collisions.length > 0) {
    // Flagged rather than resolved silently. This never *decides* anything — it
    // demotes a confident match to "ask a human", which is why an ambiguous DRI
    // does not count toward the WIP limit either (FR-028, FR-029, FR-042).
    return { resolution: "ambiguous", raw: dri, collidesWith: collisions };
  }

  return { resolution: "mine", raw: dri };
}

/** The canonical value and every alias, normalized. */
function identityNames(identity: Identity): string[][] {
  return [identity.canonical, ...identity.aliases]
    .map(normalizeName)
    .filter((words) => words.length > 0);
}
