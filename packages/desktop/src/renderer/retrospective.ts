/**
 * The retrospective view.
 *
 * Chrome only. Two date controls, a project filter, a change notice, and two
 * delivery buttons — around a string the core rendered. This file does not
 * format a single entry, does not decide what is in range, does not order
 * anything, and does not compose one sentence of the report. If any of that
 * ever looks like it belongs here, it belongs in `RetrospectiveService` or
 * `renderReport` (Principle II).
 *
 * Two behaviours are worth naming because they differ from every other window:
 *
 *   - **It holds its reading.** A vault change raises a *notice*, not a
 *     refresh. Entries moving under the user mid-read would break both the copy
 *     in their clipboard and the promise that an export is what they were
 *     looking at (FR-010a, FR-010b).
 *
 *   - **It reads nothing until asked.** No range is chosen on open, and the
 *     system never runs a retrospective the user did not ask for (FR-057).
 *
 * See specs/006-retrospective-view/contracts/retrospective-api.md
 */

/**
 * Types are declared locally and every top-level name is prefixed `rx` — the
 * renderer files are scripts, not modules, so they share one global scope.
 * Importing from the preload would pull it into the renderer TypeScript program
 * and compile it as ESM, leaving Electron with no `window.waypoint` at all; see
 * the same note in `projects.ts` and `top-three.ts`.
 */
interface RxQuery {
  range: { from: string; to: string };
  project: string | null;
}

type RxResult =
  | { ok: true; retrospective: unknown }
  | { ok: false; reason: string; message: string };

interface RxProjectRow {
  slug: string;
  title: string;
}

interface RxRetrospectiveApi {
  read(query: RxQuery): Promise<RxResult>;
  render(retrospective: unknown): Promise<string>;
  copy(text: string): Promise<{ ok: true }>;
  save(text: string, suggestedName: string): Promise<{ saved: boolean; path?: string }>;
  dismiss(): void;
  onChanged(handler: () => void): void;
}

// Cast at the boundary, exactly as `projects.ts` does: the renderer files share
// one global scope, so `window` cannot be re-declared here.
const rxWp = (
  window as unknown as {
    waypoint: {
      retrospective: RxRetrospectiveApi;
      projects: { list(): Promise<RxProjectRow[]> };
    };
  }
).waypoint;

function rxEl<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element: ${id}`);
  return found as T;
}

const rxFrom = rxEl<HTMLInputElement>("from");
const rxTo = rxEl<HTMLInputElement>("to");
const rxProject = rxEl<HTMLSelectElement>("project");
const rxRun = rxEl<HTMLButtonElement>("run");
const rxReport = rxEl<HTMLPreElement>("report");
const rxEmpty = rxEl<HTMLParagraphElement>("empty");
const rxNotice = rxEl<HTMLDivElement>("notice");
const rxReread = rxEl<HTMLButtonElement>("reread");
const rxDismissNotice = rxEl<HTMLButtonElement>("dismiss-notice");
const rxCopy = rxEl<HTMLButtonElement>("copy");
const rxSave = rxEl<HTMLButtonElement>("save");
const rxStatus = rxEl<HTMLSpanElement>("status");

/**
 * The reading currently on screen, and the text it rendered to.
 *
 * `rxText` is what the export delivers, and it is the same string that is
 * displayed — not a re-render of `rxValue`. That is the whole of FR-045: there
 * is one string, and both the eye and the clipboard get it.
 */
let rxValue: unknown = null;
let rxText = "";
/** The query that produced what is on screen, so re-reading asks it again. */
let rxLastQuery: RxQuery | null = null;

async function rxLoadProjects(): Promise<void> {
  // The unfiltered list: a retrospective is largely about finished projects,
  // which the active list excludes.
  const projects = await rxWp.projects.list();
  for (const p of projects) {
    const option = document.createElement("option");
    option.value = p.slug;
    option.textContent = p.title;
    rxProject.append(option);
  }
}

function rxShowReport(text: string): void {
  rxText = text;
  rxReport.textContent = text;
  rxReport.hidden = false;
  rxEmpty.hidden = true;
  rxCopy.disabled = false;
  rxSave.disabled = false;
}

function rxShowMessage(message: string): void {
  rxEmpty.textContent = message;
  rxEmpty.hidden = false;
  rxReport.hidden = true;
  rxCopy.disabled = true;
  rxSave.disabled = true;
}

async function rxRead(query: RxQuery): Promise<void> {
  rxStatus.textContent = "Reading…";
  const result = await rxWp.retrospective.read(query);

  if (!result.ok) {
    // The core's own words. The renderer never rephrases a refusal.
    rxShowMessage(result.message);
    rxStatus.textContent = "";
    return;
  }

  rxValue = result.retrospective;
  rxLastQuery = query;
  rxShowReport(await rxWp.retrospective.render(rxValue));
  rxNotice.classList.remove("shown");
  rxStatus.textContent = "";
}

rxRun.addEventListener("click", () => {
  const from = rxFrom.value;
  const to = rxTo.value;
  if (from === "" || to === "") {
    rxShowMessage("Pick a start and end date, then choose Show.");
    return;
  }
  void rxRead({ range: { from, to }, project: rxProject.value === "" ? null : rxProject.value });
});

/**
 * A write landed somewhere in the vault.
 *
 * Deliberately does not re-read. It says so and offers; the reading on screen
 * stays exactly as it is, and remains a true account of what the files said
 * when it was taken (FR-010d).
 */
rxWp.retrospective.onChanged(() => {
  if (rxLastQuery === null) return;
  rxNotice.classList.add("shown");
});

rxReread.addEventListener("click", () => {
  if (rxLastQuery !== null) void rxRead(rxLastQuery);
});

rxDismissNotice.addEventListener("click", () => {
  rxNotice.classList.remove("shown");
});

rxCopy.addEventListener("click", () => {
  void rxWp.retrospective.copy(rxText).then(() => {
    rxStatus.textContent = "Copied.";
  });
});

rxSave.addEventListener("click", () => {
  const name = rxLastQuery
    ? `retrospective-${rxLastQuery.range.from}-to-${rxLastQuery.range.to}.md`
    : "retrospective.md";

  void rxWp.retrospective.save(rxText, name).then((result: { saved: boolean }) => {
    // Cancelling is not an error; it is the user changing their mind.
    rxStatus.textContent = result.saved ? "Saved." : "";
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") rxWp.retrospective.dismiss();
});

void rxLoadProjects();
