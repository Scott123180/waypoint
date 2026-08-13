import type { Clock, VaultStore } from "../ports/index";
import { localDate, trashLine } from "../vault/lists";
import { slugify, uniqueSlug } from "../vault/slug";
import { renderStub } from "../vault/stub";
import {
  MILESTONES_HEADING,
  OUTCOME_HEADING,
  parseProject,
  setMilestoneLines,
  setPreambleField,
  setSectionBody,
  setTitleLine,
  setUnprocessedBlocks,
} from "./document";
import { structureGaps } from "./gaps";
import { renderMilestone } from "./milestone";
import type {
  Milestone,
  MilestoneRef,
  Project,
  ProjectOutcome,
  ProjectStatus,
  ProjectSummary,
  RefusalReason,
} from "./types";

/**
 * The single entry point for project structure.
 *
 * Every rule the feature depends on lives behind this class, so the Electron
 * client now — and the HTTP API, the LLM layer, the weekly review, and the
 * retrospective later — all get identical behaviour without reimplementing
 * anything (Principles II and VII).
 *
 * Two habits run through all of it:
 *
 *   - **Every read is fresh.** No cursor, no cache, no session. A hand-edit is
 *     reflected the next time anything asks, and the incomplete flag is
 *     recomputed rather than remembered (FR-020).
 *
 *   - **Every write verifies its own field first.** The caller passes the value
 *     it was shown; if the file now says something else, the write is refused
 *     and nothing is touched. Refusals are values, matching `SortOutcome` —
 *     they are an expected branch a caller renders, not an error (FR-045).
 *
 * See specs/003-project-structure/contracts/projects-api.md
 */

export interface ProjectServiceDeps {
  vault: VaultStore;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

/** How many milestones a project may hold. Four is the scope-creep guard (FR-013). */
export const MILESTONE_CAP = 4;

export class ProjectService {
  private readonly vault: VaultStore;
  private readonly clock: Clock;

