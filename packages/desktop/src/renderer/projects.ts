/**
 * The projects view.
 *
 * Rendering and input only. Everything this file appears to "know" arrives from
 * the core: which projects are active, how many milestones are done, which
 * fields are missing, and when marking a project done needs confirming. If a
 * rule ever looks like it belongs here, it belongs in `ProjectService`
 * (Principle II).
 *
 * See specs/003-project-structure/contracts/ipc-projects.md
 */

/**
 * Types are declared locally rather than imported from the preload, and every
 * top-level name here is unique across capture.ts and sort.ts — the three
 * renderer files are scripts, not modules, so they share one global scope.
 *
 * Importing across that boundary pulls preload.ts into the *renderer*
 * TypeScript program, which compiles it as ESM and overwrites the CommonJS
 * build Electron needs for a preload script — the app then starts with no
 * `window.waypoint` at all, and every hotkey silently stops working.
 * sort.ts and capture.ts avoid it the same way, and
 * `preload-is-commonjs.test.ts` fails if anyone reintroduces it.
 */
type ProjectStatus = "active" | "parked" | "waiting" | "done";
type AreaStatus = "active" | "parked";
type StructureGap = "outcome" | "milestones" | "next-action";
type ProjectFieldName = "outcome" | "next-action" | "dri" | "title";

interface MilestoneRef {
  index: number;
  raw: string;
}

