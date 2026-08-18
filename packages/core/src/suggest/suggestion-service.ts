/**
 * The verbs a client calls to *ask*. Neither of them can write.
 *
 * What is absent from `SuggestionServiceDeps` is the contract. There is no
 * vault, no inbox, no journal, no sort service, no policy, and no clock. A
 * contributor who wanted to write from here, consult a rule from here, or read
 * `log/` from here would have to change this constructor — a visible edit
 * rather than a quiet call to something already injected (FR-035, research
 * R11).
 *
 * Accepting is the *client's* call, made after the user says yes:
 * `sort.sort(ref, proposal.decision)` for a destination, `sort.split(ref,
 * pieces)` for a split. There is deliberately no `accept()` verb here, which
 * is what makes "nothing exists only on the assisted path" a fact about the
 * surface rather than a promise (FR-030, FR-031).
 *
 * See specs/008-llm-assisted-inbox-organization/contracts/suggestion-api.md
 */

import type { DestinationProvider, SplitProvider } from "../ports/index";
import type { InboxItemView } from "../sort/decision";
import { parseArea, parseProject } from "../projects/document";
import { segment } from "../intelligence/segments";
import { toDestinationProposal, toSplitProposal } from "../intelligence/response";
import type { DestinationCatalog } from "./catalog";
import type {
  DestinationOutcome,
  PrepareResult,
  PreparedRequest,
  SplitOutcome,
  SplitProposal,
  SuggestionFailure,
} from "./types";

/**
 * Two minutes, for every transport, not configurable (FR-066a).
 *
 * Armed here rather than in each transport, so it cannot drift between them:
 * the abort arrives from above, and a transport has no bound of its own
 * (research R15).
 */
export const SUGGESTION_TIMEOUT_MS = 120_000;

export interface SuggestionServiceDeps {
  /** The only read source. Names a directory, so `identity.md` is unreachable. */
  catalog: DestinationCatalog;
  /** Absent means the layer is off. The absence *is* the configuration. */
  intelligence?: SplitProvider & DestinationProvider;
  /** Test seam only. No production code path supplies it (research R15). */
  timeoutMs?: number;
}

export class SuggestionService {
  private readonly catalog: DestinationCatalog;
  private readonly intelligence: (SplitProvider & DestinationProvider) | undefined;
  private readonly timeoutMs: number;

  constructor(deps: SuggestionServiceDeps) {
    this.catalog = deps.catalog;
    this.intelligence = deps.intelligence;
    this.timeoutMs = deps.timeoutMs ?? SUGGESTION_TIMEOUT_MS;
  }

  /**
   * Prepares a request to divide one item, without sending it.
   *
   * Reads nothing: a split needs the item's own text and the partition core
   * computes from it, and nothing else exists in the payload to leak (FR-042).
   */
  async prepareSplit(item: InboxItemView): Promise<PrepareResult<SplitOutcome>> {
    const intelligence = this.intelligence;
    if (intelligence === undefined) return notConfigured();

    const text = item.text;
    const segments = segment(text);
    const prepared = intelligence.prepareSplit({
      text,
      segments: segments.map((s) => ({ index: s.index, text: text.slice(s.start, s.end) })),
    });

    return {
      ok: true,
      prepared: this.bind(prepared, (response) => toSplitProposal(response, text, segments)),
    };
  }

  /**
   * Prepares a request to place one item — or one piece of a split one.
   *
   * Takes text rather than an item, because a piece of a proposed split is not
   * an inbox item yet and must be askable about all the same (FR-026).
   */
  async prepareDestination(text: string): Promise<PrepareResult<DestinationOutcome>> {
    const intelligence = this.intelligence;
    if (intelligence === undefined) return notConfigured();

    // Read fresh, every request, so a destination created in another window is
    // proposable with no restart (FR-024).
    const [projects, areas] = await Promise.all([this.readProjects(), this.readAreas()]);
    const known = new Set([
      ...projects.map((p) => `project/${p.slug}`),
      ...areas.map((a) => `area/${a.slug}`),
    ]);

    const prepared = intelligence.prepareDestination({ item: text, projects, areas });

    return {
      ok: true,
      prepared: this.bind(prepared, (response) => toDestinationProposal(response, known)),
    };
  }

