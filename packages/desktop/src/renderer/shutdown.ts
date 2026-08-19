/**
 * The daily shutdown view.
 *
 * Rendering and input only. Everything this file appears to "know" arrives from
 * the core: which projects are the user's, which items have gone quiet, how many
 * days that has been, and what to say about it. If a rule ever looks like it
 * belongs here, it belongs in `ShutdownService` or in the policy module
 * (Principle II).
 *
 * Two behaviours are this window's own, and both are deliberate:
 *
 *   - **It re-reads on open and at no other time.** There is no vault-change
 *     subscription and no channel that could carry one. Membership is fixed when
 *     the screen opens (FR-010a, FR-011a); a row moving under someone halfway
 *     through a two-minute pass would move the thing they were about to click.
 *
 *   - **An acted-on row updates in place, from the verb's own return value.**
 *     Never from a re-read. `TopThreeOutcomeResult.week`, `ProjectOutcome`, and
 *     `WaitingOutcome.item` each carry what the file now says, which is exactly
 *     enough to redraw one row and nothing else (FR-010b, SC-012).
 */

/**
 * Types are declared locally and every top-level name is prefixed `sd` — the
 * renderer files are scripts, not modules, so they share one global scope, and
 * `projects.ts`, `top-three.ts` and the rest already own the short names.
 *
 * Importing from the preload would pull it into the *renderer* TypeScript
 * program, compile it as ESM, and overwrite the CommonJS build Electron needs —
 * the app then starts with no `window.waypoint` at all. See the same note in
 * `top-three.ts`; `preload-is-commonjs.test.ts` fails if anyone reintroduces it.
 */
interface SdFailure {
  path: string;
  message: string;
}

