# Quickstart: Validating Inbox View & Sort

**Feature**: 002-inbox-view-sort | **Date**: 2026-08-11

How to run the feature and prove it actually works. Scenario numbers map to the acceptance scenarios in
[spec.md](spec.md).

---

## Prerequisites

| Requirement | Note |
|---|---|
| **Node 22 LTS via nvm** | Run `nvm use` in the repo — `.nvmrc` pins it. The system `node` on PATH is 18.19.1 (EOL); a shell that hasn't sourced nvm picks up the wrong version. |
| Linux x64 dev machine | Per ROADMAP, all development happens here. The work MacBook never compiles or installs. |
| Feature 1 built | Sort reads what capture writes. `npm run build` covers both. |

```bash
npm install     # no new dependencies were added by this feature
```

No microphone, no model, no network. Sort has no external anything.

**Use a scratch vault.** Every scenario below writes real files, and you do not want them landing in your
real one.

There is no `WAYPOINT_VAULT` environment variable — `vaultRoot` is derived from `inboxPath` (research R8a),
and the only env hook is `WAYPOINT_CONFIG_PATH`, the same one the E2E harness uses. Point the app at a
throwaway config:

```bash
export VAULT=/tmp/waypoint-sort-check
rm -rf "$VAULT" && mkdir -p "$VAULT"

export WAYPOINT_CONFIG_PATH="$VAULT/config.json"
cat > "$WAYPOINT_CONFIG_PATH" <<JSON
{ "inboxPath": "$VAULT/inbox.md" }
JSON
```

Everything else — `projects/`, `areas/`, `waiting.md`, `calendar.md`, `trash.md` — is derived from that
inbox's directory, so this one setting relocates the whole vault.

---

## Run the test suite (this is the primary gate)

TDD is mandatory (Principle I), so the suite is the real acceptance check. The manual scenarios below only
confirm the pieces are wired together on a real desktop.

```bash
npm test                  # core unit + contract tests (node:test, fast)
npm run test:e2e          # Playwright _electron desktop tests
```

Expected: core tests stay well under a second. The parser, slug, section-insertion, and journal-replay
tests are all pure functions over strings, so there is no reason for this suite to get slow.

---

## Seed an inbox worth sorting

Deliberately mixed: captured items, a hand-written line, a multi-line item, a blank line, and multi-byte
text. This is the file the scenarios below assume.

```bash
cat > "$VAULT/inbox.md" <<'EOF'
- 2026-08-09T14:23:05-04:00 Call the roofer back about the estimate
Buy milk
- 2026-08-09T14:31:12-04:00 Ask Priya whether the migration window moved,
  and tell the on-call rotation before Friday.

- 2026-08-09T15:02:44-04:00 Book flights for the March offsite ✈️
## Someday
EOF
```

That is **five** routable items — the blank line is not one, and the two-space line continues the item
above it (see [contracts/inbox-parse.md](contracts/inbox-parse.md)).

```bash
npm run dev    # then open the sort view
```

---

## 1. One at a time, in file order (US1 §1, §2)

Open the sort view.

- **Expect**: exactly one item shown — `Call the roofer back about the estimate` — with its capture
  timestamp, and exactly five destination choices.
- **Expect**: no second item visible anywhere, and no way to advance without deciding (FR-002, FR-004).

## 2. Route to waiting-for and calendar (US1 §4, §5)

Route the first item to **waiting-for**, owner `roofer`. Route the next (`Buy milk`) to **calendar**.

```bash
cat "$VAULT/waiting.md" "$VAULT/calendar.md"
```

- **Expect** in `waiting.md`: today's date, `@roofer`, the original capture timestamp, the text.
- **Expect** in `calendar.md`: today's date as the flag date and **no timestamp** on the `Buy milk` line —
  it was hand-written and none is invented (FR-027a).
- **Expect**: you were never prompted for an event date or time (FR-017).
- **Expect**: both items gone from `inbox.md`, everything else byte-identical.

## 3. Multi-line items move whole (US1 §8)

