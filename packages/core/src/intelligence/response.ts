/**
 * Reading a response, strictly.
 *
 * Any of: not valid JSON, the wrong top-level shape, a field of the wrong
 * type, a segment number out of range, a repeated segment number, a piece
 * naming nothing — is `unusable`. Nothing is repaired, no second attempt is
 * made, and no partial proposal is shown.
 *
 * The alternative, extracting whatever can be understood, is precisely the
 * "partial or repaired proposal" FR-064 forbids, and it converts a visible
 * failure into a quiet wrong answer. Here the quiet wrong answer would be
 * words the user never said, in their own inbox (research R12).
 *
 * **One tolerance, deliberately**: a markdown code fence around the JSON is
 * stripped before parsing. That is a wrapper around the payload rather than a
 * repair of it, and both shipped transports will meet it constantly.
 */

import type { DestinationResponse, SplitResponse } from "../ports/index";
import type { SortDecision } from "../sort/decision";
import type { Segment } from "./segments";
import type { DestinationProposal, ProposedPiece, SplitProposal } from "../suggest/types";

/**
 * A response that completed and could not be understood.
 *
 * Carries `reason` so the service maps it without a second taxonomy — the same
 * shape a transport's own errors use.
 */
export class UnusableResponseError extends Error {
  readonly reason = "unusable" as const;

  constructor(detail: string) {
    super(`The answer could not be understood: ${detail}. Nothing was changed.`);
    this.name = "UnusableResponseError";
  }
}

function unusable(detail: string): never {
  throw new UnusableResponseError(detail);
}

/** The only tolerance: a fence around the payload, not a repair of it. */
function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const withoutOpen = trimmed.replace(/^```[A-Za-z]*\s*\n?/, "");
  return withoutOpen.replace(/\n?```\s*$/, "").trim();
}

