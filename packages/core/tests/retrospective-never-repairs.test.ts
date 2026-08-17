import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renderReport } from "../src/retrospective/report";
import { projectFile, range, readOk, serviceFor } from "./retro-fakes";

/**
 * Shown as it reads. Never reconciled, never repaired.
 *
 * The vault is hand-edited, so states the format permits but the application
 * would not have written are ordinary, not corrupt. A reader that "fixed" them
 * would be deciding the user's file is wrong — and would destroy the evidence
 * they need to fix it themselves (FR-019, FR-041).
 */

describe("a completion date that disagrees with the status", () => {
  const VAULT = {
    "projects/legacy.md": projectFile({
      slug: "legacy",
      title: "Legacy cleanup",
      // Hand-edited: dated as complete, but the status was never moved.
      status: "active",
      completed: "2026-06-30",
    }),
  };

  test("the date still places it in the range", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31"));

    assert.equal(r.completions.length, 1);
    assert.equal(r.completions[0]?.completedOn, "2026-06-30");
  });

  test("it is not excluded on the grounds that the status says otherwise", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-06-30", "2026-06-30"));
    assert.equal(r.completions.length, 1, "dropping it would be the reader overruling the file");
  });

  test("neither field is rewritten", async () => {
    const files = { ...VAULT };
    const before = files["projects/legacy.md"];
    const { service, vault } = serviceFor(files);

    await readOk(service, range("2026-01-01", "2026-12-31"));
    assert.equal(await vault.read("projects/legacy.md"), before);
  });
});

describe("a status that disagrees with the ledger (FR-041)", () => {
  const VAULT = {
    "projects/roof.md": projectFile({
      slug: "roof",
      title: "Roof repair",
      // The file says parked; the last thing recorded was entering active.
      status: "parked",
      ledger: [
        "- 2026-01-02 status created → active",
        "- 2026-03-01 status active → waiting — after 58d active",
        "- 2026-04-01 status waiting → active — after 31d waiting",
      ],
    }),
  };

  test("both are carried, and neither is corrected", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));

    assert.equal(r.history?.status, "parked", "the status field is what the project is");
    assert.equal(r.history?.entries.length, 3, "the ledger is the record of how it got there");
    assert.match(r.history?.entries[2]?.detail ?? "", /waiting → active/);
  });

  test("the report says so in as many words", async () => {
    const { service } = serviceFor(VAULT);
    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    const text = renderReport(r);

    assert.match(text, /status field says `parked`/);
    assert.match(text, /entered `active`/);
  });

  test("a project whose status and ledger agree says nothing about it", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        status: "active",
        ledger: ["- 2026-01-02 status created → active"],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    assert.doesNotMatch(renderReport(r), /status field says/);
  });
});

describe("a hand-written ledger entry (FR-042)", () => {
  test("reads exactly as an application-written one", async () => {
    const { service } = serviceFor({
      "projects/roof.md": projectFile({
        slug: "roof",
        status: "active",
        ledger: [
          "- 2026-01-02 status created → active",
          // Typed by hand: no duration tail, looser spacing in the detail.
          "- 2026-05-05 status active → waiting",
        ],
      }),
    });

    const r = await readOk(service, range("2026-01-01", "2026-12-31", "roof"));
    assert.equal(r.history?.entries.length, 2);
    assert.equal(r.history?.entries[1]?.afterDays, null, "no duration is invented for it");
    assert.equal(r.history?.entries[1]?.on, "2026-05-05");
  });
});
