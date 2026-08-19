import type { Clock, DecisionContext, Decision, PolicyModule, VaultStore } from "../src/ports/index";
import { createDefaultPolicy } from "../src/policy/default-policy";
import { ProjectService } from "../src/projects/project-service";
import { ShutdownService } from "../src/shutdown/shutdown-service";
import { calendarLine, localDate, waitingLine } from "../src/vault/lists";
import { renderActionLine } from "../src/waiting/waiting-document";
import { WaitingService } from "../src/waiting/waiting-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import { seedVault, type FakeVaultStore } from "./project-fakes";
import { CountingVault, projectFile, readOnlyVault, topThreeFile, type ReadOnlyVault } from "./retro-fakes";

/**
 * Fixtures and stubs for the shutdown suite.
 *
 * The vault stub is Feature 6's, reused rather than rewritten: it implements
 * only `list` and `read`, and a Proxy throws on any other property access — so
 * every test that uses it proves, as a side effect of running at all, that no
 * write path was taken (FR-053, SC-002). The `Pick<>` in `ShutdownServiceDeps`
 * already makes a write fail to compile; this catches anything that reached one
 * dynamically.
 *
 * The content builders render through the **shipped** line writers —
 * `waitingLine`, `calendarLine`, `renderActionLine` — rather than assembling
 * strings by hand. A hand-written fixture drifted from the grammar twice in
 * Feature 5 and read back as an empty list, which looked like a product bug and
 * was not.
 *
 * See specs/009-daily-shutdown/research.md
 */

export { CountingVault, projectFile, topThreeFile, readOnlyVault } from "./retro-fakes";
export type { ReadOnlyVault, ProjectSpec, MilestoneSpec, OutcomeSpec } from "./retro-fakes";

/** Names this feature in the read-only vault's guard, not the retrospective. */
export function shutdownVault(files: Record<string, string>): ReadOnlyVault & CountingVault {
  return readOnlyVault(
    files,
    (prop) => `the shutdown touched \`${prop}\` on the vault; it may only read (009 FR-053)`,
  );
}

/** Fixed clock, so every day count in a fixture is deterministic. */
export class FixedClock implements Clock {
  constructor(private iso = "2026-08-19T10:00:00-04:00") {}

  now(): Date {
    return new Date(this.iso);
  }

  /** Move the clock, for tests that read on one day and assert on another. */
  set(iso: string): void {
    this.iso = iso;
  }
}