function parseJson(raw: string): Record<string, unknown> {
  const text = stripFence(raw);
  if (text.length === 0) unusable("it was empty");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    unusable("it was not JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    unusable("it was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Groupings of segment numbers, verified against the partition core built.
 *
 * @param segmentCount how many segments the request presented.
 */
export function parseSplitResponse(raw: string, segmentCount: number): SplitResponse {
  const parsed = parseJson(raw);

  const nothingToSplit = parsed["nothingToSplit"];
  if (typeof nothingToSplit !== "boolean") {
    // Not defaulted to false. An answer that did not say cannot be assumed to
    // have meant "yes, split it" — that assumption writes the file.
    unusable("it did not say whether the item holds one thought");
  }

  const raw_pieces = parsed["pieces"];
  if (!Array.isArray(raw_pieces)) unusable("`pieces` was not a list");

  const pieces: number[][] = [];
  const claimed = new Set<number>();

  for (const piece of raw_pieces) {
    if (!Array.isArray(piece)) unusable("a piece was not a list of numbers");
    if (piece.length === 0) unusable("a piece named no part of the item");

    const indices: number[] = [];
    for (const index of piece) {
      if (typeof index !== "number" || !Number.isInteger(index)) {
        unusable("a piece named something that is not a whole number");
      }
      if (index < 0 || index >= segmentCount) {
        unusable(`a piece named part ${index}, which the item does not have`);
      }
      if (claimed.has(index)) {
        unusable(`part ${index} was named by two pieces`);
      }
      claimed.add(index);
      indices.push(index);
    }
    // In file order, whatever order they arrived in: the piece's text is the
    // user's words as the user said them.
    pieces.push(indices.sort((a, b) => a - b));
  }

  if (nothingToSplit && pieces.length > 0) {
    unusable("it said the item holds one thought and then divided it");
  }
  if (!nothingToSplit && pieces.length === 0) {
    unusable("it proposed no pieces and did not say the item holds one thought");
  }

  return { pieces, nothingToSplit };
}

/**
 * The proposal the user sees.
 *
 * Every piece's text is built here, by slicing the original at the indices the
 * response named. The response's own strings — if it sent any — are not read.
 * This is the whole verbatim guarantee, and it is one line of code because the
 * design put it here rather than in a validator (FR-010a, research R3).
 */
export function toSplitProposal(
  response: SplitResponse,
  text: string,
  segments: Segment[],
): SplitProposal {
  const spanOf = (index: number): string => {
    const s = segments[index];
    return s === undefined ? "" : text.slice(s.start, s.end);
  };

  const pieces: ProposedPiece[] = response.pieces.map((indices) => ({
    text: indices.map(spanOf).join(""),
    segments: [...indices],
  }));

  const claimed = new Set(response.pieces.flat());

  // Exact set difference over indices, in file order. Never a similarity
  // score: a user who dictated three thoughts and accepted two pieces needs to
  // see the third, not a confidence number about it (FR-013).
  const uncovered = response.nothingToSplit
    ? []
    : segments.filter((s) => !claimed.has(s.index)).map((s) => spanOf(s.index));

  return { pieces, uncovered, nothingToSplit: response.nothingToSplit };
}

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

/**
 * The five, and only the five.
 *
 * A sixth is not rejected here so much as unrepresentable downstream: the
 * proposal carries a `SortDecision`, Feature 2's own union, which has no shape
 * for one. This list is what turns an unknown word in a response into a
 * reported failure rather than a type error at the boundary (FR-020).
 */
const DESTINATIONS = ["project", "area", "waiting", "calendar", "trash"] as const;

type DestinationName = (typeof DESTINATIONS)[number];

function isDestination(value: unknown): value is DestinationName {
  return typeof value === "string" && (DESTINATIONS as readonly string[]).includes(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") unusable(`\`${field}\` was not text`);
  return value;
}

/**
 * One destination, with a reason.
 *
 * The slug is **not** checked here — that happens against the catalogue read
 * for this particular request, which this function has no access to and should
 * not. Parsing says what the answer was; `toDestinationProposal` says whether
 * it names something that exists.
 */
export function parseDestinationResponse(raw: string): DestinationResponse {
  const parsed = parseJson(raw);

  const named = parsed["destination"];
  if (!isDestination(named)) {
    unusable(
      typeof named === "string"
        ? `\`${named}\` is not one of the five destinations`
        : "it named no destination",
    );
  }

  // Required, and never defaulted. A destination with no reason is a bare
  // instruction, and the whole point of this feature is that it proposes
  // rather than instructs (FR-021).
  const reason = readString(parsed["reason"], "reason").trim();
  if (reason.length === 0) unusable("it gave no reason");

  return { decision: readDecision(named, parsed), reason };
}

function readDecision(named: DestinationName, parsed: Record<string, unknown>): SortDecision {
  if (named === "calendar" || named === "trash") return { to: named };

  if (named === "waiting") {
    // Absent and empty mean the same thing: the item named nobody. Left empty
    // rather than invented — a name the model made up would be written into
    // `waiting.md` having never been said. `sort()` refuses an empty owner, so
    // the user has to fill it in, which is the correct outcome (FR-025).
    const owner = parsed["owner"] === undefined ? "" : readString(parsed["owner"], "owner");
    return { to: "waiting", owner };
  }

  const hasSlug = parsed["slug"] !== undefined;
  const hasTitle = parsed["createTitle"] !== undefined;

  if (hasSlug && hasTitle) unusable("it named both an existing destination and a new one");
  if (!hasSlug && !hasTitle) unusable(`it chose ${named} without saying which one`);

  // Written out per branch rather than as `{ to: named, ... }`: `SortDecision`
  // is a discriminated union, and collapsing the two arms would widen `to` to
  // `"project" | "area"`, which is not a member of it. Keeping the union
  // undistributed here is what keeps a malformed decision unconstructable.
  if (hasSlug) {
    const slug = readString(parsed["slug"], "slug");
    return named === "project" ? { to: "project", slug } : { to: "area", slug };
  }

  const createTitle = readString(parsed["createTitle"], "createTitle");
  if (createTitle.trim().length === 0) unusable("it proposed creating something with no title");
  return named === "project" ? { to: "project", createTitle } : { to: "area", createTitle };
}

/**
 * The proposal the user sees.
 *
 * @param known every destination that exists, as `kind/slug`, read for *this*
 * request. A slug outside it makes the whole response `unusable` — never a
 * quiet conversion into "create one by that name", which would be the system
 * deciding, and the user confirming something they were never shown as new
 * (FR-022, FR-023).
 */
export function toDestinationProposal(
  response: DestinationResponse,
  known: Set<string>,
): DestinationProposal {
  const decision = response.decision;

  if ((decision.to === "project" || decision.to === "area") && "slug" in decision) {
    if (!known.has(`${decision.to}/${decision.slug}`)) {
      unusable(`no ${decision.to} called \`${decision.slug}\` exists`);
    }
  }

  return {
    decision,
    reason: response.reason,
    // Derived from the decision's shape, never read from the response: a
    // response claiming otherwise must not be able to disguise a new
    // destination as an existing one.
    isNew: (decision.to === "project" || decision.to === "area") && "createTitle" in decision,
  };
}
