# Research: LLM-Assisted Inbox Organization

**Feature**: 008-llm-assisted-inbox-organization | **Date**: 2026-08-17

Decisions taken before design, each with what was rejected and why. Numbered so the plan, contracts, and
tasks can cite them.

---

## R1 — Two seams, three modules, one direction of dependency

**Decision**: `packages/core/src/suggest/` holds `SuggestionService` — the two call sites and the
`intelligence.md` reader. `packages/core/src/intelligence/` holds the default module — segmentation, request
construction, response parsing, verbatim verification. `packages/core/src/ports/index.ts` gains three
interfaces: `SplitProvider`, `DestinationProvider`, `Transport`. The two transports live in
`packages/desktop/src/main/adapters/`.

Dependencies run one way: `suggest/` → ports; `intelligence/` → ports; desktop adapters → ports. The service
never imports the default module and the default module never imports the service — `main.ts` composes them,
exactly as it composes `WhisperAdapter` into `CaptureService`.

**Rationale**: This is the roadmap's two-seam architecture made concrete. `SplitProvider` and
`DestinationProvider` speak Waypoint's vocabulary and are stable regardless of what answers them; `Transport`
speaks in request and response content and has never heard of an inbox item. The default module is the only
thing that knows both, which is what makes swapping a transport a configuration change rather than a code
change to anything that thinks.

**Alternatives rejected**:

- *One `IntelligenceProvider` with two methods.* A single interface would mean a provider supplying one
  capability has to stub the other, and the spec makes the two independently requestable (FR-003). Two
  interfaces make "asking for one does not send the other" a fact about the shape.
- *The default module in `packages/desktop`.* Prompt construction and response parsing are domain logic —
  they decide what a proposal *is*. Principle II puts them in core. Only the I/O goes in the adapter.
- *`Transport` declared in desktop and injected upward.* Core has to name the type to accept it. Declaring it
  in `ports/` alongside `TranscriptionPort` costs nothing and keeps the composition root in one place.

---

## R2 — The default module is `createDefaultIntelligence(transport)`, mirroring `createDefaultPolicy()`

**Decision**: One factory returning an object satisfying both provider interfaces, configured with a
`Transport`. No loader, no registry, no discovery, nothing exported for a third party to register against.

**Rationale**: Exactly the restraint Principle V requires of the policy seam, applied to the second seam the
roadmap describes. The interface is written down so the project can use the seam deliberately, not so it can
be depended on from outside.

**Alternatives rejected**: a `registerProvider()` surface, a config-named module lookup, a `providers/`
directory scanned at startup — each is the plugin system the constitution defers, and each would have to be
un-promised later.

---

## R3 — The verbatim guarantee is structural: the model returns segment numbers, never text

**Decision**: Core splits the item into numbered **segments** — a partition of the item's text at sentence
terminators and line breaks, keeping every byte including whitespace, so the segments concatenated are the
item exactly. The request presents them numbered. The response names, per proposed piece, the segment numbers
it groups. Core builds each piece's text by slicing the original at those segments. Piece text never comes
from the response.

Verification is then arithmetic, not judgment:

- A number outside the range, a number appearing in two pieces, or a piece naming no segments makes the
  response **unusable** (FR-010b, FR-064). Nothing is repaired, trimmed, or partially accepted.
- Coverage under FR-013 is the set of segment numbers named by no piece — exact, and computed rather than
  estimated.

**Rationale**: This is the technique that turns FR-010a from a rule someone has to check into a property of
the data path: the module has no way to emit text that is not the user's, because it never handles text from
the response at all. It also puts the model on the task it is reliable at — deciding where one thought ends
and the next begins — rather than character arithmetic.

**Alternatives rejected**:

- *The model returns piece text; core locates each piece in the original.* Superficially simpler, genuinely
  ambiguous: a piece assembled from repeated words has several possible span decompositions, so "did this
  come from the original?" becomes a search with no single right answer, and coverage becomes a similarity
  score — the heuristic the spec's clarification session explicitly rejected.
- *The model returns character offsets.* Exact in principle, but character counting over a 90-second
  dictation is the thing language models are worst at, so the common case would be a valid-looking response
  with wrong offsets — silent corruption rather than a reported failure.
- *No verification, trusting the prompt.* FR-010b requires the failure to be detected, and a prompt is not a
  guarantee.

**Segment boundaries**: after `.`, `!`, `?` followed by whitespace, and at every newline. Trailing whitespace
belongs to the segment it follows, so `segments.join("") === item.text` byte for byte — asserted as a
property test over the dictation fixtures. Boundaries are a heuristic and are allowed to be; correctness does
not depend on them being good, only on them partitioning the item. A bad boundary makes a coarser proposal,
never a wrong one.

