import { buildCorpus } from "../identity/corpus";
import { IDENTITY_PATH, isConfigured, parseIdentity } from "../identity/identity-config";
import { resolveDri } from "../identity/resolve";
import type { Identity, NameCorpus, ResolvedDri } from "../identity/types";
import type { Clock, PolicyModule, VaultStore } from "../ports/index";
import { createDefaultPolicy } from "../policy/default-policy";
import { localDate, trashLine } from "../vault/lists";
import { slugify, uniqueSlug } from "../vault/slug";
import { renderStub } from "../vault/stub";
import {
  MILESTONES_HEADING,
  OUTCOME_HEADING,
  appendLedgerLine,
  parseProject,
  setMilestoneLines,
  setPreambleField,
  setSectionBody,
  setTitleLine,
  setUnprocessedBlocks,
} from "./document";
import { structureGaps } from "./gaps";
import { renderStatusChange, statusSince } from "./ledger";
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
  /**
   * Defaults to the single shipped module.
   *
   * Absent means *the default rules*, not *no rules*. That is load-bearing
   * twice over: it keeps every existing caller — including Feature 3's whole
   * suite — enforcing exactly what it enforced before, and it means a caller
   * cannot obtain an unpoliced service by forgetting an argument, which is the
   * bypass Principle V exists to prevent (research R3).
   */
  policy?: PolicyModule;
}

/** How much the user is driving, and whether there is room for more (FR-050). */
export interface OverLimitState {
  /** Active projects whose DRI resolves to the user. Core's count. */
  driving: number;
  /** Those projects, named — what the user would finish or park. */
  subjects: string[];
  /**
   * Whether the rules would allow one more. Policy's answer, not core's.
   *
   * False covers both "exactly at the limit" and "past it by hand-edit"; the
   * message distinguishes them, and neither blocks anything but a further
   * activation (FR-050, FR-051).
   */
  hasRoom: boolean;
  /** The module's own words, limit included. Empty when there is room. */
  message: string;
  /** So a client can distinguish a silent limit from a satisfied one (FR-031). */
  identityConfigured: boolean;
}

const systemClock: Clock = { now: () => new Date() };

/**
 * How many milestones a project may hold by default.
 *
 * @deprecated Feature 4 moved the cap into the policy module, where it is
 * configurable in `policy.md`. This is only the *default* that module applies,
 * kept exported so no existing importer breaks. Read the effective cap from
 * policy, not from here.
 *
 * Deliberately not imported from `policy/policy-config`: core must not reach
 * into the policy module, and `policy-config.test.ts` asserts the two numbers
 * agree, so drift is caught by a test rather than prevented by coupling.
 */
export const MILESTONE_CAP = 4;

export class ProjectService {
  private readonly vault: VaultStore;
  private readonly clock: Clock;
  private readonly policy: PolicyModule;

