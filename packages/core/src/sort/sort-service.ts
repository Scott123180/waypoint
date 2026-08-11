import type { Clock, InboxDocument, SortJournal, VaultStore } from "../ports/index";
import { parseInbox, type ParsedItem } from "../inbox/parse";
import { commitDecision, recoverPending, type CommitDeps } from "./commit";
import type { SortJournalEntry } from "./journal";
import type {
  DestinationRef,
  InboxItemView,
  ItemRef,
  RecoveryReport,
  SortDecision,
  SortOutcome,
} from "./decision";

/**
 * The single entry point for sorting.
 *
 * Every rule the feature depends on lives behind this class, so the Electron
 * client now — and the HTTP API and LLM layer later — all get identical
 * behaviour without reimplementing anything (Principles II and VII).
 *
 * See specs/002-inbox-view-sort/contracts/sort-api.md
 */

export interface SortServiceDeps {
  inbox: InboxDocument;
  vault: VaultStore;
  journal: SortJournal;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export class SortService {
  private readonly deps: CommitDeps;

  constructor(deps: SortServiceDeps) {
    this.deps = {
      inbox: deps.inbox,
      vault: deps.vault,
      journal: deps.journal,
      clock: deps.clock ?? systemClock,
    };
  }

  /**
   * The first unsorted item in file order, or null when nothing routable
   * remains.
   *
   * Re-reads the file every call. There is deliberately no cursor and no
   * session: calling this twice without deciding returns the *same* item,
   * which is what makes "no advancing without a decision" (FR-002) structural
   * rather than something a client has to remember.
   */
  async next(): Promise<InboxItemView | null> {
    const items = parseInbox(await this.deps.inbox.read());
    const first = items[0];
    return first ? toView(first) : null;
  }

  /** How many routable items remain. Computed from the file, never cached. */
  async count(): Promise<number> {
    return parseInbox(await this.deps.inbox.read()).length;
  }

  /**
   * Whether the inbox is at zero.
   *
   * Derived from the file so Feature 5's review gate cannot be fooled by stale
   * state, and a hand-edit is always reflected (FR-028).
   */
  async isEmpty(): Promise<boolean> {
    return (await this.count()) === 0;
  }

  /**
   * Projects and areas the user can route to, read fresh so a destination
   * created elsewhere — or by hand — appears without a restart.
   */
  async destinations(): Promise<{ projects: DestinationRef[]; areas: DestinationRef[] }> {
    const [projects, areas] = await Promise.all([
      this.readDestinations("projects"),
      this.readDestinations("areas"),
    ]);
    return { projects, areas };
  }

  private async readDestinations(dir: "projects" | "areas"): Promise<DestinationRef[]> {
    const slugs = await this.deps.vault.list(dir);
    const kind = dir === "projects" ? "project" : "area";

    return Promise.all(
      slugs.map(async (slug): Promise<DestinationRef> => {
        const content = (await this.deps.vault.read(`${dir}/${slug}.md`)) ?? "";
        return { slug, title: titleOf(content) ?? slug, kind };
      }),
    );
  }

  /**
   * Route one item.
   *
   * Awaits the disk: unlike `CaptureService.submit`, this resolves only once
   * the decision is durable, so a client cannot show the next item before the
   * current one is committed (FR-019, FR-024).
   *
   * Refusal is a value rather than an exception, matching capture's undo —
   * refusing is an expected outcome that callers must render, not crash on.
   */
  async sort(ref: ItemRef, decision: SortDecision): Promise<SortOutcome> {
    const invalid = validate(decision);
    if (invalid) return invalid;

    if (decision.to === "project" || decision.to === "area") {
      if ("slug" in decision) {
        const dir = decision.to === "project" ? "projects" : "areas";
        const path = `${dir}/${decision.slug}.md`;
        if ((await this.deps.vault.read(path)) === null) {
          return {
            ok: false,
            reason: "destination-missing",
            message: `${path} no longer exists. Nothing was written; choose again.`,
          };
        }
      }
    }

    const item = itemFromRef(ref);
    if (!item) {
      return {
        ok: false,
        reason: "item-changed",
        message: "The item could not be read back from the inbox; nothing was written.",
      };
    }

    return commitDecision(this.deps, ref, decision, item);
  }

  /**
   * Finishes any decision that was in flight when the process last stopped.
   *
   * Idempotent, and safe to crash inside. Must be called at startup before the
   * sort view opens, so the user never sees a half-committed state.
   */
  async recover(): Promise<RecoveryReport> {
    return recoverPending(this.deps, (entry: SortJournalEntry) => {
      const parsed = parseInbox(entry.ref.raw)[0];
      return { text: parsed?.text ?? entry.ref.raw.trim(), capturedAt: parsed?.capturedAt ?? null };
    });
  }
}

function validate(decision: SortDecision): SortOutcome | null {
  if (decision.to === "waiting" && decision.owner.trim().length === 0) {
    return {
      ok: false,
      reason: "empty-owner",
      message: "Waiting-for needs a name. Nothing was written.",
    };
  }
  if ((decision.to === "project" || decision.to === "area") && "createTitle" in decision) {
    if (decision.createTitle.trim().length === 0) {
      return {
        ok: false,
        reason: "empty-title",
        message: "A title is required. Nothing was created.",
      };
    }
  }
  return null;
}

/** The `#` heading, if the file has one. */
function titleOf(content: string): string | null {
  for (const line of content.split("\n")) {
    const match = /^# (.+)$/.exec(line);
    if (match) return (match[1] ?? "").trim();
  }
  return null;
}

function toView(item: ParsedItem): InboxItemView {
  return {
    text: item.text,
    capturedAt: item.capturedAt,
    ref: { start: item.start, end: item.end, raw: item.raw },
  };
}

/** Recovers the routable content from a ref's own bytes. */
function itemFromRef(ref: ItemRef): { text: string; capturedAt: Date | null } | null {
  const parsed = parseInbox(ref.raw)[0];
  if (!parsed) return null;
  return { text: parsed.text, capturedAt: parsed.capturedAt };
}
