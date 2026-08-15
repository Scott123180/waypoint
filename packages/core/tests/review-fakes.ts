import { parseInbox } from "../src/inbox/parse";
import { ProjectService } from "../src/projects/project-service";
import { ReviewService } from "../src/review/review-service";
import { WaitingService } from "../src/waiting/waiting-service";
import { TopThreeService } from "../src/weekly/top-three-service";
import type { Clock, PolicyModule, SummaryProvider } from "../src/ports/index";
import { FakeVaultStore } from "./sort-fakes";

/**
 * A review over an in-memory vault.
 *
 * The inbox is held as file content rather than as a number, so "the count is
 * derived from the file on every call" is a property the tests can actually
 * exercise rather than one they have to trust.
 */

export class FakeInbox {
  constructor(public content = "") {}

  /** Same parser the real inbox uses, so hand-written lines count identically. */
  count(): Promise<number> {
    return Promise.resolve(parseInbox(this.content).length);
  }
}

export class MutableClock implements Clock {
  constructor(private iso: string) {}

  now(): Date {
    return new Date(this.iso);
  }

  set(iso: string): void {
    this.iso = iso;
  }
}

/** Records what it was handed, so payload boundaries can be asserted. */
export class StubSummaryProvider implements SummaryProvider {
  readonly name: string;
  seen: unknown[] = [];
  calls = 0;

  constructor(
    private readonly behaviour: { text?: string; fail?: string; hang?: boolean } = {},
    name = "stub-provider",
  ) {
    this.name = name;
  }

  async draft(record: unknown): Promise<string> {
    this.calls += 1;
    this.seen.push(record);
    if (this.behaviour.hang === true) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("timed out");
    }
    if (this.behaviour.fail !== undefined) throw new Error(this.behaviour.fail);
    return this.behaviour.text ?? "a drafted summary";
  }
}

export interface ReviewHarness {
  service: ReviewService;
  vault: FakeVaultStore;
  inbox: FakeInbox;
  clock: MutableClock;
  projects: ProjectService;
  topThree: TopThreeService;
  waiting: WaitingService;
}

export function makeReview(
  opts: {
    now?: string;
    inbox?: string;
    files?: Record<string, string>;
    summary?: SummaryProvider;
    /**
     * A stand-in for the shipped module.
     *
     * Only for tests that need to observe what core *asks*. Absent means the
     * real rules, as it does in production — a harness that quietly unpoliced
     * every service would make most of this suite meaningless.
     */
    policy?: PolicyModule;
  } = {},
): ReviewHarness {
  const vault = new FakeVaultStore();
  for (const [path, content] of Object.entries(opts.files ?? {})) {
    vault.files.set(path, content);
  }

  const clock = new MutableClock(opts.now ?? "2026-08-14T09:00:00-04:00");
  const inbox = new FakeInbox(opts.inbox ?? "");
  const projects = new ProjectService({ vault, clock });
  const topThree = new TopThreeService({ vault, clock });
  const waiting = new WaitingService({ vault, clock });

  const service = new ReviewService({
    vault,
    projects,
    topThree,
    inbox,
    waiting,
    clock,
    ...(opts.summary === undefined ? {} : { summary: opts.summary }),
    ...(opts.policy === undefined ? {} : { policy: opts.policy }),
  });

  return { service, vault, inbox, clock, projects, topThree, waiting };
}

/** Walks every step, so a test that cares only about completion can get there. */
export async function passAllSteps(service: ReviewService): Promise<void> {
  await service.start();
  for (let i = 0; i < 4; i++) {
    await service.advance({ confirmed: true });
  }
}

export function project(slug: string, body: string[] = []): string {
  return [`# ${slug}`, "", "status: active", "", ...body, ""].join("\n");
}