---

## R4 — Payload identity, not payload comparison

**Decision**: A request is prepared before it is sent, and the prepared value carries both the exact content
and the means to send it:

```ts
interface PreparedRequest<T> {
  /** The exact content that would be sent. FR-041's preview reads this. */
  readonly payload: string;
  /** Sends `payload`. There is no argument, so nothing else can be sent. */
  run(): Promise<T>;
}
```

`run()` is a closure over the single `payload` binding. There is no second construction of the content and no
argument through which different content could be supplied.

**Rationale**: This is the technique Feature 6 used to collapse "the export matches the view" into an
identity — one renderer, one string, displayed and written. FR-045 says a discrepancy must be impossible by
construction rather than avoided by discipline, and a recording transport can assert `received[0] === payload`
with `===`, which is a stronger claim than deep equality.

**Alternatives rejected**:

- *`preview(ref)` and `send(ref)` as two calls.* Two constructions of the same content, which is exactly the
  discrepancy FR-045 forbids, and a test could only compare them rather than prove them the same.
- *`send(payload)` taking the previewed string.* Better, but a caller could pass a different string; the
  guarantee would live in the caller rather than in the type.

---

## R5 — The destination context is a closed shape, so the payload boundary is not a promise

**Decision**: `DestinationProvider` receives:

```ts
interface DestinationRequest {
  item: string;
  projects: ReadonlyArray<{ slug: string; title: string; outcome: string | null }>;
  areas: ReadonlyArray<{ slug: string; title: string }>;
}
```

There is no field for a milestone, a next action, a DRI, a status, a ledger entry, an unprocessed item, or
any other file. A provider that wanted them would have to change core to get them, which is a visible change.

**Rationale**: Feature 5's `ReviewRecord` established this discipline for the summary port and
`summary-payload.test.ts` established how to prove it — plant a distinctive marker in every file the payload
must never carry, and assert none appears. The same test shape carries over, extended to the files this
feature must not read at all.

**Why the outcome and not just the title**: the spec's assumption, from the user's own phrase that suggesting
a destination "needs to know what my projects and areas actually are". A slug list would make the proposal
name-matching dressed up as judgment. Areas have no outcome and send a title alone.

---

## R6 — The service cannot name a file, so it cannot read the wrong one

**Decision**: `SuggestionService` does not receive a `VaultStore`. It receives a narrowed source that can only
express the two directories it is allowed to read:

```ts
interface DestinationCatalog {
  list(dir: "projects" | "areas"): Promise<string[]>;
  read(dir: "projects" | "areas", slug: string): Promise<string | null>;
}
```

Core builds one from a `VaultStore` in a three-line adapter at the composition root. `identity.md`,
`policy.md`, `trash.md`, `calendar.md`, `top-three.md`, and `log/` are not nameable through this interface.

**Rationale**: Feature 6 narrowed `vault` to `Pick<VaultStore, "list" | "read">` and made "never writes" a
typecheck. That technique gives write-immunity but not read-scope — `read("identity.md")` still typechecks
under a `Pick`. Naming the directory as a parameter rather than embedding it in a path string closes the
remaining gap, so FR-044's "never read" is held by the compiler and not only by a marker test.

**Alternatives rejected**:

- *`Pick<VaultStore, "list" | "read">` plus a read-log test.* What Feature 6 did, and adequate there because
  the retrospective is *allowed* to read those files. Here they are forbidden, so the stronger form is worth
  the small adapter.
- *Reusing `SortService.destinations()`.* Returns slug, title, and kind only — no outcome — and widening it
  would put a payload concern into Feature 2's read (`sort-no-suggestion.test.ts` asserts that
  `DestinationRef` has exactly three keys, and it should keep asserting it).

---

## R7 — `SortService` gains one verb, `split`, and the scope guard is amended by one line

**Decision**: The atomic inbox rewrite lives on `SortService` as `split(ref, pieces)`. It takes explicit piece
text and knows nothing about proposals, providers, or transports. `packages/core/tests/sort-scope-boundaries.test.ts`
gains `"split"` in its expected-surface array, with a dated amendment note in the style Feature 6 used when
Feature 3's guard fired.

**Rationale**: Splitting is a mutation of the inbox during sorting, sharing the item-changed verification, the
`InboxDocument` port, and the process-wide inbox mutex with `sort()`. A second service holding the same three
dependencies and duplicating the verification would be two writers to one file — the exact hazard
`inbox-mutex.ts` exists to remove — for the sake of leaving one array untouched.

