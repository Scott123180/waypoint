# Implementation Plan: LLM-Assisted Inbox Organization

**Branch**: `008-llm-assisted-inbox-organization` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-llm-assisted-inbox-organization/spec.md`

## Summary

The intelligence layer the roadmap describes, built at its narrowest useful scope: a user sorting one inbox
item can ask for it to be divided into separate items, or ask where it belongs, and gets a proposal they
accept, edit, or reject. Nothing is analysed unless asked. Nothing is written unless accepted. With no
transport configured — the shipped default — sorting is byte-for-byte Feature 2 and shows no sign this
feature exists.

Two seams, as the roadmap specifies. Core declares `SplitProvider` and `DestinationProvider` in Waypoint's own
vocabulary, each with one call site, injected — the shape `TranscriptionPort` and `SummaryProvider` set. Core
also declares `Transport`, which carries request content out and response content back and has never heard of
a project. Between them sits the default intelligence module, which owns segmentation, request construction,
response parsing, and the suggest-don't-decide semantics. Two transports ship: one spawning a command-line
tool, one making an HTTPS request with client-certificate authentication, chosen because their failures arrive
as different kinds of thing.

Four guarantees are made structural rather than asserted, each following a technique already proven in this
repo:

- **The module cannot write.** `SuggestionServiceDeps` has no `VaultStore`, no `SortService`, and no journal.
  Accepting a destination is the client calling the existing `sort()` after the user says yes. Feature 6's
  narrowing, taken one step further (research R6, R11).
- **The previewed content is the sent content.** A request is *prepared* into a value holding the payload and
  a `run()` closed over it. There is no second construction and no argument through which different content
  could be sent, so FR-045's byte-for-byte assertion is `===` on one binding — the identity Feature 6 used to
  collapse "the export matches the view" (research R4).
- **A proposed piece is always the user's own words.** The model returns segment *numbers*, never text; core
  slices the original. Text that is not the user's cannot be emitted because it is never handled, and FR-013's
  coverage check becomes set arithmetic instead of a similarity score (research R3).
- **The payload cannot carry what it must not.** `DestinationRequest` has no field for a milestone, DRI,
  status, or ledger entry, and the service's read source names a directory rather than a path, so
  `identity.md` and `log/` are not expressible (research R5, R6).

The load-bearing decisions elsewhere:

- **A split needs no journal.** It is one atomic `replaceRange`, so FR-014's all-or-nothing is the rename's
  guarantee rather than a recovery path. This departs from the literal instruction to reuse sorting's
  journaling and serves its intent: the journal exists for the two-file commit, and adding it here would
  create a crash window that does not otherwise exist (research R9, and Complexity Tracking).
- **`SortService` gains exactly one verb.** `split(ref, pieces)` takes explicit text and knows nothing about
  proposals. One existing test is amended by one line, named and dated (research R7).
- **The 120-second bound lives in core**, armed once, delivered to both transports as an `AbortSignal`, so it
  cannot drift between them (research R15).
- **`intelligence.md` sits beside `policy.md` and `identity.md`**, read with the same preamble helpers, naming
  a transport, its non-secret parameters, and the *path* to a credential — never the material (research R16).
- **With no transport, the renderer is not handed the verb.** Not disabled, not hidden — absent from the
  preload API, which is the only form of "no control in any state" that a stylesheet cannot undo
  (research R17).

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 22 (`.nvmrc` pins 22; `engines.node >=22`)

**Primary Dependencies**: None added. Both transports use platform capabilities — `node:child_process.spawn`
for the command-line tool, following `WhisperAdapter`, and `node:https.request` for client-certificate
authentication, which exposes `cert`/`key`/`ca` directly where `fetch` would need a custom dispatcher
(research R13). A dependency added here would be one both platform builds have to carry.

**Storage**: One new plain-text file, `intelligence.md`, at the vault root, in the `key: value` plus
`## Section` shapes `identity.md` and `policy.md` already use. Absent by default and absent in every existing
vault, which is what makes shipping this a no-op for data already on disk. No other file, field, index, cache,
or migration; nothing about a proposal is ever stored (FR-046, FR-070).

