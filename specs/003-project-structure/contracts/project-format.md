# Contract: Project and Area File Format

**Location**: `<vault>/projects/<slug>.md`, `<vault>/areas/<slug>.md` | **Feature**: 003-project-structure

Extends [Feature 2's vault format](../../002-inbox-view-sort/contracts/vault-format.md). That document
described the stub; this one describes what a fully structured project looks like once this feature has
filled it in. **The stub remains valid** — it is this format with every optional part absent.

This is a contract with the **user** before it is a contract with code. Feature 5's weekly review and the
later retrospective view both read these files, so changes here are breaking changes.

---

## A structured project

```markdown
# Roof repair

status: active
next action: Call the roofer back for a revised estimate
dri: me

## Outcome

The roof survives a full winter with no leak, and the insurance claim is settled.

## Milestones

- [x] Estimate approved by insurer — @Priya — done 2026-08-14
- [ ] Materials delivered on site — @me
- [ ] Work signed off and claim paid — @Priya

## Unprocessed

- 2026-08-11T09:14:02-04:00 Call the roofer back about the estimate
```

## The same project as a stub, before any structure

```markdown
# Roof repair

status: active
```

Both parse. The second is what sort writes and what a project looks like until the user chooses otherwise
(FR-004, FR-005).

---

## Preamble fields

Everything between the `#` heading and the first `##` heading. One `key: value` per line, in any order.

| Key | Value | Rules |
|---|---|---|
| `status` | `active` \| `parked` \| `waiting` \| `done` | Written by Feature 2's stub. Absent or unrecognized reads as `active`; an unrecognized value is preserved, not rewritten. |
| `next action` | Free text, one line | Absent means not set (FR-007). |
| `dri` | Free text name | May be `me`. Absent never contributes to the incomplete flag (FR-009). |
| `completed` | `YYYY-MM-DD`, local | Written only when the project is marked done; removed when reopened (FR-036). |

Keys are lowercase and matched case-insensitively with surrounding whitespace ignored. An unknown key is
left exactly where it is and carried through every write — this feature owns four keys, not the file.

A missing preamble entirely is fine. A file containing only `# Title` parses as an active project with no
structure.

---

## `## Outcome`

Free-form prose, everything up to the next `##` heading. Multiple paragraphs and line breaks are preserved
verbatim (FR-006).

An absent section, or one containing only whitespace, means the outcome is not set — which flags the
project as needing structure (FR-018).

---

## `## Milestones`

One markdown task-list line per milestone, in order.

```text
line := "- [" state "] " definition-of-done [ " — @" verifier ] [ " — done " date ]
state := " " | "x"
date  := YYYY-MM-DD
```

| Part | Rule |
|---|---|
| `[x]` / `[ ]` | The done state. Editing this character by hand is a supported way to complete a milestone. |
| `definition-of-done` | Required, verbatim, what finishing it means (FR-011). |
| `@verifier` | Optional. Who confirms it (FR-012). `@me` is written like any other name. |
| `done <date>` | Present only on a completed milestone (FR-033). Removed when it is reopened. |

**Parsing is right-to-left**: strip a trailing ` — done <date>` if it matches exactly, then a trailing
` — @<name>` if it matches; whatever remains is the definition of done. A definition containing ` — ` or an
`@` is therefore safe. Anything that does not match a tail pattern is part of the text, never an error.

A line under this heading that is not a task-list line is left untouched and is not a milestone.

**Count**: the application refuses to add a fifth (FR-013). A file hand-edited to hold more is displayed in
full and never truncated (FR-013b).

---

## `## Unprocessed`

Unchanged from Feature 2 — items sort routed here, in arrival order, in the inbox item grammar. This
feature reads and displays them, and can remove one when the user dismisses it (FR-046b); it never
reinterprets, reorders, or converts them (FR-046c).

A dismissed item is appended to `trash.md` in the existing discard-line format before being removed
(FR-046d). The section going empty, or being deleted by hand, is not an error and does not affect the
incomplete flag (FR-046e).

---

## Section order and what the app may touch

New sections the app adds are inserted **before `## Unprocessed`** when it exists, otherwise appended at
the end — so raw material stays below the structure it is meant to become. Canonical order for content this
feature writes:

```text
# Title
<preamble>
## Outcome
## Milestones
## Unprocessed
```

**Existing files are never reordered to match.** A user who moves `## Milestones` above `## Outcome`, adds a
`## Notes` section, or writes their own `### Sub-heading` keeps all of it exactly as written. The rule is:
the app edits the lines belonging to the field it was asked to change and reproduces every other byte
unchanged (FR-045, research R3). Opening a project and closing it without editing produces no diff.

---

## An area

```markdown
# Home maintenance

status: active

## Unprocessed

- 2026-08-11T14:02:55-04:00 Gutters need clearing before autumn
```

A title, a status, and whatever sort routed in. **No `## Outcome`, no `## Milestones`, no `completed`, no
`next action`, no `dri`** — the application never writes them and never offers them (FR-040).

`status` is `active` or `parked` only (FR-041). A file hand-edited to `status: done` or `status: waiting` is
displayed as it reads and never silently rewritten, but the application offers only the two (FR-041c).

If an area file is hand-edited to contain milestones, it stays an area: the content is preserved and
ignored, not adopted (FR-043).

---

## Filenames

Unchanged from Feature 2: `<slug>.md`, the slug derived from the title at creation time. **Editing a title
does not rename the file** — the `#` heading is for the human, the slug is the identity used by every verb,
and a rename would break `git log --follow` and any link the user made to the path. The two can therefore
drift, which is accepted (spec Assumptions).

---

## Reading completed work over a date range

The retrospective view (Feature 6) answers "what got finished in March" by scanning `projects/*.md` for:

- `completed: YYYY-MM-DD` in the preamble — projects finished
- `— done YYYY-MM-DD` on milestone lines — milestones finished

No index, no history file, nothing that can fall out of step with the projects themselves (SC-010,
research R10). Projects completed before this feature existed carry no date and correctly do not appear.