  constructor(deps: ProjectServiceDeps) {
    this.vault = deps.vault;
    this.clock = deps.clock ?? systemClock;
    this.policy = deps.policy ?? createDefaultPolicy(deps.vault);
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Every project, done ones included. For the review and the retrospective.
   *
   * **One pass over the vault.** Each project file is read exactly once, and
   * both the name corpus and every per-project resolution are derived from the
   * array in memory. The obvious alternative — letting each summary resolve
   * itself — would re-read every file for every project, because ambiguity
   * needs vault-wide input. That is quadratic, and the tempting fix (cache the
   * corpus) is exactly the stored derived state that drifts the first time the
   * user edits a file in vim (FR-020b, FR-020c, research R6).
   */
  async list(): Promise<ProjectSummary[]> {
    return (await this.listDetailed()).map((d) => d.summary);
  }

  /**
   * Every project in full, each with its summary, from the same one pass.
   *
   * For a caller that needs the body as well as the row — the weekly review's
   * walk shows the outcome, the next action, and every milestone, and could
   * otherwise only get them by reading each file a second time. That second
   * read is exactly the quadratic path `list()` was shaped to avoid, so the
   * cheaper answer lives here rather than in the caller (005 SC-016).
   */
  async listDetailed(): Promise<{ project: Project; summary: ProjectSummary }[]> {
    const projects = await this.readAll();
    const { identity, corpus } = await this.resolutionContext(projects);
    return projects.map((project) => ({
      project,
      summary: summarize(project, resolveDri(project.dri, identity, corpus)),
    }));
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
   * One project, with its DRI resolved against the whole vault.
   *
   * A sibling of `get` rather than a change to it: `get`'s shape is what every
   * write verb answers with, and widening it would ripple through the whole
   * surface for the benefit of one view.
   *
   * Resolving one project reads every project file, because ambiguity cannot
   * be answered from one file alone. That cost is deliberate — a single-project
   * view and the list must not give different answers to the same question,
   * which is the divergence the whole matching design exists to prevent
   * (FR-020a).
   */
  async getResolved(
    slug: string,
  ): Promise<{ project: Project; dri: ResolvedDri; needsDri: boolean } | null> {
    const projects = await this.readAll();
    const project = projects.find((p) => p.slug === slug);
    if (!project) return null;

    const { identity, corpus } = await this.resolutionContext(projects);
    const dri = resolveDri(project.dri, identity, corpus);
    return { project, dri, needsDri: dri.resolution === "unassigned" };
  }

  /** Whether this vault has been told who the user is (FR-031). */
  async identityConfigured(): Promise<boolean> {
    return isConfigured(parseIdentity(await this.vault.read(IDENTITY_PATH)));
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
    const refusal = await this.consultStatusChange(slug, next);
    if (refusal) return refusal;

    // The ledger entry is written here, by the verb performing the action —
    // never by a client and never by the review. The same status change made
    // from any surface produces an identical entry, because there is one place
    // that produces it (FR-092).
    return this.writeField(slug, expected, (p) => p.status, (content, current) =>
      this.withStatusEntry(setPreambleField(content, "status", next), current, next),
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

    // The cap itself lives in the policy module. Core knows only that a rule is
    // consulted here, never what it says — and the empty-value check above stays
    // first, so the user is told the actionable thing rather than a cap they
    // are not at (Feature 4, FR-061).
    const decision = await this.policy.decide({
      point: "project.milestone.add",
      project: { slug: project.slug, title: project.title, status: project.status, dri: project.dri },
      milestoneCount: project.milestones.length,
    });
    if (decision.verdict === "block") {
      return refuse("milestone-cap", decision.reason);
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

    const refusal = await this.consultStatusChange(slug, "done", {
      confirmed: opts?.confirmOpenMilestones === true,
    });
    if (refusal) return refusal;

    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const current = parseProject(content, slug);
    const withDate = setPreambleField(content, "completed", localDate(this.clock.now()));
    const withStatus = setPreambleField(withDate, "status", "done");
    await this.vault.write(path(slug), this.withStatusEntry(withStatus, current, "done"));
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
    const refusal = await this.consultStatusChange(slug, to);
    if (refusal) return refusal;

    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const current = parseProject(content, slug);
    const cleared = setPreambleField(content, "completed", null);
    const withStatus = setPreambleField(cleared, "status", to);
    await this.vault.write(path(slug), this.withStatusEntry(withStatus, current, to));
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
    apply: (content: string, current: Project) => string,
  ): Promise<ProjectOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const current = parseProject(content, slug);
    const actual = read(current);
    if (!same(actual, expected)) {
      return refuse(
        "field-changed",
        `That field changed on disk since it was shown, so nothing was written. ` +
          `It now reads: ${describe(actual)}`,
      );
    }

    await this.vault.write(path(slug), apply(content, current));
    return this.reread(slug);
  }

  /**
   * The status line and its ledger entry, composed into one content transform.
   *
   * One write, not two. A crash between them would leave a status the ledger
   * does not explain, and the ledger's whole value is that it explains the
   * status. `writeField` already takes a transform, so this is the natural
   * shape rather than an extra mechanism (contracts/project-ledger.md).
   *
   * A no-op change records nothing: an entry records a change, and recording a
   * non-change would put noise in the history *and* reset the duration clock,
   * making a project that has sat untouched for months look freshly moved.
   */
  private withStatusEntry(content: string, current: Project, to: ProjectStatus): string {
    if (current.status === to) return content;

    return appendLedgerLine(
      content,
      renderStatusChange({
        on: localDate(this.clock.now()),
        from: current.status,
        to,
        // What the ledger already knows, and nothing more. No prior entry
        // entering the state that just ended means no duration is recorded.
        since: statusSince(current.ledger, current.status),
      }),
    );
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

  /**
   * Consults the status-change decision point. Returns a refusal, or null.
   *
   * Called before the write, never after — a decision made on stale state is
   * not a decision (contracts/policy-seam.md).
   *
   * Reading the whole vault to resolve one project's DRI is the accepted cost
   * of ambiguity needing vault-wide input: a status change is a single
   * user-initiated action, bounded by the same budget as rendering the list.
   */
  private async consultStatusChange(
    slug: string,
    to: ProjectStatus,
    opts?: { confirmed?: boolean },
  ): Promise<ProjectOutcome | null> {
    const projects = await this.readAll();
    const project = projects.find((p) => p.slug === slug);
    if (!project) return notFound(slug);

    const { identity, corpus } = await this.resolutionContext(projects);

    const decision = await this.policy.decide({
      point: "project.status.change",
      project: { slug: project.slug, title: project.title, status: project.status, dri: project.dri },
      from: project.status,
      to,
      dri: resolveDri(project.dri, identity, corpus),
      openMilestones: project.milestones.filter((m) => !m.done).map((m) => m.definitionOfDone),
      // Lazy: a rule that does not need this never pays for it. Excludes the
      // project being changed, so a no-op write cannot count itself and refuse
      // at the limit rather than above it.
      activeProjectsDrivenByUser: () =>
        Promise.resolve(
          projects
            .filter(
              (p) =>
                p.slug !== slug &&
                p.status === "active" &&
                resolveDri(p.dri, identity, corpus).resolution === "mine",
            )
            .map((p) => ({ slug: p.slug, title: p.title, status: p.status })),
        ),
    });

    // A warning needs confirmation. The caller retries with the flag set and
    // the same decision is honoured rather than re-asked — Feature 3's
    // `open-milestones` flow, unchanged in everything the user sees.
    if (decision.verdict === "warn") {
      if (opts?.confirmed === true) return null;
      return {
        ok: false,
        reason: "open-milestones",
        message: decision.reason,
        // Mapped back onto the field clients already read. `subjects` is the
        // seam's internal name; `open` is the contract with the renderer, and
        // renaming it would silently hide the confirmation dialog
        // (contracts/policy-seam.md).
        open: decision.subjects,
      };
    }

    if (decision.verdict !== "block") return null;
    // The reason is the module's, passed through untouched — core never
    // rewrites an explanation it did not author.
    return { ok: false, reason: "wip-limit", message: decision.reason, subjects: decision.subjects };
  }

  /**
   * How much the user is driving, and whether the rules leave room for more.
   *
   * The split matters. **The count is core's** — a fact about the data. **The
   * comparison is policy's** — a rule. So core does not read the limit and does
   * not compute `count > limit`; it asks the same decision point a real
   * activation would hit, with the facts it already has, and reports the
   * answer. A renderer computing the comparison would be a client holding a
   * rule, which the future API would have to reimplement to agree with
   * (Principle II, Principle V, research R11).
   *
   * That is also why this reads no policy configuration: the number lives in
   * the module's message, and core never learns it.
   */
  async overLimitState(): Promise<OverLimitState> {
    const projects = await this.readAll();
    const { identity, corpus } = await this.resolutionContext(projects);

    const driving = projects
      .filter((p) => p.status === "active" && resolveDri(p.dri, identity, corpus).resolution === "mine")
      .map((p) => ({ slug: p.slug, title: p.title, status: p.status }));

    // "Is there room for one more?" is the same question a real activation
    // asks, so it is asked the same way rather than reimplemented.
    const decision = await this.policy.decide({
      point: "project.status.change",
      project: { slug: "", title: "", status: "parked", dri: null },
      from: "parked",
      to: "active",
      dri: { resolution: "mine", raw: null },
      openMilestones: [],
      activeProjectsDrivenByUser: () => Promise.resolve(driving),
    });

    return {
      driving: driving.length,
      subjects: driving.map((p) => p.title),
      hasRoom: decision.verdict !== "block",
      // The module's own words, including the limit and any complaint about its
      // configuration. Passed through untouched.
      message: decision.reason,
      identityConfigured: isConfigured(identity),
    };
  }

  /** Every project on disk, parsed, each file read exactly once. */
  private async readAll(): Promise<Project[]> {
    const slugs = await this.vault.list("projects");
    const projects = await Promise.all(slugs.map((slug) => this.get(slug)));
    return projects.filter((p): p is Project => p !== null);
  }

  /**
   * Identity plus the name corpus, from projects already parsed.
   *
   * One extra read (`identity.md`) per operation, never per project. Nothing
   * here is cached: a hand-edit to either the identity file or any project must
   * be reflected the next time anything asks (FR-020b).
   */
  private async resolutionContext(
    projects: readonly Project[],
  ): Promise<{ identity: Identity; corpus: NameCorpus }> {
    const identity = parseIdentity(await this.vault.read(IDENTITY_PATH));
    return { identity, corpus: buildCorpus(projects) };
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

function summarize(project: Project, dri: ResolvedDri): ProjectSummary {
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
    dri,
    // Its own signal, sitting beside `gaps` rather than inside it. A missing
    // DRI is not a structure gap (Feature 3 FR-009, Feature 4 FR-033).
    needsDri: dri.resolution === "unassigned",
    // Derived here beside the other two, for the same reason: a stored copy
    // drifts the first time the user edits the file by hand (Feature 5).
    statusSince: statusSince(project.ledger, project.status),
  };
}

/** Re-exported so callers do not have to reach past the service for it. */
export { MILESTONES_HEADING };