**Testing**: `node --test` over compiled output, `TZ=America/New_York`. Five kinds of test carry the weight —
payload identity by `===`, payload boundary by planted markers, Feature 2's suite unmodified, one suite run
against both transports, and the seven failure modes (research R18). Fixtures: `fake-llm-cli.sh` in the shape
of `fake-whisper-cli.sh`, and a local HTTPS server with key material generated at run time so the platform's
own OpenSSL produces what the test uses. Window behaviour under Playwright, where the config already lives.

**Target Platform**: Electron desktop on Linux and macOS. macOS builds are produced by GitHub Actions on a
macOS runner and shipped as release artifacts; nothing is built or installed on the work machine. Both
transports are exercised on both platforms because both touch platform behaviour — subprocess handling and
TLS (research R19).

**Project Type**: npm workspaces monorepo — `packages/core` (all domain logic, imports nothing from Electron)
and `packages/desktop` (thin client). Transports are adapters in `packages/desktop/src/main/adapters/`,
beside `whisper-adapter.ts`, for the same reason: they are I/O.

**Performance Goals**: None that this feature owns. A request takes as long as the model takes; the only bound
is the 120-second ceiling, and the user can abandon at any moment. Nothing here is a capture surface, so
Principle VI's latency budget does not apply. Request construction reads one file per project and one per
area — the same reads `SortService.destinations()` already makes, plus the project bodies for their outcomes.

**Constraints**: Fully optional and off by default. Adds no decision point; the count stays at five. Writes
nothing without an explicit acceptance, enforced by the dependency types. Sends nothing without a configured
transport, enforced by there being no transport to send through. No existing behaviour changes: Features 1–6
suites pass unmodified except for one named line (research R7).

**Scale/Scope**: Single user, single vault, one item at a time. A 20-minute dictation is the large case for
segmentation; a hundred projects is the large case for the destination catalogue.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Assessed against Constitution v2.0.0, all seven principles.

| Principle | Assessment | How this plan satisfies it |
|---|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS | Every task is a failing test first. Four deserve naming. The **payload identity** test cannot be written until `run()` is a closure over one binding — with two constructions it can only assert equality, so its Red is "there is no single value to compare". The **verbatim** test is written against a stub returning out-of-range segment numbers and must go Red as "a proposal was shown" before the verification exists. The **degrade-to-nothing** test is Feature 2's entire suite against an unconfigured build: its Red is that the suite does not yet run in that configuration, and a green that came from the suite silently not executing is the failure mode, so the run is asserted by count. The **no-network-when-unconfigured** test uses `review-no-outbound.test.ts`'s technique — replace `globalThis.fetch` and `spawn` with recorders that throw — so absence is proven against doubles rather than by reading the code. |
| **II. Library-First** | PASS | Segmentation, request construction, response parsing, verbatim verification, coverage arithmetic, destination validation against what exists, the failure taxonomy, and the 120-second bound are all `packages/core`. The transports do exactly two things — carry bytes out, bring bytes back — and the window renders proposals and collects an accept, an edit, or a reject. Nothing about *what a proposal is* is computable in the renderer or in an adapter. |
| **III. Local-First / Offline** | PASS | The layer is off by default and every existing capability works with it off, asserted by running Feature 2's suite in that configuration. Core adds no network code: the HTTPS transport is a desktop adapter, and a new `suggest-offline.test.ts` asserts `dist/src/{suggest,intelligence}` import no networking module, mirroring `sort-offline.test.ts` without editing it. A configured transport is an optional integration that is additive and never required — the constitution's own words for what an integration may be. |
| **IV. Durable Plain-Text** | PASS | Pieces are written as ordinary inbox items in Feature 1's format, indistinguishable from hand-typed ones, and a hand-written item with no timestamp yields pieces with none rather than a fabricated one. `intelligence.md` is `key: value` plus a `## Arguments` list, hand-editable with no application running. Nothing about a proposal is stored anywhere, so there is no new format to outlive. Credentials are named by path and never copied into the vault (FR-051b). |
| **V. Enforced Process, Separable Policy** | PASS | No decision point is added and none is consulted; `decision-points.test.ts` is not edited and still asserts five. There is no rule here to allow, warn, or block — a proposal the user is free to reject holds no opinion the system enforces. The absence of a `policy` field on `SuggestionServiceDeps` makes that structural (research R11). Accepting a destination goes through `sort()`, so whatever policy that action consults is consulted identically, and no client gets a second path to a destination. No loader, no discovery, no registration API for either seam. |
| **VI. Instant, Non-Blocking Capture** | PASS — not touched | Capture is unchanged: no surface, no latency budget, no inbox format change, no transcription change. The inbox is read and spliced by sorting, as it already was. |
| **VII. One Consistent Interaction Model** | PASS | Five terms enter the core and every client inherits them: *suggestion*, *proposal*, *piece*, *split*, *transport*. Every one is the user's own word from the spec. No client introduces a concept core does not have — the window is handed proposals and returns an acceptance. Destinations keep Feature 2's five names and `SortDecision` is unchanged, which is what makes "no behavior exists only in the assisted path" a fact about the type rather than a claim. Refusals keep the established `{ ok: false, reason, message }` shape. |