The guard's other assertions all keep passing and keep their teeth: the forbidden-substring list
(`edit`, `reorder`, `move`, `undo`, `bulk`, `purge`, **`suggest`**) is unchanged, and `suggest` still names
nothing on `SortService`, because suggesting lives in `SuggestionService`.

**Alternatives rejected**:

- *A separate `SplitService`.* Duplicates the dependencies and the verification, and puts a second writer on
  `inbox.md`.
- *Putting the rewrite in the intelligence module.* The module must not reach a write verb at all (the whole
  point of R11), so this is not available even if it were desirable.
- *Leaving the guard red or renaming the verb to slip past it.* Feature 6 named both and rejected both: a
  guard passing on a technicality is worse than an amendment a reader can date.

**Prediction, stated so it can be checked**: exactly one existing test file is modified, by one line plus a
comment. Feature 6's plan predicted zero and was wrong; this one predicts one and names it.

---

## R8 — `InboxDocument` gains `replaceRange`; `removeRange` is untouched

**Decision**: The port gains

```ts
replaceRange(start: number, end: number, expected: string, replacement: string): Promise<"replaced" | "mismatch">;
```

`FsInboxDocument` already rebuilds the file and renames it over the original; the replacement text is one
extra argument to a splice it already performs. `removeRange` keeps its signature, its behaviour, and its
tests, and is implemented in terms of the same private splice.

**Rationale**: Additive, so Feature 2's `fs-inbox-document.test.ts`, `inbox-concurrent-write.test.ts`, and
`inbox-mutex.test.ts` pass unmodified. The retry-on-size-change loop, the mutex, and the
`beforeRename` test seam all apply to a replace exactly as they apply to a removal.

---

## R9 — A split needs no journal entry, because it is one atomic write

**Decision**: `split()` does not write a journal entry. It verifies the item, then performs a single
`replaceRange`. `recover()` and `SortJournalEntry` are untouched.

**Rationale**: This departs from the literal instruction to reuse sorting's journaling, and serves its intent
better. The journal exists because a destination commit touches **two** files and POSIX cannot update two
files atomically — the entry is what makes "never both and never neither" recoverable. A split touches
**one** file, through a temp-plus-rename that is already atomic within a filesystem. Journaling it would add a
second discipline where the requirement is already met, and would introduce a crash window that does not
otherwise exist: between writing the entry and performing the splice, with a recovery path that has to decide
whether the pieces are already there.

FR-014's "either every piece is written and the original removed, or nothing changes" is satisfied by the
rename. There is no partial state to recover from, which is a stronger guarantee than one that recovers.

**Alternatives rejected**: journalling for symmetry with `sort()` — symmetry between a one-file and a two-file
operation is a cost with no benefit, and the recovery code would be untestable because the state it recovers
from is unreachable.

---

## R10 — Pieces inherit the original's timestamp and position, by re-serializing through Feature 1's writer

**Decision**: The replacement block is built by rendering each piece with `serializeItem`-equivalent
formatting, stamped with the original's `capturedAt`. When `capturedAt` is `null` — a line the user typed by
hand — pieces are written as bare `- text` lines with no timestamp, which is what `parseInbox` already reads
back as a hand-written item.

Because the replacement occupies the original's byte range, position in file order is preserved without
computing anything.

**Rationale**: FR-016. Inbox order is capture order and `SortService.next()` returns the first item in file
order, so pieces occupying the original's range means the first piece is the next item presented — no cursor,
no seek, nothing for a client to remember. Inventing a timestamp for pieces of a hand-written item would
fabricate a capture that did not happen; `parse.ts` already treats a near-miss timestamp as hand-written
rather than as an error, and this stays inside that rule.

**Round-trip obligation**: `parseInbox(after).length === pieces.length + (others)` and each parsed piece's
`text` equals the piece text given — a property test, because multi-line pieces go through the
continuation-indent convention and that is where a serializer and a parser most easily disagree.

---

## R11 — No policy dependency, no decision point, and no write verb reachable from the module

**Decision**: `SuggestionServiceDeps` has no `policy` field and the intelligence module's factory takes only a
`Transport`. `DECISION_POINTS` stays at five and `decision-points.test.ts` is not edited.

**Rationale**: Feature 6's finding, restated: absent is stronger than injected-and-unused, because a
contributor who wanted to consult a rule from here would have to change a constructor, which is a visible
edit. Nothing here is an allow, warn, or block — a proposal the user is free to reject holds no opinion the
system enforces — and a point declared with no rule registered against it is what Principle V forbids.

