import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { identityFile, populatedVault, projectFile, shutdownFor } from "./shutdown-fakes";

/**
 * Panel 2 — active, and mine. Nothing else (FR-017–FR-019, SC-007).
 *
 * Both halves are answers core already has: `status` is the project's own field,
 * and `dri.resolution` is what `resolveDri` worked out against the whole vault.
 * This panel applies no matching of its own, which is the point — a second
 * definition of "is this mine" would be free to disagree with the WIP limit's.
 *
 * The fixture crosses every status against every resolution deliberately. Three
 * of the four resolutions are exclusions, and the two that look most like
 * inclusions — `unassigned` and `ambiguous` — are the ones a well-meaning
 * "helpful" change would start listing.
 */

const MATRIX = {
  ...Object.fromEntries(
    (["active", "waiting", "parked", "done"] as const).flatMap((status) =>
      (
        [
          ["mine", "Scott Hansen"],
          ["theirs", "Scott Delgado"],
          ["ambiguous", "Scott"],
        ] as const
      ).map(([who, dri]) => [
        `projects/${status}-${who}.md`,
        projectFile({
          slug: `${status}-${who}`,
          title: `${status} ${who}`,
          status,
          dri,
          ...(status === "done" ? { completed: "2026-08-01" } : {}),
        }),
      ]),
    ),
  ),
  ...Object.fromEntries(
    (["active", "waiting", "parked", "done"] as const).map((status) => [
      `projects/${status}-unassigned.md`,
      projectFile({
        slug: `${status}-unassigned`,
        title: `${status} unassigned`,
        status,
        ...(status === "done" ? { completed: "2026-08-01" } : {}),
      }),
    ]),
  ),
  "identity.md": identityFile("Scott Hansen", ["Scott"]),
};

describe("the whole status × resolution matrix", () => {
  test("exactly one cell is listed: active and mine", async () => {
    const { service } = shutdownFor(MATRIX);

    const { projects } = await service.read();

    assert.equal(projects.failure, null);
    assert.deepEqual(projects.items.map((p) => p.summary.slug), ["active-mine"]);
  });

  test("someone else's active project is never listed", async () => {
    const { service } = shutdownFor(MATRIX);

    const { projects } = await service.read();

    assert.ok(!projects.items.some((p) => p.summary.slug === "active-theirs"));
  });

  test("an unassigned project is not mine — an unknown owner is not the user", async () => {
    const { service } = shutdownFor(MATRIX);

    const { projects } = await service.read();

    assert.ok(!projects.items.some((p) => p.summary.slug === "active-unassigned"));
  });

  test("an ambiguous DRI is never listed, and nothing guesses the human behind it", async () => {
    const { service } = shutdownFor(MATRIX);

    const { projects } = await service.read();

    assert.ok(
      !projects.items.some((p) => p.summary.slug === "active-ambiguous"),
      "ambiguity demotes a confident match to 'ask a human'; the panel must not answer for them",
    );
  });

  test("my own waiting, parked, and done projects are not listed either", async () => {
    const { service } = shutdownFor(MATRIX);

    const { projects } = await service.read();

    for (const status of ["waiting", "parked", "done"]) {
      assert.ok(
        !projects.items.some((p) => p.summary.slug === `${status}-mine`),
        `${status}-mine is mine, but it is not active`,
      );
    }
  });
});

describe("the resolution is core's, unchanged", () => {
  test("every listed project reports `mine`", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();

    assert.ok(projects.items.length > 0, "the fixture must produce a panel to measure");
    for (const project of projects.items) {
      assert.equal(project.summary.dri.resolution, "mine");
      assert.equal(project.summary.status, "active");
    }
  });

  test("the populated fixture lists exactly the two active-and-mine projects", async () => {
    const { service } = shutdownFor(populatedVault());

    const { projects } = await service.read();

    assert.deepEqual(projects.items.map((p) => p.summary.slug), ["alpha", "bravo"]);
  });
});

describe("with no identity configured", () => {
  test("nothing is mine, and nothing is guessed", async () => {
    // A named project whose owner is simply not known to be the user. Listing
    // it would mean the panel deciding who the user is, which core refuses to
    // do without `identity.md` saying so (004 FR-031).
    const { service } = shutdownFor({
      "projects/alpha.md": projectFile({ slug: "alpha", status: "active", dri: "Scott Hansen" }),
    });

    const { projects } = await service.read();

    assert.deepEqual(projects.items, []);
    assert.equal(projects.failure, null, "an unconfigured identity is an empty panel, not an error");
  });
});
