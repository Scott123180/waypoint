import { readField, readListSection } from "../vault/preamble";
import type { Identity } from "./types";

/**
 * Reading `identity.md`.
 *
 * Identity lives with the data, not with the application, so any client opening
 * this vault resolves it the same way — agreement by construction rather than
 * by each client honouring a convention (FR-018).
 *
 * It sits in its own file, separate from `policy.md`, because the two are
 * different kinds of thing: identity is a *fact* about this data directory
 * (there is one right answer, and two users cannot both be correct with
 * different ones), while policy is an *opinion* about how to work. Identity
 * also outlives any given policy module, and the review, the retrospective and
 * a future LLM layer all need it without needing policy (FR-019, FR-053).
 *
 * See specs/004-top-three-wip-limit/contracts/data-files.md
 */

/** Vault-relative path. */
export const IDENTITY_PATH = "identity.md";

export function parseIdentity(content: string | null): Identity {
  if (content === null) return { canonical: null, aliases: [] };

  return {
    canonical: readField(content, "me"),
    // Stored as written. Normalization happens at match time, so the file keeps
    // showing the user the spellings they actually typed.
    aliases: readListSection(content, "Aliases"),
  };
}

/**
 * Whether this vault has been told who the user is.
 *
 * Aliases without a canonical value do **not** count. A file listing spellings
 * but never saying which is the real one has not answered the question, and
 * picking one of the aliases would be inventing an answer the file does not
 * give (FR-031).
 */
export function isConfigured(identity: Identity): boolean {
  return identity.canonical !== null && identity.canonical.trim().length > 0;
}
