import type { Project } from "../projects/types";
import { normalizeName } from "./normalize";
import type { NameCorpus } from "./types";

/**
 * Every distinct person named on the projects.
 *
 * Two sources, both from the project files: **DRI values and milestone
 * verifier values** (FR-028a). A verifier is a teammate by definition, so a
 * second person sharing the user's first name is evidence of a second person
 * wherever on a project they are named — and the project files are already
 * being read to build the DRI half.
 *
 * Nothing else contributes (FR-028b). Not `waiting.md`, not the inbox, not
 * areas — an area has no DRI (FR-037). The boundary is drawn here deliberately:
 * widening it would make core identity resolution depend on files it otherwise
 * has no reason to open, and every added source widens the net in a direction
 * that *weakens* the WIP limit, since an ambiguous DRI stops counting.
 *
 * Built per read and discarded. Never cached — stored derived state drifts the
 * moment the user edits a project in a text editor, which is the scenario the
 * plain-text format exists to support (FR-020b).
 *
 * Note the signature: this takes **already-parsed projects**. A function that
 * fetched its own would make the quadratic read path the easy one to write
 * (research R6).
 */

/** Just the fields a name can hide in — so callers may pass partial projects. */
type NamedFields = Pick<Project, "dri" | "milestones">;

export function buildCorpus(projects: readonly NamedFields[]): NameCorpus {
  // Keyed by normalized form, so the same person written three ways is one
  // entry. The first spelling seen wins, which keeps the reported name stable.
  const seen = new Map<string, { raw: string; words: string[] }>();

  const add = (raw: string | null): void => {
    if (raw === null) return;
    const words = normalizeName(raw);
    if (words.length === 0) return;

    const key = words.join(" ");
    if (!seen.has(key)) seen.set(key, { raw, words });
  };

  for (const project of projects) {
    add(project.dri);
    for (const milestone of project.milestones) add(milestone.verifier);
  }

  return [...seen.values()];
}
