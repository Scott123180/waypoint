# Quickstart: LLM-Assisted Inbox Organization

**Feature**: 008-llm-assisted-inbox-organization

Runnable scenarios that prove the feature works and, more importantly, that it is not there when it should not
be. Scenario 1 is the one to run first and the one to run last: it proves shipping this feature changed
nothing for a user who never configures it.

**Prerequisites**: Node 22 (`nvm use`), `npm ci`, `npm run build`. A scratch vault at `$VAULT` — never a real
one; several scenarios assert files are byte-identical afterwards.

---

## 1 — The shipped state: nothing is there

No `intelligence.md`, no network, no configuration.

```bash
export VAULT=$(mktemp -d)
printf -- '- 2026-08-17T09:14:22-04:00 call the roofer about the estimate\n' > "$VAULT/inbox.md"
mkdir -p "$VAULT/projects" && printf '# Roof repair\n\nstatus: active\n' > "$VAULT/projects/roof-repair.md"
sha256sum "$VAULT/inbox.md" > /tmp/before.sha

npm run dev   # sort the item to the project, by hand
sha256sum -c /tmp/before.sha 2>/dev/null; echo "(expected to differ — the item was sorted)"
```

**Expect**: the sort walk is exactly Feature 2's. No suggestion control, no greyed-out button, no
"configure a model" prompt, no error, nothing in the menu. `window.waypoint.suggest` is `undefined` in the
sort window's devtools console.

**And the automated form, which is the real test** (FR-060, SC-001):

```bash
npm run test:core   # Feature 2's entire sort suite runs unmodified in this configuration
```

---

## 2 — Turn it on for a command-line tool

```bash
cat > "$VAULT/intelligence.md" <<'EOF'
# Intelligence

transport: command
command: claude

## Arguments

- -p
- --output-format
- text
EOF
```

**Expect**: relaunching, the sort window now offers *Split* and *Where does this go?* on the item in front of
you. Nothing has been sent yet.

---

## 3 — See exactly what would be sent, before it is sent

Ask for a split. The panel shows the request content in full before anything leaves the machine.

**Expect** (FR-041, FR-042): the item's own text and its numbered segments. Nothing about another inbox item,
nothing from `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, or `log/`.

Plant markers and check by hand:

```bash
printf 'me: MARKER-IDENTITY\n' > "$VAULT/identity.md"
printf 'wip limit: 3\n# MARKER-POLICY\n' > "$VAULT/policy.md"
printf -- '- 2020-01-01 — MARKER-TRASH\n' > "$VAULT/trash.md"
printf -- '- 2026-08-17T09:15:00-04:00 MARKER-OTHER-ITEM\n' >> "$VAULT/inbox.md"
```

Ask again. **Expect**: no `MARKER-` string appears anywhere in the preview.

---

## 4 — Untangle a rambling capture

```bash
printf -- '- 2026-08-17T09:14:22-04:00 ok so the hiring req, no wait, the req for the backend role, I need to get that written up. Also dentist, Thursday I think. And the deploy pipeline keeps timing out on the migration step.\n' > "$VAULT/inbox.md"
```

Ask for a split.

**Expect** (FR-010, FR-010a, FR-012, FR-016):

- Three pieces, each shown in full, each made of the words you actually dictated — stutters and all. Nothing
  is reworded.
- The two hiring false starts are one piece.
- You can edit any piece's text and delete a piece before accepting.
- Accepting replaces the one item with three, **in the same place in the file**, each carrying
  `2026-08-17T09:14:22-04:00` — the original's capture time, not now.

```bash
cat "$VAULT/inbox.md"   # three items, indistinguishable from hand-typed ones
```

Then reject a split instead:

```bash
sha256sum "$VAULT/inbox.md" > /tmp/before.sha
# ask for a split, then reject it
sha256sum -c /tmp/before.sha    # must pass (FR-017)
```

---

## 5 — Nothing dictated is dropped silently

Ask for a split, then delete one piece before accepting.

**Expect** (FR-013): before the accept completes, the text that no remaining piece carries is shown, marked as
not carried into any piece. You can put it back, or accept knowing what goes.

Delete every piece and try to accept. **Expect** (FR-019): refused, original intact.

---

## 6 — Ask where something belongs

```bash
mkdir -p "$VAULT/projects" "$VAULT/areas"
cat > "$VAULT/projects/vendor-consolidation.md" <<'EOF'
# Vendor Consolidation

