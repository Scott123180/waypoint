# Phase 0 Research: Projects with Milestones

**Feature**: 003-project-structure | **Date**: 2026-08-12

Decisions taken before design, with the reasoning that produced them. Anything marked NEEDS
CLARIFICATION in the Technical Context is resolved here.

The dominant constraint on this feature is not logic — the rules are simple — it is **format**. Feature 2
already shipped stub files into users' vaults, and Feature 5 (weekly review) and the eventual retrospective
view will read whatever this feature writes. The format is the part that is expensive to change later.

---

## R1 — Where project structure lives inside the file

**Decision**: Extend Feature 2's stub in place. Short, atomic fields become `key: value` lines in the
preamble beside the existing `status: active`; prose and repeating structure become `##` sections:

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

**Rationale**: A stub written by sort last week is *already* a valid instance of this format — it simply has
no optional fields and no sections yet. Nothing migrates, nothing is rewritten on read, and a user who
never opens this feature's UI sees their files unchanged. That is the explicit requirement (FR-005, and the
plan input's "adding fields must not require rewriting existing files").

The split between preamble lines and sections is not cosmetic. `status`, `next action`, `dri`, and
`completed` are single-value, single-line facts — `key: value` is the smallest thing that holds them and it
matches the one line Feature 2 already writes. Outcome is prose the user may want two sentences and a line
break for, and milestones are a repeating record with four fields each; both need room a `key: value` line
cannot give without inventing an escaping rule.

**Alternatives considered**:

- *YAML frontmatter* (`---` fenced block at the top). The obvious "structured metadata" answer, and
  permitted by Principle IV. **Rejected because it forces a migration**: every existing stub has
  `status: active` as a bare line *after* the `#` heading, so adopting frontmatter means rewriting every
  file already in the vault to move it. It would also demand a YAML parser — either a new dependency, which
  the plan input forbids, or a hand-rolled subset, which is a parser with strictly more failure modes than
  the one we need.
- *Everything as `##` sections*, including status and DRI. Uniform, but it turns a stub into a file with
  five near-empty headings, and Feature 2 deliberately refused to write empty placeholders (FR-009 there,
  FR-026 here says show them as unset in the *view*, not in the file).
- *A sidecar index* (`projects.json`) holding structure while the markdown holds prose. Rejected outright:
  it makes the markdown no longer the source of truth, which is the whole of Principle IV, and creates a
  desync the user cannot see or repair by hand.

**Consequence**: The parser must tolerate any ordering and any unknown content, because the user is invited
to hand-edit. See R3.

---

## R2 — The milestone line format

**Decision**: One GFM task-list line per milestone, with trailing tagged fields separated by ` — `:

```text
- [x] <definition of done> — @<verifier> — done <YYYY-MM-DD>
- [ ] <definition of done> — @<verifier>
- [ ] <definition of done>
```

Fields are parsed **right-to-left**: strip a trailing `— done <date>` if present, then a trailing
`— @<verifier>` if present; everything remaining after `- [ ] ` is the definition of done, verbatim.

**Rationale**: The checkbox is the done state, and it is the one piece of markdown syntax that renders as a
checkbox in every viewer the user might open the file in, and is edited by hand by typing one character.
The `@name` and ` — ` conventions are lifted directly from `waiting.md`, which Feature 2 shipped — the user
has already learned that `@` means a person and ` — ` separates fields.

Right-to-left parsing is what makes a definition of done that happens to contain ` — ` or an `@` safe. The
tail patterns are strict (`— done ` followed by exactly a date; `— @` followed by a non-empty token to end
of line), so ordinary prose does not accidentally match, and anything that fails to match is simply part of
the definition of done rather than an error.

**Alternatives considered**:

- *A nested sub-list per milestone* (`- Estimate approved` with indented `- verifier: Priya`). More
  obviously structured, but four lines per milestone turns a four-milestone project into sixteen lines of
  mostly labels, and hand-editing gets fussy about indentation.
- *`verifier:` instead of `@`* — clearer in isolation, inconsistent with the `waiting.md` the same user
  already reads. Vocabulary consistency is Principle VII, and it applies to the files as much as the UI.
- *A stable id per milestone* (`<!-- id: 7f3a -->`). Would make edit-targeting exact. Rejected: it puts
  machine bookkeeping into a file whose entire promise is that a human can read and edit it. Identity is
  solved instead by position-plus-text verification (R4), which costs the user nothing.

**Consequence**: A milestone has no durable identity across a hand-edit that rewords it. That is the
correct behaviour here — a reworded milestone *should* fail verification rather than be silently written
over (FR-045b).

---

## R3 — Lenient read, surgical write

