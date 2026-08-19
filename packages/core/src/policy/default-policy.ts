import type { Decision, DecisionContext, PolicyModule, VaultStore } from "../ports/index";
// Calendar arithmetic, not domain logic: `vault/lists` owns the one definition
// of a local date and the span between two of them. A second copy here would be
// free to round differently from the one the ledger writes, and the two numbers
// appear on the same screen.
import { daysBetween } from "../vault/lists";
import { POLICY_PATH, parsePolicyConfig, type PolicyConfig } from "./policy-config";

/**
 * The one default policy module.
 *
 * Every rule Waypoint enforces lives here, and core knows none of them — it
 * knows only the three points at which this module is asked (Principle V).
 *
 * **Exactly one module ships.** There is no loader, no discovery, and no public
 * extension API (FR-064). The seam is built; the plugin system is deliberately
 * deferred until the interface has been used internally long enough to know
 * what it should look like.
 *
 * Config is read fresh on every decision, never cached — the same habit the
 * rest of core follows, and what lets a user edit `policy.md` and see the new
 * rule take effect without restarting anything (FR-058).
 *
 * See specs/004-top-three-wip-limit/contracts/policy-seam.md
 */

export function createDefaultPolicy(vault: VaultStore): PolicyModule {
  return new DefaultPolicy(vault);
}

const ALLOW: Decision = { verdict: "allow", reason: "" };

/** Small numbers read better as words in a sentence the user will see. */
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number, noun: string): string {
  const word = WORDS[n] ?? String(n);
  return `${word} ${noun}${n === 1 ? "" : "s"}`;
}

function plural(n: number, noun: string): string {
  return `${noun}${n === 1 ? "" : "s"}`;
}

class DefaultPolicy implements PolicyModule {
  constructor(private readonly vault: VaultStore) {}

  async decide(context: DecisionContext): Promise<Decision> {
    const { problems, ...config } = parsePolicyConfig(await this.vault.read(POLICY_PATH), {
      withProblems: true,
    });

    const decision = await this.route(context, config);

    // A complaint about this module's own configuration travels with its
    // answer. Surfaced, never blocking: a typo in `policy.md` must not stop the
    // user working (FR-060). An `allow` carrying a reason is how the client
    // gets told without anything being refused.
    if (problems.length === 0) return decision;
    return { ...decision, reason: [decision.reason, ...problems].filter(Boolean).join(" ") };
  }

  private route(context: DecisionContext, config: PolicyConfig): Promise<Decision> | Decision {
    switch (context.point) {
      case "project.status.change":
        return this.statusChange(context, config);
      case "project.milestone.add":
        return this.milestoneAdd(context, config);
      case "week.outcome.record":
        return this.outcomeRecord(context, config);
      case "review.inbox.advance":
        return this.inboxAdvance(context, config);
      case "waiting.stale.check":
        return this.stale(context, config);
    }
  }

  /**
   * The work-in-progress limit.
   *
   * Counts only projects the user is actually **driving**: active, and with a
   * DRI that resolves to them. Someone else's are being *overseen* — a manager
   * may have many, and a limit counting them would fire constantly and be
   * ignored. A rule nobody heeds is worse than no rule, because it teaches the
   * user to dismiss refusals (FR-039, FR-040).
   *
   * `unassigned` and `ambiguous` do not count either: an unknown owner is not
   * the user (FR-041, FR-042). Every sort-created stub starts with no DRI, so
   * counting unknowns would make the limit fire on untriaged work — precisely
   * the false alarm this scoping exists to avoid.
   *
   * Note where the accessor is called: only after every cheap check has passed.
   * A rule that will not fire never pays to read the vault (research R4).
   */
  private async statusChange(
    context: Extract<DecisionContext, { point: "project.status.change" }>,
    config: PolicyConfig,
  ): Promise<Decision> {
    // Feature 3's open-milestone confirmation, relocated here by Feature 4.
    //
    // A `warn`, never a `block`. A hard refusal would be routed around by
    // deleting the milestone, which destroys its record — so the confirmation
    // is the honest version of the same guardrail (FR-062).
    if (context.to === "done" && context.openMilestones.length > 0) {
      const open = context.openMilestones;
      return {
        verdict: "warn",
        reason:
          `${open.length} milestone${open.length === 1 ? " is" : "s are"} still open. ` +
          "Marking the project done leaves them open, recorded as never completed.",
        // Named here so the caller has nothing to compute. Core maps this back
        // onto the `open` field clients already read (contracts/policy-seam.md).
        subjects: open,
      };
    }

    const becomingActive = context.to === "active" && context.from !== "active";
    if (!becomingActive || context.dri.resolution !== "mine") return ALLOW;

    const driving = await context.activeProjectsDrivenByUser();
    if (driving.length < config.wipLimit) return ALLOW;

    return {
      verdict: "block",
      reason:
        `You are already driving ${driving.length} active ${plural(driving.length, "project")} ` +
        `and your limit is ${config.wipLimit}. ` +
        "Finish or park one of these first.",
      // Named so the client has nothing to compute, and so the refusal is
      // something the user can act on rather than merely be told (FR-046).
      subjects: driving.map((p) => p.title),
    };
  }