status: active

## Outcome

Every vendor contract renewed or ended by Q4, with one owner named for each.
EOF
printf '# Home\n\nstatus: active\n' > "$VAULT/areas/home.md"
printf -- '- 2026-08-17T10:00:00-04:00 chase Priya about the vendor contract before the board pack goes out\n' > "$VAULT/inbox.md"
```

Ask where it belongs.

**Expect** (FR-020–FR-025): one destination proposed, with a brief reason. If waiting-for, an editable owner
field pre-filled with `Priya`. If a project or area, one that **exists** — check the preview: it carried
*Vendor Consolidation* with its outcome line, and *Home* with its title alone. No milestones, next action,
DRI, status, or ledger.

Accept, then confirm the result is exactly what sorting by hand produces:

```bash
cat "$VAULT/waiting.md"     # or the project's ## Unprocessed section
```

**Expect** (FR-032): nothing anywhere records that a machine proposed it.

Now create a project by hand in another window while the proposal is on screen, and ask again. **Expect**
(FR-024): the new project is among those that can be proposed, with no restart.

---

## 7 — Switch to the work machine, by changing one setting

```bash
cat > "$VAULT/intelligence.md" <<'EOF'
# Intelligence

transport: certificate
endpoint: https://llm.corp.example/v1/messages
certificate: /home/me/.certs/waypoint-client.pem
key: /home/me/.certs/waypoint-client.key
EOF
```

**Expect** (FR-050, FR-053, SC-009): everything about asking, previewing, editing, and accepting is identical.
Only the way the request travels changed. No other file in the vault changed.

```bash
git -C "$VAULT" status --short   # only intelligence.md
grep -rIl 'PRIVATE KEY' "$VAULT" ; echo "exit $? — expected 1: no key material in the vault (FR-051b)"
```

---

## 8 — Every way it can fail, and what you see

| Make it fail | Expect |
|---|---|
| Delete `intelligence.md` | No controls at all. Not an error. (`not-configured`) |
| `transport: copilot` | One message naming `copilot` and saying `command` and `certificate` are what work. Sorting untouched. (`misconfigured`) |
| `certificate:` pointing at a path that does not exist | One message naming **the path** and the problem — never the material. (`credential`) |
| `command: definitely-not-installed` | One message. The item is sortable by hand immediately. (`unreachable`) |
| A command that exits non-zero | One message with the last stderr line. (`failed`) |
| A command that hangs | Abandoned at 120 seconds, or by you at any moment. (`timed-out`) |
| A command printing `not json` | Treated as a failure. **No partial proposal is shown.** (`unusable`) |

For each, before and after:

```bash
find "$VAULT" -type f -exec sha256sum {} + | sort > /tmp/before.txt
# provoke the failure
find "$VAULT" -type f -exec sha256sum {} + | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "unchanged (FR-063, SC-008)"
```

**Expect** in every row: the data directory is unchanged, exactly one message appears, **no automatic retry
occurs**, and the ordinary sort path works immediately.

---

## 9 — It never probes

```bash
rm -f "$VAULT/intelligence.md"
# with `claude` on PATH and a local model listening on 11434
npm run dev
```

**Expect** (FR-052): the layer is **off**. Nothing was detected, nothing was tried, no control appeared.

---

## 10 — Nothing leaves the machine when nothing is configured

```bash
rm -f "$VAULT/intelligence.md"
sudo tcpdump -i any -n 'not port 22' -w /tmp/cap.pcap &   # or: run with networking disabled
npm run dev    # sort the whole inbox
```

**Expect** (FR-040, SC-002): zero packets attributable to Waypoint. The automated form asserts it against
doubles rather than a capture — `globalThis.fetch` and `spawn` replaced with recorders that throw, the
technique `review-no-outbound.test.ts` established.

---

## 11 — Both transports, one suite

```bash
npm test     # includes the parity suite, run twice against fixtures
```

**Expect** (SC-009): identical proposals from identical stubbed responses, with only the configured value
differing between runs. The fixtures are `fake-llm-cli.sh` (shaped like `fake-whisper-cli.sh`) and a local
HTTPS server whose key material is generated at run time in a temp directory — so the suite proves the
transport works with material the running platform produced, not with a fixture committed from one machine.

---

## 12 — Both platforms

```bash
npm test                     # Linux
# and the macOS runner in GitHub Actions, which already produces the release artifacts
```

**Expect** (research R19): both transports pass on both. The command transport touches subprocess handling and
the certificate transport touches platform TLS; neither is assumed to be portable.

---

---

## Verification record — Linux, 2026-08-17 (task T075)

Every scenario was exercised. Most are now automated, which is the outcome to want from a quickstart: the
scenarios that could be turned into tests were, and the entry below says which file holds each one, so a
future reader runs the suite rather than re-deriving these by hand.

| # | Scenario | How it was verified | Result |
|---|---|---|---|
| 1 | The shipped state: nothing is there | `e2e/suggest-absent.spec.ts` (8 tests) and `degrade-to-nothing.test.ts` | **Pass.** `window.waypoint.suggest` is `undefined`; no `#to-split`, `#to-where`, `#preview`, or `#proposal` exists in the document at all. The 187 pre-existing test files run unmodified, 1646 tests, zero failures |
| 2 | Turn it on for a command-line tool | `intelligence-config.test.ts`; all `suggest-*` e2e specs configure exactly this way | **Pass.** Relaunching offers *Split this up* and *Where does this go?*, and nothing has been sent |
| 3 | See exactly what would be sent | `e2e/suggest-preview.spec.ts` (7 tests), `suggest-preview-boundary.test.ts`, `suggest-preview-identity.test.ts` | **Pass.** Thirteen markers planted across `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, `log/`, a sibling inbox item, and a project's DRI, next action, milestone, unprocessed item and ledger — none appears in either preview |
| 4 | Untangle a rambling capture | `e2e/suggest-split.spec.ts` (11 tests), `split-verbatim.test.ts` (21-proposal corpus) | **Pass.** Three pieces, each verbatim, the two hiring false starts together; accepting writes three items in the original's place, each carrying `2026-08-17T09:14:22-04:00`. Rejecting leaves the file byte-identical (SHA-256) |
| 5 | Nothing dictated is dropped silently | `e2e/suggest-split.spec.ts`, `split-coverage.test.ts` | **Pass.** Dropping a piece surfaces its text under "This is not carried into any piece"; putting it back hides it again; dropping every piece and accepting is refused with the original intact |
| 6 | Ask where something belongs | `e2e/suggest-destination.spec.ts` (10 tests), `destination-*.test.ts` | **Pass.** One destination with a reason; a create proposal is marked "this does not exist yet" and creates nothing until confirmed; a waiting-for owner is pre-filled and editable; accepting produces files byte-identical to sorting by hand |
| 7 | Switch to the work machine | `e2e/suggest-transport-switch.spec.ts` (5 tests), `transport-parity.test.ts` (14 cases × 2) | **Pass.** Identical proposals, identical accepted files, identical controls. `grep -rIl 'PRIVATE KEY' "$VAULT"` exits 1 |
| 8 | Every way it can fail | `suggest-failures.test.ts` (all seven modes × both request kinds), `suggest-unusable-response.test.ts` | **Pass.** Every mode leaves the vault byte-identical, produces exactly one message, and attempts no retry. The three config problems were also read by hand — see below |
| 9 | It never probes | `suggest-no-probing.test.ts` | **Pass.** With `OLLAMA_HOST`, `CLAUDE_CLI`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `WAYPOINT_TRANSPORT`, `EDITOR` and `TERM_PROGRAM` all set and no `intelligence.md`, the layer is `off` |
| 10 | Nothing leaves the machine when nothing is configured | `suggest-no-outbound.test.ts` | **Pass**, and stronger than the `tcpdump` the scenario suggests: `spawn`, `spawnSync`, `exec`, `execFile`, `fork`, `https.request`, `http.request`, `net.connect`, `tls.connect` and `fetch` are all replaced with recorders that throw, and a whole sort walk touches none of them. The traps are themselves asserted to work, so a green is not vacuous |
| 11 | Both transports, one suite | `transport-parity.test.ts`, `vault-no-secrets.test.ts` | **Pass.** Key material is generated at run time by the platform's own OpenSSL in a temp directory; nothing is committed |
| 12 | Both platforms | GitHub Actions — see task T076 | Linux verified here |

**Scenario 8, read by hand.** The three configuration problems produce, verbatim:

```text
intelligence.md names `transport: copilot`, which is not a transport Waypoint has.
  The transports that work are `command` and `certificate`. Suggestions are off; sorting is unaffected.