**Blocking-principle review (I, III, IV, V)**: no violations. Three concessions are recorded in Complexity
Tracking; none relaxes a blocking guarantee.

### Post-design re-check (after Phase 1)

Re-run against the completed contracts. Still PASS on all seven. Four things the design surfaced that the
pre-design check had not:

- **Principle II was at risk in the coverage report, and R3 closes it.** "These two sentences are not in any
  piece" is a statement about the user's data. Had the window computed it by diffing strings, that would be a
  client holding domain logic — and getting it wrong quietly. Segment arithmetic in core removes the
  possibility rather than the temptation.
- **Principle VII was at risk in the word *suggestion*.** Feature 2's guard forbids any `SortService` method
  whose name contains `suggest`, and that guard must keep passing. It does, and it now means something
  sharper: suggesting is a different verb on a different service, so a client cannot reach a destination
  through a suggestion — it reaches a proposal, and then reaches `sort()` itself.
- **Principle IV needed an explicit contract line about a multi-line piece.** A dictated item can contain
  blank lines, and Feature 1's serializer indents continuation lines. A piece spanning a blank line must
  round-trip through `parseInbox` as one item; the contract states it and a property test proves it
  (research R10).
- **Principle V's guarantee is stronger than "no point was added".** `sort()` is called by the *client* after
  an acceptance, not by the suggestion service, so there is no path where a proposal reaches a destination
  without passing through the same policy consultation a manual decision passes through — and no argument by
  which it could carry a hint that it was proposed. Feature 2 already ensured the last part by giving
  `SortDecision` no `suggestedBy` field; this feature inherits that impossibility rather than re-promising it.

## Project Structure

### Documentation (this feature)

