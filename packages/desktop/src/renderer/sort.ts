/**
 * The sort view.
 *
 * Input handling and rendering only. This file has no idea what a project
 * *is*, where anything is stored, or what makes a decision valid — it renders
 * what the core returns and sends back which choice the user made
 * (Principle II).
 *
 * See specs/002-inbox-view-sort/contracts/ipc-sort.md
 */

/**
 * Types are declared locally rather than imported from the preload.
 *
 * Importing across that boundary pulls preload.ts into the *renderer*
 * TypeScript program, which compiles it as ESM and overwrites the CommonJS
 * build Electron needs for a preload script — the app then starts with no
 * `window.waypoint` at all. capture.ts avoids it the same way.
 */
interface ItemRef {
  start: number;
  end: number;
  raw: string;
}

type SortDecision =
  | { to: "project"; slug: string }
  | { to: "project"; createTitle: string }
  | { to: "area"; slug: string }
  | { to: "area"; createTitle: string }
  | { to: "waiting"; owner: string }
  | { to: "calendar" }
  | { to: "trash" };

interface SortApi {
  next(): Promise<
    { item: { text: string; capturedAt: string | null; ref: ItemRef } } | { item: null }
  >;
  destinations(): Promise<{
    projects: { slug: string; title: string }[];
    areas: { slug: string; title: string }[];
  }>;
  count(): Promise<number>;
  decide(
    ref: ItemRef,
    decision: SortDecision,
  ): Promise<{ ok: true; destination: string } | { ok: false; reason: string; message: string }>;
  dismiss(): void;
  onRefresh(callback: () => void): void;
  onRecovered(callback: (report: { completed: number; abandoned: number }) => void): void;
  onNotice(callback: (notice: { level: "info" | "error"; message: string }) => void): void;
}

const api = (window as unknown as { waypoint: { sort: SortApi } }).waypoint.sort;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sorting = el("sorting");
const emptyState = el("empty");
const remaining = el("remaining");
const capturedAt = el("captured-at");
const textEl = el("text");
const choices = el("choices");
const panel = el("panel");
const notice = el("notice");

let currentRef: ItemRef | null = null;
/** Guards against a second decision while one is in flight (FR-019). */
let deciding = false;

function say(message: string, level: "info" | "error" = "info"): void {
  notice.textContent = message;
  notice.className = level === "error" ? "error" : "";
}

function clearNotice(): void {
  notice.textContent = "";
  notice.className = "";
}

function setBusy(busy: boolean): void {
  deciding = busy;
  choices.querySelectorAll("button").forEach((button) => {
    (button as HTMLButtonElement).disabled = busy;
  });
}

/** Renders the next item, or the empty state when nothing is left. */
async function showNext(): Promise<void> {
  panel.replaceChildren();
  const response = await api.next();

  if (response.item === null) {
    currentRef = null;
    sorting.hidden = true;
    emptyState.hidden = false;
    remaining.textContent = "";
    return;
  }

  const { text, capturedAt: at, ref } = response.item;
  currentRef = ref;

  // A hand-written item has no capture time and never gets a fabricated one
  // (FR-027a) — the line is simply left empty.
  capturedAt.textContent = at ? new Date(at).toLocaleString() : "";
  textEl.textContent = text;

  sorting.hidden = false;
  emptyState.hidden = true;
  setBusy(false);

  const count = await api.count();
  remaining.textContent = count === 1 ? "1 item left" : `${count} items left`;
}

/**
 * Sends a decision and moves on.
 *
 * Deliberately awaits the result before requesting the next item — the
 * opposite of capture's submit. Showing item N+1 while N's write is still in
 * flight is exactly the state the journal exists to avoid (FR-019).
 */
async function decide(decision: SortDecision): Promise<void> {
  if (!currentRef || deciding) return;
  setBusy(true);
  clearNotice();

  const outcome = await api.decide(currentRef, decision);

  if (outcome.ok) {
    await showNext();
    return;
  }

  // Every refusal leaves the item in the inbox, so the user can retry or
  // choose differently. None of these are modal.
  switch (outcome.reason) {
    case "item-changed":
      say(outcome.message, "error");
      await showNext();
      return;
    case "destination-missing":
      say(outcome.message, "error");
      setBusy(false);
      await openDestinationPicker(decision.to === "area" ? "area" : "project");
      return;
    default:
      say(outcome.message, "error");
      setBusy(false);
      return;
  }
}

async function openDestinationPicker(kind: "project" | "area"): Promise<void> {
  const all = await api.destinations();
  const options = kind === "project" ? all.projects : all.areas;

  panel.replaceChildren();

  const list = document.createElement("div");
  list.className = "list";

  // Rendered in the order the core returned, with nothing pre-selected,
  // highlighted, or reordered by likelihood (FR-030).
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.title;
    button.dataset["slug"] = option.slug;
    button.addEventListener("click", () => {
      void decide({ to: kind, slug: option.slug } as SortDecision);
    });
    list.append(button);
  }

  if (options.length === 0) {
    const none = document.createElement("p");
    none.textContent = `No ${kind}s yet — create one below.`;
    panel.append(none);
  }

  panel.append(list, createRow(kind));
}

/** The create-on-the-spot affordance: one title field and nothing else (FR-009). */
function createRow(kind: "project" | "area"): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = `New ${kind} title`;
  input.id = "create-title";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Create and file here";
  submit.id = "create-submit";

  const send = (): void => {
    void decide({ to: kind, createTitle: input.value } as SortDecision);
  };

  submit.addEventListener("click", send);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send();
  });

  row.append(input, submit);
  return row;
}

function openWaitingPanel(): void {
  panel.replaceChildren();

  const row = document.createElement("div");
  row.className = "row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Who is it waiting on?";
  input.id = "waiting-owner";

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Save";
  submit.id = "waiting-submit";

  const send = (): void => {
    void decide({ to: "waiting", owner: input.value });
  };

  submit.addEventListener("click", send);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send();
  });

  row.append(input, submit);
  panel.append(row);
  input.focus();
}

el("to-project").addEventListener("click", () => void openDestinationPicker("project"));
el("to-area").addEventListener("click", () => void openDestinationPicker("area"));
el("to-waiting").addEventListener("click", openWaitingPanel);
el("to-calendar").addEventListener("click", () => void decide({ to: "calendar" }));
el("to-trash").addEventListener("click", () => void decide({ to: "trash" }));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") api.dismiss();
});

api.onRefresh(() => void showNext());

api.onRecovered((report) => {
  if (report.abandoned > 0) {
    say(
      `Finished ${report.completed} interrupted decision(s). ${report.abandoned} could not be ` +
        "matched to the inbox — an item may appear both here and in its destination.",
      "error",
    );
  } else if (report.completed > 0) {
    say(`Finished ${report.completed} interrupted decision(s) from last time.`);
  }
});

api.onNotice((n) => say(n.message, n.level));

void showNext();
