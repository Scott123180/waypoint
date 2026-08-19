import type { VaultStore } from "../src/ports/index";
import type { Project } from "../src/projects/types";
import { parseProject } from "../src/projects/document";
import {
  renderTopThreeLines,
  renderWaitingItemLine,
  summaryHeadingFor,
} from "../src/review/review-document";
import type { WaitingReviewRecord } from "../src/review/types";
import { RetrospectiveService } from "../src/retrospective/retrospective-service";
import type { RetrospectiveQuery } from "../src/retrospective/types";

/**
 * Fixtures and stubs for the retrospective suite.
 *
 * The vault stub is the load-bearing one. It implements only `list` and `read`,
 * and a Proxy throws on any other property access — so every test that uses it
 * proves, as a side effect of running at all, that no write path was taken
 * (006 FR-051, SC-004). The `Pick<>` in `RetrospectiveServiceDeps` already makes
 * a write fail to compile; this catches anything that reached one dynamically.
 *
 * See specs/006-retrospective-view/research.md R14
 */

export type ReadOnlyVault = Pick<VaultStore, "list" | "read">;

export class CountingVault {
  /** Reads per vault-relative path, in call order. */
  readonly reads: string[] = [];
  /** Directory listings performed. */
  readonly lists: string[] = [];

  constructor(private readonly files: Map<string, string>) {}

  /** How many times a path was read. The number SC-019 asserts on. */
  readCount(path: string): number {
    return this.reads.filter((p) => p === path).length;
  }

  /** The highest read count across every path touched. */
  maxReadCount(): number {
    return this.reads.length === 0
      ? 0
      : Math.max(...[...new Set(this.reads)].map((p) => this.readCount(p)));
  }

  async list(dir: "projects" | "areas" | "log"): Promise<string[]> {
    this.lists.push(dir);
    const prefix = `${dir}/`;
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && p.endsWith(".md"))
      .map((p) => p.slice(prefix.length, -".md".length))
      .sort();
  }

  async read(relPath: string): Promise<string | null> {
    this.reads.push(relPath);
    return this.files.get(relPath) ?? null;
  }
}

/**
 * A read-only vault that throws on anything but `list` and `read`.
 *
 * Deliberately not just an object literal with two methods: a bug that reached
 * for `write` would get `undefined is not a function`, which reads like a
 * mistake in the test. This says what actually happened.
 */
export function readOnlyVault(
  files: Record<string, string>,
  /**
   * How the guard names the feature that reached for a write.
   *
   * Parameterized by Feature 9 so a shutdown write path does not fail under the
   * retrospective's name — a message naming the wrong requirement sends the
   * next reader to the wrong spec. Defaults to the existing wording, so every
   * retrospective test is behaviourally untouched.
   */
  guard: (prop: string) => string = (prop) =>
    `the retrospective touched \`${prop}\` on the vault; it may only read (006 FR-051)`,
): ReadOnlyVault & CountingVault {
  const target = new CountingVault(new Map(Object.entries(files)));
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && !ALLOWED.has(prop)) {
        throw new Error(guard(prop));
      }
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  }) as ReadOnlyVault & CountingVault;
}

const ALLOWED = new Set(["list", "read", "reads", "lists", "readCount", "maxReadCount"]);

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

export interface MilestoneSpec {
  text: string;
  done?: boolean;
  /** Written verbatim after `done `, so a malformed date can be fixtured. */
  completedOn?: string;
  verifier?: string;
}

export interface ProjectSpec {
  slug: string;
  title?: string;
  status?: string;
  /** Written verbatim, so `completed: not-a-date` is expressible. */
  completed?: string;
  outcome?: string;
  nextAction?: string;
  dri?: string;
  milestones?: MilestoneSpec[];
  /** Raw ledger lines, so a hand-written entry is expressible. */
  ledger?: string[];
}

/** A project file as it appears on disk (003 contracts/project-format.md). */
export function projectFile(spec: ProjectSpec): string {
  const title = spec.title ?? spec.slug;
  let out = `# ${title}\n\nstatus: ${spec.status ?? "active"}\n`;
  if (spec.nextAction !== undefined) out += `next action: ${spec.nextAction}\n`;
  if (spec.dri !== undefined) out += `dri: ${spec.dri}\n`;
  if (spec.completed !== undefined) out += `completed: ${spec.completed}\n`;

  if (spec.outcome !== undefined) out += `\n## Outcome\n\n${spec.outcome}\n`;

  if (spec.milestones && spec.milestones.length > 0) {
    out += "\n## Milestones\n\n";
    for (const m of spec.milestones) {
      let line = `- [${m.done ? "x" : " "}] ${m.text}`;
      if (m.verifier !== undefined) line += ` — @${m.verifier}`;
      if (m.completedOn !== undefined) line += ` — done ${m.completedOn}`;
      out += `${line}\n`;
    }
  }

  if (spec.ledger && spec.ledger.length > 0) {
    out += `\n## Ledger\n\n${spec.ledger.join("\n")}\n`;
  }

  return out;
}

/** Parses a spec straight to a `Project`, for tests that skip the vault. */
export function project(spec: ProjectSpec): Project {
  return parseProject(projectFile(spec), spec.slug);
}

export interface OutcomeSpec {
  text: string;
  done?: boolean;
  /** Verbatim, so a malformed date can be fixtured. */
  completedOn?: string;
}

