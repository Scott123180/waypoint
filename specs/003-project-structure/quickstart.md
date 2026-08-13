# Quickstart: Projects with Milestones

**Feature**: 003-project-structure | **Date**: 2026-08-12

Runnable scenarios that prove the feature works end to end. Each maps to spec requirements and success
criteria, so a failure here points at a specific requirement rather than a vague regression.

Formats referenced rather than repeated: [project-format.md](contracts/project-format.md),
[projects-api.md](contracts/projects-api.md), [data-model.md](data-model.md).

---

## Prerequisites

```bash
nvm use                     # Node 22 LTS — the system node is 18.19.1 and EOL
npm install                 # no new dependencies are added by this feature
npm run build
```

Vault location follows Feature 2: derived from the directory containing `inbox.md`, or an explicit
`vaultRoot`. Point at a scratch vault before running anything destructive:

```bash
export WAYPOINT_VAULT="$(mktemp -d)/waypoint"
mkdir -p "$WAYPOINT_VAULT/projects" "$WAYPOINT_VAULT/areas"
```

## Test commands

```bash
npm run test:core           # fast: pure functions + services over FakeVaultStore
npm test                    # everything, including real-filesystem adapter tests
npm run test:e2e            # Playwright _electron, the project view
npm run typecheck
```

---

## 1. A stub is a valid project — nothing is forced (US1, FR-004, FR-005)

Start from exactly what sort writes:

```bash
printf '# Roof repair\n\nstatus: active\n' > "$WAYPOINT_VAULT/projects/roof-repair.md"
```

Open the project view and select it.

**Expect**: it opens with no error. Outcome, milestones, next action, and DRI are each shown as *not yet
set* rather than hidden. Nothing prompts for them. The project is flagged as needing structure, and the
flag names outcome, milestones, and next action specifically (FR-022, FR-026).

**Then**: set only the outcome and close the app. Reopen.

**Expect**: the outcome persisted with no save step (FR-030), the other three are still empty, and the file
now has a `## Outcome` section with `status: active` untouched above it.

---

## 2. Opening a project produces no diff (FR-045, SC-014, research R3)

With the vault under git:

```bash
cd "$WAYPOINT_VAULT" && git init -q && git add -A && git commit -qm baseline
```

Open several projects in the app — including a hand-shaped one with a `## Notes` section, an unknown
`priority: high` preamble key, and `## Milestones` placed above `## Outcome`. Close without editing.

```bash
git status --porcelain      # expect: empty
```

**Expect**: no output. Reading never rewrites, reorders, or normalizes. This is the single most important
regression test in the feature.

---

## 3. Partial structure, added over four sessions (US1, SC-001)

Add one field per session, quitting the app between each: outcome → one milestone with a verifier → next
action → DRI.

**Expect**: every intermediate state saves and reopens cleanly, no session demands a field the user did not
choose to supply, and the file is readable in a text editor at every step (SC-002).

**Also expect**: after the single milestone is added, the project is **not** warned about for having fewer
than two (FR-013a). It stops being flagged only once outcome, at least one milestone, and a next action are
all present (FR-018, FR-023).

---

## 4. The milestone cap (FR-013, SC-008a)

Add milestones one at a time to a project, checking after each.

**Expect**: the first four are accepted without objection. The fifth is refused with an explanation naming
the cap; all four existing milestones are unchanged. Removing one and adding a different one works.

**Then**, by hand:

```bash
# append two extra milestones directly to the file, taking it to six
```

**Expect**: reopening shows all six. None is deleted, hidden, or truncated (FR-013b). Only *adding* through
the app is refused.

---

## 5. Milestone completion stays visible, with dates (US2, SC-008, SC-009)

On a project with four milestones, mark two done.

**Expect**: both remain visible alongside the two open ones — never hidden or moved (FR-035). The project
reports **2 of 4 done** (FR-017). No date was prompted for (FR-033). The file reads:

```markdown
- [x] Estimate approved by insurer — @Priya — done 2026-08-14
- [ ] Materials delivered on site — @me
```

**Then**: edit the definition of done on the completed milestone.

**Expect**: its `done` date is unchanged (FR-037, SC-011).

**Then**: un-mark it.

**Expect**: it returns to `[ ]`, the ` — done <date>` is gone, and progress reads 1 of 4 (FR-036).

---

## 6. Completing a project with open milestones (US2, FR-034a–d, SC-009a)

With two of four milestones done, mark the project done.

**Expect**: a confirmation naming the two still-open milestones — *not* a refusal (FR-034a).

**Decline it.** Expect: status unchanged, no `completed:` line written, no milestone altered, and
`git diff` empty.

**Confirm it.** Expect: `completed: YYYY-MM-DD` in the preamble, the project gone from the active list
(FR-032), and the two open milestones still `[ ]` with no date invented for them (FR-034b).

