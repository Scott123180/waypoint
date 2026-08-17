# Contract: Report Format

**Feature**: 006-retrospective-view | **Date**: 2026-08-16

What `renderReport(retrospective)` produces. This is simultaneously the text shown in the window and the text
the export delivers — there is exactly one rendering, so the two cannot differ (research R2, FR-045).

Markdown, because the vault is markdown (Principle IV) and because the documents the user is pasting into
generally accept it. It degrades to legible plain text if they do not.

---

## 1. Shape

```text
# Retrospective: <from> to <to>
[Project: <title>]

## Completions (<n>)
## Undated (<n>)
## Weekly outcomes (<n>)
## Weekly notes (<n>)
## Project history (<n>)      ← only under a project filter
## Could not be read (<n>)    ← only when non-empty
```

**Every section states its count in its heading**, taken from the length of the array being printed (FR-010f,
research R7). A section with nothing in it prints its heading with `(0)` and a sentence saying what it found
none of — it is never omitted, because a missing section and an empty one look identical only if one of them
is missing.

The two exceptions are deliberate and each is a stated absence rather than a silent one: **Project history**
appears only under a project filter (FR-036a), and **Could not be read** appears only when something could
not be (an empty one would be a reassurance nobody asked for, printed on every report forever).

---

## 2. Header

```text
# Retrospective: 2026-01-01 to 2026-12-31
```

Under a project filter, one further line:

```text
# Retrospective: 2026-01-01 to 2026-12-31
Project: Payments migration
```

The range is always stated, so a report separated from the application still says what it covers (FR-010,
FR-046). The project line uses the title as it currently reads, and the slug never appears — the user narrowed
by picking a project, not by typing a filename.

---

## 3. Completions

```text
## Completions (18)

- 2026-09-30 — Payments migration — project completed
- 2026-09-14 — Payments migration — Beta shipped to 50 users
- 2026-09-14 — Vendor consolidation — Contract signed
- 2026-08-02 — Onboarding rewrite — First cohort through the new flow
```

`- <date> — <project title> — <what was finished>`

- A **milestone** prints its definition of done verbatim.
- A **project** prints the fixed phrase `project completed`, so a project completion is never mistaken for a
  milestone whose text happens to be the project's name.
- The separator is ` — `, which is already the repo's line separator (`SEPARATOR` in `top-three-document.ts`,
  and the grammar `waitingLine`, `calendarLine`, and `trashLine` all use).

Order: date descending, then project slug, then projects before milestones on a shared date, then milestone
index (FR-008, research R8).

Empty:

```text
## Completions (0)

Nothing was completed in this range.
```

---

## 4. Undated

```text
## Undated (3)

These are recorded as done but carry no readable date, so they cannot be placed in the range.

- (undated) — Payments migration — Vendor shortlist agreed
- (undated) — Onboarding rewrite — project completed
- (undated: "2026-13-45") — Vendor consolidation — Legal review closed
```

The explanatory sentence is fixed text and always present when the section is non-empty: FR-017 requires the
reader to see that these are done but undatable, and a bare list would not say so.

The third form carries the raw text of whatever was written where the date goes, verbatim and quoted, so the
user can find it in vim (FR-018). It is never corrected, and it never appears in the dated section however
plausible it looks.

Order: same tie-break as `Completions`, minus the date.

Empty:

```text
## Undated (0)

Everything found in this range carries a completion date.
```

---

## 5. Weekly outcomes

```text
## Weekly outcomes (11)

### 2026-W20

- 2026-05-14 — Ship the migration plan
- 2026-05-15 — Close the vendor decision

### 2026-W21

- 2026-05-26 — Write the incident review
```

Grouped by the week each outcome was **committed to**, weeks descending, outcomes in file order within a week
(FR-011, FR-012). The date on each line is when it was finished, which may be a later week — the grouping and
the date answer different questions and both are shown (FR-013).

The section count is the total number of outcomes, not the number of weeks.

Undated outcomes follow, under their own subheading, for the same reason they do above:

```text
### Undated (2)

Recorded as done but carrying no readable date.

- 2026-W22 — Talk to finance
```

Under a project filter, the whole section is replaced by its stated reason (FR-032):

```text
## Weekly outcomes

Not shown: outcomes are committed to for a week, not recorded against a project,
so there is no such thing as this project's outcomes.
```

No count is printed there, because nothing was counted. The wording is core's, not the window's.

Empty, unnarrowed:

```text
## Weekly outcomes (0)

No weekly outcomes were completed in this range.
```

---

## 6. Weekly notes

```text
## Weekly notes (6)

### 2026-W20 (2026-05-11 to 2026-05-17)

Note:
Rough week. The migration cutover ate three days I had planned for the vendor
decision, and I let the incident review slide again.

Slipped:
- Write the incident review

Waiting:
- @dana — 12 days — followed up — invoice approval
- payments-migration — 21 days — left — project waiting

### 2026-W21 (2026-05-18 to 2026-05-24) — review incomplete

Note: none recorded.

No review was run for 7 of the 13 weeks in this range:
2026-W22, 2026-W23, 2026-W24, 2026-W25, 2026-W26, 2026-W27, 2026-W28
```

Points of precision:

- **The span is always stated** beside the identifier, so a week only partly inside the range is legible as
  such (FR-028). A reader can then see that a note covers days the range does not.
