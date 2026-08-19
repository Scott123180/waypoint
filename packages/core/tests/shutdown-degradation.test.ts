import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { policyFile, populatedVault, shutdownFor } from "./shutdown-fakes";

/**
 * Five ways a vault can be less than perfect, and none of them shuts the screen
 * (SC-011a).
 *
 * The shape of every case is the same: `read()` resolves, every unaffected panel
 * is built and populated, and the inputs its actions need — the raw lines, the
 * indices, the slugs — are intact. A screen that refused to open because one
 * file had a typo would be punishing the user for editing the files they were
 * invited to edit.
 *
 * These are the five the spec names. They are asserted one by one rather than in
 * a loop, because "every unaffected panel" means a different set in each case
 * and a loop would quietly assert less than it looks like it does.
 */

/** Every panel that should still be intact, with its actions' inputs present. */
function assertActionable(
  panel: { items: Array<{ item?: { raw?: string }; summary?: { slug: string } }>; failure: unknown },
  name: string,
): void {
  assert.equal(panel.failure, null, `${name} must still be built`);
  assert.ok(panel.items.length > 0, `${name} must still be populated`);
  for (const row of panel.items) {
    const identity = row.item?.raw ?? row.summary?.slug;
    assert.ok(identity, `${name} must still carry what a write would be verified against`);
  }
}

describe("no policy.md at all", () => {
  test("the documented default of seven applies, with no notice", async () => {
    const files = populatedVault();

    const view = await shutdownFor(files).service.read();

    assert.deepEqual(view.policyNotices, [], "absence is the normal case, not a problem");
    assertActionable(view.waiting, "waiting");
    assertActionable(view.calendar, "calendar");
    assertActionable(view.projects, "projects");
  });
});

describe("a `staleness days` that will not parse", () => {
  const BROKEN = { ...populatedVault(), "policy.md": policyFile({ "staleness days": "soon" }) };

  test("the default applies and every panel is built", async () => {
    const view = await shutdownFor(BROKEN).service.read();

    assertActionable(view.waiting, "waiting");
    assertActionable(view.calendar, "calendar");
    assert.equal(view.waiting.items.length, 2, "seven days, as if the file said nothing");
  });

  test("the problem is reported and nothing is refused", async () => {
    const view = await shutdownFor(BROKEN).service.read();

    assert.equal(view.policyNotices.length, 1);
    assert.match(view.policyNotices[0] ?? "", /staleness days/);
    assert.match(view.policyNotices[0] ?? "", /soon/, "the user is told what they typed");
  });

  test("one broken value does not reset another", async () => {
    const files = {
      ...populatedVault(),
      "policy.md": policyFile({ "staleness days": "soon", "wip limit": 6 }),
    };

    const view = await shutdownFor(files).service.read();

    assert.equal(view.policyNotices.length, 1, "only the broken value is complained about");
  });
});

describe("no waiting.md", () => {
  test("the panel is empty and the other three are intact", async () => {
    const files = populatedVault();
    delete files["waiting.md"];

    const view = await shutdownFor(files).service.read();

    assert.deepEqual(view.waiting.items, []);
    assert.equal(view.waiting.failure, null);
    assertActionable(view.calendar, "calendar");
    assertActionable(view.projects, "projects");
    assert.ok(view.topThree.week?.outcomes.length);
  });
});

describe("no calendar.md", () => {
  test("the panel is empty and the other three are intact", async () => {
    const files = populatedVault();
    delete files["calendar.md"];

    const view = await shutdownFor(files).service.read();

    assert.deepEqual(view.calendar.items, []);
    assert.equal(view.calendar.failure, null);
    assertActionable(view.waiting, "waiting");
    assertActionable(view.projects, "projects");
  });
});

describe("an unreadable project file", () => {
  test("the project panel fails and the other three still work", async () => {
    const view = await shutdownFor(populatedVault(), {
      unreadable: ["projects/alpha.md"],
    }).service.read();

    assert.equal(view.projects.failure?.path, "projects/");
    assertActionable(view.waiting, "waiting");
    assertActionable(view.calendar, "calendar");
    assert.ok(view.topThree.week?.outcomes.length, "and the top three is still actionable");
    assert.ok(view.topThree.week?.outcomes[0]?.raw, "with the raw line a write needs");
  });
});

describe("all five at once", () => {
  test("the screen still opens", async () => {
    const files = populatedVault();
    delete files["waiting.md"];
    delete files["calendar.md"];
    files["policy.md"] = policyFile({ "staleness days": "soon" });

    const { service } = shutdownFor(files, { unreadable: ["projects/alpha.md"] });

    const view = await service.read();

    assert.equal(view.today, "2026-08-19");
    assert.ok(view.topThree.week?.outcomes.length, "what is left still works");
    assert.equal(view.policyNotices.length, 1);
  });
});