interface SdOutcome {
  index: number;
  text: string;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

interface SdWeek {
  id: string;
  outcomes: SdOutcome[];
  current: boolean;
  writable: boolean;
}

interface SdMilestone {
  index: number;
  definitionOfDone: string;
  verifier: string | null;
  done: boolean;
  completedOn: string | null;
  raw: string;
}

interface SdProject {
  summary: { slug: string; title: string; status: string };
  nextAction: string | null;
  openMilestones: SdMilestone[];
}

interface SdWaitingItem {
  index: number;
  since: string;
  owner: string;
  text: string;
  raw: string;
}

interface SdStaleWaiting {
  item: SdWaitingItem;
  reason: string;
  untouchedDays: number;
  waitingDays: number;
}

interface SdCalendarItem {
  index: number;
  flaggedOn: string;
  text: string;
  raw: string;
}

interface SdStaleCalendar {
  item: SdCalendarItem;
  reason: string;
  unscheduledDays: number;
}

interface SdUnreadableLine {
  line: number;
  raw: string;
}

interface SdPanel<T> {
  items: T[];
  failure: SdFailure | null;
}

interface SdView {
  today: string;
  topThree: { week: SdWeek | null; failure: SdFailure | null };
  projects: SdPanel<SdProject>;
  waiting: SdPanel<SdStaleWaiting>;
  calendar: SdPanel<SdStaleCalendar>;
  unreadableWaiting: SdUnreadableLine[];
  unreadableCalendar: SdUnreadableLine[];
  policyNotices: string[];
}

type SdTopThreeResponse =
  | { ok: true; week: SdWeek }
  | { ok: false; reason: string; message: string };

type SdProjectResponse =
  | { ok: true; project: { nextAction: string | null; milestones: SdMilestone[] } }
  | { ok: false; reason: string; message: string };

type SdWaitingResponse =
  | { ok: true; item: SdWaitingItem }
  | { ok: false; reason: string; message: string };

interface SdApi {
  read(): Promise<SdView>;
  dismiss(): void;
  onOpened(handler: () => void): void;
  completeOutcome(ref: { week: string; index: number; raw: string }): Promise<SdTopThreeResponse>;
  completeMilestone(slug: string, ref: { index: number; raw: string }): Promise<SdProjectResponse>;
  setNextAction(slug: string, expected: string | null, next: string | null): Promise<SdProjectResponse>;
  recordFollowUp(ref: { index: number; raw: string }): Promise<SdWaitingResponse>;
  recordReceived(ref: { index: number; raw: string }): Promise<SdWaitingResponse>;
  capture(text: string): Promise<SdCaptureResponse>;
}

type SdCaptureResponse = { ok: true; id: string } | { ok: false; error: "empty" };

const sdwp = (window as unknown as { waypoint: { shutdown: SdApi } }).waypoint.shutdown;

function sd$(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: ${id}`);
  return el;
}

function sdError(message: string): void {
  sd$("error").textContent = message;
}

/** A row of muted secondary text under an item. */
function sdDetail(text: string, extraClass = ""): HTMLElement {
  const div = document.createElement("div");
  div.className = extraClass ? `detail ${extraClass}` : "detail";
  div.textContent = text;
  return div;
}

/**
 * A refusal or a warning, shown on the row it concerns and in the error line.
 *
 * The message is the core's, verbatim, in both places. This file does not know
 * why a write was refused and must not invent a reason — and there is no bypass,
 * no override, and no "don't ask again" to offer beside it (FR-038, FR-039,
 * FR-041).
 *
 * For an `entry-changed` refusal the core's message already carries what the
 * entry now reads, which is how the row is re-presented without this screen
 * re-reading anything (FR-040).
 */
function sdRefuse(row: HTMLElement, message: string): void {
  sdError(message);

  const existing = row.querySelector(".row-error");
  if (existing) existing.remove();

  const notice = sdDetail(message, "row-error");
  row.appendChild(notice);
}

function sdClearRowError(row: HTMLElement): void {
  row.querySelector(".row-error")?.remove();
  sdError("");
}

/**
 * Empty, failed, or populated — exactly one of the three.
 *
 * The distinction is the core's, carried in the value: a panel with `failure`
 * set could not be read, and one with an empty `items` and no failure simply has
 * nothing in it. A renderer that flattened those into "the list is empty" would
 * tell the user their waiting list is clear when the truth is that the file
 * could not be opened (FR-011c).
 */
function sdPaintPanel(name: string, failure: SdFailure | null, rows: HTMLElement[]): void {
  const list = sd$(name);
  const empty = sd$(`${name}-empty`);
  const failed = sd$(`${name}-failure`);

  if (failure) {
    list.replaceChildren();
    empty.hidden = true;
    failed.hidden = false;
    // The path and the message are the core's, shown as given. The view does
    // not know why a file could not be read and must not invent a reason.
    failed.textContent = `${failure.path} could not be read: ${failure.message}`;
    return;
  }

  failed.hidden = true;
  empty.hidden = rows.length > 0;
  list.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------
// Panel 1 — this week's top three
// ---------------------------------------------------------------------------

/**
 * One outcome, with a checkbox that marks it done.
 *
 * Only marking done is offered. Reopening, editing, adding and removing are the
 * top-three window's, and offering them here would make this screen a second
 * editor for the same file — the thing FR-033 avoids by naming one verb.
 */
function sdOutcomeRow(weekId: string, outcome: SdOutcome): HTMLLIElement {
  const li = document.createElement("li");
  li.className = outcome.done ? "row outcome done" : "row outcome";
  li.dataset["index"] = String(outcome.index);

  if (!outcome.done) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "complete-outcome";
    toggle.addEventListener("change", () => {
      void (async () => {
        sdClearRowError(li);
        const result = await sdwp.completeOutcome({
          week: weekId,
          index: outcome.index,
          raw: outcome.raw,
        });

        if (!result.ok) {
          toggle.checked = false;
          sdRefuse(li, result.message);
          return;
        }
        // In place, from the verb's own return value. Membership and order are
        // untouched: the row that was clicked is the only thing that changes.
        const written = result.week.outcomes[outcome.index];
        if (written) li.replaceWith(sdOutcomeRow(weekId, written));
      })();
    });
    li.appendChild(toggle);
  }

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = outcome.text;
  li.appendChild(text);

  if (outcome.completedOn) {
    const date = document.createElement("span");
    date.className = "date";
    // The date the core recorded, shown as recorded. Never reformatted.
    date.textContent = outcome.completedOn;
    li.appendChild(date);
  }

  return li;
}

// ---------------------------------------------------------------------------
// Panel 2 — your active projects
// ---------------------------------------------------------------------------

function sdMilestoneRow(slug: string, milestone: SdMilestone): HTMLLIElement {
  const li = document.createElement("li");
  li.className = milestone.done ? "milestone done" : "milestone";
  li.dataset["index"] = String(milestone.index);

  if (!milestone.done) {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "complete-milestone";
    toggle.addEventListener("change", () => {
      void (async () => {
        sdClearRowError(li);
        const result = await sdwp.completeMilestone(slug, {
          index: milestone.index,
          raw: milestone.raw,
        });

        if (!result.ok) {
          toggle.checked = false;
          sdRefuse(li, result.message);
          return;
        }
        const written = result.project.milestones[milestone.index];
        if (written) li.replaceWith(sdMilestoneRow(slug, written));
      })();
    });
    li.appendChild(toggle);
  }

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = milestone.definitionOfDone;
  li.appendChild(text);

  if (milestone.completedOn) {
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = milestone.completedOn;
    li.appendChild(date);
  }

  return li;
}

/**
 * The next action, editable in place.
 *
 * The value it was **shown** goes back as `expected`, so an edit made in a text
 * editor between the screen opening and the button being pressed cancels the
 * write rather than overwriting it (FR-040). That is not an edge case here: this
 * screen is meant to be left open while the user works through it.
 */
function sdNextAction(slug: string, shown: string | null): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "detail next-action";

  const label = document.createElement("span");
  label.className = "next-action-text";
  label.textContent = shown === null ? "No next action recorded" : `Next: ${shown}`;
  wrap.appendChild(label);

  const edit = document.createElement("button");
  edit.className = "link edit-next-action";
  edit.textContent = "Change";
  edit.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "next-action-input";
    input.value = shown ?? "";

    const save = (): void => {
      void (async () => {
        sdClearRowError(wrap);
        const next = input.value.trim();
        const result = await sdwp.setNextAction(slug, shown, next.length === 0 ? null : next);

        if (!result.ok) {
          sdRefuse(wrap, result.message);
          return;
        }
        wrap.replaceWith(sdNextAction(slug, result.project.nextAction));
      })();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") save();
      if (event.key === "Escape") wrap.replaceWith(sdNextAction(slug, shown));
    });

    const button = document.createElement("button");
    button.className = "save-next-action";
    button.textContent = "Save";
    button.addEventListener("click", save);

    wrap.replaceChildren(input, button);
    input.focus();
    input.select();
  });
  wrap.appendChild(edit);

  return wrap;
}

function sdProjectRow(project: SdProject): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "row project";
  li.dataset["slug"] = project.summary.slug;

  const body = document.createElement("div");
  body.className = "text";

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = project.summary.title;
  body.appendChild(title);

  // Verbatim, or the absence said plainly. Nothing is inferred where a project
  // records no next action — an empty line is a gap the user fills (FR-021).
  body.appendChild(sdNextAction(project.summary.slug, project.nextAction));

  if (project.openMilestones.length > 0) {
    const list = document.createElement("ul");
    list.className = "milestones";
    for (const milestone of project.openMilestones) {
      list.appendChild(sdMilestoneRow(project.summary.slug, milestone));
    }
    body.appendChild(list);
  }

  li.appendChild(body);
  return li;
}

// ---------------------------------------------------------------------------
// Panel 3 — waiting on someone
// ---------------------------------------------------------------------------

/**
 * Both verbs, on every listed item, with neither preferred.
 *
 * "I chased them again" and "it arrived" are equally likely answers to a
 * delegated item that has gone quiet, and nothing about the item says which is
 * true. Offering one and hiding the other, or defaulting to either, would be the
 * screen guessing (FR-036a).
 */
function sdWaitingRow(stale: SdStaleWaiting): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "row waiting";
  li.dataset["index"] = String(stale.item.index);

  const body = document.createElement("div");
  body.className = "text";

  const line = document.createElement("div");
  line.textContent = stale.item.text;
  body.appendChild(line);

  // Both numbers, because "waiting three months, chased last Friday" and
  // "forgotten for three months" are different situations and one number cannot
  // tell them apart (FR-027). The counts are the core's; only the layout is
  // this file's.
  body.appendChild(
    sdDetail(
      `@${stale.item.owner} · untouched ${stale.untouchedDays}d · waiting ${stale.waitingDays}d`,
      "age",
    ),
  );
  // The policy module's words, verbatim. Composing this sentence from the day
  // count would put domain vocabulary in a renderer (Principles II and VII).
  body.appendChild(sdDetail(stale.reason, "reason"));

  const actions = document.createElement("div");
  actions.className = "detail actions";

  const act = (
    className: string,
    label: string,
    verb: (ref: { index: number; raw: string }) => Promise<SdWaitingResponse>,
  ): HTMLButtonElement => {
    const button = document.createElement("button");
    button.className = `link ${className}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      void (async () => {
        sdClearRowError(li);
        const result = await verb({ index: stale.item.index, raw: stale.item.raw });

        if (!result.ok) {
          sdRefuse(li, result.message);
          return;
        }
        // In place. The item stays where it is for the rest of this opening,
        // even though a fresh reading would no longer list it — membership was
        // fixed when the screen opened (FR-010a, FR-010b).
        actions.replaceChildren(sdDetail(`Recorded ${label.toLowerCase()}`, "recorded"));
      })();
    });
    return button;
  };

  actions.appendChild(act("record-follow-up", "Followed up", (ref) => sdwp.recordFollowUp(ref)));
  actions.appendChild(act("record-received", "Received", (ref) => sdwp.recordReceived(ref)));
  body.appendChild(actions);

  li.appendChild(body);
  return li;
}

