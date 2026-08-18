import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

import { launch, type Harness } from "./harness";

/**
 * Quickstart scenario 3: see exactly what would be sent, before it is sent.
 *
 * Written before the preview panel existed, so its Red was "the request was
 * sendable without its content being shown" — the failure that matters, and
 * one a test asserting only on the panel's *contents* would never catch.
 *
 * The markers are planted in every file this feature must never read, in the
 * real vault, on disk, and read through the real config. Nothing here is a
 * double.
 */

const FAKE_CLI = resolve(__dirname, "../../dist/tests/fixtures/fake-llm-cli.sh");

const M = {
  identity: "MARKER-IDENTITY-4c2d",
  policy: "MARKER-POLICY-55aa",
  trash: "MARKER-TRASH-91ab",
  calendar: "MARKER-CALENDAR-7d13",
  topThree: "MARKER-TOPTHREE-e7f1",
  log: "MARKER-LOG-3f80",
  waiting: "MARKER-WAITING-6b22",
  sibling: "MARKER-SIBLING-ITEM-aa01",
  milestone: "MARKER-MILESTONE-dd04",
  nextAction: "MARKER-NEXT-ACTION-ee05",
  dri: "MARKER-DRI-ff06",
  ledger: "MARKER-LEDGER-1107",
  unprocessed: "MARKER-UNPROCESSED-2208",
};

const ITEM = "- 2026-08-17T09:14:22-04:00 chase the vendor contract. also the roof estimate.\n";
const SIBLING = `- 2026-08-17T09:15:00-04:00 ${M.sibling}\n`;

async function open(): Promise<Harness> {
  const h = await launch({
    seedVault: {
      "intelligence.md": ["transport: command", `command: ${FAKE_CLI}`, ""].join("\n"),
      "identity.md": `me: ${M.identity}\n`,
      "policy.md": `wip limit: 3\n# ${M.policy}\n`,
      "trash.md": `- 2020-01-01 — ${M.trash}\n`,
      "calendar.md": `- 2026-09-01 — ${M.calendar}\n`,
      "top-three.md": `# ${M.topThree}\n`,
      "waiting.md": `- 2026-08-01 @${M.waiting} — ${M.waiting}\n`,
      "log/2026-W33.md": `# ${M.log}\n`,
      "projects/vendor-consolidation.md": [
        "# Vendor Consolidation",
        "",
        "status: active",
        `dri: ${M.dri}`,
        `next action: ${M.nextAction}`,
        "",
        "## Outcome",
        "",
        "Every vendor contract renewed or ended by Q4.",
        "",
        "## Milestones",
        "",
        `- [ ] ${M.milestone}`,
        "",
        "## Unprocessed",
        "",
        `- ${M.unprocessed}`,
        "",
        "## Ledger",
        "",
        `- 2026-01-02 ${M.ledger}`,
        "",
      ].join("\n"),
    },
    env: { FAKE_LLM_OUTPUT: JSON.stringify({ pieces: [[0], [1]], nothingToSplit: false }) },
  });
  h.writeInbox(ITEM + SIBLING);
  await h.openSort();
  return h;
}

test("nothing can be sent without its content being shown first", async () => {
  const h = await open();
  try {
    const view = await h.sortView();

    // There is no control that sends. Asking prepares; the send is a second,
    // separate act taken with the content on screen (FR-041).
    await expect(view.locator("#send")).toHaveCount(0);

    await view.click("#to-split");
    await expect(view.locator("#preview")).toBeVisible();
    await expect(view.locator("#send")).toBeVisible();
  } finally {
    await h.close();
  }
});

test("the split preview carries the item and no marker from anywhere else", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    await view.click("#to-split");

    const preview = await view.locator("#preview").innerText();
    expect(preview).toContain("chase the vendor contract");

    for (const [name, marker] of Object.entries(M)) {
      expect(preview, `${name} is visible in the split preview`).not.toContain(marker);
    }
  } finally {
    await h.close();
  }
});

test("the destination preview carries titles and outcomes, and no marker", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    await view.click("#to-where");

    const preview = await view.locator("#preview").innerText();
    expect(preview).toContain("Vendor Consolidation");
    expect(preview).toContain("Every vendor contract renewed");

    for (const [name, marker] of Object.entries(M)) {
      expect(preview, `${name} is visible in the destination preview`).not.toContain(marker);
    }
  } finally {
    await h.close();
  }
});

test("the preview shows the whole payload, not a summary of it", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    await view.click("#to-split");

    const preview = await view.locator("#preview").innerText();
    // A truncated or elided preview would be consent to send something the
    // user did not read. The numbered segments the model answers about are
    // part of what is sent, so they are part of what is shown.
    expect(preview).toContain("[0]");
    expect(preview).toContain("[1]");
    expect(preview).not.toContain("…");
    expect(preview).not.toMatch(/\.\.\.$/);
  } finally {
    await h.close();
  }
});

test("backing out of the preview sends nothing and leaves the item alone", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    const before = h.inbox();

    await view.click("#to-split");
    await view.click("#cancel-send");

    await expect(view.locator("#preview")).toHaveCount(0);
    await expect(view.locator("#to-split")).toBeVisible();
    expect(h.inbox()).toBe(before);
  } finally {
    await h.close();
  }
});

test("the preview is replaced by the answer, so the two are never confused", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await view.click("#send");

    await view.waitForSelector(".piece");
    await expect(view.locator("#preview")).toHaveCount(0);
  } finally {
    await h.close();
  }
});

test("moving to the next item drops the preview with it", async () => {
  const h = await open();
  try {
    const view = await h.sortView();
    await view.click("#to-split");
    await expect(view.locator("#preview")).toBeVisible();

    // A prepared request belongs to the item it was made about (FR-046).
    await view.click("#to-trash");
    await expect(view.locator("#preview")).toHaveCount(0);
    await expect(view.locator("#to-split")).toBeVisible();
  } finally {
    await h.close();
  }
});