Route the Priya item to **trash**.

```bash
cat "$VAULT/trash.md"
grep -c "on-call rotation" "$VAULT/inbox.md"   # expect 0
```

- **Expect**: both lines of the item in `trash.md`, the continuation still indented.
- **Expect**: the blank line that followed it still in `inbox.md`, untouched.
- **Expect**: the item is recoverable by reading the file — trash is a soft delete (FR-016).

## 4. Emptiness is computed from the file, not remembered

While the sort view is open on an item, in another terminal:

```bash
echo "- 2026-08-11T10:00:00-04:00 Snuck this in by hand" >> "$VAULT/inbox.md"
```

Decide the current item, then look at the next.

- **Expect**: the hand-appended item appears in the queue without a restart (FR-025).

## 5. Create a project on the spot (US2 §1, §2, §4)

Route the offsite item to a **project** that does not exist, titling it `March offsite`.

```bash
cat "$VAULT/projects/march-offsite.md"
```

- **Expect**: `# March offsite`, `status: active`, `## Unprocessed`, and the item with its timestamp and
  its emoji intact.
- **Expect**: you were asked for a title and nothing else — no outcome, milestone, next action, or DRI
  (FR-009).

Now try the duplicate and empty cases on the remaining `## Someday` item:

- Create a project titled `  march  OFFSITE  ` → **expect** it routes into the existing
  `march-offsite.md`, and no second file appears (FR-012).
- Submit an empty title → **expect** nothing is created, the item stays in the inbox, and the field stays
  open (FR-011).

## 6. Inbox zero (US3 §3, §4)

Sort until nothing is left.

```bash
cat "$VAULT/inbox.md"     # expect empty, or only blank lines
```

- **Expect**: the empty state, with no destination choices offered (FR-026).
- **Expect**: `## Someday` was routable like anything else — a hand-organized heading is still text to
  decide about (clarify Q2).

## 7. Stop and resume (US3 §1, §2)

Re-seed the inbox, sort two items, then quit the app hard:

```bash
pkill -f "electron.*waypoint"
```

Relaunch.

- **Expect**: both decisions still in their destination files — no save step existed to miss (FR-024).
- **Expect**: sorting resumes at the third item, and the first two are not shown again (FR-025).

## 8. Hand-edit under a live decision (FR-020a, FR-020b)

Open the sort view on an item. Before deciding, in another terminal, reword **that exact line** in
`inbox.md`. Now make a decision.

- **Expect**: the decision is refused with an explanation, and the item is re-presented as it now reads.
- **Expect**: `git diff` in the vault shows **nothing** was written — no destination file changed, no
  journal entry left behind.

This is the scenario worth doing by hand at least once. It is the difference between a sort that respects
a file the user is editing and one that clobbers it.

## 9. Crash recovery (SC-005)

Simulated in tests rather than by hand, because the interesting part is the decision table, not the kill
signal (see [research.md](research.md) R10):

```bash
npm test -- --grep "journal"
```

- **Expect**: a case for a crash at each of the four commit steps, each ending with the item in exactly
  one place.
- **Expect**: a case where recovery runs twice, proving it is idempotent.

For the honest end-to-end version, scenario 7's hard kill covers it.

## 10. Offline (FR-031, SC-008)

Disconnect the network entirely and repeat scenarios 1–6.

- **Expect**: no behavioural difference of any kind. Nothing in sort has a network path to lose.

## 11. Nothing is suggested (FR-030, SC-007)

Throughout every scenario above:

- **Expect**: no destination is ever pre-selected, highlighted, ranked, or reordered by likelihood.
- **Expect**: the destination list appears in the order the core returned it, every time.

---

## Reading the result with no application running

The real acceptance test for Principle IV — close the app entirely and:

```bash
ls -R "$VAULT"
grep -r "roofer" "$VAULT"
```

Every sorted thought is findable, readable, and editable in a plain text editor, in a directory the user
can put under git. If that is not true, the feature has failed regardless of what the tests say.