/** Local noon on a calendar date, so a line renders that date in any DST state. */
export function noonOn(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

export interface WaitingSpec {
  /** Date it started waiting. */
  since: string;
  owner: string;
  text: string;
  /** Original capture time. Omitted renders a hand-written line. */
  capturedAt?: Date | null;
  /** Follow-ups and receipt, in file order. */
  actions?: Array<{ kind: "followed-up" | "received"; on: string }>;
}

/**
 * `waiting.md` as it appears on disk (002 contracts/vault-format.md, 005
 * contracts/project-ledger.md).
 *
 * A bare string is a raw line, so a malformed one is expressible — the same
 * convention `topThreeFile` uses.
 */
export function waitingFile(items: Array<WaitingSpec | string>): string {
  let out = "";
  for (const item of items) {
    if (typeof item === "string") {
      out += `${item}\n`;
      continue;
    }
    out += `${waitingLine(
      { text: item.text, capturedAt: item.capturedAt ?? null },
      item.owner,
      noonOn(item.since),
    )}\n`;
    for (const action of item.actions ?? []) out += `${renderActionLine(action)}\n`;
  }
  return out;
}

export interface CalendarSpec {
  /** Date it was flagged. */
  flaggedOn: string;
  text: string;
  capturedAt?: Date | null;
}

/** `calendar.md` as it appears on disk (002 contracts/vault-format.md). */
export function calendarFile(items: Array<CalendarSpec | string>): string {
  let out = "";
  for (const item of items) {
    if (typeof item === "string") {
      out += `${item}\n`;
      continue;
    }
    out += `${calendarLine(
      { text: item.text, capturedAt: item.capturedAt ?? null },
      noonOn(item.flaggedOn),
    )}\n`;
  }
  return out;
}

/**
 * `policy.md` as it appears on disk (004 contracts/data-files.md).
 *
 * Values are written verbatim, so `staleness days: soon` is expressible — the
 * malformed case FR-030 is about.
 */
export function policyFile(settings: Record<string, string | number>): string {
  let out = "# Policy\n\n";
  for (const [key, value] of Object.entries(settings)) out += `${key}: ${value}\n`;
  return out;
}

/** `identity.md` as it appears on disk (004 contracts/data-files.md). */
export function identityFile(canonical: string, aliases: string[] = []): string {
  let out = `# Identity\n\nme: ${canonical}\n`;
  if (aliases.length > 0) out += `\n## Aliases\n\n${aliases.map((a) => `- ${a}`).join("\n")}\n`;
  return out;
}

/**
 * A vault with something in every panel, and something excluded from each.
 *
 * The default clock is 2026-08-19 and the default threshold is seven days, so
 * "2026-08-12" is the boundary itself and "2026-08-13" is one day inside it.
 *
 * The identity is `Scott Hansen`, with `Scott` claimed as an alias — which is
 * what makes a bare `Scott` **ambiguous** against the second Scott on the
 * projects, rather than needing a contrived name to produce that resolution.
 */
export function populatedVault(): Record<string, string> {
  return {
    "identity.md": identityFile("Scott Hansen", ["Scott"]),
    "top-three.md": topThreeFile([
      {
        week: "2026-W34",
        outcomes: [
          { text: "Decide the license" , done: true, completedOn: "2026-08-17" },
          { text: "Ship the sort view" },
          { text: "Book the offsite" },
        ],
      },
      { week: "2026-W33", outcomes: [{ text: "Last week's thing", done: true, completedOn: "2026-08-14" }] },
    ]),
    "projects/alpha.md": projectFile({
      slug: "alpha",
      title: "Alpha",
      status: "active",
      dri: "Scott Hansen",
      nextAction: "Draft the migration note",
      milestones: [
        { text: "Estimate approved", done: true, completedOn: "2026-08-01" },
        { text: "Cutover rehearsed" },
      ],
    }),
    "projects/bravo.md": projectFile({
      slug: "bravo",
      title: "Bravo",
      status: "active",
      dri: "Scott Hansen",
    }),
    "projects/charlie.md": projectFile({
      slug: "charlie",
      title: "Charlie",
      status: "active",
      dri: "Scott Delgado",
    }),
    "projects/delta.md": projectFile({ slug: "delta", title: "Delta", status: "active" }),
    "projects/echo.md": projectFile({
      slug: "echo",
      title: "Echo",
      status: "active",
      dri: "Scott",
    }),
    "projects/foxtrot.md": projectFile({
      slug: "foxtrot",
      title: "Foxtrot",
      status: "waiting",
      dri: "Scott Hansen",
    }),
    "projects/golf.md": projectFile({
      slug: "golf",
      title: "Golf",
      status: "parked",
      dri: "Scott Hansen",
    }),
    "projects/hotel.md": projectFile({
      slug: "hotel",
      title: "Hotel",
      status: "done",
      completed: "2026-08-10",
      dri: "Scott Hansen",
    }),
    "waiting.md": waitingFile([
      { since: "2026-06-01", owner: "Priya", text: "Confirm the migration window moved" },
      { since: "2026-08-13", owner: "Sam", text: "Sign-off on the copy" },
      {
        since: "2026-05-02",
        owner: "Dana",
        text: "The signed contract",
        actions: [{ kind: "received", on: "2026-08-01" }],
      },
      {
        since: "2026-04-01",
        owner: "Lee",
        text: "Budget numbers",
        actions: [{ kind: "followed-up", on: "2026-08-12" }],
      },
    ]),
    "calendar.md": calendarFile([
      { flaggedOn: "2026-07-30", text: "Quarterly planning day" },
      { flaggedOn: "2026-08-12", text: "Book flights for the March offsite" },
      { flaggedOn: "2026-08-13", text: "Dentist sometime in September" },
    ]),
  };
}

// ---------------------------------------------------------------------------
// The recording policy
// ---------------------------------------------------------------------------

export interface RecordingPolicy extends PolicyModule {
  /** Every context handed to `decide`, in call order. */
  readonly calls: DecisionContext[];
  /** What was answered, in the same order. */
  readonly answers: Decision[];
  /** Just the points, for the common assertion. */
  points(): string[];
}

/**
 * The shipped module, wrapped so what core *asks* is observable.
 *
 * Wrapping rather than replacing is the point: the answers are the real ones,
 * so a test can assert both which points were consulted and what the shipped
 * rule said about them. A stub that returned `allow` would make the second
 * half unassertable, and "consulted nothing" would look like "consulted nothing
 * new" (the trap T019 and T042 pair against).
 */
export function recordingPolicy(vault: Pick<VaultStore, "read">): RecordingPolicy {
  const inner = createDefaultPolicy(vault as VaultStore);
  const calls: DecisionContext[] = [];
  const answers: Decision[] = [];

  return {
    calls,
    answers,
    points: () => calls.map((c) => c.point),
    async decide(context: DecisionContext): Promise<Decision> {
      calls.push(context);
      const decision = await inner.decide(context);
      answers.push(decision);
      return decision;
    },
  };
}

// ---------------------------------------------------------------------------
// The service under test
// ---------------------------------------------------------------------------

export interface ShutdownFixture {
  service: ShutdownService;
  vault: ReadOnlyVault & CountingVault;
  policy: RecordingPolicy;
  clock: FixedClock;
}

/**
 * A `ShutdownService` over an in-memory vault, with the vault and the policy
 * spy for assertions.
 *
 * Deliberately **not** named `serviceFor`: that already exists in
 * `retro-fakes.ts` with a different shape, and this file re-exports from there.
 *
 * The three sources are the **real** services, narrowed by
 * `ShutdownServiceDeps` to their read halves. Stubs would make the read count
 * a fiction and the parity tests meaningless — what is being measured is what
 * the shipped services actually do.
 */
export function shutdownFor(
  files: Record<string, string>,
  opts: {
    now?: string;
    /**
     * Paths whose `read` throws — a file that exists and cannot be read.
     *
     * Distinct from simply leaving a file out, and that distinction is the
     * whole of FR-011c: absence is the empty state, and a source that failed is
     * a failure named on its own panel.
     */
    unreadable?: string[];
  } = {},
): ShutdownFixture {
  const vault = shutdownVault(files);
  const clock = new FixedClock(opts.now);

  const failing = new Set(opts.unreadable ?? []);
  const source: ReadOnlyVault =
    failing.size === 0
      ? vault
      : {
          list: (dir) => vault.list(dir),
          async read(relPath) {
            // Shaped like the errors an adapter actually raises, so the message
            // the panel carries is one a user could act on.
            if (failing.has(relPath)) throw new Error(`EACCES: permission denied, open '${relPath}'`);
            return vault.read(relPath);
          },
        };

  const policy = recordingPolicy(source);

  // The cast is what the Proxy exists to catch: these services declare a full
  // `VaultStore`, and reaching for a write verb throws with a message naming
  // the requirement rather than failing as `undefined is not a function`.
  const store = source as unknown as VaultStore;

  return {
    service: new ShutdownService({
      projects: new ProjectService({ vault: store, clock, policy }),
      topThree: new TopThreeService({ vault: store, clock, policy }),
      waiting: new WaitingService({ vault: store, clock }),
      vault: source,
      policy,
      clock,
    }),
    vault,
    policy,
    clock,
  };
}

/** Today, as the fixture clock sees it. What every day count is measured against. */
export function todayOf(clock: FixedClock): string {
  return localDate(clock.now());
}

// ---------------------------------------------------------------------------
// Acting on what the screen shows
// ---------------------------------------------------------------------------

export interface ActingFixture {
  /** The read-only screen. Still cannot write; that is the point. */
  shutdown: ShutdownService;
  /** The verbs the screen's affordances call. The same ones every surface calls. */
  projects: ProjectService;
  topThree: TopThreeService;
  waiting: WaitingService;
  /** A **writable** vault, so a parity comparison has something to compare. */
  vault: FakeVaultStore;
  clock: FixedClock;
  policy: RecordingPolicy;
}

/**
 * A shutdown over a vault that can actually be written to.
 *
 * `shutdownFor` deliberately cannot write — its vault throws on anything but
 * `list` and `read`, which is what makes the immutability suite mean something.
 * The parity suite needs the opposite: two identical writable vaults, the same
 * verb invoked through each of two callers, and the resulting file compared byte
 * for byte.
 *
 * Note that `shutdown` here is still read-only **by type**. What is writable is
 * the vault the *other three services* hold — which is exactly the shape the app
 * has: a screen that reads, beside verbs that write, and no path from one to the
 * other except the user pressing something.
 */
export function actingVault(
  files: Record<string, string>,
  opts: { now?: string } = {},
): ActingFixture {
  const vault = seedVault(files);
  const clock = new FixedClock(opts.now);
  const policy = recordingPolicy(vault);

  const projects = new ProjectService({ vault, clock, policy });
  const topThree = new TopThreeService({ vault, clock, policy });
  const waiting = new WaitingService({ vault, clock });

  return {
    shutdown: new ShutdownService({ projects, topThree, waiting, vault, policy, clock }),
    projects,
    topThree,
    waiting,
    vault,
    clock,
    policy,
  };
}

/** Every file in a vault, as a plain snapshot to compare against. */
export function snapshot(vault: FakeVaultStore): Record<string, string> {
  return Object.fromEntries([...vault.files.entries()].sort());
}