Write-unreachability is likewise structural rather than asserted: `SuggestionService` receives a
`DestinationCatalog` (R6) and a provider; neither exposes a write. `SortService` is **not** among its
dependencies, so accepting a destination is the client calling `sort()` after the user says yes, not the
service calling it for them. That is FR-035 as a shape rather than a rule.

---

## R12 — The response format is strict JSON, and an unparseable response is a failure

**Decision**: The module asks for a single JSON object and parses it strictly. Any of: not valid JSON, wrong
top-level shape, a field of the wrong type, a segment number out of range, a repeated segment number, a
destination naming a project or area that does not exist, or a destination kind outside the five — is
`unusable`. Nothing is repaired, no second attempt is made, and no partial proposal is shown.

**Rationale**: FR-064 and FR-065. The alternative — extracting what can be understood — is precisely the
"partial or repaired proposal" the spec forbids, and it converts a visible failure into a quiet wrong answer.

**On fenced output**: a leading/trailing markdown code fence around the JSON is stripped before parsing. This
is deliberate and is the only tolerance: it is a wrapper around the payload, not a repair of it, and both
shipped transports will meet it constantly. Everything inside the fence is parsed strictly.

---

## R13 — Two transports chosen for differing failure modes; neither adds a dependency

**Decision**:

| | `command` | `certificate` |
|---|---|---|
| Mechanism | `node:child_process.spawn`, request on stdin, response on stdout | `node:https.request` with `cert`/`key` options |
| Precedent in repo | `WhisperAdapter` — same spawn, stdin, timeout, kill shape | none; new, and deliberately unlike the other |
| Failure surface | spawn `ENOENT`, non-zero exit with stderr, killed on abort | credential file unreadable, TLS handshake failure, non-2xx status, socket error, abort |

**Rationale**: The user's instruction, and the roadmap's bar. Two transports whose failures arrive as
different *kinds* of thing — an exit code and a stderr tail against a TLS error and an HTTP status — are what
prove the failure taxonomy (R14) is a real abstraction rather than one implementation's error type renamed.

**Why `node:https` and not `fetch`**: client-certificate authentication needs `cert`, `key`, and optionally
`ca` on the request options. Node's `fetch` (undici) does not expose them without constructing a custom
dispatcher, which is more code than `https.request` and a heavier commitment to a shape that may change.
`node:https` is the platform capability and adds nothing to either platform's build.

**Why the CLI transport writes the request to stdin**: `WhisperAdapter` proved the shape, argument lists have
length limits that a long dictation plus a project catalogue can approach, and a request on the command line
would appear in the process table.

---

## R14 — One failure taxonomy, seven members, owned by core

**Decision**:

```ts
type SuggestionFailure =
  | "not-configured"     // no intelligence.md, or none names a transport
  | "misconfigured"      // unrecognised transport, or a required parameter missing
  | "credential"         // named credential absent, unreadable, or rejected
  | "unreachable"        // could not start the process / could not reach the endpoint
  | "timed-out"          // the 120s bound, or the user abandoned
  | "failed"             // started, did not complete: non-zero exit, non-2xx, socket closed mid-response
  | "unusable";          // completed, and the response could not be understood
```

Every failure carries a message written for display. A transport throws its own errors; the module maps them
onto this set. `not-configured` never reaches a message at all, because a client with no transport shows no
affordance.

**Rationale**: FR-062 says all of these land in the same place, and SC-008 tests them as a set. A closed union
in core is what lets both transports be tested against the same expectations, which is the seam's proof.

---

## R15 — The 120-second bound is enforced in core, once

**Decision**: `SuggestionService` creates an `AbortController`, arms a timer for 120 seconds, and passes the
signal to `Transport.send(request, signal)`. Transports honour the signal — the CLI transport kills the child,
the HTTPS transport destroys the request. The bound is a module constant, not a config value; a
`timeoutMs` field on the service deps exists as a **test seam only**, in the spirit of `beforeRename`, with no
code path supplying it in production.

**Rationale**: FR-066a says one number for every transport and not configurable. Enforcing it in core makes
that structural: a transport cannot have its own bound, because the abort arrives from above. Two transports
each implementing a timeout would be two numbers that could drift, and the second one added would be the
place the drift started.

**On abandonment**: the user's cancel and the timer share the controller, so FR-066 and FR-066a are one
mechanism with two triggers, and both produce `timed-out` with different messages.

---

## R16 — `intelligence.md`, in the vault root, in the shapes the vault already uses