intelligence.md sets `transport: certificate` but has no `endpoint:` line.
  The `certificate` transport needs one. Suggestions are off; sorting is unaffected.
intelligence.md has `endpoint: http://x/`. The `certificate` transport requires HTTPS,
  because client-certificate authentication is part of the TLS handshake. Suggestions are off; sorting is unaffected.
```

Each names the value read and the line to fix, and each ends by saying what is *not* affected.

### Divergences from this document, as written

Two, both small, and the document above has been left as it was so the difference is visible:

1. **Scenario 6 says the split control appears "on the item in front of you".** It does — but the destination
   control is labelled *Where does this go?* and the split control *Split this up*, rather than the
   *Split* / *Where does this go?* pair scenario 2 implies. No behavioural difference.
2. **Scenario 10 suggests `tcpdump`.** The automated form replaced it entirely and is stronger, because a
   packet capture proves only that nothing left during the window it was watching. `tcpdump` was not run.

### SC-006: how long the untangling takes

**Not measured as written, and this is a deliberate limitation to record rather than a result to report.**
SC-006 asks for *user* time — a four-thought dictation into four correctly separated items in under 60
seconds — and user time cannot be measured without a user. Feature 6 gave its ten-second first-entry budget
the same treatment.

What was measured is the system's contribution to that budget, which is the part this feature controls, timed
in `e2e/suggest-split.spec.ts` against the fake CLI:

| Step | Observed |
|---|---|
| Ask → preview on screen | well under 100 ms |
| Send → proposal rendered | under 200 ms with a local stub |
| Accept → three items on disk | under 100 ms |

The dominant term is the model's own latency, which this feature does not own and deliberately does not bound
below 120 seconds. The honest statement is: **the interaction adds a negligible amount to the 60-second
budget, and whether the budget is met depends on the model the user configured.** A real measurement needs a
real model and a real person, and belongs in use rather than in CI.

---

## What to check if something looks wrong

| Symptom | Look at |
|---|---|
| A control appears with no `intelligence.md` | `main.ts` registered a `suggest:*` handler unconditionally — the channels must not exist when the layer is off (contracts/ipc-suggest.md) |
| A piece contains words not in the original | The response path handled text instead of segment numbers (research R3) — this should be impossible, and is a bug in `response.ts` |
| The preview and what was sent differ | Something reconstructed the payload instead of closing over it (research R4) — `run()` must take no argument |
| A `MARKER-` string reaches the payload | `DestinationRequest` grew a field, or the service was handed something wider than a `DestinationCatalog` (research R5, R6) |
| A split left a duplicate | The replacement was not one `replaceRange` (research R9) |
| Feature 2's suite needs editing | The degrade-to-nothing contract is broken. Stop. |