interface MilestoneView {
  index: number;
  definitionOfDone: string;
  verifier: string | null;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

interface UnprocessedView {
  text: string;
  capturedAt: string | null;
  index: number;
  raw: string;
}

interface ProjectView {
  slug: string;
  title: string;
  status: ProjectStatus;
  outcome: string | null;
  nextAction: string | null;
  dri: string | null;
  milestones: MilestoneView[];
  completedOn: string | null;
  unprocessed: UnprocessedView[];
  /** Derived by the core and sent with the project, so status cannot affect it. */
  gaps: StructureGap[];
  /** Reported by the core; the view renders these rather than counting (FR-017). */
  milestonesDone: number;
  milestonesTotal: number;
}

interface ProjectSummaryView {
  slug: string;
  title: string;
  status: ProjectStatus;
  milestonesDone: number;
  milestonesTotal: number;
  gaps: StructureGap[];
  completedOn: string | null;
}

interface AreaView {
  slug: string;
  title: string;
  status: AreaStatus;
  rawStatus: string;
  unprocessed: UnprocessedView[];
}

type ProjectResponse =
  | { ok: true; project: ProjectView }
  | { ok: false; reason: string; message: string; open?: string[] };

type AreaResponse = { ok: true; area: AreaView } | { ok: false; reason: string; message: string };

interface ProjectsApi {
  listActive(): Promise<ProjectSummaryView[]>;
  listCompleted(): Promise<ProjectSummaryView[]>;
  list(): Promise<ProjectSummaryView[]>;
  get(slug: string): Promise<ProjectView | null>;
  create(title: string): Promise<ProjectResponse>;
  setField(
    slug: string,
    field: ProjectFieldName,
    expected: string | null,
    next: string | null,
  ): Promise<ProjectResponse>;
  setStatus(slug: string, expected: ProjectStatus, next: ProjectStatus): Promise<ProjectResponse>;
  addMilestone(slug: string, definitionOfDone: string, verifier: string | null): Promise<ProjectResponse>;
  editMilestone(
    slug: string,
    ref: MilestoneRef,
    definitionOfDone: string,
    verifier: string | null,
  ): Promise<ProjectResponse>;
  removeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse>;
  completeMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse>;
  reopenMilestone(slug: string, ref: MilestoneRef): Promise<ProjectResponse>;
  complete(slug: string, opts?: { confirmOpenMilestones?: boolean }): Promise<ProjectResponse>;
  reopen(slug: string, to: Exclude<ProjectStatus, "done">): Promise<ProjectResponse>;
  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<ProjectResponse>;
  dismiss(): void;
  onRefresh(callback: () => void): void;
  onVaultChanged(callback: () => void): void;
}

interface AreasApi {
  list(): Promise<{ slug: string; title: string; status: AreaStatus; rawStatus: string }[]>;
  get(slug: string): Promise<AreaView | null>;
  create(title: string): Promise<AreaResponse>;
  setTitle(slug: string, expected: string, next: string): Promise<AreaResponse>;
  setStatus(slug: string, expected: AreaStatus, next: AreaStatus): Promise<AreaResponse>;
  dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<AreaResponse>;
}

const wp = (window as unknown as { waypoint: { projects: ProjectsApi; areas: AreasApi } }).waypoint;

type Chosen = { kind: "project"; slug: string } | { kind: "area"; slug: string } | null;

let selection: Chosen = null;
/** The project as last read. Every write is verified against these values. */
let current: ProjectView | null = null;
let currentArea: AreaView | null = null;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const GAP_LABELS: Record<StructureGap, string> = {
  outcome: "outcome",
  milestones: "milestones",
  "next-action": "next action",
};

// ---------------------------------------------------------------------- list

/** Paints the sidebar from lists the core already decided the membership of. */
function paintList(
  projects: ProjectSummaryView[],
  areas: { slug: string; title: string }[],
  done: ProjectSummaryView[],
): void {
  const projectList = $("project-list");
  projectList.replaceChildren(
    ...projects.map((p) => projectRow(p)),
    ...(projects.length === 0 ? [note("No active projects.")] : []),
  );

  const areaList = $("area-list");
  areaList.replaceChildren(
    ...areas.map((a) => areaRow(a.slug, a.title)),
    ...(areas.length === 0 ? [note("No areas.")] : []),
  );

  // Finished projects stay reachable, which is what makes reopening possible
  // at all — and what lets the user look at what they actually got done
  // (FR-029, SC-012).
  const doneList = $("done-list");
  doneList.replaceChildren(
    ...done.map((p) => projectRow(p)),
    ...(done.length === 0 ? [note("Nothing finished yet.")] : []),
  );
}

function note(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "row meta";
  p.textContent = text;
  return p;
}

function projectRow(p: ProjectSummaryView): HTMLElement {
  const row = document.createElement("button");
  row.className = "row";
  row.type = "button";
  row.dataset["project"] = p.slug;
  row.setAttribute(
    "aria-current",
    String(selection?.kind === "project" && selection.slug === p.slug),
  );

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = p.title;
  row.append(name);

  const meta = document.createElement("div");
  meta.className = "meta";
  // Progress and the completion date both come from the core; this
  // concatenates, it does not count.
  const progress =
    p.milestonesTotal > 0 ? `${p.milestonesDone} of ${p.milestonesTotal} done` : "";
  meta.textContent = [p.completedOn ? `completed ${p.completedOn}` : p.status, progress]
    .filter(Boolean)
    .join(" · ");
  row.append(meta);

  if (p.gaps.length > 0) {
    const flag = document.createElement("div");
    flag.className = "needs-structure";
    flag.dataset["flag"] = "true";
    flag.textContent = "needs structure";
    row.append(flag);
  }

  row.addEventListener("click", () => void select({ kind: "project", slug: p.slug }));
  return row;
}

function areaRow(slug: string, title: string): HTMLElement {
  const row = document.createElement("button");
  row.className = "row";
  row.type = "button";
  row.dataset["area"] = slug;
  row.setAttribute("aria-current", String(selection?.kind === "area" && selection.slug === slug));

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = title;
  row.append(name);

  row.addEventListener("click", () => void select({ kind: "area", slug }));
  return row;
}

// -------------------------------------------------------------------- detail

async function select(next: Chosen): Promise<void> {
  selection = next;
  await refreshAll();
}

/** Paints whichever of the two detail panes the selection calls for. */
function paintDetail(project: ProjectView | null, area: AreaView | null): void {
  $("empty").hidden = selection !== null;
  $("project-detail").hidden = selection?.kind !== "project";
  $("area-detail").hidden = selection?.kind !== "area";

  if (selection?.kind === "project") {
    if (!project) {
      // Deleted underneath us; fall back to the empty state rather than
      // rendering a project that is no longer there.
      selection = null;
      $("project-detail").hidden = true;
      $("empty").hidden = false;
      return;
    }
    paintProject(project);
  }

  if (selection?.kind === "area") {
    if (!area) {
      selection = null;
      $("area-detail").hidden = true;
      $("empty").hidden = false;
      return;
    }
    paintArea(area);
  }
}

function paintProject(project: ProjectView): void {
  current = project;

  $("project-title").textContent = project.title;
  const titleInput = $("title-input") as HTMLInputElement;
  if (titleInput.value === (titleInput.dataset["painted"] ?? "")) titleInput.value = project.title;
  titleInput.dataset["painted"] = project.title;
  ($("status-select") as HTMLSelectElement).value = project.status;
  $("completed-on").textContent = project.completedOn ? `completed ${project.completedOn}` : "";

  // The gaps are named rather than merely counted, so the user knows what to
  // supply without opening a checklist (FR-022). They come from the project
  // itself — sourcing them from the *active* list would report a done project
  // as fully structured, and status must have no effect on the flag (FR-021).
  $("gaps-line").textContent =
    project.gaps.length > 0
      ? `Needs structure: ${project.gaps.map((g) => GAP_LABELS[g]).join(", ")}`
      : "";

  setField("project-outcome", "outcome-input", project.outcome);
  setField("project-next-action", "next-action-input", project.nextAction);
  setField("project-dri", "dri-input", project.dri);

  renderMilestones(project);
  renderUnprocessed(project);

  $("project-error").textContent = "";
  $("milestone-error").textContent = "";
  $("confirm").hidden = true;
}

/**
 * An unset field is shown as unset, never hidden (FR-026).
 *
 * The input half is only overwritten when the user has *not* touched it. A
 * refresh can land at any moment — every write raises `vault:changed`, and the
 * user is usually already typing into the next field by then — so blindly
 * assigning `value` here would delete half-typed text a keystroke before they
 * saved it.
 *
 * "Untouched" means the value still equals what was last painted into it,
 * which is tracked on the element itself rather than in a parallel map that
 * could fall out of step with the DOM.
 */
function setField(displayId: string, inputId: string, value: string | null): void {
  const display = $(displayId);
  display.textContent = value ?? "not yet set";
  display.classList.toggle("unset", value === null);

  const input = $(inputId) as HTMLInputElement | HTMLTextAreaElement;
  const next = value ?? "";
  const untouched = input.value === (input.dataset["painted"] ?? "");

  if (untouched) input.value = next;
  input.dataset["painted"] = next;
}

function renderMilestones(project: ProjectView): void {
  // Both numbers come from the core; this renders them (FR-017).
  $("milestone-progress").textContent =
    project.milestonesTotal > 0
      ? `${project.milestonesDone} of ${project.milestonesTotal} done`
      : "";

  $("milestone-list").replaceChildren(
    ...project.milestones.map((m) => {
      const row = document.createElement("div");
      row.className = m.done ? "milestone done" : "milestone";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = m.done;
      box.setAttribute("aria-label", m.definitionOfDone);
      const ref: MilestoneRef = { index: m.index, raw: m.raw };
      box.addEventListener("change", () => {
        void run(
          box.checked
            ? wp.projects.completeMilestone(project.slug, ref)
            : wp.projects.reopenMilestone(project.slug, ref),
          "milestone-error",
        );
      });

      const text = document.createElement("span");
      text.className = "dod";
      text.textContent = m.definitionOfDone;

      const meta = document.createElement("span");
      meta.className = "when";
      // A completed milestone stays visible, with its date, beside the ones
      // that remain (FR-035).
      meta.textContent = [m.verifier ? `@${m.verifier}` : "", m.completedOn ? `done ${m.completedOn}` : ""]
        .filter(Boolean)
        .join(" · ");

      const edit = document.createElement("button");
      edit.textContent = "Edit";
      edit.className = "edit";
      // Editing swaps the row for inputs in place, so the milestone keeps its
      // position while it is being reworded (FR-015, FR-016).
      edit.addEventListener("click", () => {
        row.replaceChildren(...editorFor(project.slug, m, ref, row));
      });

      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.className = "remove";
      remove.addEventListener("click", () => {
        void run(wp.projects.removeMilestone(project.slug, ref), "milestone-error");
      });

      row.append(box, text, meta, edit, remove);
      return row;
    }),
  );
}

/**
 * The in-place editor for one milestone.
 *
 * Sends the `MilestoneRef` the row was rendered from, so a milestone reworded
 * in a text editor since then is refused rather than overwritten (FR-045d).
 * A completed milestone keeps its date through an edit — that rule lives in the
 * core, and nothing here needs to know it (FR-037).
 */
function editorFor(
  slug: string,
  milestone: MilestoneView,
  ref: MilestoneRef,
  row: HTMLElement,
): HTMLElement[] {
  const dod = document.createElement("input");
  dod.className = "edit-dod";
  dod.value = milestone.definitionOfDone;
  dod.setAttribute("aria-label", "Definition of done");

  const verifier = document.createElement("input");
  verifier.className = "edit-verifier";
  verifier.value = milestone.verifier ?? "";
  verifier.placeholder = "Verifier";
  verifier.setAttribute("aria-label", "Verifier");

  const save = document.createElement("button");
  save.className = "edit-save";
  save.textContent = "Save";
  save.addEventListener("click", () => {
    const name = verifier.value.trim();
    void run(
      wp.projects.editMilestone(slug, ref, dod.value, name === "" ? null : name),
      "milestone-error",
    );
  });

  const cancel = document.createElement("button");
  cancel.className = "edit-cancel";
  cancel.textContent = "Cancel";
  // Cancelling changes nothing at all, so a plain redraw is the whole of it.
  cancel.addEventListener("click", () => void refreshAll());

  dod.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save.click();
    if (event.key === "Escape") cancel.click();
  });

  void row;
  return [dod, verifier, save, cancel];
}

