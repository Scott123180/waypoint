import type {
  Completion,
  OutcomeCompletion,
  ProjectHistory,
  ProjectScoped,
  Narrative,
  Retrospective,
  UnreadableReason,
  UnreadableSource,
} from "./types";

/**
 * The one rendering.
 *
 * This string is simultaneously what the window shows and what the export
 * writes. That is the whole point: "the export matches the view" is an identity
 * rather than a property maintained by two renderers that have to be changed in
 * step forever (FR-045, SC-011, research R2).
 *
 * Pure — no I/O, no clock, no locale, no randomness. The same value renders to
 * the same bytes forever (SC-003).
 *
 * Markdown, because the vault is markdown and the documents people paste into
 * generally accept it. It degrades to legible plain text if they do not.
 *
 * See specs/006-retrospective-view/contracts/report-format.md
 */

/**
 * Every fixed string this module can emit.
 *
 * Enumerated rather than inlined so that the set of words the report may
 * contribute is *listable*, and a test can assert that every run of text in a
 * rendered report is either user data or a member of this set. Without it,
 * "nothing is generated, summarized, or editorialized" (FR-053) is a promise
 * nobody can check; with it, an invented adjective fails a test rather than
 * reading plausibly (SC-015).
 *
 * Adding a string here is therefore a deliberate act. If a new one is needed,
 * it goes in this object — not inline at a call site.
 */
export const REPORT_LABELS = {
  titlePrefix: "Retrospective:",
  rangeJoin: "to",
  projectPrefix: "Project:",

  completions: "Completions",
  completionsEmpty: "Nothing was completed in this range.",
  projectCompleted: "project completed",

  undated: "Undated",
  undatedPreamble:
    "These are recorded as done but carry no readable date, so they cannot be placed in the range.",
  undatedEmpty: "Everything found in this range carries a completion date.",
  undatedMarker: "undated",

  outcomes: "Weekly outcomes",
  outcomesEmpty: "No weekly outcomes were completed in this range.",
  outcomesUndatedPreamble: "Recorded as done but carrying no readable date.",

  notes: "Weekly notes",
  note: "Note:",
  noteNone: "Note: none recorded.",
  slipped: "Slipped:",
  waiting: "Waiting:",
  summary: "Summary",
  reviewIncomplete: "review incomplete",

  history: "Project history",
  historyEmpty:
    "No history is recorded for this project. Nothing has been written down about how it got " +
    "to its current status — which is not the same as it never having changed.",
  statusDisagrees: "The project's status field says",
  statusDisagreesTail: "its last recorded change entered",

  unreadable: "Could not be read",
  unreadablePreamble:
    "These are shown as they sit on disk. Nothing here has been changed or repaired.",
  notAWeekFile: "not a week file",
  unreadableLine: "unreadable line",
  unreadableFile: "listed but not readable",

  unreviewedNone: "Every one of the",
  unreviewedNoneTail: "weeks in this range was reviewed.",
  unreviewedSome: "No review was run for",
  unreviewedSomeMiddle: "of the",
  unreviewedSomeTail: "weeks in this range:",

  after: "after",

  /**
   * Why a section a project does not have is omitted (FR-032, FR-033).
   *
   * Here rather than beside the service that attaches them, even though the
   * service is what puts them in the value: this object's contract is *every
   * fixed string the report can emit*, and these are emitted. Defining them
   * anywhere else would put two of the report's own sentences outside the set
   * that makes FR-053 checkable — which is exactly how the first version of
   * this file failed its own test.
   */
  outcomesNotProjectScoped:
    "Not shown: outcomes are committed to for a week, not recorded against a project, " +
    "so there is no such thing as this project's outcomes.",
  narrativeNotProjectScoped: "Not shown: a note belongs to a week, not to a project.",

  /**
   * Feature 5's fallback when a log's summary heading names no provider.
   *
   * Not this module's word, and not the user's either — it arrives already in
   * `AcceptedSummary.provider`. Listed so the vocabulary check stays honest
   * about where it came from rather than being widened to let anything through.
   */
  unknownProvider: "unknown",
} as const;

const SEP = " — ";

/**
 * A label per reason, exhaustively.
 *
 * `Record<UnreadableReason, string>` rather than a ternary: adding a reason to
 * the union without a word for it is then a compile error rather than a report
 * that silently prints the wrong one. The ternary this replaced would have
 * called a vanished file an unreadable line.
 */
