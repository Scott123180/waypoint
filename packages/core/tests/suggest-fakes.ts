import { catalogOf, type CatalogDir, type DestinationCatalog } from "../src/suggest/catalog";
import type {
  DestinationProvider,
  DestinationRequest,
  DestinationResponse,
  PreparedProposal,
  SplitProvider,
  SplitRequest,
  SplitResponse,
  Transport,
} from "../src/ports/index";
import { FakeVaultStore } from "./sort-fakes";

/**
 * In-memory doubles for the suggestion layer.
 *
 * The one that carries weight is `RecordingTransport`: it keeps every string
 * it was handed **by reference**, so a test can assert
 * `transport.received[0] === prepared.payload` with `===` rather than deep
 * equality. That is the whole point of research R4 — the previewed content and
 * the sent content are one value, not two constructions that happen to agree.
 */

export class RecordingTransport implements Transport {
  readonly name: string;
  /** Every request, by reference, in call order. */
  readonly received: string[] = [];
  /** Every signal handed down, so the one-controller claim is checkable. */
  readonly signals: AbortSignal[] = [];
  calls = 0;

  constructor(
    private readonly behaviour: {
      /** Returned from `send`. A function is called with the request. */
      reply?: string | ((request: string) => string);
      /** Thrown instead of replying. */
      fail?: Error;
      /** Never settles until aborted, for the timeout and abandon paths. */
      hang?: boolean;
      /** Milliseconds before replying. */
      delayMs?: number;
    } = {},
    name = "recording-transport",
  ) {
    this.name = name;
  }

  async send(request: string, signal: AbortSignal): Promise<string> {
    this.calls += 1;
    this.received.push(request);
    this.signals.push(signal);

    if (this.behaviour.hang === true) {
      return await new Promise<string>((_resolve, reject) => {
        if (signal.aborted) return reject(abortError());
        signal.addEventListener("abort", () => reject(abortError()), { once: true });
      });
    }

    if (this.behaviour.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
    }

    if (this.behaviour.fail !== undefined) throw this.behaviour.fail;

    const reply = this.behaviour.reply ?? "";
    return typeof reply === "function" ? reply(request) : reply;
  }
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** A transport that must never be reached. Any call is the test's failure. */
export class ForbiddenTransport implements Transport {
  readonly name = "forbidden-transport";
  send(): Promise<string> {
    throw new Error("a transport was contacted when nothing should have been sent");
  }
}

export class StubSplitProvider implements SplitProvider {
  readonly name: string;
  /** The domain request each `prepareSplit` was handed. */
  readonly seen: SplitRequest[] = [];
  /** How many prepared proposals were actually sent. */
  sends = 0;
  prepares = 0;

  constructor(
    private readonly behaviour: {
      response?: SplitResponse | ((request: SplitRequest) => SplitResponse);
      fail?: Error;
      hang?: boolean;
      payload?: (request: SplitRequest) => string;
    } = {},
    name = "stub-split",
  ) {
    this.name = name;
  }

  prepareSplit(request: SplitRequest): PreparedProposal<SplitResponse> {
    this.prepares += 1;
    this.seen.push(request);
    const payload = (this.behaviour.payload ?? JSON.stringify)(request);

    return {
      payload,
      send: async (signal: AbortSignal): Promise<SplitResponse> => {
        this.sends += 1;
        if (this.behaviour.hang === true) return await never(signal);
        if (this.behaviour.fail !== undefined) throw this.behaviour.fail;
        const response = this.behaviour.response ?? { pieces: [], nothingToSplit: true };
        return typeof response === "function" ? response(request) : response;
      },
    };
  }
}

export class StubDestinationProvider implements DestinationProvider {
  readonly name: string;
  readonly seen: DestinationRequest[] = [];
  sends = 0;
  prepares = 0;

  constructor(
    private readonly behaviour: {
      response?: DestinationResponse | ((request: DestinationRequest) => DestinationResponse);
      fail?: Error;
      hang?: boolean;
      payload?: (request: DestinationRequest) => string;
    } = {},
    name = "stub-destination",
  ) {
    this.name = name;
  }

  prepareDestination(request: DestinationRequest): PreparedProposal<DestinationResponse> {
    this.prepares += 1;
    this.seen.push(request);
    const payload = (this.behaviour.payload ?? JSON.stringify)(request);

    return {
      payload,
      send: async (signal: AbortSignal): Promise<DestinationResponse> => {
        this.sends += 1;
        if (this.behaviour.hang === true) return await never(signal);
        if (this.behaviour.fail !== undefined) throw this.behaviour.fail;
        const response = this.behaviour.response ?? { decision: { to: "trash" }, reason: "stubbed" };
        return typeof response === "function" ? response(request) : response;
      },
    };
  }
}

/** Settles only when the signal aborts — the timeout and abandon paths. */
function never<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

/** Counts what was asked for, so "reads fresh every request" is assertable. */
export class FakeDestinationCatalog implements DestinationCatalog {
  readonly listLog: CatalogDir[] = [];
  readonly readLog: string[] = [];

  constructor(public files: Map<string, string> = new Map()) {}

  list(dir: CatalogDir): Promise<string[]> {
    this.listLog.push(dir);
    const prefix = `${dir}/`;
    return Promise.resolve(
      [...this.files.keys()]
        .filter((p) => p.startsWith(prefix) && p.endsWith(".md"))
        .map((p) => p.slice(prefix.length, -".md".length))
        .sort(),
    );
  }

  read(dir: CatalogDir, slug: string): Promise<string | null> {
    this.readLog.push(`${dir}/${slug}.md`);
    return Promise.resolve(this.files.get(`${dir}/${slug}.md`) ?? null);
  }
}

/**
 * A vault and a catalog over it, in one call.
 *
 * Takes the whole vault — including the files this feature must never read —
 * so a payload test can plant a marker in `identity.md` and prove by absence
 * that it never travelled.
 */
export function seedIntelligence(files: Record<string, string> = {}): {
  vault: FakeVaultStore;
  catalog: DestinationCatalog;
} {
  const vault = new FakeVaultStore();
  for (const [path, content] of Object.entries(files)) vault.files.set(path, content);
  return { vault, catalog: catalogOf(vault) };
}

/** A project file in the shape `parseProject` expects, with a stated outcome. */
export function projectFile(title: string, outcome?: string, extra: string[] = []): string {
  return [
    `# ${title}`,
    "",
    "status: active",
    ...(outcome === undefined ? [] : ["", "## Outcome", "", outcome]),
    ...(extra.length === 0 ? [] : ["", ...extra]),
    "",
  ].join("\n");
}

/** An area file. Areas have no outcome, so a title and a status. */
export function areaFile(title: string, extra: string[] = []): string {
  return [`# ${title}`, "", "status: active", ...(extra.length === 0 ? [] : ["", ...extra]), ""].join("\n");
}