**Decision**: Parsing never fails. Unrecognized lines, unknown `key: value` pairs, unknown `##` sections,
and malformed milestone lines are all carried through untouched. A field that is absent or unparseable
reads as **not set**. Writing is read-modify-write of the whole file through the existing atomic
`VaultStore.write`, but only the lines belonging to the field being changed are altered; every other byte
is reproduced exactly.

**Rationale**: FR-045 requires it, but the deeper reason is that the vault is git-tracked. A read that
reformats — normalizing whitespace, reordering keys, rewrapping prose — turns every app open into a diff,
and the user stops trusting `git status` to mean something. The test for this is byte equality on a
round-trip through parse-and-render with no edit, and it is worth writing first.

**Alternatives considered**:

- *Parse strictly and refuse to open a malformed file.* Rejected: it hands the user a file the app will not
  open and no way to know which line offended it, in a format whose selling point is that they can edit it.
- *Normalize on read* (canonical field order, canonical spacing). Tempting for a clean format, and rejected
  for the git-noise reason above. New content this feature writes is canonical; existing content is left as
  found.

**Consequence**: Section insertion needs an ordering rule for content the app adds. New sections are
inserted **before `## Unprocessed`** when it exists, else appended — keeping raw material from sort at the
bottom, below the structure it is meant to become. This mirrors and reuses the boundary-detection already
in `vault/unprocessed.ts`.

---

## R4 — Verifying a field before writing it

**Decision**: Every mutating verb takes the value the caller believes is current, and refuses if the file
now says something else.

- Scalar fields (outcome, next action, DRI, status): the caller passes `expected: string | null`. The
  service re-reads, re-parses, compares that one field, and returns a `field-changed` refusal without
  writing if it differs.
- Milestones: identity is a `MilestoneRef { index, raw }` — the position plus the milestone's full line
  exactly as the caller was shown it. A milestone whose line no longer matches at that index refuses.

Refusals are **values, not exceptions**, matching `SortOutcome`.

**Rationale**: This is Feature 2's verify-before-write narrowed from a whole item to a single field, which
is exactly what the spec's clarification chose (FR-045a–e). `MilestoneRef` is the deliberate analogue of
`ItemRef { start, end, raw }`: sort identifies an item by where it is plus what it says, because the file
is the only account of the truth. The same reasoning applies here, with an index standing in for a byte
range because milestones move as siblings are edited.

Field-level granularity is what makes the guarantee usable. Whole-file verification would cancel an outcome
edit because the DRI changed in a text editor — a refusal the user cannot act on and would learn to click
past.

**Alternatives considered**:

- *Content hash of the whole file* as an optimistic-concurrency token. Simple to implement, and it is
  precisely the whole-file behaviour the clarification rejected.
- *Last-write-wins.* Cheapest, and it silently destroys a deliberate hand-edit. The vault is a git-tracked
  directory the user is invited to edit; overwriting them there is the one unforgivable bug in a plain-text
  tool.
- *File locking.* Cannot work — the competing writer is a text editor that does not participate.

---

## R5 — The incomplete flag is computed, never stored

**Decision**: A pure function over a parsed project returns which of `outcome`, `milestones`, `next-action`
are missing. Nothing is written to the file, and nothing is cached.

**Rationale**: A stored flag is a second copy of a fact that already exists in the fields themselves, and
the two would diverge the first time the user edited the file in vim — which is the exact scenario this
project's data model exists to support. Deriving it also makes it free for Feature 5's review to ask the
same question and get the same answer, with no risk of the review and the UI disagreeing.

This is the same reasoning that made `SortService.isEmpty()` a computation over `inbox.md` rather than a
tracked counter (FR-028 in Feature 2).

**Alternatives considered**: none seriously. Storing it was never a candidate; it is recorded here because
it is a requirement (FR-020) and the plan input calls it out specifically.

---

## R6 — No new ports are needed

**Decision**: `VaultStore` as it exists — `list`, `read`, `write`, `appendLine` — is the complete I/O
surface this feature requires. No port is added, no port is changed, and no adapter is rewritten.

**Rationale**: Worth stating explicitly because it is a strong signal that Feature 2 drew the boundary in
the right place. `VaultStore` deliberately has no concept of a destination; it moves bytes to a
vault-relative path. Project structure is bytes at `projects/<slug>.md`, milestone completion is bytes at
the same path, and dismissing an unprocessed item to trash is `appendLine("trash.md", …)` — the same call
sort already makes. The existing `FsVaultStore` and `FakeVaultStore` are reused unchanged, which means the
whole feature is testable on day one with no adapter work.

**Consequence**: The only new plumbing in the desktop package is presentation — a window, IPC pass-throughs,
and a renderer.

---

## R7 — How an open view learns the file changed

**Decision**: A `VaultChanged` emitter in the desktop main process, identical in shape to Feature 2's
`InboxChanged`: no payload, no cause, raised after a write has landed. The projects window re-reads on
`show()` and on `vault:changed`. **No filesystem watching is added.**