```text
specs/008-llm-assisted-inbox-organization/
├── plan.md              # This file
├── research.md          # Phase 0 output — R1..R19
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── intelligence-ports.md    # SplitProvider, DestinationProvider, Transport
│   ├── suggestion-api.md        # SuggestionService and SortService.split
│   ├── intelligence-config.md   # intelligence.md on-disk format
│   └── ipc-suggest.md           # main ↔ renderer channels
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── ports/index.ts                       # + SplitProvider, DestinationProvider, Transport
├── suggest/                             # NEW — the call sites and the config
│   ├── suggestion-service.ts            #   SuggestionService: prepareSplit, prepareDestination
│   ├── intelligence-config.ts           #   parseIntelligenceConfig, INTELLIGENCE_PATH
│   ├── catalog.ts                       #   DestinationCatalog + the VaultStore adapter
│   └── types.ts                         #   proposals, failures, PreparedRequest
├── intelligence/                        # NEW — the default module
│   ├── default-intelligence.ts          #   createDefaultIntelligence(transport)
│   ├── segments.ts                      #   the partition; segments.join("") === text
│   ├── request.ts                       #   the single construction of payload text
│   └── response.ts                      #   strict parse + verbatim/coverage verification
└── sort/
    ├── sort-service.ts                  # + split(ref, pieces)
    └── split.ts                         # NEW — verification and the replacement block

packages/desktop/src/
├── main/
│   ├── adapters/
│   │   ├── fs-inbox-document.ts         # + replaceRange (removeRange unchanged)
│   │   ├── command-transport.ts         # NEW — spawn, stdin/stdout, abort
│   │   └── certificate-transport.ts     # NEW — node:https, cert/key, abort
│   ├── ipc.ts                           # + suggest:* channels, registered only when configured
│   ├── main.ts                          # + reads intelligence.md, composes the module
│   └── sort-window.ts                   # + passes availability to the window
├── preload/preload.ts                   # + suggest API, absent when no transport
└── renderer/
    ├── sort.ts                          # + proposal rendering, edit, accept, reject
    └── sort.html                         # + proposal panel markup

packages/core/tests/                     # ~22 new files; one amended (sort-scope-boundaries)
packages/desktop/tests/
├── fixtures/fake-llm-cli.sh             # NEW — shape of fake-whisper-cli.sh
├── command-transport.test.ts            # NEW
├── certificate-transport.test.ts        # NEW — key material generated at run time
└── e2e/suggest-*.spec.ts                # NEW
```

**Structure Decision**: The established monorepo split, unchanged. The only judgement is where the default
intelligence module sits, and it sits in core because prompt construction and response parsing decide what a
proposal *is* — domain logic under Principle II. What goes in `packages/desktop` is what performs I/O, which
is the same line `whisper-adapter.ts` sits on.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **One existing test file is modified**: `packages/core/tests/sort-scope-boundaries.test.ts` gains `"split"` in its expected-surface array, with a dated amendment note. | `SortService.split()` is the atomic inbox rewrite (research R7). The guard asserts the service's surface exactly, so any addition trips it. | **A separate `SplitService`** — would hold the same `InboxDocument`, the same mutex, and a copy of the item-changed verification, putting two writers on `inbox.md`, which is the hazard `inbox-mutex.ts` exists to remove. **Renaming the verb to slip past the pattern** — the guard would pass on a technicality while the thing it guards against had happened; Feature 6 named and rejected this exact move. **Leaving it red** — impossible; `split` is this feature's write. The forbidden-substring list including `suggest` is untouched and still passes, which is the part of the guard that matters most here. |
| **A split is not journalled**, departing from the instruction to reuse sorting's journaling and crash recovery. | A split touches one file through an atomic temp-plus-rename, so FR-014's all-or-nothing already holds. The journal exists because a destination commit touches two files and POSIX cannot update both atomically. | **Journalling for symmetry** — would add a crash window that does not otherwise exist (between writing the entry and performing the splice) and a recovery path whose triggering state is unreachable, therefore untestable. The instruction's intent was "do not invent a second discipline"; this invents none at all. Recorded here rather than resolved silently because it is a deliberate deviation from a stated instruction. |
| **`InboxDocument` gains a method**, so a Feature 2 port grows. | A split must replace a byte range, and `removeRange` can only empty one. | **A remove followed by an append** — two writes, so the atomicity requirement fails, and the pieces would land at the end of the file rather than in the original's position (FR-016). **A new port beside `InboxDocument`** — a second writer to the same file again. The addition is strictly additive: `removeRange` keeps its signature and behaviour, and Feature 2's adapter tests pass unmodified. |

