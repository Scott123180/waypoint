import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * The `## Completions` and `## Undated` sections.
 *
 * See specs/006-retrospective-view/contracts/report-format.md §3–§4.
 */

async function report(files: Record<string, string>, from = "2026-01-01", to = "2026-12-31") {
  const { service } = serviceFor(files);
  return renderReport(await readOk(service, range(from, to)));
}

describe("the header", () => {
  test("states the range, so a report separated from the app says what it covers", async () => {
    const text = await report({ "projects/a.md": projectFile({ slug: "a" }) }, "2026-04-01", "2026-06-30");
    assert.match(text, /^# Retrospective: 2026-04-01 to 2026-06-30$/m);
  });

  test("carries no project line when unnarrowed", async () => {
    const text = await report({ "projects/a.md": projectFile({ slug: "a" }) });
    assert.doesNotMatch(text, /^Project:/m);
  });
});

describe("## Completions", () => {
  const VAULT = {
    "projects/roof.md": projectFile({
      slug: "roof",
      title: "Roof repair",
      status: "done",
      completed: "2026-09-30",
      milestones: [{ text: "Estimate approved", done: true, completedOn: "2026-06-10" }],
    }),
  };

  test("a milestone line names its date, its project, and what was finished", async () => {
    const text = await report(VAULT);
    assert.match(text, /^- 2026-06-10 — Roof repair — Estimate approved$/m);
  });

  test("a project line says `project completed`, not its title twice", async () => {
    const text = await report(VAULT);
    assert.match(text, /^- 2026-09-30 — Roof repair — project completed$/m);
  });

  test("the heading carries the count", async () => {
    const text = await report(VAULT);
    assert.match(text, /^## Completions \(2\)$/m);
  });

  test("entries appear newest first, as rendered", async () => {
    const text = await report(VAULT);
    const lines = text.split("\n").filter((l) => l.startsWith("- 2026"));
    assert.deepEqual(lines, [
      "- 2026-09-30 — Roof repair — project completed",
      "- 2026-06-10 — Roof repair — Estimate approved",
    ]);
  });
});

describe("## Undated", () => {
  test("carries the fixed sentence saying why these cannot be placed", async () => {
    const text = await report({
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Vendor shortlist agreed", done: true }],
      }),
    });

    assert.match(text, /^## Undated \(1\)$/m);
    assert.match(text, /recorded as done but carry no readable date/);
    assert.match(text, /^- \(undated\) — Roof repair — Vendor shortlist agreed$/m);
  });

  test("a date that is not a date is quoted verbatim", async () => {
    const text = await report({
      "projects/roof.md": projectFile({
        slug: "roof",
        title: "Roof repair",
        milestones: [{ text: "Legal review closed", done: true, completedOn: "2026-13-45" }],
      }),
    });

    assert.match(text, /^- \(undated: "2026-13-45"\) — Roof repair — Legal review closed$/m);
  });

  test("an undated project completion reads like an undated milestone", async () => {
    const text = await report({
      "projects/onboarding.md": projectFile({
        slug: "onboarding",
        title: "Onboarding rewrite",
        status: "done",
      }),
    });

    assert.match(text, /^- \(undated\) — Onboarding rewrite — project completed$/m);
  });
});
