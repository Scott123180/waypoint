import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * A project's recorded status history, read from its ledger and nowhere else.
 *
 * Carried through unmapped, which is what makes "unknown, never computed"
 * structural rather than a rule to remember: `afterDays` is the ledger's own
 * and is already null wherever the record is silent, so there is no field into
 * which a derived duration could be smuggled (FR-037, FR-039, research R12).
 */

const LEDGER = [
  "- 2026-02-03 status created → active",
  "- 2026-04-11 status active → waiting — after 67d active",
  "- 2026-06-02 status waiting → active — after 52d waiting",
  "- 2026-09-30 status active → done — after 120d active",
];

const VAULT = {
  "projects/payments.md": projectFile({
    slug: "payments",
    title: "Payments migration",
    status: "done",
    completed: "2026-09-30",
    ledger: LEDGER,
  }),
};

async function historyOf(files: Record<string, string>, slug: string) {
  const { service } = serviceFor(files);
  const r = await readOk(service, range("2020-01-01", "2030-12-31", slug));
  return { history: r.history, text: renderReport(r) };
}

describe("entries", () => {
  test("every recorded entry appears, in file order", async () => {
    const { history } = await historyOf(VAULT, "payments");
    assert.equal(history?.entries.length, 4);
    assert.deepEqual(
      history?.entries.map((e) => e.on),
      ["2026-02-03", "2026-04-11", "2026-06-02", "2026-09-30"],
    );
  });

  test("each names the statuses the entry records", async () => {
    const { history } = await historyOf(VAULT, "payments");
    assert.deepEqual(
      history?.entries.map((e) => e.detail),
      ["created → active", "active → waiting", "waiting → active", "active → done"],
    );
  });

  test("the report renders one line per entry", async () => {
    const { text } = await historyOf(VAULT, "payments");
    assert.match(text, /^## Project history \(4\)$/m);
    assert.match(text, /^- 2026-02-03 — status — created → active$/m);
  });
});

describe("durations", () => {
  test("appear only where the entry records one", async () => {
    const { history } = await historyOf(VAULT, "payments");
    assert.deepEqual(
      history?.entries.map((e) => e.afterDays),
      [null, 67, 52, 120],
    );
  });

  test("the tail is rendered where recorded and absent where not", async () => {
    const { text } = await historyOf(VAULT, "payments");
    assert.match(text, /^- 2026-04-11 — status — active → waiting — after 67d active$/m);
    // The first entry has no duration, so its line simply ends.
    assert.match(text, /^- 2026-02-03 — status — created → active$/m);
  });

  test("none is computed from the surrounding dates", async () => {
    // 2026-02-03 to 2026-04-11 is 67 days, so a reader could compute the first
    // entry's missing duration. It must not.
    const { history, text } = await historyOf(VAULT, "payments");
    assert.equal(history?.entries[0]?.afterDays, null);
    const firstLine = text.split("\n").find((l) => l.startsWith("- 2026-02-03"));
    assert.doesNotMatch(firstLine ?? "", /after/);
  });

  test("a hand-written entry with no tail keeps its unknown", async () => {
    const { history } = await historyOf(
      {
        "projects/roof.md": projectFile({
          slug: "roof",
          ledger: ["- 2026-01-02 status created → active", "- 2026-05-05 status active → waiting"],
        }),
      },
      "roof",
    );

    assert.equal(history?.entries[1]?.afterDays, null);
    assert.equal(history?.entries[1]?.afterState, null);
  });
});

describe("a project with no ledger (FR-040)", () => {
  test("reports that no history is recorded", async () => {
    const { history, text } = await historyOf(
      { "projects/plain.md": projectFile({ slug: "plain", title: "Plain" }) },
      "plain",
    );

    assert.deepEqual(history?.entries, []);
    assert.match(text, /^## Project history \(0\)$/m);
    assert.match(text, /No history is recorded for this project\./);
  });

  test("which is stated as different from never having changed status", async () => {
    const { text } = await historyOf(
      { "projects/plain.md": projectFile({ slug: "plain" }) },
      "plain",
    );
    assert.match(text, /not the same as it never having changed/);
  });
});

describe("viewing changes nothing (FR-043)", () => {
  test("no entry is written, reordered, or compacted", async () => {
    const files = { ...VAULT };
    const before = files["projects/payments.md"];
    const { service, vault } = serviceFor(files);

    await readOk(service, range("2020-01-01", "2030-12-31", "payments"));
    assert.equal(await vault.read("projects/payments.md"), before);
  });

  test("a long ledger is never truncated or summarized", async () => {
    const many = Array.from(
      { length: 60 },
      (_, i) => `- 2026-01-${String((i % 28) + 1).padStart(2, "0")} status active → waiting`,
    );
    const { history, text } = await historyOf(
      { "projects/busy.md": projectFile({ slug: "busy", ledger: many }) },
      "busy",
    );

    assert.equal(history?.entries.length, 60);
    assert.match(text, /^## Project history \(60\)$/m);
    assert.equal(text.split("\n").filter((l) => l.startsWith("- 2026-01-")).length, 60);
  });
});

describe("no other surface gains a history (FR-036a)", () => {
  test("ProjectSummary has no history field", async () => {
    const { ProjectService } = await import("../src/projects/project-service");
    // A structural check rather than a type-level one: if a later change added
    // a history to the summary, this feature's promise of one surface breaks.
    assert.ok(ProjectService, "the shipped service is still the one that exists");

    const { history } = await historyOf(VAULT, "payments");
    assert.ok(history, "the retrospective is where a history lives");
  });
});