const REASON_LABELS: Record<UnreadableReason, string> = {
  "not-a-week-file": REPORT_LABELS.notAWeekFile,
  "unreadable-line": REPORT_LABELS.unreadableLine,
  "unreadable-file": REPORT_LABELS.unreadableFile,
};

export function renderReport(r: Retrospective): string {
  const out: string[] = [];

  out.push(`# ${REPORT_LABELS.titlePrefix} ${r.query.range.from} ${REPORT_LABELS.rangeJoin} ${r.query.range.to}`);
  if (r.projectTitle !== null) out.push(`${REPORT_LABELS.projectPrefix} ${r.projectTitle}`);

  section(out, REPORT_LABELS.completions, r.completions.length, () =>
    r.completions.length === 0
      ? [REPORT_LABELS.completionsEmpty]
      : r.completions.map(completionLine),
  );

  section(out, REPORT_LABELS.undated, r.undated.length, () =>
    r.undated.length === 0
      ? [REPORT_LABELS.undatedEmpty]
      : [REPORT_LABELS.undatedPreamble, "", ...r.undated.map(completionLine)],
  );

  renderOutcomes(out, r);
  renderNarrative(out, r.narrative);
  if (r.history !== null) renderHistory(out, r.history);
  if (r.unreadable.length > 0) renderUnreadable(out, r.unreadable);

  return `${out.join("\n")}\n`;
}

/**
 * A heading with its count, taken from the list about to be printed.
 *
 * The count is computed here, from the same array the body comes from, so the
 * number and the entries beneath it cannot disagree. Nothing stores a total —
 * a stored count is a second representation of the same fact, and second
 * representations drift (FR-010f, research R7).
 */
function section(out: string[], heading: string, count: number, body: () => string[]): void {
  out.push("", `## ${heading} (${count})`, "");
  out.push(...body());
}

/** A section a project does not have: heading, reason, no count. */
function omitted(out: string[], heading: string, reason: string): void {
  out.push("", `## ${heading}`, "", reason);
}

function completionLine(c: Completion): string {
  const date =
    c.completedOn !== null
      ? c.completedOn
      : c.rawDate !== null
        ? `(${REPORT_LABELS.undatedMarker}: "${c.rawDate}")`
        : `(${REPORT_LABELS.undatedMarker})`;
  const what = c.kind === "project" ? REPORT_LABELS.projectCompleted : c.text;
  return `- ${date}${SEP}${c.projectTitle}${SEP}${what}`;
}

function renderOutcomes(out: string[], r: Retrospective): void {
  if (!r.outcomes.applies) {
    omitted(out, REPORT_LABELS.outcomes, r.outcomes.reason);
    return;
  }

  const groups = r.outcomes.value;
  const total = groups.reduce((n, g) => n + g.outcomes.length, 0);

  section(out, REPORT_LABELS.outcomes, total, () => {
    if (total === 0) return [REPORT_LABELS.outcomesEmpty];
    const lines: string[] = [];
    for (const g of groups) {
      lines.push(`### ${g.week}`, "");
      lines.push(...g.outcomes.map(outcomeLine));
      lines.push("");
    }
    lines.pop();
    return lines;
  });

  const undated = r.undatedOutcomes.applies ? r.undatedOutcomes.value : [];
  if (undated.length > 0) {
    out.push(
      "",
      `### ${REPORT_LABELS.undated} (${undated.length})`,
      "",
      REPORT_LABELS.outcomesUndatedPreamble,
      "",
      ...undated.map((o) => `- ${o.week}${SEP}${o.text}`),
    );
  }
}

function outcomeLine(o: OutcomeCompletion): string {
  const date =
    o.completedOn !== null
      ? o.completedOn
      : o.rawDate !== null
        ? `(${REPORT_LABELS.undatedMarker}: "${o.rawDate}")`
        : `(${REPORT_LABELS.undatedMarker})`;
  return `- ${date}${SEP}${o.text}`;
}