  constructor(deps: ProjectServiceDeps) {
    this.vault = deps.vault;
    this.clock = deps.clock ?? systemClock;
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** Every project, done ones included. For the review and the retrospective. */
  async list(): Promise<ProjectSummary[]> {
    const slugs = await this.vault.list("projects");
    const projects = await Promise.all(slugs.map((slug) => this.get(slug)));
    return projects.filter((p): p is Project => p !== null).map(summarize);
  }

  /**
   * The active list: every project whose status is not done (FR-032).
   *
   * Here rather than in a client filter because "which projects are active" is
   * a business rule, and a renderer holding it would mean Feature 6's API had
   * to reimplement it to agree (Principle II).
   */
  async listActive(): Promise<ProjectSummary[]> {
    return (await this.list()).filter((p) => p.status !== "done");
  }

  /**
   * Finished projects — the exact complement of `listActive()`.
   *
   * Here for the same reason its mirror is: a client that filtered `list()` on
   * `status === "done"` would be holding the rule. It also makes finished work
   * reachable at all, which is what keeps `reopen()` from being a verb with no
   * way to call it (FR-029, SC-012).
   */
  async listCompleted(): Promise<ProjectSummary[]> {
    return (await this.list()).filter((p) => p.status === "done");
  }

  async get(slug: string): Promise<Project | null> {
    const content = await this.vault.read(path(slug));
    return content === null ? null : parseProject(content, slug);
  }

  /**
   * Creates a project from a title alone.
   *
   * Emits exactly Feature 2's stub, by calling the same `renderStub`: a project
   * created here and one created mid-sort must be the same file, and two
   * definitions would be free to drift (FR-005).
   */
  async create(title: string): Promise<ProjectOutcome> {
    const base = slugify(title);
    if (base.length === 0) {
      return refuse("empty-title", "A title is required. Nothing was created.");
    }

    const existing = await this.vault.list("projects");
    // A matching title routes to that project rather than creating a duplicate,
    // the same rule sort applies when creating on the spot (FR-012 there).
    if (existing.includes(base)) {
      const found = await this.get(base);
      if (found) return { ok: true, project: found };
    }

    const slug = uniqueSlug(base, existing);
    await this.vault.write(path(slug), renderStub(title));
    return this.reread(slug);
  }

  // -------------------------------------------------------------------------
  // Scalar fields
  // -------------------------------------------------------------------------

  async setOutcome(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome> {
    return this.writeField(slug, expected, (p) => p.outcome, (content) =>
      setSectionBody(content, OUTCOME_HEADING, blankToNull(next)),
    );
  }

  async setNextAction(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome> {
    return this.writeField(slug, expected, (p) => p.nextAction, (content) =>
      setPreambleField(content, "next action", blankToNull(next)),
    );
  }

  async setDri(slug: string, expected: string | null, next: string | null): Promise<ProjectOutcome> {
    return this.writeField(slug, expected, (p) => p.dri, (content) =>
      setPreambleField(content, "dri", blankToNull(next)),
    );
  }

  /**
   * A title is one of the two fields always present, so unlike the others it
   * cannot be cleared (FR-003).
   *
   * Changing it does not rename the file: the slug is the identity every verb
   * uses, and a rename would break `git log --follow` and any path the user
   * linked to.
   */
  async setTitle(slug: string, expected: string, next: string): Promise<ProjectOutcome> {
    if (next.trim().length === 0) {
      return refuse("empty-title", "A project always has a title. Nothing was changed.");
    }
    return this.writeField(slug, expected, (p) => p.title, (content) => setTitleLine(content, next));
  }

  async setStatus(slug: string, expected: ProjectStatus, next: ProjectStatus): Promise<ProjectOutcome> {
    return this.writeField(slug, expected, (p) => p.status, (content) =>
      setPreambleField(content, "status", next),
    );
  }

  // -------------------------------------------------------------------------
  // Milestones
  // -------------------------------------------------------------------------

  async addMilestone(slug: string, definitionOfDone: string, verifier: string | null): Promise<ProjectOutcome> {
    const project = await this.get(slug);
    if (!project) return notFound(slug);

    if (definitionOfDone.trim().length === 0) {
      return refuse("empty-value", "A milestone needs a definition of done. Nothing was added.");
    }
    if (project.milestones.length >= MILESTONE_CAP) {
      return refuse(
        "milestone-cap",
        `A project holds at most four milestones, and this one already has ${project.milestones.length}. ` +
          "Remove one first if this belongs here.",
      );
    }

    const line = renderMilestone({
      definitionOfDone: definitionOfDone.trim(),
      verifier: blankToNull(verifier),
      done: false,
      completedOn: null,
    });

    return this.writeMilestones(slug, [...project.milestones.map((m) => m.raw), line]);
  }

  async editMilestone(
    slug: string,
    ref: MilestoneRef,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<ProjectOutcome> {
    if (definitionOfDone.trim().length === 0) {
      return refuse("empty-value", "A milestone needs a definition of done. Nothing was changed.");
    }
    return this.rewriteMilestone(slug, ref, (m) => ({
      ...m,
      definitionOfDone: definitionOfDone.trim(),
      verifier: blankToNull(verifier),
    }));
  }

  async removeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome> {
    const check = await this.verifyMilestone(slug, ref);
    if ("refusal" in check) return check.refusal;

    const lines = check.project.milestones.filter((m) => m.index !== ref.index).map((m) => m.raw);
    return this.writeMilestones(slug, lines);
  }

  /** Records the date automatically. No prompt, ever (FR-033). */
  async completeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome> {
    return this.rewriteMilestone(slug, ref, (m) => ({
      ...m,
      done: true,
      completedOn: localDate(this.clock.now()),
    }));
  }

  async reopenMilestone(slug: string, ref: MilestoneRef): Promise<ProjectOutcome> {
    return this.rewriteMilestone(slug, ref, (m) => ({ ...m, done: false, completedOn: null }));
  }

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------

  /**
   * Marks the project done, recording the date.
   *
   * Refuses with `open-milestones` when any milestone is still open, unless the
   * caller confirms. A hard refusal would be routed around by deleting the
   * milestone, which destroys its record — so the confirmation is the honest
   * version of the same guardrail (FR-034a, research R8).
   *
   * The guardrail lives here rather than in a renderer so the HTTP API and the
   * LLM layer inherit it; the LLM layer is exactly the caller that should not
   * be able to close projects quietly (Principle V).
   *
   * Note what does *not* gate this: the structure flag. A project missing its
   * outcome closes as freely as a fully structured one (FR-034e).
   */
  async complete(slug: string, opts?: { confirmOpenMilestones?: boolean }): Promise<ProjectOutcome> {
    const project = await this.get(slug);
    if (!project) return notFound(slug);

    const open = project.milestones.filter((m) => !m.done);
    if (open.length > 0 && opts?.confirmOpenMilestones !== true) {
      return {
        ok: false,
        reason: "open-milestones",
        message:
          `${open.length} milestone${open.length === 1 ? " is" : "s are"} still open. ` +
          "Marking the project done leaves them open, recorded as never completed.",
        // Named here so the caller has nothing to compute.
        open: open.map((m) => m.definitionOfDone),
      };
    }

    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const withDate = setPreambleField(content, "completed", localDate(this.clock.now()));
    await this.vault.write(path(slug), setPreambleField(withDate, "status", "done"));
    return this.reread(slug);
  }

  /**
   * Reopens a completed project.
   *
   * Clears the project's own completion date — it is no longer complete — and
   * leaves every milestone date untouched, because those milestones really were
   * finished on those days. Reopening the project does not un-happen the work
   * (FR-036).
   */
  async reopen(slug: string, to: Exclude<ProjectStatus, "done">): Promise<ProjectOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const cleared = setPreambleField(content, "completed", null);
    await this.vault.write(path(slug), setPreambleField(cleared, "status", to));
    return this.reread(slug);
  }

  // -------------------------------------------------------------------------
  // Unprocessed items
  // -------------------------------------------------------------------------

  /**
   * Clears one item sort left behind, once the user has handled it.
   *
   * Trash first, then removal: the failure mode is a duplicate the user can
   * see, rather than a loss they cannot. No journal — a crash here costs one
   * spare line in an append-only file, where sort's cost was a corrupted
   * inbox-zero state (research R9).
   *
   * Nothing is converted into a field. Reading the item and deciding what it
   * means is the thinking the structure is for (FR-046c).
   */
  async dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<ProjectOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const project = parseProject(content, slug);
    const item = project.unprocessed[index];
    if (!item || item.raw !== expectedRaw) {
      return refuse(
        "field-changed",
        "That item changed on disk since it was shown, so nothing was written. " +
          "Here is the project as it now reads.",
      );
    }

    await this.vault.appendLine(
      "trash.md",
      trashLine({ text: item.text, capturedAt: item.capturedAt }, this.clock.now()),
    );

    const remaining = project.unprocessed.filter((u) => u.index !== index).map((u) => u.raw);
    await this.vault.write(path(slug), setUnprocessedBlocks(content, remaining));
    return this.reread(slug);
  }

  // -------------------------------------------------------------------------
  // Shared machinery
  // -------------------------------------------------------------------------

  /**
   * Verify one field, then write.
   *
   * The comparison is against a freshly read file, never a copy from when the
   * view opened. Anything else on disk may have changed and is preserved —
   * cancelling an outcome edit because the DRI moved would be a refusal the
   * user cannot act on (FR-045c).
   */
  private async writeField<T>(
    slug: string,
    expected: T,
    read: (p: Project) => T,
    apply: (content: string) => string,
  ): Promise<ProjectOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const actual = read(parseProject(content, slug));
    if (!same(actual, expected)) {
      return refuse(
        "field-changed",
        `That field changed on disk since it was shown, so nothing was written. ` +
          `It now reads: ${describe(actual)}`,
      );
    }

    await this.vault.write(path(slug), apply(content));
    return this.reread(slug);
  }

  /** A milestone's identity is its position plus its text (FR-045d). */
  private async verifyMilestone(
    slug: string,
    ref: MilestoneRef,
  ): Promise<{ project: Project; content: string } | { refusal: ProjectOutcome }> {
    const content = await this.vault.read(path(slug));
    if (content === null) return { refusal: notFound(slug) };

    const project = parseProject(content, slug);
    const milestone = project.milestones[ref.index];
    if (!milestone || milestone.raw !== ref.raw) {
      return {
        refusal: refuse(
          "field-changed",
          "That milestone changed on disk since it was shown, so nothing was written. " +
            "Here is the project as it now reads.",
        ),
      };
    }
    return { project, content };
  }

  private async rewriteMilestone(
    slug: string,
    ref: MilestoneRef,
    change: (m: Milestone) => Milestone,
  ): Promise<ProjectOutcome> {
    const check = await this.verifyMilestone(slug, ref);
    if ("refusal" in check) return check.refusal;

    const lines = check.project.milestones.map((m) =>
      m.index === ref.index ? renderMilestone(change(m)) : m.raw,
    );
    return this.writeMilestones(slug, lines);
  }

  private async writeMilestones(slug: string, lines: string[]): Promise<ProjectOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);
    await this.vault.write(path(slug), setMilestoneLines(content, lines));
    return this.reread(slug);
  }