// ---------------------------------------------------------------------------
// Panel 4 — flagged for the calendar
// ---------------------------------------------------------------------------

/**
 * Information only.
 *
 * There is no affordance on this row, and there is nothing to add one from:
 * core exposes no verb, no ref, and no channel for a calendar flag. Scheduling
 * it happens in a calendar; letting it go happens in an editor (FR-042).
 */
function sdCalendarRow(stale: SdStaleCalendar): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "row calendar";

  const body = document.createElement("div");
  body.className = "text";

  const line = document.createElement("div");
  line.textContent = stale.item.text;
  body.appendChild(line);

  body.appendChild(
    sdDetail(`flagged ${stale.item.flaggedOn} · ${stale.unscheduledDays}d unscheduled`, "age"),
  );
  body.appendChild(sdDetail(stale.reason, "reason"));

  li.appendChild(body);
  return li;
}

// ---------------------------------------------------------------------------

function sdUnreadableRow(file: string, line: SdUnreadableLine): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "row unreadable-line";

  const where = document.createElement("span");
  where.className = "lineno";
  // The file and the 1-based line number, so the user is sent to line 14 rather
  // than sent hunting.
  where.textContent = `${file}:${line.line}`;
  li.appendChild(where);

  const raw = document.createElement("span");
  raw.className = "text";
  // Exactly as it sits on disk. Never normalized, never repaired.
  raw.textContent = line.raw;
  li.appendChild(raw);

  return li;
}