/** `top-three.md` as it appears on disk (004 contracts/top-three-format.md). */
export function topThreeFile(weeks: Array<{ week: string; outcomes: (OutcomeSpec | string)[] }>): string {
  let out = "";
  for (const { week, outcomes } of weeks) {
    out += `## ${week}\n\n`;
    for (const o of outcomes) {
      // A bare string is a raw line, so an unparseable one is expressible.
      if (typeof o === "string") {
        out += `${o}\n`;
        continue;
      }
      let line = `- [${o.done ? "x" : " "}] ${o.text}`;
      if (o.completedOn !== undefined) line += ` — done ${o.completedOn}`;
      out += `${line}\n`;
    }
    out += "\n";
  }
  return out;
}

export interface LogSpec {
  week: string;
  started?: string;
  complete?: boolean;
  completed?: string;
  note?: string;
  /** Raw lines for the top-three section, so `slipped` can be fixtured. */
  finished?: string[];
  slipped?: string[];
  committed?: string[];
  /** Waiting records, rendered through the shipped renderer. */
  waiting?: Array<{
    on?: string;
    owner: string;
    days: number;
    action?: WaitingReviewRecord["action"];
    text: string;
  }>;
  summary?: { provider: string; text: string };
  /** Raw project lines. */
  projects?: string[];
}

/** `log/YYYY-Www.md` as it appears on disk (005 contracts/review-log-format.md). */
export function logFile(spec: LogSpec): string {
  const started = spec.started ?? "2026-05-15";
  let out = `# Review ${spec.week}\n\nweek: ${spec.week}\nstarted: ${started}\n`;
  out += `status: ${spec.complete === false ? "in progress" : "complete"}\n`;
  out += "step: top-three\n";
  if (spec.complete !== false) out += `completed: ${spec.completed ?? started}\n`;

  out += `\n## Inbox\n\n- ${started} 0 items, allowed\n`;

  out += "\n## Projects\n\n";
  for (const line of spec.projects ?? []) out += `${line}\n`;

  out += "\n## Waiting for\n\n";
  for (const w of spec.waiting ?? []) {
    out += `${renderWaitingItemLine(w.on ?? started, w.owner, w.days, w.action ?? "none", w.text)}\n`;
  }

  // Through the shipped renderer, for the reason the summary heading is: a
  // hand-written fixture drifted from `- slipped: x` to `- slipped x` and read
  // back as an empty list, which looked like a product bug and was not.
  out += "\n## Top three\n\n";
  for (const line of renderTopThreeLines({
    finished: spec.finished ?? [],
    slipped: spec.slipped ?? [],
    committed: spec.committed ?? [],
    forWeek: spec.week,
  })) {
    out += `${line}\n`;
  }

  if (spec.note !== undefined) out += `\n## Note\n\n${spec.note}\n`;
  if (spec.summary !== undefined) {
    // Through the shipped helper, so the fixture cannot drift from the
    // format the parser expects — it silently did, and read back "unknown".
    out += `\n## ${summaryHeadingFor(spec.summary.provider)}\n\n${spec.summary.text}\n`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Read-only stubs for the two services the retrospective depends on
// ---------------------------------------------------------------------------

/**
 * A `Pick<ProjectService, "listDetailed">` backed by a vault, so read counting
 * observes exactly what the real service would do: one read per project file
 * plus one `identity.md`.
 */
export function projectSource(vault: ReadOnlyVault): {
  listDetailed(): Promise<Array<{ project: Project }>>;
} {
  return {
    async listDetailed() {
      const slugs = await vault.list("projects");
      // Mirrors ProjectService.readAll + resolutionContext: one read per file,
      // one identity read per call, never per project.
      await vault.read("identity.md");
      const out: Array<{ project: Project }> = [];
      for (const slug of slugs) {
        const content = await vault.read(`projects/${slug}.md`);
        if (content !== null) out.push({ project: parseProject(content, slug) });
      }
      return out;
    },
  };
}

/** A service wired over an in-memory vault, with the vault for assertions. */
export function serviceFor(files: Record<string, string>): {
  service: RetrospectiveService;
  vault: ReadOnlyVault & CountingVault;
} {
  const vault = readOnlyVault(files);
  const service = new RetrospectiveService({ projects: projectSource(vault), vault });
  return { service, vault };
}

/**
 * A service whose `log/` listing names files its `read` cannot produce.
 *
 * The one case `serviceFor` cannot express, because there the listing is
 * derived from the same map the reads come from — so a file always reads if it
 * listed. On disk the two are separate syscalls with a gap between them, and
 * `FsVaultStore.read` returns null on ENOENT alone: a log deleted in that gap
 * lists and then is gone.
 *
 * Worth a fixture because the week is then in neither set unless the service
 * says so — not shown with a narrative it has no content for, and not named as
 * unreviewed either, which is how it went silently missing (006 FR-020,
 * FR-028, SC-007).
 */
export function serviceWithVanishedLogs(
  files: Record<string, string>,
  vanished: readonly string[],
): { service: RetrospectiveService; vault: ReadOnlyVault & CountingVault } {
  const vault = readOnlyVault(files);
  const wrapped: ReadOnlyVault = {
    async list(dir) {
      const listed = await vault.list(dir);
      return dir === "log" ? [...listed, ...vanished].sort() : listed;
    },
    read: (path) => vault.read(path),
  };
  return {
    service: new RetrospectiveService({ projects: projectSource(wrapped), vault: wrapped }),
    vault,
  };
}

/** A whole-range query, since most tests do not narrow. */
export function range(from: string, to: string, project: string | null = null): RetrospectiveQuery {
  return { range: { from, to }, project };
}

/** Reads and unwraps, failing loudly on a refusal a test did not expect. */
export async function readOk(
  service: RetrospectiveService,
  query: RetrospectiveQuery,
): Promise<import("../src/retrospective/types").Retrospective> {
  const result = await service.read(query);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason} — ${result.message}`);
  return result.retrospective;
}