  private async readProjects(): Promise<{ slug: string; title: string; outcome: string | null }[]> {
    const slugs = await this.catalog.list("projects");
    return Promise.all(
      slugs.map(async (slug) => {
        const content = await this.catalog.read("projects", slug);
        // Title and stated outcome. `parseProject` reads far more than that;
        // only these two fields are carried across, and `DestinationRequest`
        // has nowhere to put the rest (FR-043).
        const parsed = content === null ? null : parseProject(content, slug);
        return {
          slug,
          title: parsed?.title ?? slug,
          outcome: parsed?.outcome ?? null,
        };
      }),
    );
  }

  private async readAreas(): Promise<{ slug: string; title: string }[]> {
    const slugs = await this.catalog.list("areas");
    return Promise.all(
      slugs.map(async (slug) => {
        const content = await this.catalog.read("areas", slug);
        const parsed = content === null ? null : parseArea(content, slug);
        return { slug, title: parsed?.title ?? slug };
      }),
    );
  }

  /**
   * Wraps a provider's prepared proposal in the request the client holds.
   *
   * `payload` is passed through by reference — the same string the provider
   * rendered, which is the same string it will hand the transport. Nothing
   * here re-renders it, and `run()` takes no argument, so there is no path by
   * which different content could be sent (FR-045).
   */
  private bind<R, T>(
    prepared: { readonly payload: string; send(signal: AbortSignal): Promise<R> },
    interpret: (response: R) => T,
  ): PreparedRequest<{ ok: true; proposal: T } | { ok: false; reason: SuggestionFailure; message: string }> {
    const controller = new AbortController();
    // One controller, two triggers: the bound and the user's abandon. That is
    // why both land on `timed-out` (FR-066, FR-066a).
    let abandoned = false;

    return {
      payload: prepared.payload,

      abandon: (): void => {
        abandoned = true;
        controller.abort();
      },

      run: async () => {
        if (controller.signal.aborted) return timedOut(abandoned);

        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await prepared.send(controller.signal);
          return { ok: true as const, proposal: interpret(response) };
        } catch (err) {
          if (controller.signal.aborted) return timedOut(abandoned);
          return { ok: false as const, ...classify(err) };
        } finally {
          // Cleared on every path, so a completed request leaves no timer
          // holding the process open for two minutes.
          clearTimeout(timer);
        }
      },
    };
  }
}

function notConfigured<T>(): PrepareResult<T> {
  // No message, ever. A client with no transport renders no affordance, so
  // there is nothing for a message to appear in — and a message that existed
  // would eventually be shown, which is how a user who never configured this
  // would learn it exists (FR-060).
  return { ok: false, reason: "not-configured", message: "" };
}

function timedOut(abandoned: boolean): { ok: false; reason: "timed-out"; message: string } {
  return {
    ok: false,
    reason: "timed-out",
    message: abandoned
      ? "The request was abandoned. Nothing was changed."
      : "No answer within 120 seconds, so the request was stopped. Nothing was changed.",
  };
}

/**
 * Everything a transport can throw, onto exactly one failure.
 *
 * A transport throws its own kind of error — an exit code and a stderr tail,
 * or a TLS error and an HTTP status — and this is where those become the one
 * taxonomy both are tested against (research R14).
 */
function classify(err: unknown): { reason: SuggestionFailure; message: string } {
  const named = err as { code?: string; reason?: SuggestionFailure; message?: string };

  // A transport that already knows which kind of failure this is says so, and
  // is believed. Neither transport invents a reason outside the union.
  if (typeof named.reason === "string") {
    return { reason: named.reason, message: named.message ?? "The request failed." };
  }

  return { reason: "failed", message: named.message ?? "The request failed." };
}