**Predictions, stated so they can be checked against what actually happens** (Feature 6's plan predicted "zero
existing tests modified" and was wrong; recording the prediction is what made that visible):

- Exactly one existing test file is modified, by one line plus a dated comment: `sort-scope-boundaries.test.ts`.
- `decision-points.test.ts`, `sort-no-suggestion.test.ts`, `sort-offline.test.ts`, `summary-payload.test.ts`,
  and `project-scope-boundaries.test.ts` are **not** edited, and each still passes for the reason it was
  written.
- No existing source file's behaviour changes. Three gain something additive: `ports/index.ts` (three
  interfaces), `sort-service.ts` (one verb), `fs-inbox-document.ts` (one method).

### What actually happened (recorded 2026-08-17, task T072)

The first prediction was **wrong in the same way Feature 6's was**, and for a related reason. Three files
under `tests/` changed, not one:

| File | Kind | Why it had to change |
|---|---|---|
| `packages/core/tests/sort-scope-boundaries.test.ts` | test | As predicted: `"split"` added to the expected-surface array, one line plus a dated comment. The forbidden-substring list, `suggest` included, is untouched and still passes. |
| `packages/core/tests/sort-fakes.ts` | **helper** | `FakeInboxDocument implements InboxDocument`, and the port gained `replaceRange`. A fake missing it does not compile. Also gained a `replaceCalls` counter and a `forceMismatch` flag, so "a split is exactly one write" is assertable. |
| `packages/desktop/tests/e2e/harness.ts` | **helper** | Gained `seedVault` and `env` launch options. `intelligence.md` is read once at startup, so a vault seeded after launch would be read by nothing, and the command transport's fake CLI is driven through the app's environment. |

Neither helper changes what any existing test asserts. That is the line that matters, and it is checked rather
than claimed: `packages/desktop/tests/degrade-to-nothing.test.ts` runs the 187 test files that existed before
this feature and asserts the executed count is still **1646**, with zero failures, against a build with no
transport configured. It also asserts the modified set is exactly these three, so a fourth cannot appear
quietly.

The lesson generalises, and is worth carrying into the next feature's plan: **a prediction about "existing
tests" should be stated about test *files* and helper *files* separately.** Widening a port obliges every fake
that implements it, and that is a mechanical consequence of the design rather than a surprise — Feature 6 hit
the same class of thing. The prediction was not wrong about the risk it was watching for; it was scoped one
category too narrowly to be checkable.

The other two predictions held exactly:

- The five named guards were not edited, and all still pass. Asserted, not assumed — `degrade-to-nothing.test.ts`
  names them and fails if any appears in the modified set.
- No existing source file's behaviour changed. Six gained something additive: `ports/index.ts` (five interfaces
  and one method on `InboxDocument`), `sort-service.ts` (one verb), `sort/decision.ts` (one refusal reason),
  `fs-inbox-document.ts` (one method, sharing the existing splice), `ipc.ts` (one sort channel plus the
  conditional `suggest:*` block), `preload.ts` (one sort method plus the conditional bridge), and `main.ts`
  (the config read and the transport switch).

One further deviation, recorded here rather than in silence, is in the **contracts** rather than the tests:
`contracts/intelligence-ports.md` gave each provider a single `propose(request, signal)` that both rendered
the payload and sent it. That shape cannot satisfy FR-041 and FR-045 together — with rendering and sending in
one call, a caller can only obtain the payload by rendering it a *second* time, which is precisely the
discrepancy FR-045 forbids, reintroduced one layer down. The verb is therefore `prepareSplit` /
`prepareDestination`, each returning a `PreparedProposal<T>` whose `payload` and `send(signal)` close over one
binding. Everything else about the seam is unchanged: the provider still owns prompt construction, the
transport still knows nothing, and `run()` still takes no argument. See `packages/core/src/ports/index.ts`,
where the reasoning is recorded beside the type.

### Two more deviations, found by convergence (recorded 2026-08-18, tasks T078 and T077)