async function sdPaint(): Promise<void> {
  const view = await sdwp.read();
  sdError("");

  sd$("today").textContent = view.today;

  const notices = sd$("notices");
  notices.hidden = view.policyNotices.length === 0;
  notices.replaceChildren(
    ...view.policyNotices.map((text) => {
      const div = document.createElement("div");
      div.textContent = text;
      return div;
    }),
  );

  const weekId = view.topThree.week?.id ?? "";
  sdPaintPanel(
    "top-three",
    view.topThree.failure,
    (view.topThree.week?.outcomes ?? []).map((o) => sdOutcomeRow(weekId, o)),
  );
  sdPaintPanel("projects", view.projects.failure, view.projects.items.map(sdProjectRow));
  sdPaintPanel("waiting", view.waiting.failure, view.waiting.items.map(sdWaitingRow));
  sdPaintPanel("calendar", view.calendar.failure, view.calendar.items.map(sdCalendarRow));

  const unreadable = [
    ...view.unreadableWaiting.map((line) => sdUnreadableRow("waiting.md", line)),
    ...view.unreadableCalendar.map((line) => sdUnreadableRow("calendar.md", line)),
  ];
  sd$("unreadable-section").hidden = unreadable.length === 0;
  sd$("unreadable").replaceChildren(...unreadable);
}

// ---------------------------------------------------------------------------

/**
 * The capture box.
 *
 * The ordinary verb on the ordinary channel. Confirming captures and clears the
 * box, focus stays here, and no panel is navigated away from — the point of
 * emptying your head at the end of the day is that it costs nothing and
 * interrupts nothing (FR-043, FR-047).
 *
 * The box is cleared **now**, not when the write returns. Clearing
 * asynchronously races the user: start typing the next thought while the
 * previous one is still in flight and the late clear wipes what they just typed.
 * The capture window learnt this the same way; a refused capture puts the text
 * back, so nothing is lost either way.
 */
function sdCapture(): void {
  const input = sd$("capture-text") as HTMLInputElement;
  const text = input.value;
  if (text.trim().length === 0) {
    // Nothing is captured, and nothing is said about it. An empty box is not a
    // mistake to be corrected (FR-048).
    input.value = "";
    return;
  }

  input.value = "";
  input.focus();

  void sdwp.capture(text).then((result) => {
    // A refused capture puts the text back rather than losing it. There is
    // nothing else to do on success: the thought is in the inbox, the box is
    // ready for the next one, and this screen keeps no record of either.
    if (!result.ok && input.value === "") input.value = text;
  });
}

sd$("capture").addEventListener("click", sdCapture);
sd$("capture-text").addEventListener("keydown", (event) => {
  if ((event as KeyboardEvent).key === "Enter") sdCapture();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") sdwp.dismiss();
});

/**
 * Read on open, and at no other time.
 *
 * This window hides rather than closes, so `shutdown:opened` is what makes the
 * second opening a cold one. There is deliberately no `onVaultChanged` beside
 * it: this is a reading taken at a moment, not a live view of a file.
 */
sdwp.onOpened(() => void sdPaint());

void sdPaint();