  /** Every successful verb answers with the project as it now stands on disk. */
  private async reread(slug: string): Promise<ProjectOutcome> {
    const project = await this.get(slug);
    return project ? { ok: true, project } : notFound(slug);
  }
}

// ---------------------------------------------------------------------------

function path(slug: string): string {
  return `projects/${slug}.md`;
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function same<T>(actual: T, expected: T): boolean {
  // Absent and blank are the same claim about a field, so a caller that passes
  // "" where the file has nothing is not treated as stale.
  const norm = (v: T): unknown => (typeof v === "string" ? v.trim() : v ?? null);
  return norm(actual) === norm(expected) || (norm(actual) === null && norm(expected) === null);
}

function describe(value: unknown): string {
  return value === null || value === undefined ? "(not set)" : String(value);
}

/** Every refusal except `open-milestones`, which carries the open names too. */
function refuse(reason: Exclude<RefusalReason, "open-milestones">, message: string): ProjectOutcome {
  return { ok: false, reason, message };
}

function notFound(slug: string): ProjectOutcome {
  return refuse("not-found", `No project called "${slug}". Nothing was written.`);
}

function summarize(project: Project): ProjectSummary {
  return {
    slug: project.slug,
    title: project.title,
    status: project.status,
    milestonesDone: project.milestones.filter((m) => m.done).length,
    milestonesTotal: project.milestones.length,
    // Derived here, on every read, so it cannot disagree with the fields it
    // describes (FR-020).
    gaps: structureGaps(project),
    completedOn: project.completedOn,
  };
}

/** Re-exported so callers do not have to reach past the service for it. */
export { MILESTONES_HEADING };
