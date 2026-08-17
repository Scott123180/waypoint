import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { logFile, projectFile, range, readOk, serviceFor, topThreeFile } from "./retro-fakes";

/**
 * The same question, twice, over unchanged files, byte for byte (SC-003).
 *
 * Deliberately fixtured with entries that share a completion date, because that
 * is the case a naive implementation gets wrong — and the reason the tie-break
 * is made of slugs and indices rather than of read order.
 */

const VAULT = {
  "projects/zebra.md": projectFile({
    slug: "zebra",
    title: "Zebra",
    status: "done",
    completed: "2026-06-10",
    milestones: [
      { text: "z-b", done: true, completedOn: "2026-06-10" },
      { text: "z-a", done: true, completedOn: "2026-06-10" },
      { text: "z-undated", done: true },
    ],
    ledger: ["- 2026-01-02 status created → active"],
  }),
  "projects/apple.md": projectFile({
    slug: "apple",
    title: "Apple",
    milestones: [{ text: "a-a", done: true, completedOn: "2026-06-10" }],
  }),
  "top-three.md": topThreeFile([
    {
      week: "2026-W24",
      outcomes: [
        { text: "o-one", done: true, completedOn: "2026-06-10" },
        { text: "o-two", done: true, completedOn: "2026-06-10" },
      ],
    },
  ]),
  "log/2026-W24.md": logFile({ week: "2026-W24", note: "same every time" }),
};

describe("repeated reads render identically", () => {
  test("the whole report is byte-identical across three reads", async () => {
    const { service } = serviceFor(VAULT);
    const a = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));
    const b = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));
    const c = renderReport(await readOk(service, range("2026-01-01", "2026-12-31")));

    assert.equal(a, b);
    assert.equal(b, c);
    assert.ok(a.includes("z-a") && a.includes("o-two"), "the fixture must actually produce content");
  });

  test("two services over the same content agree", async () => {
    const first = serviceFor(VAULT);
    const second = serviceFor(VAULT);

    assert.equal(
      renderReport(await readOk(first.service, range("2026-01-01", "2026-12-31"))),
      renderReport(await readOk(second.service, range("2026-01-01", "2026-12-31"))),
    );
  });

  test("insertion order of the files does not change the bytes", async () => {
    const forwards = serviceFor(VAULT);
    const backwards = serviceFor(
      Object.fromEntries(Object.entries(VAULT).reverse()) as Record<string, string>,
    );

    assert.equal(
      renderReport(await readOk(forwards.service, range("2026-01-01", "2026-12-31"))),
      renderReport(await readOk(backwards.service, range("2026-01-01", "2026-12-31"))),
    );
  });

  test("a narrowed reading is deterministic too", async () => {
    const { service } = serviceFor(VAULT);
    const a = renderReport(await readOk(service, range("2026-01-01", "2026-12-31", "zebra")));
    const b = renderReport(await readOk(service, range("2026-01-01", "2026-12-31", "zebra")));
    assert.equal(a, b);
  });

  test("rendering the same value twice is a pure function", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.equal(renderReport(r), renderReport(r));
  });
});