**`intelligence.md` is read once, at startup — not "after a vault change" as T062 said.** The task text asked
for both; `main.ts` does only the first. This is the right answer rather than an oversight, and the reason is
structural: whether the bridge exists at all is decided *before* the sort window is created, and passed to it
as the `--waypoint-suggest` argument. Re-reading the file later could not attach or detach a bridge on a
window that already exists — it would have to destroy and rebuild the window under the user, mid-sort, because
a file they edited in another program changed. Switching transports therefore takes a restart, which is the
same cost as switching them by editing the file in the first place, and one the user is already at a keyboard
to pay. What *is* read fresh on every request is the projects-and-areas catalogue, which is where FR-024
actually requires it.

**The configuration problem is reported at the end of startup, not where it is parsed.** Found by writing the
test T077 asked for and watching it fail for a reason nobody had predicted: the capture box holds **one**
notice at a time — `showNotice` replaces the element's text — so when several notices are replayed on the
first open, the last delivered is the one the user reads. The intelligence problem was raised early, before
the hotkeys register, and on any machine where a hotkey also fails to register it was overwritten before it
could be seen. It was reported plainly to nobody.

Moving the emission to sit beside the application's own configuration problem, after the hotkeys, is the whole
fix and it is one line's worth of placement. The underlying limitation is **not** fixed and is recorded here
instead: two startup notices still cannot both be read, and the second silently wins. Stacking them would mean
changing the capture surface, which FR-071 forbids this feature from touching. It is a Feature 1 concern, it
predates this work, and it is now written down where the next person to raise a startup notice will find it.

The generalisable point, and the reason this is in the plan rather than only in a commit message: **"the code
emits it" is not the same claim as "the user sees it"**, and only one of those is what a requirement like
FR-055 asks for. The original test asserted the half that was easy to reach.

### The baseline that only existed before the commit (recorded 2026-08-18)

`degrade-to-nothing.test.ts` is the file that proves T063 and SC-001: it runs the 187 test files that predate
this feature and asserts 1646 of them executed with zero failures. It asked git for the baseline rather than
listing it, which was the right instinct — a hand-written list rots — but it asked for `HEAD`.

`HEAD` meant "before Feature 8" for exactly as long as Feature 8 was uncommitted. The first push moved it, the
baseline grew from 187 files to 228, and the 228 **included `degrade-to-nothing.test.js` itself**. The test
spawns a runner over the baseline, so it spawned itself. Both CI jobs sat on a step that takes three seconds
locally until the run was cancelled twenty-one minutes later. It did not fail — it recursed, which is a worse
shape of the same problem: a green that never arrives says nothing about the code.

The companion defect was in the same file and had the same cause. `modified()` read `git status --porcelain`,
which sees only uncommitted work, so on a committed branch it returned the empty list: the two assertions about
which three files this feature was allowed to change would have failed, and the assertion beneath them — that
seven named guards were *not* touched — would have passed vacuously forever. A guard that cannot fail is not a
guard.

Pinning the query to that commit fixed the recursion and failed differently, on the next CI run: `actions/
checkout` clones shallow, so the pre-feature commit does not exist on a runner at all — `fatal: Not a valid
object name`. The baseline is therefore **frozen into a committed fixture**, generated once from that commit,
and the "which files changed" question is answered by comparing content hashes rather than by asking git what
it thinks is dirty. It now works in a shallow clone, in a source tarball, and with no git at all, and
`baselineFiles()` refuses to return a list containing itself however the fixture is ever regenerated.

Three attempts, and the thing that was wrong each time was the same: the test was asking its environment a
question whose answer changed with the environment. The version that works asks nothing.

The generalisable lesson, and the reason this is recorded next to the others: **a test whose meaning depends on
the working tree's git state passes under exactly one condition and cannot tell you which.** This one was
written, run, and observed green while the feature was uncommitted — the only state in which it was ever
correct. It is the same failure the file itself was written to catch, one level up: not a suite that silently
did not run, but a suite that silently could not stop running.