  /**
   * The milestone cap — Feature 3's rule, relocated here by Feature 4.
   *
   * Four is the scope-creep guard. The cap is enforced and the floor is not: a
   * fifth milestone is refused, while a single milestone is just a project
   * mid-typing and is never flagged for it.
   *
   * The wording is Feature 3's, word for word. This rule changed address, not
   * behaviour, and the message is what the user actually sees (FR-061,
   * FR-062a).
   */
  private milestoneAdd(
    context: Extract<DecisionContext, { point: "project.milestone.add" }>,
    config: PolicyConfig,
  ): Decision {
    if (context.milestoneCount < config.milestoneCap) return ALLOW;

    return {
      verdict: "block",
      reason:
        `A project holds at most ${WORDS[config.milestoneCap] ?? config.milestoneCap} milestones, ` +
        `and this one already has ${context.milestoneCount}. ` +
        "Remove one first if this belongs here.",
    };
  }

  /**
   * The weekly outcome cap.
   *
   * A rule, not a fact: two users could reasonably set it differently and both
   * still be using Waypoint correctly. The name "top three" is core vocabulary
   * and does not change with the number (FR-063, FR-063b).
   */
  private outcomeRecord(
    context: Extract<DecisionContext, { point: "week.outcome.record" }>,
    config: PolicyConfig,
  ): Decision {
    if (context.outcomeCount < config.weeklyOutcomeCap) return ALLOW;

    return {
      verdict: "block",
      reason:
        `A top three holds at most ${count(config.weeklyOutcomeCap, "outcome")}, ` +
        `and ${context.week} already has ${context.outcomeCount}. ` +
        "Remove one first if this matters more.",
    };
  }

  /**
   * The inbox gate.
   *
   * Ships as a `warn`, the opposite default from the WIP limit and deliberately
   * so: the limit guards a commitment the user is making, while a full inbox
   * only makes the picture incomplete — and a review that cannot start is a
   * review that does not happen. A user who wants the harder version configures
   * `inbox gate: block` (005 FR-018).
   *
   * An empty inbox is `allow` whichever way it is configured. The gate is about
   * a non-empty inbox; announcing an empty one would be a message with no
   * decision behind it (005 FR-020).
   */
  private inboxAdvance(
    context: Extract<DecisionContext, { point: "review.inbox.advance" }>,
    config: PolicyConfig,
  ): Decision {
    if (context.inboxCount <= 0) return ALLOW;

    const waiting = `${count(context.inboxCount, "item")} ${context.inboxCount === 1 ? "is" : "are"} still in your inbox`;

    if (config.inboxGate === "block") {
      return {
        verdict: "block",
        reason: `${waiting}. Sort the inbox to zero before reviewing — reviewing with it full is reviewing an incomplete picture.`,
      };
    }

    return {
      verdict: "warn",
      reason: `${waiting}, so this review is working from an incomplete picture. You can sort them first, or carry on.`,
    };
  }

  /**
   * The staleness check — one rule, asked about three kinds of subject.
   *
   * A delegated item nobody has chased, a project sitting in `waiting`, and a
   * thought flagged for the calendar and never scheduled are the same
   * situation: something is not moving and time is passing. They share this
   * decision point, this threshold, and this implementation, so they cannot be
   * configured to disagree — that is structural rather than a promise (005
   * FR-080, 009 FR-028).
   *
   * `subject` reaches the wording and nothing else. Where the three differ is
   * only in what the user can do about it: an item is chased, a project is
   * parked, a flag is put in a calendar. Note in particular that the
   * remediation names what the *person* does — the application offers no
   * scheduling verb, and this sentence must not imply one (009 FR-042).
   *
   * A `warn`, never a `block`. Staleness is a prompt: the review surfaces it
   * and says nothing about what to do, and nothing here changes a byte of
   * anything (005 FR-022b).
   */
  private stale(
    context: Extract<DecisionContext, { point: "waiting.stale.check" }>,
    config: PolicyConfig,
  ): Decision {
    const days = daysBetween(context.since, context.today);

    // An unreadable or future date is not evidence of neglect. Core is supposed
    // to withhold subjects whose date is unknown (FR-094); this is the same
    // answer from the other side, so a caller that asks anyway gets silence
    // rather than an invented complaint.
    if (days === null || days < 0) return ALLOW;
    if (days < config.stalenessDays) return ALLOW;

    const noun = context.subject === "project" ? "This project has" : "This has";
    // The elapsed-time clause differs for a flag because "waiting" alone would
    // read as waiting on someone, which a calendar flag never is.
    const elapsed =
      context.subject === "calendar"
        ? `been waiting to be scheduled for ${days} ${plural(days, "day")}`
        : `been waiting ${days} ${plural(days, "day")}`;
    const next =
      context.subject === "project"
        ? "Chase it, or park it until it is really moving."
        : context.subject === "calendar"
          ? "Put it in your calendar, or let it go."
          : "Chase it, or let it go.";

    return {
      verdict: "warn",
      reason: `${noun} ${elapsed}. ${next}`,
    };
  }
}
