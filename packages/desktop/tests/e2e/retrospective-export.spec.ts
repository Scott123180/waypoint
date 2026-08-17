import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { launch, type Harness } from "./harness";

/**
 * The export is the thing on screen.
 *
 * There is one rendering: the core produces a string, the window displays that
 * string, and the export writes that string. So the assertion here is an
 * identity rather than a comparison between two renderers — which is the whole
 * reason `retrospective:render` lives in main rather than in the renderer
 * (006 FR-045, SC-011, research R2).
 *
 * The save dialog is stubbed in main so its *options* can be asserted. Where it
 * defaults to is a requirement, not a detail: an export written into the vault
 * would make this feature a writer (FR-049).
 */

let h: Harness;

const PROJECT = `# Roof repair

status: done
completed: 2026-06-30

## Milestones

- [x] Estimate approved — done 2026-06-10
- [x] Undated one
`;

/** Replaces the native dialog and records what it was asked for. */
async function stubSaveDialog(app: Harness["app"], target: string | null): Promise<void> {
  await app.evaluate(
    ({ dialog }, chosen) => {
      const record = { defaultPath: "" };
      (globalThis as Record<string, unknown>)["__saveDialog"] = record;
      dialog.showSaveDialog = (async (options: { defaultPath?: string }) => {
        record.defaultPath = options.defaultPath ?? "";
        return chosen === null
          ? { canceled: true, filePath: undefined }
          : { canceled: false, filePath: chosen };
      }) as typeof dialog.showSaveDialog;
    },
    target,
  );
}

async function lastDefaultPath(app: Harness["app"]): Promise<string> {
  return app.evaluate(
    () => (globalThis as Record<string, { defaultPath: string }>)["__saveDialog"].defaultPath,
  );
}

async function show(view: Awaited<ReturnType<Harness["retrospectiveView"]>>): Promise<void> {
  await view.fill("#from", "2026-01-01");
  await view.fill("#to", "2026-12-31");
  await view.click("#run");
  await expect(view.locator("#report")).toBeVisible();
}

test.beforeEach(async () => {
  h = await launch();
  h.writeVaultFile("projects/roof.md", PROJECT);
});

test.afterEach(async () => {
  await h.close();
});

test("saving writes exactly what is on screen", async () => {
  const target = join(tmpdir(), `waypoint-export-${Date.now()}.md`);
  await stubSaveDialog(h.app, target);

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  const displayed = (await view.locator("#report").textContent()) ?? "";
  await view.click("#save");
  await expect(view.locator("#status")).toContainText("Saved");

  const written = readFileSync(target, "utf8");
  // The identity. Not "contains the same entries" — the same string.
  expect(written).toBe(displayed);
  expect(written).toContain("# Retrospective: 2026-01-01 to 2026-12-31");
  expect(written).toContain("(undated)");
});

test("the dialog never defaults inside the vault", async () => {
  await stubSaveDialog(h.app, join(tmpdir(), "somewhere.md"));

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);
  await view.click("#save");

  const defaultPath = await lastDefaultPath(h.app);
  const vaultRoot = dirname(h.inboxPath);

  expect(defaultPath).not.toBe("");
  expect(defaultPath.startsWith(vaultRoot)).toBe(false);
  expect(defaultPath).toContain("retrospective-2026-01-01-to-2026-12-31.md");
});

test("cancelling is not an error and writes nothing", async () => {
  await stubSaveDialog(h.app, null);

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  const before = h.vaultDir("projects");
  await view.click("#save");

  // No status, no error, no file. The user changed their mind.
  await expect(view.locator("#status")).toHaveText("");
  expect(h.vaultDir("projects")).toEqual(before);
});

test("copying puts the same string on the clipboard", async () => {
  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  const displayed = (await view.locator("#report").textContent()) ?? "";
  await view.click("#copy");
  await expect(view.locator("#status")).toContainText("Copied");

  const clipped = await h.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clipped).toBe(displayed);
});

test("an export taken after the data changed matches the held reading (SC-021)", async () => {
  const target = join(tmpdir(), `waypoint-stale-${Date.now()}.md`);
  await stubSaveDialog(h.app, target);

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await show(view);

  const displayed = (await view.locator("#report").textContent()) ?? "";

  // The vault moves on. The reading does not.
  h.writeVaultFile(
    "projects/roof.md",
    `${PROJECT}- [x] Something newer — done 2026-07-15\n`,
  );
  await view.waitForTimeout(150);

  await view.click("#save");
  await expect(view.locator("#status")).toContainText("Saved");

  const written = readFileSync(target, "utf8");
  expect(written).toBe(displayed);
  expect(written).not.toContain("Something newer");
});

test("an empty retrospective still exports a report rather than a blank file", async () => {
  const target = join(tmpdir(), `waypoint-empty-${Date.now()}.md`);
  await stubSaveDialog(h.app, target);

  await h.openRetrospective();
  const view = await h.retrospectiveView();
  await view.fill("#from", "2020-01-01");
  await view.fill("#to", "2020-03-31");
  await view.click("#run");
  await expect(view.locator("#report")).toBeVisible();

  await view.click("#save");
  await expect(view.locator("#status")).toContainText("Saved");

  const written = readFileSync(target, "utf8");
  expect(written).toContain("2020-01-01 to 2020-03-31");
  expect(written).toContain("Nothing was completed in this range.");
});