- **The note is verbatim, unprefixed.** No blockquote, no indentation, no wrapping. A `> ` prefix would be
  four characters the user did not write arriving in the document they paste into, and FR-021 says verbatim.
- **`Note: none recorded.`** distinguishes a week whose review wrote no note from a week with no review
  (FR-025). The latter never appears here — it appears in the unreviewed report below.
- **`— review incomplete`** marks a log recording a review still in progress. It is shown as it stands,
  neither completed nor hidden (FR-026).
- **Slipped** is the log's own `topThree.slipped`, and **Waiting** its own waiting records, printed as they
  were recorded rather than recomputed against today's files (FR-022, FR-023).
- **An accepted summary**, where one exists, prints under its own `Summary (<provider>):` label, keeping the
  attribution the log carries and staying plainly separate from the note (FR-027).

The **unreviewed report** closes the section, always:

```text
No review was run for 7 of the 13 weeks in this range:
2026-W22, 2026-W23, …
```

and when none were missed:

```text
Every one of the 13 weeks in this range was reviewed.
```

Same shape at any range length — twelve weeks with notes and one line naming the other 197 (FR-024a–d). There
is no threshold at which this changes.

Under a project filter, the section is replaced by its reason (FR-033):

```text
## Weekly notes

Not shown: a note belongs to a week, not to a project.
```

---

## 7. Project history

Only under a project filter.

```text
## Project history (5)

- 2026-02-03 — status — created → active
- 2026-04-11 — status — active → waiting — after 67d active
- 2026-06-02 — status — waiting → active — after 52d waiting
- 2026-09-30 — status — active → done — after 120d active
```

One line per ledger entry, file order, verbatim from `LedgerEntry` (FR-037, FR-038). The `— after <n>d
<state>` tail appears only where the entry records one; where the ledger is silent it is simply absent, and no
duration is computed from the surrounding dates (FR-039).

Where the current status disagrees with the last entry — a hand-edited file — both are printed and neither is
repaired (FR-041):

```text
The project's status field says `parked`; its last recorded change entered `active`.
```

No ledger at all:

```text
## Project history (0)

No history is recorded for this project. Nothing has been written down about how it
got to its current status — which is not the same as it never having changed.
```

The second sentence is required by FR-040, which draws exactly that distinction.

---

## 8. Could not be read

Present only when non-empty.

```text
## Could not be read (2)

These are shown as they sit on disk. Nothing here has been changed or repaired.

- log/2026-W12 copy.md — not a week file
- top-three.md:41 — unreadable line — - [x] ship it
```

`- <path>[:<line>] — <reason> — <raw text>`

Each entry names the vault-relative path, a 1-based line number where the problem is a line rather than the
file, the `reason` verbatim from `UnreadableSource`, and the raw text exactly as it sits on disk (FR-020). A
file in `log/` whose name is not a week identifier is reported here rather than parsed as a week or silently
skipped (research R4).

> **Amended 2026-08-16 (convergence T109).** A third `reason` was added: `unreadable-file`, rendered as
> `listed but not readable`, for a file the directory listed that the read could not produce — `list` and
> `read` are two syscalls, and `FsVaultStore.read` returns null on ENOENT alone, so a log deleted in the gap
> lists and is then gone. It prints with no raw text, because there is nothing left on disk to quote:
>
> ```text
> - log/2026-W20.md — listed but not readable
> ```
>
> Before this, such a file was skipped and the week it stood for was counted as reviewed on the strength of
> the listing alone — so it appeared neither individually nor in the unreviewed report, which FR-020, FR-028,
> and SC-007 all forbid. The week is now named in the unreviewed report, which is what the files say once the
> log is gone, and the entry here is what distinguishes it from a week that was simply never reviewed.

**The report never guesses why.** `reason` is one of the fixed values the type allows, and nothing
speculates about the cause — no "missing date?", no "did you mean". Diagnosing the line is the user's job in
their editor, and a report that guessed would be editorializing about the user's data, which §10's fourth
invariant and FR-053 both forbid. This paragraph exists because an earlier draft of this contract carried
exactly such a guess in its example.

---

## 9. An empty retrospective

Still a report, never an empty file (FR-048):

```text
# Retrospective: 2026-01-01 to 2026-03-31

## Completions (0)

Nothing was completed in this range.

## Undated (0)

Everything found in this range carries a completion date.

## Weekly outcomes (0)

No weekly outcomes were completed in this range.

## Weekly notes (0)

Every one of the 13 weeks in this range was reviewed.
```

---

## 10. Invariants

1. **The rendered string is a pure function of the `Retrospective`.** No clock, no locale, no randomness, no
   filesystem. The same value renders to the same bytes forever (SC-003).
2. **Every count equals the length of the list beneath it**, because it is taken from it (FR-010f, SC-015a).
3. **Counts are the only figures.** No rate, average, streak, per-quarter split, or comparison appears
   anywhere in this format (FR-010g, FR-054, SC-015a).
4. **Every word is either the user's data or fixed labelling from this contract.** Nothing is generated,
   summarized, ranked, or reworded (FR-053, SC-015).
5. **No section is silently absent.** The two conditional sections are conditional on a stated rule, and every
   other section prints even when empty.
6. **The view shows this string and the export writes this string.** There is no third thing (FR-045, SC-011).
