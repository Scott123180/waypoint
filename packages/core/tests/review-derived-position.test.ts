import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { makeReview } from "./review-fakes";

/**
 * The walk position is derived from the log, not stored beside it.
 *
 * The proof is a hand-edit: delete a project's line from `## Projects` and that
 * project is offered again, because "where am I" is answered by reading the
 * file rather than by a number the service remembered. A stored cursor would
 * survive the deletion and be wrong (research R3).
 *
 * This is also the property that keeps the position correct when the *walk set*
 * changes mid-review — a project parked in another window does not shift a
 * cursor, because there is no cursor to shift.
 */

const VAULT = {
  "projects/alpha.md": "# Alpha\n\nstatus: active\n",
  "projects/bravo.md": "# Bravo\n\nstatus: active\n",
  "projects/charlie.md": "# Charlie\n\nstatus: active\n",
};

const WEEK = "log/2026-W33.md";

describe("deleting a record by hand", () => {
  test("offers that project again", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");
    await service.recordNoChange("bravo");

    assert.equal((await service.nextProject())?.project.slug, "charlie");

    // The user opens the log in a text editor and removes one line.
    vault.files.set(
      WEEK,
      (vault.files.get(WEEK) ?? "")
        .split("\n")
        .filter((l) => !l.includes(" alpha "))
        .join("\n"),
    );

    assert.equal(
      (await service.nextProject())?.project.slug,
      "alpha",
      "the file is the state — removing the record removes the fact",
    );
  });

  test("adding a record by hand marks that project walked", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();

    vault.files.set(
      WEEK,
      (vault.files.get(WEEK) ?? "").replace(
        "## Projects\n",
        "## Projects\n\n- 2026-08-14 alpha no change\n",
      ),
    );

    assert.equal(
      (await service.nextProject())?.project.slug,
      "bravo",
      "a line the user wrote reads exactly like one the app wrote",
    );
  });
});

describe("the walk set changing under the position", () => {
  test("parking the current project moves on without losing anyone", async () => {
    const { service, projects } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");

    assert.equal((await service.nextProject())?.project.slug, "bravo");

    // Parked elsewhere — it leaves the walk set entirely, and there is no index
    // pointing past charlie as a result.
    await projects.setStatus("bravo", "active", "parked");

    assert.equal((await service.nextProject())?.project.slug, "charlie");
    assert.deepEqual(
      (await service.projectStep()).map((e) => e.project.slug),
      ["alpha", "charlie"],
    );
  });

  test("a project added before the current one is not skipped", async () => {
    const { service, vault } = makeReview({ files: { ...VAULT } });
    await service.start();
    await service.recordNoChange("alpha");

    // Sorts before "bravo", so a stored index would have jumped over it.
    vault.files.set("projects/aardvark.md", "# Aardvark\n\nstatus: active\n");

    assert.equal((await service.nextProject())?.project.slug, "aardvark");
  });

  test("every project reviewed leaves nothing next", async () => {
    const { service } = makeReview({ files: { ...VAULT } });
    await service.start();
    for (const slug of ["alpha", "bravo", "charlie"]) await service.recordNoChange(slug);

    assert.equal(await service.nextProject(), null);
  });
});