**Decision**: A new file at the vault root, read with `readField` and `readListSection` from
`vault/preamble.ts` — the same helpers `identity.md` and `policy.md` use, so the file looks like the ones the
user already hand-edits.

```markdown
# Intelligence

transport: command
command: claude

## Arguments

- -p
- --output-format
- text
```

```markdown
# Intelligence

transport: certificate
endpoint: https://llm.corp.example/v1/messages
certificate: /home/me/.certs/waypoint-client.pem
key: /home/me/.certs/waypoint-client.key
```

Absent file, or a file naming no transport → the layer is off, silently, with no problem reported (FR-054).
An unrecognised `transport:` value, or a recognised one missing a required parameter → one problem naming the
value read and the values that work, the layer off, nothing blocked (FR-055).

**Rationale**: Its own file rather than a section in `policy.md`, for the reason the spec's assumption gives —
policy is read identically by every client by design, and a machine-specific value inside it would break that
premise. Arguments as a `## Arguments` list rather than a space-separated field because splitting on spaces is
lossy for an argument containing one, and because `identity.md`'s `## Aliases` already teaches the user that a
list of things is a list section.

**Secrets**: `certificate:` and `key:` name paths. FR-051b forbids the material itself, and the parser has
nowhere to put it — there is no field whose value is key material, which is the same "cannot be expressed"
discipline as R5. The paths are read at call time by the transport (FR-051c), never at parse time, so a
missing credential is a per-request `credential` failure rather than a startup problem.

---

## R17 — Desktop wiring: the affordance exists only when the layer does

**Decision**: `main.ts` reads `intelligence.md` at startup and after a vault change. With no transport, the
sort window is constructed exactly as Feature 2 built it and the preload API exposes no suggestion methods —
the renderer has nothing to hide, disable, or grey out, because the capability is absent from its API surface.

**Rationale**: FR-060 and SC-002 ask for no control in any state, which a `disabled` attribute does not
satisfy. Feature 5's summary affordance set the precedent — "a client renders no summary affordance at all,
rather than a disabled or broken one" — and the strongest form of that is the renderer not being handed the
verb.

**Alternatives rejected**: rendering the controls and hiding them with CSS (a control that exists and is
invisible is still a control, and one bad selector away from visible); a settings screen offering to configure
a transport (a first-run experience FR-054 forbids).

---

## R18 — Test strategy: five kinds of test carry this feature

1. **Payload identity** — a recording transport asserts `received[0] === prepared.payload` with `===`
   (R4, FR-045, SC-007).
2. **Payload boundary by absence** — markers planted in `identity.md`, `policy.md`, `trash.md`,
   `calendar.md`, `top-three.md`, `log/`, a sibling inbox item, and a project's milestones, next action, DRI,
   status, ledger, and `## Unprocessed`; none may appear in the payload. Extends `summary-payload.test.ts`'s
   shape (FR-042–FR-044, SC-007).
3. **Feature 2 unmodified** — the whole Feature 2 sort suite runs against a build with no transport
   configured. If a Feature 2 test needs editing, the degrade-to-nothing contract is broken. This is a CI
   fact, not a new assertion (FR-060, SC-001).
4. **Transport parity** — one suite, run twice with only the configured value changed, asserting identical
   proposals from identical stubbed responses (FR-050, SC-009). Two fixtures make this real: a
   `fake-llm-cli.sh` in the shape of `fake-whisper-cli.sh`, and a local HTTPS server with a generated
   self-signed client/server pair, both created in the test's temp directory.
5. **The seven failure modes** — each asserted to leave the data directory byte-identical, produce exactly one
   message, and attempt no retry, for both transports (FR-062–FR-065, SC-008).

Plus the property tests R3 and R10 name: `segments.join("") === item.text`, and the piece round-trip through
`parseInbox`.

**Determinism**: `TZ=America/New_York` as everywhere else. Piece timestamps come from the original item, so
no clock is needed for a split; `SuggestionService` takes no `Clock` at all.

---

## R19 — Platform verification

**Decision**: Both transports are exercised on Linux and macOS in CI. The CLI transport's subprocess handling
and the HTTPS transport's TLS both touch platform behaviour; the existing GitHub Actions macOS runner already
produces the macOS release artifacts, and nothing is built or installed on the work machine.

**Known platform risk, tested rather than assumed**: certificate handling differs between the two systems'
OpenSSL builds for some key formats. The test generates its key material at run time in a temp directory, so
the suite proves the transport works with material the running platform produced rather than with a fixture
committed from one developer's machine.
