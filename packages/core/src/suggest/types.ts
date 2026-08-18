/**
 * What a suggestion is, and every way one can fail.
 *
 * Nothing here is ever stored. A proposal lives between the user's ask and
 * their accept-or-reject and then ceases to exist, which is what makes
 * "learning from the user's decisions" structurally out of scope rather than
 * merely unimplemented (FR-046, FR-070).
 *
 * See specs/008-llm-assisted-inbox-organization/data-model.md
 */

import type { SortDecision } from "../sort/decision";

/**
 * The closed failure taxonomy, owned by core and mapped onto by every
 * transport (research R14).
 *
 * A closed union here is what lets two transports whose errors arrive as
 * different *kinds* of thing — an exit code and a stderr tail against a TLS
 * error and an HTTP status — be tested against the same expectations. That is
 * the seam's proof rather than one implementation's error type renamed.
 */
export type SuggestionFailure =
  /** No `intelligence.md`, or none naming a transport. Carries no message. */
  | "not-configured"
  /** Unrecognised `transport:`, or a required parameter missing. */
  | "misconfigured"
  /** The named certificate or key is absent, unreadable, or rejected. */
  | "credential"
  /** Process could not be spawned; endpoint could not be reached. */
  | "unreachable"
  /** The 120-second bound, or the user abandoned. */
  | "timed-out"
  /** Started and did not complete: non-zero exit, non-2xx, socket closed. */
  | "failed"
  /** Completed, and the response could not be understood (research R12). */
  | "unusable";

/** Every member, as a value, so the set is assertable. */
export const SUGGESTION_FAILURES = [
  "not-configured",
  "misconfigured",
  "credential",
  "unreachable",
  "timed-out",
  "failed",
  "unusable",
] as const;

/**
 * One proposed piece of a split item.
 *
 * `text` is built by core slicing the original at the named segments. It is
 * **never** taken from the response, which is what makes FR-010a a property of
 * the data path rather than a rule someone checks (research R3).
 */
export interface ProposedPiece {
  text: string;
  /** Which segments it groups. Retained so the coverage arithmetic is checkable. */
  segments: number[];
}

export interface SplitProposal {
  pieces: ProposedPiece[];
  /**
   * Text of segments no piece names, in file order. Exact set arithmetic over
   * segment indices, never a similarity score (FR-013).
   */
  uncovered: string[];
  /** True when the item holds one thought. Not a one-piece proposal (FR-011). */
  nothingToSplit: boolean;
}

export interface DestinationProposal {
  /**
   * **Feature 2's type, unchanged.** A proposal that cannot be expressed as one
   * of the five decisions does not exist, and `SortDecision`'s deliberate lack
   * of a `suggestedBy` field means FR-032 needs no enforcement.
   */
  decision: SortDecision;
  /** Brief, in the item's terms (FR-021). Displayed, never written (FR-032). */
  reason: string;
  /** True only for `createTitle` decisions. What FR-023's marking keys off. */
  isNew: boolean;
}

export type SplitOutcome =
  | { ok: true; proposal: SplitProposal }
  | { ok: false; reason: SuggestionFailure; message: string };

export type DestinationOutcome =
  | { ok: true; proposal: DestinationProposal }
  | { ok: false; reason: SuggestionFailure; message: string };

/**
 * The value that makes the payload guarantee structural (research R4).
 *
 * `run` is a closure over the same binding `payload` exposes. There is no
 * second construction of the content and no argument through which different
 * content could be supplied, so FR-045's byte-for-byte assertion is `===` on
 * one binding rather than a comparison of two renderings.
 */
export interface PreparedRequest<T> {
  /** The exact content that would be sent. What FR-041's preview displays. */
  readonly payload: string;
  /** Sends `payload`. Takes no argument, so nothing else is sendable. */
  run(): Promise<T>;
  /**
   * Abandons an in-flight request, leaving the item untouched (FR-066).
   * Shares the one `AbortController` with the 120-second bound, so FR-066 and
   * FR-066a are one mechanism with two triggers.
   */
  abandon(): void;
}

export type PrepareResult<T> =
  | { ok: true; prepared: PreparedRequest<T> }
  | { ok: false; reason: SuggestionFailure; message: string };