**Separately**: on a project whose milestones are all done — and on a project with none at all — marking it
done completes immediately with no confirmation (FR-034d). On a project missing its outcome, completing it
also raises no confirmation, because the structure flag never gates anything (FR-034e, FR-019).

---

## 7. Reopening (FR-036, FR-039, SC-012)

Set the done project's status back to active.

**Expect**: it reappears in the active list immediately, its `completed:` line is gone, and every milestone
`done` date is untouched. Completing it again on a later date records the new date.

---

## 8. Incomplete projects are visible at a glance (US3, SC-004, SC-007)

Create projects covering every combination: missing outcome only, missing milestones only, missing next
action only, several missing, and one fully structured with and without a DRI.

**Expect**: the project list flags exactly the incomplete ones — no false flags, no misses — visible without
opening any of them. The fully structured project with no DRI is **not** flagged (FR-009, SC-005).

**Then**: while the app is closed, delete the `next action:` line from a project with a text editor. Reopen.

**Expect**: it is now flagged. The flag is computed from the file, so a hand-edit keeps it accurate with the
app uninvolved (FR-020, research R5).

---

## 9. Every operation works on a flagged project (US3, FR-019, SC-006)

On a bare stub: edit fields, add and complete a milestone, change status, mark it done.

**Expect**: all succeed exactly as on a fully structured project. Zero operations blocked, gated, or given a
confirmation an unflagged project would not also get.

---

## 10. Hand-edit conflict handling (FR-045a–e, SC-014a)

With a project open in the app:

```bash
# in a text editor, change the outcome line and save
```

Now save an outcome edit in the app.

**Expect**: refused. Nothing written, the file byte-for-byte unchanged, the user told what the outcome now
says, and the project re-presented as it currently reads (FR-045b). Not an error state — no retry queue,
no pending write (FR-045e).

**Then**, the other direction: with the project open, change the **DRI** by hand, then save an **outcome**
edit in the app.

**Expect**: the outcome write succeeds *and* the hand-edited DRI survives. An unrelated change does not
cancel the write (FR-045c) — this is the half of the rule that keeps refusals honest.

**Then**: edit milestone 2 by hand, then complete milestone 1 in the app. Expect: succeeds. Each milestone
is its own verification unit (FR-045d).

---

## 11. Unprocessed items: shown, dismissable, never converted (FR-046a–e, SC-003a)

On a project carrying three items under `## Unprocessed` from sort:

**Expect**: all three are visible alongside the fields. None has been auto-filled into an outcome,
milestone, or next action (FR-046c).

Read one, type what it meant into a milestone by hand, then dismiss that item.

**Expect**: it is removed from the project, the other two remain in order, and the dismissed item is
findable in `trash.md` with its original text and capture timestamp intact (FR-046d).

```bash
tail -3 "$WAYPOINT_VAULT/trash.md"
```

**Then**: dismiss the last two. Expect: the empty `## Unprocessed` section is not an error and does not
affect the structure flag (FR-046e).

---

## 12. Areas stay ongoing and unstructured (US4, SC-013)

Open an area.

**Expect**: a title and a status, and nowhere in the interface an outcome, milestone, next action, DRI, or
any way to mark it complete (FR-040). Changing its status offers exactly two choices — active and parked
(FR-041). It is never flagged as needing structure, however long it exists (FR-024).

**Then**, by hand: set `status: done` on an area file and add a `## Milestones` section. Reopen.

**Expect**: the status is displayed as it reads and not silently rewritten, the app still offers only the
two (FR-041c), and the milestone content is preserved and ignored rather than adopted — it is still an area
(FR-043).

---

## 13. Open views reflect writes (research R7)

With the projects window open, complete a milestone from another view (or trigger any write).

**Expect**: the window reflects it without being closed and reopened, and whatever the user was typing into
a field is not thrown away.

**Known limit, verified deliberately**: a hand-edit made in a text editor while the window is open is *not*
reflected until the window is reopened. There is no filesystem watch. The subsequent write is refused
rather than destructive (scenario 10), which is the guarantee that actually protects the file.

---

## 14. Offline (FR-047, SC-015)

Disconnect the network entirely and run scenarios 1, 5, 6, and 11.

**Expect**: all pass unchanged. Nothing in this feature has a network code path to lose.

---

## 15. Nothing is suggested (FR-048, SC-016)

Through every path above.

**Expect**: no generated, suggested, ranked, or pre-filled outcome, milestone, next action, DRI, or
verifier appears at any point. Every stored value traces to an explicit keystroke.

---

## Out of scope — do not expect these to work

The weekly review ritual (Feature 5), the top-three / WIP limit (Feature 4), the retrospective date-range
view (later — this feature only guarantees the dates it will read are present and parseable), the local
HTTP API (Feature 7), and any AI-assisted structuring, including automatic conversion of an unprocessed
item into a milestone (Feature 8, FR-046c).
