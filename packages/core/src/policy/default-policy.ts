import type { Decision, DecisionContext, PolicyModule, VaultStore } from "../ports/index";
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
}
