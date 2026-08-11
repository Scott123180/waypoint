# Contract: Vault File Formats

**Location**: `~/waypoint/` (configurable) | **Feature**: 002-inbox-view-sort

These formats are a contract with the **user**, not just with future code. They are the durable artifacts
that must remain useful with no application running (Principle IV, FR-029). Features 3, 5, and 8 will read
them, so changes here are breaking changes.

```text
~/waypoint/
├── inbox.md              # Feature 1 — unchanged grammar, now also read and spliced
├── projects/<slug>.md    # one file per project
├── areas/<slug>.md       # one file per area
├── waiting.md            # single running list
├── calendar.md           # single running list
└── trash.md              # single running list
```

All five destinations reuse the inbox's item grammar wherever an item's text appears, so the same thought
is recognizable everywhere it lands.

---

## Project and area files

Created during sort as a minimal stub — title and status, nothing else (FR-009).

```markdown
# Roof repair

status: active

## Unprocessed

- 2026-08-11T09:14:02-04:00 Call the roofer back about the estimate
- Buy a tarp before it rains
```

| Rule | Reason |
|---|---|
| `#` heading holds the title **verbatim as typed** | The slug is for the filename; the heading is for the human. `destinations()` reads the title from here. |
| `status: active` is the only field sort writes | Feature 3 owns status semantics. Sort writes it and never reads it back. |
| No outcome, milestones, next action, or DRI — **not even empty** | Writing blank placeholders would be metadata the user has to maintain before it means anything (FR-009). |
| Items go under `## Unprocessed`, appended in arrival order | Marks them as raw material Feature 3 has not yet shaped. |
| A hand-written item appears with no timestamp | None is fabricated (FR-027a). |
| Everything outside `## Unprocessed` is never touched | Feature 3's sections and the user's own edits survive verbatim (FR-019b, SC-003a). |

**Section insertion**: find `## Unprocessed`; the section ends at the next `## ` at the same level or EOF;
insert before that boundary. If the heading is absent, append it at the end of the file. The `##` level is
matched exactly — a `### Unprocessed` under some other section is not the target.

**Filenames**: `<slug>.md` where the slug is the title lowercased with non-alphanumerics collapsed to
hyphens (`Roof Repair!` → `roof-repair`). Slug equality is the duplicate test, so "Roof Repair" and
"roof  repair" resolve to one project (FR-012). A slug collision between genuinely different titles gets
`-2`, `-3`.

---

## `waiting.md`

```markdown
- 2026-08-11 @Priya — 2026-08-09T16:02:11-04:00 Confirm the migration window moved
- 2026-08-11 @roofer — Send the revised estimate
```

```text
line := "- " waiting-since " @" owner " — " [capture-timestamp " "] text
```

| Field | Rule |
|---|---|
| `waiting-since` | Date the item was routed here, `YYYY-MM-DD`. The clock for staleness (FR-013, FR-015). |
| `owner` | Free text, required and non-empty (FR-014). Prefixed `@` so it is greppable. |
| `capture-timestamp` | The item's original capture time, omitted entirely for a hand-written item. |

The ROADMAP's 7-day staleness threshold is Feature 5's to enforce. This feature only guarantees the date
is present and parseable.

---

## `calendar.md`

```markdown
- 2026-08-11 — 2026-08-09T16:02:11-04:00 Book flights for the March offsite
- 2026-08-11 — Dentist sometime in September
```

```text
line := "- " flagged-on " — " [capture-timestamp " "] text
```

| Field | Rule |
|---|---|
| `flagged-on` | Date the item was flagged, `YYYY-MM-DD`, filled in automatically with no prompt (FR-017a). |
| `capture-timestamp` | Original capture time; omitted for a hand-written item. |

Deliberately shaped like `waiting.md`: "flagged but never scheduled" is the same staleness problem as
"delegated but never returned," and Feature 8 should be able to check both the same way.

**No event date, time, or duration is recorded, and nothing here syncs with any calendar** (FR-017). This
is a staging list until a later feature does the integration.

---

## `trash.md`

```markdown
- 2026-08-11 — 2026-08-09T16:02:11-04:00 Idea about the thing that turned out to be nothing
```

```text
line := "- " discarded-on " — " [capture-timestamp " "] text
```

Append-only. No purge, expiry, or size limit in this feature (FR-016a) — pruning is deliberately nobody's
job yet. Recovery is by hand: open the file, copy the line back into `inbox.md`. There is no in-app
restore.

---

## Shared rules

| Rule | Reason |
|---|---|
| Item text is stored **verbatim** | Sort routes; it never edits (FR-021). No capitalization, punctuation, or reflow fixes. |
| Multi-line items keep two-space continuation lines | Same convention as the inbox, so a long dictated thought renders correctly wherever it lands. |
| Files end with a trailing newline | Makes the next append safe and keeps the files POSIX-clean. |
| A missing file or directory is created on demand | Never a failure state. |
| Appends only; existing lines never rewritten | Protects hand-edits and Feature 3's structure. |
| Dates are local dates, timestamps carry a UTC offset | Matches the inbox format's reasoning: preserve the wall clock the user experienced, stay unambiguous across DST. |

## What the app tolerates in a hand-edited vault

The user is expected to edit these files directly, so the app must not be strict:

- Lines that do not match the grammar are left untouched and never "corrected."
- A project file with no `#` heading falls back to its slug for display.
- A project file the user created by hand, with no `## Unprocessed` section, gets one appended on first
  routed item and keeps everything else exactly as written.
- Reordered, deleted, or reworded lines are fine — sort only ever appends to these files.
