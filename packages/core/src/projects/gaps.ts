import type { Project, StructureGap } from "./types";

/**
 * Which of outcome, milestones, and next action a project is missing.
 *
 * Computed from the fields themselves on every read, never stored (FR-020). A
 * stored flag would be a second copy of a fact the file already carries, and
 * the two would diverge the first time the user edited that file in a text
 * editor — which is the exact scenario this data model exists to support
 * (research R5).
 *
 * Deriving it also means Feature 5's review and the UI ask the same question
 * and cannot get different answers.
 *
 * Note what is absent: a missing DRI is not a gap (FR-009), and status has no
 * influence at all — a parked or done project missing its outcome is still
 * missing its outcome (FR-021).
 *
 * See specs/003-project-structure/spec.md FR-018
 */

/** Fixed order, so the UI renders the gaps the same way every time. */
const ORDER: readonly StructureGap[] = ["outcome", "milestones", "next-action"];

function present(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

export function structureGaps(project: Project): StructureGap[] {
  const missing = new Set<StructureGap>();

  if (!present(project.outcome)) missing.add("outcome");
  if (project.milestones.length === 0) missing.add("milestones");
  if (!present(project.nextAction)) missing.add("next-action");

  return ORDER.filter((gap) => missing.has(gap));
}

/** Whether the project would be flagged as needing structure. */
export function needsStructure(project: Project): boolean {
  return structureGaps(project).length > 0;
}