function renderUnprocessed(project: ProjectView): void {
  const has = project.unprocessed.length > 0;
  $("unprocessed-heading").hidden = !has;

  $("unprocessed-list").replaceChildren(
    ...project.unprocessed.map((item) => {
      const row = document.createElement("div");
      row.className = "unprocessed-item";

      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;

      const when = document.createElement("span");
      when.className = "when";
      // A hand-written item has no timestamp and is not given one.
      when.textContent = item.capturedAt ? item.capturedAt.slice(0, 10) : "";

      const dismiss = document.createElement("button");
      dismiss.className = "dismiss";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => {
        void run(
          wp.projects.dismissUnprocessed(project.slug, item.index, item.raw),
          "project-error",
        );
      });

      row.append(text, when, dismiss);
      return row;
    }),
  );
}

function paintArea(area: AreaView): void {
  currentArea = area;

  $("area-title").textContent = area.title;
  ($("area-status-select") as HTMLSelectElement).value = area.status;
  // A hand-edited status outside the range is shown as recorded rather than
  // silently rewritten (FR-041c).
  $("area-raw-status").textContent =
    area.rawStatus !== area.status ? `file says: ${area.rawStatus}` : "";

  const has = area.unprocessed.length > 0;
  $("area-unprocessed-heading").hidden = !has;
  $("area-unprocessed-list").replaceChildren(
    ...area.unprocessed.map((item) => {
      const row = document.createElement("div");
      row.className = "unprocessed-item";

      const text = document.createElement("span");
      text.className = "text";
      text.textContent = item.text;

      const dismiss = document.createElement("button");
      dismiss.className = "dismiss";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => {
        void runArea(wp.areas.dismissUnprocessed(area.slug, item.index, item.raw));
      });

      row.append(text, dismiss);
      return row;
    }),
  );

  $("area-error").textContent = "";
}

