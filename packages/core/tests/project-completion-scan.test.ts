import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ProjectService } from "../src/projects/project-service";
import { parseProject } from "../src/projects/document";
import { FixedClock, seedVault } from "./project-fakes";
import { STUB } from "./project-fixtures";

/**
 * Completed work is reviewable over any date range, from the files alone
 * (FR-038, SC-010).
 *
 * There is no index and no history file — the set of project files *is* the
 * history, which is what makes it impossible for the two to fall out of step
 * (research R10). This test stands in for the retrospective view that will read
 * these dates once it is built, and fails if the format stops being scannable.
 */

const CLOCK = new FixedClock();

function service(files: Record<string, string>) {
  const vault = seedVault(files);
  return { vault, projects: new ProjectService({ vault, clock: CLOCK }) };
}

/** What a retrospective would do: read the files, collect the dates. */
function completionsIn(
  files: Map<string, string>,
  from: string,
  to: string,
): { projects: string[]; milestones: string[] } {
  const projects: string[] = [];
  const milestones: string[] = [];

  for (const [path, content] of files) {
    if (!path.startsWith("projects/")) continue;
    const p = parseProject(content, path.slice("projects/".length, -".md".length));

    if (p.completedOn && p.completedOn >= from && p.completedOn <= to) projects.push(p.title);
    for (const m of p.milestones) {
      if (m.completedOn && m.completedOn >= from && m.completedOn <= to) {
        milestones.push(m.definitionOfDone);
      }
    }
  }
  return { projects, milestones };
}

describe("scanning completions across months", () => {
  async function threeMonths() {
    const { vault, projects } = service({
      "projects/jan.md": STUB.replace("Roof repair", "January work"),
      "projects/feb.md": STUB.replace("Roof repair", "February work"),
      "projects/mar.md": STUB.replace("Roof repair", "March work"),
    });

    const done: Array<[string, string]> = [
      ["jan", "2026-01-15"],
      ["feb", "2026-02-20"],
      ["mar", "2026-03-14"],
    ];

    for (const [slug, date] of done) {
      CLOCK.set(`${date}T10:00:00-04:00`);
      await projects.addMilestone(slug, `${slug} milestone`, "me");
      const p = await projects.get(slug);
      const m = p?.milestones[0];
      assert.ok(m);
      await projects.completeMilestone(slug, { index: m.index, raw: m.raw });
      await projects.complete(slug);
    }

    CLOCK.set("2026-08-12T10:00:00-04:00");
    return vault;
  }

  test("a single-month range returns only that month's completions", async () => {
    const vault = await threeMonths();
    const result = completionsIn(vault.files, "2026-02-01", "2026-02-28");
    assert.deepEqual(result.projects, ["February work"]);
    assert.deepEqual(result.milestones, ["feb milestone"]);
  });

  test("a range spanning two months returns both", async () => {
    const vault = await threeMonths();
    const result = completionsIn(vault.files, "2026-01-01", "2026-02-28");
    assert.deepEqual(result.projects.sort(), ["February work", "January work"]);
  });

  test("a range with nothing in it returns nothing", async () => {
    const vault = await threeMonths();
    assert.deepEqual(completionsIn(vault.files, "2026-05-01", "2026-05-31").projects, []);
  });

  test("every completion is derivable from file contents alone", async () => {
    // No index, no sidecar, nothing the app has to be running to interpret.
    const vault = await threeMonths();
    assert.ok(!vault.files.has("completions.json"));
    assert.ok(![...vault.files.keys()].some((k) => k.includes("index")));

    const raw = [...vault.files.entries()]
      .filter(([k]) => k.startsWith("projects/"))
      .map(([, v]) => v)
      .join("\n");
    assert.equal((raw.match(/^completed: /gm) ?? []).length, 3);
    assert.equal((raw.match(/ — done \d{4}-\d{2}-\d{2}$/gm) ?? []).length, 3);
  });

  test("a project completed before this feature existed carries no date and does not appear", async () => {
    // No backfill and no fabricated date — the same principle Feature 2 applied
    // to hand-written items with no capture timestamp.
    const vault = await threeMonths();
    vault.files.set("projects/ancient.md", "# Ancient history\n\nstatus: done\n");
    const result = completionsIn(vault.files, "2020-01-01", "2030-01-01");
    assert.ok(!result.projects.includes("Ancient history"));
  });
});