function renderNarrative(out: string[], narrative: ProjectScoped<Narrative>): void {
  if (!narrative.applies) {
    omitted(out, REPORT_LABELS.notes, narrative.reason);
    return;
  }

  const { weeks, unreviewed } = narrative.value;

  section(out, REPORT_LABELS.notes, weeks.length, () => {
    const lines: string[] = [];
    for (const w of weeks) {
      const incomplete = w.status === "in-progress" ? `${SEP}${REPORT_LABELS.reviewIncomplete}` : "";
      lines.push(`### ${w.week} (${w.span.from} ${REPORT_LABELS.rangeJoin} ${w.span.to})${incomplete}`, "");

      if (w.note === null || w.note.trim().length === 0) {
        lines.push(REPORT_LABELS.noteNone, "");
      } else {
        // Verbatim and unprefixed. A blockquote would be four characters the
        // user did not write, arriving in the document they paste into (FR-021).
        lines.push(REPORT_LABELS.note, w.note.replace(/\n+$/, ""), "");
      }

      if (w.slipped.length > 0) {
        lines.push(REPORT_LABELS.slipped, ...w.slipped.map((s) => `- ${s}`), "");
      }
      if (w.waiting.length > 0) {
        lines.push(
          REPORT_LABELS.waiting,
          ...w.waiting.map((item) =>
            `- ${item.owner}${SEP}${item.days}d${SEP}${item.action}${item.text ? SEP + item.text : ""}`,
          ),
          "",
        );
      }
      if (w.summary !== null) {
        lines.push(`${REPORT_LABELS.summary} (${w.summary.provider}):`, w.summary.text, "");
      }
    }

    // Always present. An empty list says "none were missed"; an absent section
    // says nothing at all, and the two must not look alike (FR-024d).
    lines.push(...unreviewedReport(narrative.value));
    return lines;
  });
}

function unreviewedReport(n: Narrative): string[] {
  const { weeks, weeksInRange } = n.unreviewed;
  if (weeks.length === 0) {
    return [`${REPORT_LABELS.unreviewedNone} ${weeksInRange} ${REPORT_LABELS.unreviewedNoneTail}`];
  }
  // The same shape at every range length — twelve weeks with notes and one line
  // naming the other 197. No threshold at which this changes (FR-024a–c).
  return [
    `${REPORT_LABELS.unreviewedSome} ${weeks.length} ${REPORT_LABELS.unreviewedSomeMiddle} ` +
      `${weeksInRange} ${REPORT_LABELS.unreviewedSomeTail}`,
    weeks.join(", "),
  ];
}

function renderHistory(out: string[], h: ProjectHistory): void {
  section(out, REPORT_LABELS.history, h.entries.length, () => {
    if (h.entries.length === 0) return [REPORT_LABELS.historyEmpty];

    const lines = h.entries.map((e) => {
      const tail =
        e.afterDays === null || e.afterState === null
          ? ""
          : `${SEP}${REPORT_LABELS.after} ${e.afterDays}d ${e.afterState}`;
      return `- ${e.on}${SEP}${e.action}${SEP}${e.detail}${tail}`;
    });

    // Both are shown and neither is repaired (FR-041). The status field is what
    // the project is; the ledger is what was recorded.
    const last = h.entries[h.entries.length - 1];
    const entered = last?.detail.split("→").pop()?.trim();
    if (entered !== undefined && entered.length > 0 && entered !== h.status) {
      lines.push(
        "",
        `${REPORT_LABELS.statusDisagrees} \`${h.status}\`; ` +
          `${REPORT_LABELS.statusDisagreesTail} \`${entered}\`.`,
      );
    }
    return lines;
  });
}

function renderUnreadable(out: string[], sources: readonly UnreadableSource[]): void {
  section(out, REPORT_LABELS.unreadable, sources.length, () => [
    REPORT_LABELS.unreadablePreamble,
    "",
    ...sources.map((s) => {
      const where = s.line === null ? s.path : `${s.path}:${s.line}`;
      // A file that was listed and then could not be read has no raw text to
      // show — there is nothing on disk to quote.
      const tail = s.raw.length === 0 ? "" : `${SEP}${s.raw}`;
      // The reason and the raw line, and nothing else. Diagnosing it is the
      // user's job in their editor; a report that guessed would be
      // editorializing about their data (FR-053).
      return `- ${where}${SEP}${REASON_LABELS[s.reason]}${tail}`;
    }),
  ]);
}
