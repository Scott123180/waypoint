import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { identityFile, populatedVault, projectFile, shutdownFor } from "./shutdown-fakes";

/**
 * What each listed project carries (FR-020–FR-023).
 *
 * The title, the next action **verbatim or null**, and the **open** milestones.
 * `nextAction: string | null` carries FR-021 in the type: there is no branch in
 * which a value could be derived, because there is nothing to derive it from.
 *
 * And no limit, anywhere. Thirty of the user's projects are thirty rows. A cap,
 * a truncation, or a "show more" would be the screen deciding which of the
 * user's commitments are worth seeing.
 */

describe("each listed project", () => {
  test("carries its title as typed, never derived from the slug", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();

    assert.deepEqual(projects.items.map((p) => p.summary.title), ["Alpha", "Bravo"]);
  });

  test("carries its next action verbatim", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();
    const alpha = projects.items.find((p) => p.summary.slug === "alpha");

    assert.equal(alpha?.nextAction, "Draft the migration note");
  });

  test("carries null where none is recorded, and infers nothing", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();
    const bravo = projects.items.find((p) => p.summary.slug === "bravo");

    assert.equal(
      bravo?.nextAction,
      null,
      "an absent next action is a gap the user fills, not one the screen fills for them",
    );
  });

  test("carries its open milestones, and only those", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();
    const alpha = projects.items.find((p) => p.summary.slug === "alpha");

    assert.deepEqual(
      alpha?.openMilestones.map((m) => m.definitionOfDone),
      ["Cutover rehearsed"],
      "a milestone already done cannot be marked done from here, so it is not offered",
    );
  });

  test("carries no milestones when the project has none", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();
    const bravo = projects.items.find((p) => p.summary.slug === "bravo");

    assert.deepEqual(bravo?.openMilestones, []);
  });

  test("keeps the raw line each milestone needs to be written against", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();
    const milestone = projects.items.find((p) => p.summary.slug === "alpha")?.openMilestones[0];

    assert.equal(milestone?.raw, "- [ ] Cutover rehearsed");
    assert.equal(milestone?.index, 1, "its position in the file is part of its identity");
  });
});

describe("order and size", () => {
  test("the panel is in slug order", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();

    const slugs = projects.items.map((p) => p.summary.slug);
    assert.deepEqual(slugs, [...slugs].sort());
  });

  test("thirty projects are thirty rows — nothing is capped, truncated, or ranked", async () => {
    const files: Record<string, string> = { "identity.md": identityFile("Scott Hansen") };
    for (let i = 0; i < 30; i++) {
      const slug = `p-${String(i).padStart(2, "0")}`;
      files[`projects/${slug}.md`] = projectFile({
        slug,
        title: `Project ${i}`,
        status: "active",
        dri: "Scott Hansen",
      });
    }

    const { service } = shutdownFor(files);
    const { projects } = await service.read();

    assert.equal(projects.items.length, 30);
    assert.equal(projects.items[0]?.summary.slug, "p-00");
    assert.equal(projects.items[29]?.summary.slug, "p-29");
  });
});
