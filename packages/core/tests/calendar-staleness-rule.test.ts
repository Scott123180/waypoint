import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createDefaultPolicy } from "../src/policy/default-policy";
import type { Decision } from "../src/ports/index";
import { seedVault } from "./project-fakes";
import { policyFile } from "./shutdown-fakes";

/**
 * The third subject on the existing point (FR-028, contracts/shutdown-api.md §2).
 *
 * `DECISION_POINTS` does not change. `waiting.stale.check` gains a third
 * `subject`, and `subject` reaches the **wording** and nothing else: the
 * comparison, the inclusive boundary, the `allow` for an unreadable or future
 * date, and the threshold are all exactly what they already were.
 *
 * A `warn`, never a `block`, for the same reason the other two subjects are:
 * staleness is a prompt, and nothing on this screen changes a byte by itself.
 */

const TODAY = "2026-08-19";

function ask(since: string, opts: { threshold?: string | number } = {}): Promise<Decision> {
  const vault = seedVault(
    opts.threshold === undefined ? {} : { "policy.md": policyFile({ "staleness days": opts.threshold }) },
  );
  return createDefaultPolicy(vault).decide({
    point: "waiting.stale.check",
    subject: "calendar",
    since,
    today: TODAY,
  });
}

/** `TODAY` minus `days`, as a local calendar date. */
function daysAgo(days: number): string {
  const date = new Date(`${TODAY}T12:00:00`);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

describe("the boundary, asserted on both sides", () => {
  test("at the default of seven, a flag seven days old is stale", async () => {
    const decision = await ask(daysAgo(7));
    assert.equal(decision.verdict, "warn");
  });

  test("and one six days old is not", async () => {
    const decision = await ask(daysAgo(6));
    assert.equal(decision.verdict, "allow");
    assert.equal(decision.reason, "");
  });

  test("past the boundary it stays stale", async () => {
    assert.equal((await ask(daysAgo(30))).verdict, "warn");
  });

  test("a configured threshold moves the boundary, and only the boundary", async () => {
    assert.equal((await ask(daysAgo(13), { threshold: 14 })).verdict, "allow");
    assert.equal((await ask(daysAgo(14), { threshold: 14 })).verdict, "warn");
  });

  test("a threshold of zero makes today's flag stale — zero is a number, not an off switch", async () => {
    assert.equal((await ask(TODAY, { threshold: 0 })).verdict, "warn");
  });
});

describe("a date that cannot be judged is never evidence of neglect (FR-029a)", () => {
  test("an unreadable date answers allow", async () => {
    assert.equal((await ask("not-a-date")).verdict, "allow");
  });

  test("a future date answers allow", async () => {
    assert.equal((await ask("2026-12-25")).verdict, "allow");
  });
});

describe("the reason is written for a flag, not for a delegated item", () => {
  test("it names the day count and the calendar remediation", async () => {
    const decision = await ask(daysAgo(14));

    assert.equal(
      decision.reason,
      "This has been waiting to be scheduled for 14 days. Put it in your calendar, or let it go.",
    );
  });

  test("the day count pluralizes through the existing helper", async () => {
    const decision = await ask(daysAgo(1), { threshold: 1 });

    assert.match(decision.reason, /for 1 day\./);
    assert.doesNotMatch(decision.reason, /1 days/);
  });

  test("the remediation names what the person does, never a verb the app offers", async () => {
    // The app has no scheduling verb and this sentence must not imply one
    // (FR-042). "Put it in your calendar" is something the user does elsewhere.
    const reason = (await ask(daysAgo(9))).reason;

    assert.doesNotMatch(reason, /schedule it|snooze|dismiss|remind/i);
    assert.match(reason, /Put it in your calendar/);
  });

  test("the two shipped subjects still say what they said", async () => {
    const vault = seedVault({});
    const policy = createDefaultPolicy(vault);
    const since = daysAgo(14);

    const item = await policy.decide({ point: "waiting.stale.check", subject: "item", since, today: TODAY });
    const project = await policy.decide({
      point: "waiting.stale.check",
      subject: "project",
      since,
      today: TODAY,
    });

    assert.equal(item.reason, "This has been waiting 14 days. Chase it, or let it go.");
    assert.equal(
      project.reason,
      "This project has been waiting 14 days. Chase it, or park it until it is really moving.",
    );
  });
});
