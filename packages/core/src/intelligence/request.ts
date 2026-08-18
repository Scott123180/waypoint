/**
 * The one place a request's content is built.
 *
 * One function per request kind, and each is called from exactly one place —
 * the corresponding `prepare*` in `default-intelligence.ts`. That is not a
 * style preference: FR-045 requires the previewed content and the sent content
 * to be the same value rather than two renderings compared for equality, and
 * the cheapest way to break that guarantee is to render the payload a second
 * time somewhere else. One call site is what makes the second rendering not
 * exist (research R4).
 *
 * Everything these functions can see is passed in. Neither takes a vault, a
 * store, a path, or a config, so there is nothing here that could reach a file
 * the payload must not carry (FR-042, FR-043).
 */

import type { DestinationRequest, SplitRequest } from "../ports/index";

/**
 * Asks for groupings of segment numbers, and never for text.
 *
 * The response format is the load-bearing part. Because the model answers with
 * numbers, core can build every piece by slicing the original, and a piece
 * containing words the user did not say is not something the parser has to
 * detect — it is something the data path cannot produce (research R3).
 */
export function renderSplitRequest(request: SplitRequest): string {
  const numbered = request.segments.map((s) => `[${s.index}] ${s.text.replace(/\n/g, "\\n")}`);

  return [
    "You are helping someone sort a single item out of their inbox. It was dictated,",
    "so it may ramble, restart, or run several unrelated thoughts together.",
    "",
    "Decide whether it holds more than one distinct thought. If it does, group the",
    "numbered pieces below into one group per thought, keeping them in order.",
    "",
    "Rules:",
    "- Answer with numbers only. Never repeat the text back.",
    "- Every number appears in at most one group.",
    "- False starts and restarts of the same thought belong in the same group.",
    "- If it holds a single thought, say so instead of returning one group.",
    "",
    "Reply with one JSON object and nothing else:",
    '  {"pieces": [[0, 1], [2]], "nothingToSplit": false}',
    '  {"pieces": [], "nothingToSplit": true}',
    "",
    "The item, numbered:",
    "",
    ...numbered,
    "",
  ].join("\n");
}

/**
 * Sends the item's own text, each project's title and stated outcome, and each
 * area's title. Nothing else exists to send: `DestinationRequest` has no field
 * for a milestone, next action, DRI, status, ledger entry, or unprocessed
 * item, so the boundary is the shape rather than this function's restraint
 * (FR-043).
 */
export function renderDestinationRequest(request: DestinationRequest): string {
  const projects = request.projects.map((p) =>
    p.outcome === null || p.outcome.length === 0
      ? `- ${p.slug}: ${p.title}`
      : `- ${p.slug}: ${p.title} — ${p.outcome.replace(/\n+/g, " ").trim()}`,
  );
  const areas = request.areas.map((a) => `- ${a.slug}: ${a.title}`);

  return [
    "You are helping someone decide where one inbox item belongs. Propose exactly",
    "one destination and give a brief reason in their own terms.",
    "",
    "The destinations are:",
    "- project: work with a finish line. Name one that exists, or propose a new title.",
    "- area: an ongoing responsibility. Name one that exists, or propose a new title.",
    "- waiting: something someone else owes. Name the person if the item does.",
    "- calendar: something that happens at a particular time.",
    "- trash: nothing worth keeping.",
    "",
    "Rules:",
    "- Only name a project or area listed below. Do not invent a name for an existing one.",
    "- If none of them fits, either propose a new title or choose another destination.",
    "- The reason is one short sentence, about this item.",
    "",
    "Reply with one JSON object and nothing else. One of:",
    '  {"destination": "project", "slug": "an-existing-slug", "reason": "..."}',
    '  {"destination": "project", "createTitle": "A New Project", "reason": "..."}',
    '  {"destination": "area", "slug": "an-existing-slug", "reason": "..."}',
    '  {"destination": "area", "createTitle": "A New Area", "reason": "..."}',
    '  {"destination": "waiting", "owner": "Someone", "reason": "..."}',
    '  {"destination": "calendar", "reason": "..."}',
    '  {"destination": "trash", "reason": "..."}',
    "",
    "Projects that exist:",
    "",
    ...(projects.length === 0 ? ["(none)"] : projects),
    "",
    "Areas that exist:",
    "",
    ...(areas.length === 0 ? ["(none)"] : areas),
    "",
    "The item:",
    "",
    request.item,
    "",
  ].join("\n");
}
