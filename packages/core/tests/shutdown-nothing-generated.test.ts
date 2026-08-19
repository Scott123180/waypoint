import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * Nothing on this screen is produced by the application (FR-009).
 *
 * Every string on the view is either verbatim from a source file or the policy
 * module's own reason. Nothing is summarized, scored, ranked, prioritized, or
 * suggested — the shutdown shows what is already recorded, and the user decides
 * what any of it means.
 *
 * **This file is the sibling of `shutdown-adds-no-decision-point`.** That one
 * asserts the seam did not grow, which is true of a test in which no panel was
 * ever built. This one asserts from the other side that `waiting.stale.check`
 * **was** consulted, with `subject: "item"` and with `subject: "calendar"`, so
 * "consulted nothing" cannot masquerade as "consulted nothing new". Neither may
 * ship without the other.
 */

describe("exactly one decision point is consulted", () => {
  test("and it is the shipped staleness check", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    await service.read();

    assert.deepEqual(new Set(policy.points()), new Set(["waiting.stale.check"]));
  });

  test("it was consulted for waiting items", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    await service.read();

    const items = policy.calls.filter((c) => c.point === "waiting.stale.check" && c.subject === "item");
    assert.equal(items.length, 3, "three outstanding items; the received one is not a subject");
  });

  test("and for calendar flags", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    await service.read();

    const flags = policy.calls.filter(
      (c) => c.point === "waiting.stale.check" && c.subject === "calendar",
    );
    assert.equal(flags.length, 3);
  });

  test("with both subjects present in one reading — the assertion that has teeth", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    await service.read();

    const subjects = new Set(
      policy.calls.filter((c) => c.point === "waiting.stale.check").map((c) => c.subject),
    );
    assert.deepEqual(subjects, new Set(["item", "calendar"]));
  });

  test("every call carries the view's single `today`", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    const view = await service.read();

    for (const call of policy.calls) {
      assert.equal("today" in call && call.today, view.today);
    }
  });
});

describe("every string on the view has a source", () => {
  test("each reason is a reason the policy module actually returned", async () => {
    const { service, policy } = shutdownFor(populatedVault());

    const view = await service.read();
    const returned = new Set(policy.answers.map((a) => a.reason));

    for (const stale of [...view.waiting.items, ...view.calendar.items]) {
      assert.ok(returned.has(stale.reason), `"${stale.reason}" was composed rather than passed through`);
    }
  });

  test("each outcome, project title, next action, and item text is verbatim from a file", async () => {
    const files = populatedVault();
    const view = await shutdownFor(files).service.read();

    const corpus = Object.values(files).join("\n");
    const strings = [
      ...(view.topThree.week?.outcomes.map((o) => o.text) ?? []),
      ...view.projects.items.map((p) => p.summary.title),
      ...view.projects.items.map((p) => p.nextAction).filter((n): n is string => n !== null),
      ...view.projects.items.flatMap((p) => p.openMilestones.map((m) => m.definitionOfDone)),
      ...view.waiting.items.map((s) => s.item.text),
      ...view.calendar.items.map((s) => s.item.text),
    ];

    assert.ok(strings.length > 5, "the fixture must produce something to check");
    for (const value of strings) {
      assert.ok(corpus.includes(value), `"${value}" does not appear in any source file`);
    }
  });
});

describe("nothing is summarized, scored, or proposed", () => {
  test("the view carries no field that could hold a generated opinion", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();

    assert.deepEqual(Object.keys(view).sort(), [
      "calendar",
      "policyNotices",
      "projects",
      "today",
      "topThree",
      "unreadableCalendar",
      "unreadableWaiting",
      "waiting",
    ]);
  });

  test("no nested field is named for a summary, a score, or a suggestion", async () => {
    const { service } = shutdownFor(populatedVault());

    const view = await service.read();
    const names = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        names.add(key);
        walk(child);
      }
    };
    walk(view);

    // `summary` is `ProjectSummary` — Feature 3's word for "enough to render a
    // project in a list without opening it". A row of recorded fields, not a
    // summary of anything. Allowed by name so the rest of the net stays tight.
    names.delete("summary");

    for (const name of names) {
      assert.doesNotMatch(name, /summar|score|rank|suggest|propos|recommend|insight|priorit/i);
    }
  });
});