// --------------------------------------------------------------------- verbs

/**
 * Sends one call and renders whatever comes back.
 *
 * A refusal is a message to display, not an exception — the same shape sort
 * established. This function is the only place a refusal is handled, so no
 * caller can quietly ignore one.
 */
async function run(call: Promise<ProjectResponse>, errorId: string): Promise<boolean> {
  const outcome = await call;

  // Refresh *before* showing the message, never after: redrawing the project
  // clears the error slots, so setting the text first would wipe every refusal
  // the instant it was written — the milestone cap, the stale-write warning,
  // the empty-title refusal, all invisible.
  await refreshAll();

  if (!outcome.ok) {
    $(errorId).textContent = outcome.message;
    return false;
  }
  return true;
}

async function runArea(call: Promise<{ ok: boolean; message?: string }>): Promise<void> {
  const outcome = await call;
  await refreshAll();
  if (!outcome.ok) $("area-error").textContent = outcome.message ?? "";
}

/**
 * Redraw everything from disk.
 *
 * Guarded by a generation counter because two refreshes race on every write:
 * one from the verb that just returned, one from the `vault:changed` signal the
 * same write raised. Both read asynchronously, so without this the older one
 * can resolve last and paint stale rows — a flag that will not clear, or
 * progress that lags a click behind.
 */
let generation = 0;