**Rationale**: The plan input asks for Feature 2's open-view behaviour, and this is it, including its
limitation. `InboxChanged`'s doc comment states the design directly — the signal reports the fact, never the
writer — so a future writer (the local API in Feature 6, the LLM layer in Feature 7) needs no new plumbing
and no view needs to learn it exists.

A separate emitter rather than reusing `InboxChanged` because the two fire on genuinely different events:
`InboxChanged` fires on every capture, which for a projects window is noise that would trigger a full
re-read each time the user jots a thought. Both are generic with respect to *cause*, which is what the
requirement is about; they differ in *subject*, which is what makes them useful.

`fs.watch` is deliberately not added. It is real machinery with real cross-platform behaviour differences,
and it would only narrow — not close — the hand-edit window, because FR-045a's verification is what actually
protects the user and it runs at write time regardless. Feature 2 made the same call for the same reason.

**Consequence**: An edit made in a text editor while the projects window is open is not reflected until the
window is reopened or something in-process writes. The write that follows is still refused rather than
destructive (R4), which is the guarantee that matters. This is named here rather than left implicit.

---

## R8 — Marking a project done with open milestones is a core rule

**Decision**: `complete()` returns a refusal — `{ ok: false, reason: "open-milestones", open: [...] }` —
unless called with an explicit confirmation flag. The names of the open milestones come back in the
refusal so the client has nothing to compute.

**Rationale**: FR-034a is a process rule, and Principle V says process rules live in the core where a
client cannot skip them. Putting the confirmation in the renderer would make it a convention that the
Feature 6 HTTP API and the Feature 7 LLM layer would each have to remember to reimplement — and the LLM
layer is exactly the caller that should not be able to close projects quietly.

Returning the refusal as a value rather than throwing matches `SortOutcome`: a refusal here is an expected
branch the caller renders, not an error.

**Alternatives considered**:

- *A `force: boolean` parameter with no refusal path.* The client would have to know to ask first, which is
  the same as not enforcing it.
- *Refuse outright* (no confirmation path). Rejected by the spec clarification, and correctly: the user
  would route around it by deleting the milestone, destroying its record.

The same shape covers the milestone cap: `addMilestone` refuses with `reason: "milestone-cap"` at four
(FR-013). Parsing imposes no cap, so a hand-written sixth milestone is displayed rather than truncated
(FR-013b).

---

## R9 — Dismissing an unprocessed item touches two files, without a journal

**Decision**: Append the item to `trash.md` first, then rewrite the project file without it. No write-ahead
journal.

**Rationale**: The ordering is Feature 2's — write the destination before removing the source, so the
failure mode is a duplicate rather than a loss. The journal is deliberately *not* reused here, and that is
the trade-off worth stating: sort needed it because a duplicated inbox item corrupts inbox zero, which
Feature 5's review gates on, so a transient duplicate there is a real defect. An unprocessed item that
survives a crash is a line the user sees and dismisses again, with a spare trash line as the only residue.

Adding the journal would be maybe forty lines and a startup recovery hook for a failure window of a few
milliseconds whose worst outcome is one duplicate line in an append-only file nobody reads. That is the
kind of machinery that pays for itself in sort and does not pay for itself here.

**Consequence**: A crash between the two writes leaves the item in both the project and `trash.md`. Named
as an accepted outcome, not an oversight.

---

## R10 — Dates

**Decision**: Reuse `localDate()` from `vault/lists.ts` — `YYYY-MM-DD` in the user's local timezone —
for both `completed:` on a project and `— done <date>` on a milestone. The `Clock` port supplies the time,
so tests are deterministic.

**Rationale**: Already the format in `waiting.md`, `calendar.md`, and `trash.md`, already local-time for the
stated reason that a day boundary belongs to the user's day rather than UTC's, and already implemented and
tested. A retrospective view (post-Feature 8) reads completed work over a date range by scanning
`projects/*.md` for these two fields — no index, nothing to fall out of sync, which is what SC-010 asks for.

Date-level granularity, not timestamps: the spec asks what got finished in March, and a wall-clock date is
what the user means by the day they finished something.

---

## R11 — Test strategy

**Decision**: `node:test` with the existing `FakeVaultStore` for everything in core; real-filesystem tests
in `packages/desktop/tests` only where the adapter is genuinely exercised; Playwright `_electron` for the
project view end to end. Format round-trip and byte-preservation tests are written first, before any
service verb.

**Rationale**: R6 means no new adapters, so the interesting surface is entirely pure functions over strings
plus a service over a fake — the fast suite covers essentially the whole feature. The highest-risk code is
the parser and renderer, and both are pure, so test-first is genuinely cheap here (Principle I).

macOS artifacts continue to come only from the GitHub Actions macOS runner per the ROADMAP build-machine
rule; nothing in this feature changes the build or adds a dependency to install.