async function refreshAll(): Promise<void> {
  const mine = ++generation;
  const [projects, areas, done, project, area] = await Promise.all([
    wp.projects.listActive(),
    wp.areas.list(),
    wp.projects.listCompleted(),
    selection?.kind === "project" ? wp.projects.get(selection.slug) : Promise.resolve(null),
    selection?.kind === "area" ? wp.areas.get(selection.slug) : Promise.resolve(null),
  ]);

  // A newer refresh started while this one was reading; its paint wins.
  if (mine !== generation) return;

  paintList(projects, areas, done);
  paintDetail(project, area);
}

function saveField(field: ProjectFieldName, inputId: string, expected: () => string | null): void {
  const value = ($(inputId) as HTMLInputElement | HTMLTextAreaElement).value;
  if (!current) return;
  void run(
    wp.projects.setField(current.slug, field, expected(), value.trim() === "" ? null : value),
    "project-error",
  );
}

// A title is one of the two fields always present, so unlike the others it
// cannot be cleared — the core refuses an empty one and this renders that
// refusal rather than pre-empting it (FR-003, FR-027).
$("title-save").addEventListener("click", () => {
  if (!current) return;
  const next = ($("title-input") as HTMLInputElement).value;
  void run(wp.projects.setField(current.slug, "title", current.title, next), "project-error");
});

$("outcome-save").addEventListener("click", () =>
  saveField("outcome", "outcome-input", () => current?.outcome ?? null),
);
$("next-action-save").addEventListener("click", () =>
  saveField("next-action", "next-action-input", () => current?.nextAction ?? null),
);
$("dri-save").addEventListener("click", () =>
  saveField("dri", "dri-input", () => current?.dri ?? null),
);

$("milestone-add").addEventListener("click", () => {
  if (!current) return;
  const dod = ($("milestone-input") as HTMLInputElement).value;
  const verifier = ($("verifier-input") as HTMLInputElement).value.trim();
  void run(
    wp.projects.addMilestone(current.slug, dod, verifier === "" ? null : verifier),
    "milestone-error",
  ).then((ok) => {
    if (ok) {
      ($("milestone-input") as HTMLInputElement).value = "";
      ($("verifier-input") as HTMLInputElement).value = "";
    }
  });
});

/**
 * Status, including completion.
 *
 * The renderer does not decide whether completing needs confirming — it calls
 * `complete()`, and if the core refuses with `open-milestones` it renders the
 * names the refusal carried and offers to call again (FR-034a).
 */
$("status-select").addEventListener("change", async () => {
  if (!current) return;
  const next = ($("status-select") as HTMLSelectElement).value as ProjectStatus;
  const project = current;

  if (next === "done") {
    const outcome = await wp.projects.complete(project.slug);
    if (!outcome.ok && outcome.reason === "open-milestones") {
      $("confirm-list").replaceChildren(
        ...(outcome.open ?? []).map((name) => {
          const li = document.createElement("li");
          li.textContent = name;
          return li;
        }),
      );
      $("confirm").hidden = false;
      return;
    }
    if (!outcome.ok) $("project-error").textContent = outcome.message;
    await refreshAll();
    return;
  }

  if (project.status === "done") {
    await run(wp.projects.reopen(project.slug, next as Exclude<ProjectStatus, "done">), "project-error");
    return;
  }

  await run(wp.projects.setStatus(project.slug, project.status, next), "project-error");
});

$("confirm-yes").addEventListener("click", () => {
  if (!current) return;
  $("confirm").hidden = true;
  void run(wp.projects.complete(current.slug, { confirmOpenMilestones: true }), "project-error");
});

$("confirm-no").addEventListener("click", () => {
  $("confirm").hidden = true;
  // Declining changes nothing at all, including the control the user touched.
  void refreshAll();
});

$("area-status-select").addEventListener("change", () => {
  if (!currentArea) return;
  const next = ($("area-status-select") as HTMLSelectElement).value as AreaStatus;
  void runArea(wp.areas.setStatus(currentArea.slug, currentArea.status, next));
});

// ------------------------------------------------------------------- signals

// The window was shown: redraw everything, since a hand-edit made while it was
// hidden is invisible to any in-process signal.
wp.projects.onRefresh(() => void refreshAll());

// Something wrote a vault file mid-session. Re-read, but do not disturb what
// the user is currently typing — only the display halves are replaced.
wp.projects.onVaultChanged(() => void refreshAll());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") wp.projects.dismiss();
});

void refreshAll();
