# Feature Specification: LLM-Assisted Inbox Organization

**Feature Branch**: `008-llm-assisted-inbox-organization`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "I want the app to help me organize my inbox, without ever deciding for me.

When I dictate, I ramble. One recording often holds three or four unrelated thoughts run together, and sometimes a single thought spread across several false starts. Right now sorting that means reading a wall of text and mentally untangling it before I can route anything. I want help with the untangling.

So when I'm sorting, I can ask for suggestions on an inbox item. Two kinds of help. First, splitting: if an item holds several distinct thoughts, it proposes how to break it into separate items, showing me each proposed piece. Second, destination: for an item, or for each piece after a split, it proposes where that belongs — a specific existing project or area, the waiting-for list, trash, or calendar — and says briefly why.

Every suggestion is a proposal I accept, edit, or reject. Nothing is applied because the system produced it. If I accept a split, the pieces become separate inbox items and I sort each one normally. If I accept a destination, it routes through exactly the same sort action I'd use by hand, with all the same rules — nothing bypasses anything, and no behavior exists only in the assisted path. If I reject, the item is untouched, exactly as it was.

Suggestions never happen on their own. I ask for them, per item. Nothing is analyzed in the background, on capture, or when I open the inbox.

Suggesting a destination needs to know what my projects and areas actually are, so it can propose real ones rather than inventing names. It should only ever propose a project or area that exists, or propose creating a new one as a clearly-marked new thing that I confirm.

All of this is optional. If I haven't configured anything, sorting works exactly as it does today — no suggestion controls that don't work, no errors to dismiss, no sign anything is missing. The same is true if whatever I configured is unavailable, unreachable, or fails partway: I'm told plainly, and I sort by hand.

I want to see what would be sent before it's sent, and nothing leaves my machine unless I've explicitly configured it to. The default is that nothing does.

I need this to work in very different places. At home I might use a command-line tool or a model running locally on my own machine. At work, command-line tools are blocked and I'd need to reach a service using certificate-based authentication, or go through an editor integration. So how a model is reached must be a separate, swappable piece of configuration, chosen explicitly in my data directory rather than detected — the same file I'd move between machines. Changing machines should mean changing that one setting, not changing how any of the suggesting works.

This feature does not include the local HTTP API, automatic organizing without my confirmation, suggesting anything about projects or milestones, drafting my weekly review summary, background analysis of any kind, or any change to how capture works."

> **A note on the number.** This is the ROADMAP's **Feature 8**, resequenced ahead of the deferred Feature 7
> (the local HTTP/JSON API). The directory keeps the number 8 because six shipped specs, the core's own source
> comments, and `specs/002-inbox-view-sort/data-model.md` already cite "Feature 8" for exactly this work.
> `specs/007-*` is reserved for the local API if and when it is scheduled.

## Clarifications

### Session 2026-08-17

- Q: Which ways of reaching a model should actually be built in this feature — just the two that cover the home and work machines, or more? → A: Two, chosen to be maximally different in kind: invoking a command-line tool, and a certificate-authenticated HTTPS endpoint. One spawns a process, the other makes an authenticated network call, so between them they exercise the seam against two genuinely different real environments rather than one implementation and a hypothesis. A local model reached over HTTP is a variant of the second and a later, cheap addition; an editor integration is deferred because it depends on a host application's extension surface rather than a protocol the project controls, and is the case most likely to force the interface to bend — which argues for building it second, against a settled interface.
- Q: Given that the data directory is a git repository carried between machines, where should a transport's connection details and credentials live — the endpoint URL, the command to run, the client certificate and its private key? → A: The data directory holds the transport's name and its non-secret parameters — the command to invoke, the endpoint URL, and the filesystem *path* to a certificate or key — and never the secret bytes themselves. The transport reads the credential from that path at call time. This keeps the file safe to commit and hand-readable, keeps the whole configuration in the one place the user edits when they change machines, and makes a missing or unreadable credential a plain reported failure that leaves the layer off, in the same shape as a malformed setting. A leaked data directory leaks no secret.
- Q: How long should Waypoint wait for a model before giving up and telling the user to sort by hand? → A: One fixed ceiling of 120 seconds, the same for every transport, not configurable. The user can already abandon a request at any moment, so the ceiling is not what protects them from waiting — it is a backstop against a hung transport holding a request open forever. One generous number is long enough for a local model on modest hardware and short enough to bound a hang; a per-transport number would be two values to defend and the first thing a reader has to learn about the layer, and a configurable one would be a knob the user must understand before the feature works. Stating the number is what makes the timeout case testable.
- Q: When the system proposes splitting an item, may a proposed piece reword what was dictated, or must each piece be the user's own words taken verbatim from the original? → A: Verbatim only. Each proposed piece is one or more spans of the original item's text, joined — spans may be non-contiguous, so several false starts about the same thing become one piece — and the system never rewords, paraphrases, summarises, or adds. This makes FR-013's no-silent-loss check exact rather than heuristic, preserves the words the user actually said, and keeps the model's task to deciding where the seams are rather than what the user meant. Cleanup remains the user's edit under FR-012, which they can make before accepting. A response containing text that is not a span of the original is a failed response under FR-064, not a proposal to be repaired.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Untangle One Rambling Capture Into Separate Items (Priority: P1)

The user is sorting. The item in front of them is ninety seconds of dictation that starts with a hiring
decision, wanders into a reminder about a dentist appointment, doubles back to restate the hiring thing a
second way, and finishes with something about the deploy pipeline. Today they read it three times and route
the whole thing to whichever destination fits worst-least. Instead they ask for a split. Four proposed pieces
come back, each shown as the text it would become — the two hiring false starts folded into one. They edit the
wording of the deploy one, decide the dentist piece should say the date out loud, and accept. The item is
replaced by four ordinary inbox items sitting exactly where the original sat, and they sort each one the way
they always have.

**Why this priority**: This is the pain the user described. The wall of text is the reason sorting stalls, and
untangling it is the part a person cannot do faster by trying harder. Even with no destination suggestion at
all, a user who can turn one rambling capture into four clean items has got the thing they asked for — the
rest of sorting already works and has since Feature 2.

**Independent Test**: With a transport configured against a stub that returns a fixed split, ask for a split
on a multi-thought inbox item. Confirm each proposed piece is shown in full and consists only of verbatim
spans of the original, that the inbox is unchanged while the proposal is on screen, that accepting replaces
the one item with exactly the accepted pieces in the original's position and carrying its capture timestamp,
that the resulting file is indistinguishable from one the user could have typed by hand, and that rejecting
leaves the file byte-for-byte as it was.

**Acceptance Scenarios**:

1. **Given** an inbox item containing several unrelated thoughts, **When** the user asks for a split, **Then**
   the system presents one proposed piece per distinct thought, each rendered as the full text it would
   become, and writes nothing.
2. **Given** a split proposal on screen, **When** the user edits a piece's text and accepts, **Then** the
   inbox contains the edited text and not the original proposal's text.
3. **Given** a split proposal on screen, **When** the user rejects it, **Then** the inbox is byte-for-byte
   identical to before the request and the item is still the one in front of them.
4. **Given** an accepted split of one item into three, **When** the user looks at the inbox, **Then** there
   are three items in the original's place, each carrying the original's capture timestamp, each sortable by
   the ordinary path, and none of them marked as machine-produced.
5. **Given** an item holding a single coherent thought, **When** the user asks for a split, **Then** the
   system says there is nothing to split rather than manufacturing a division.
6. **Given** a split proposal whose pieces do not between them account for all of the original's text,
   **When** the user goes to accept, **Then** the text that no piece carries is shown, marked as such, before
   the accept can complete.
7. **Given** a split proposal, **When** each piece is compared against the original, **Then** every piece
   consists entirely of spans taken verbatim from the original, and a response containing any other text is
   reported as a failure rather than presented as a proposal.

---

### User Story 2 - Ask Where This Belongs, and Be Told Why (Priority: P2)

The user is on an item that reads "chase Priya about the vendor contract before the board pack goes out". They
ask where it belongs. The system proposes the waiting-for list, with Priya as the owner, and one sentence
saying why: the item is a follow-up on something someone else owes. The user agrees, accepts, and the item
lands in `waiting.md` with today's date — through the same sort action, with the same validation, as if they
had chosen waiting-for from the menu themselves. On the next item the proposal is the *Vendor Consolidation*
project, named because it exists; the user disagrees, picks an area instead, and sorts it by hand from there.

**Why this priority**: Second half of the untangling. Splitting produces four items that each still need a
destination, and choosing among a dozen projects is the other place sorting slows down. It is P2 rather than
P1 because it is useful on its own but the user already has a fast manual path for it, whereas they have no
manual path for untangling that is faster than reading.

**Independent Test**: With a fixture data directory holding several projects and areas, ask for a destination
on an item. Confirm the proposal names exactly one of the five destinations sorting offers; that any project
or area named exists in the fixture; that a proposal to create a new one is visibly distinct from a proposal
to route to an existing one; that a waiting-for proposal carries an editable owner; that accepting produces a
file identical to what the same decision made by hand produces; and that rejecting writes nothing.

**Acceptance Scenarios**:

1. **Given** an inbox item and a data directory containing projects and areas, **When** the user asks for a
   destination, **Then** exactly one destination is proposed, with a brief stated reason, and nothing is
   written.
2. **Given** a proposal naming a project, **When** the user checks it, **Then** that project exists in the
   data directory as of the moment the proposal was made.
3. **Given** a proposal to create a new project or area, **When** it is presented, **Then** it is visibly
   marked as new rather than existing, and nothing is created until the user confirms the title.
4. **Given** a proposal of the waiting-for list, **When** it is presented, **Then** it also proposes the owner
   it would be recorded against, and the user can change that owner before accepting.
5. **Given** an accepted destination proposal, **When** the write completes, **Then** the destination file and
   the inbox are identical to what the same decision taken by hand would have produced, with no record that
   anything was proposed.
6. **Given** a project created by hand in another window since the sort session began, **When** the user asks
   for a destination, **Then** that project is among the ones that can be proposed.
7. **Given** an accepted split, **When** the user asks for a destination on one of the resulting pieces,
   **Then** the proposal is about that piece alone.

---

### User Story 3 - See Exactly What Would Leave the Machine (Priority: P3)

Before anything is sent, the user can read the exact content of the request, in full and verbatim: the item's
own words, and — for a destination proposal — the titles of the projects and areas it is choosing among. They
recognize all of it. Nothing about a different inbox item, nothing from `identity.md`, nothing from the
weekly logs, nothing from `trash.md`. It is the same view whether the transport is a local model on their own
machine or their employer's endpoint, which is what makes it worth reading at work.

**Why this priority**: The user asked for it in as many words, and it is the check that makes every other
promise in this spec falsifiable rather than assertable. It ranks below the two capabilities because with no
transport configured nothing is sent at all, so there is nothing to inspect until Stories 1 and 2 exist.

**Independent Test**: With a recording stub transport, ask for a split and a destination. Confirm the content
displayed before sending is byte-identical to the content the transport received, and that the content
contains the item text (and, for a destination, the destination titles) and nothing else drawn from the data
directory.

**Acceptance Scenarios**:

1. **Given** a suggestion request about to be made, **When** the user looks, **Then** the exact content that
   would be sent is shown in full before it is sent.
2. **Given** a split request, **When** the content is inspected, **Then** it contains that item's text and no
   other item, file, or configuration value from the data directory.
3. **Given** a destination request, **When** the content is inspected, **Then** it contains the item's text
   and the identifying details of existing projects and areas, and nothing else.
4. **Given** any suggestion request, **When** the content is inspected, **Then** it contains nothing from
   `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, or `log/`.

---

### User Story 4 - Nothing Configured, or Something Broke — Sort by Hand, Unbothered (Priority: P4)

A colleague clones Waypoint and opens their inbox. They see Feature 2's sort walk and nothing else: no
suggestion control, no greyed-out button, no "configure a model" prompt, no error. Later, the user is at work
with a configured endpoint that their VPN has dropped. They ask for a split; one plain message says the
transport could not be reached. The item is exactly as it was, and they sort it immediately by hand. On a
third machine the transport setting has a typo; the message names the setting and the words that work, the
layer stays off, and sorting is untouched.

**Why this priority**: It is ordered last because it delivers no capability of its own — and it is the
constraint every story above it must satisfy, verified within each of them rather than only here. This is the
roadmap's degrade-to-nothing contract, already shipped once as Feature 5's summary port behavior, becoming
the whole layer's rule.

**Independent Test**: Run the full Feature 2 sort suite against a build of this feature with no transport
configured and no network available, and confirm it passes unmodified and the resulting files are byte-
identical to Feature 2's. Then, with a transport configured to fail in each of four ways — unreachable,
timing out, returning unusable content, failing partway through — confirm each produces one plain message, no
write, and an immediately sortable item.

**Acceptance Scenarios**:

1. **Given** no transport configured, **When** the user sorts their inbox end to end, **Then** the experience
   and the resulting files are identical to Feature 2's, with no suggestion affordance present in any state.
2. **Given** no transport configured, **When** the user sorts, **Then** no network request, process
   invocation, or inter-process call is made at any point.
3. **Given** a configured transport that is unreachable, **When** the user asks for a suggestion, **Then**
   one plain message says so, the item is unchanged, and the ordinary sort path is available immediately.
4. **Given** a transport that fails partway through a response, **When** the failure occurs, **Then** it is
   reported as a failure and no partial or repaired proposal is presented.
5. **Given** a transport setting that is not recognized, **When** Waypoint opens the data directory, **Then**
   the problem is reported plainly, the layer is off, and every other capability works normally.
6. **Given** any failure, **When** it is reported, **Then** no automatic retry occurs; a second attempt is a
   second explicit request by the user.

---

### User Story 5 - Move Between Home and Work by Changing One Line (Priority: P5)

The user's data directory is a git repository they carry between a home machine and a work laptop. At home the
transport setting names a command-line tool. At work, where command-line tools are blocked, they change that
one value to the certificate-authenticated endpoint their employer runs. Nothing else changes — not the
prompts, not what is proposed, not how a proposal is accepted, not a single rule in this spec. They can read
the setting in vim, and it is the same file on both machines.

**Why this priority**: It is the portability motivation the whole project exists for, and it is P5 because
one working transport is enough to prove Stories 1 through 4; the second is what proves the seam is real.

**Independent Test**: Run the identical suggestion test suite twice, once against each of two genuinely
different transports, changing only the configured value between runs. Confirm both runs produce the same
proposals from the same stubbed responses, exercise the same acceptance path, and write identical files.

**Acceptance Scenarios**:

1. **Given** a data directory with a transport setting, **When** the user changes only that value, **Then**
   the model is reached differently and nothing about what is proposed or how it is accepted changes.
2. **Given** a data directory moved to another machine, **When** the user opens it, **Then** the transport in
   use is the one the setting names, regardless of what tools, endpoints, or editors that machine has
   available.
3. **Given** a machine with a command-line tool on `PATH` and a local model listening, **When** the transport
   setting is absent, **Then** neither is used and the layer is off.
4. **Given** the transport setting, **When** the user opens the data directory in a text editor with no
   application running, **Then** the setting is readable and editable as plain text.

---

### Edge Cases

- **The item changes on disk between showing a proposal and accepting it** — because the user edited
  `inbox.md` in vim, or captured from another window. Accepting is refused, nothing is written, and the item
  is shown as it now reads. This is Feature 2's `item-changed` rule; the assisted path gets no exemption.
- **A split proposal contains text the original never had** — the model rewrote rather than divided. This is
  a failed response, not a proposal: nothing is shown, the failure is reported, and the item is sortable by
  hand immediately (FR-010b, FR-064). The user may of course write anything they like into a piece once a
  valid proposal is on screen; the constraint is on what the system may propose, not on what the user may
  type.
- **A split proposes exactly one piece**, identical to the original. Accepting it is a no-op the user should
  not have to think about; it is presented as "nothing to split" rather than as a one-piece proposal.
- **A destination proposal names a project that was deleted between the proposal and the accept.** Feature 2's
  `destination-missing` refusal fires. Nothing is written and the user chooses again.
- **A destination proposal names a project that does not exist at all** — the model invented it. It is never
  presented as an existing destination; it is either dropped or shown as a proposal to create something new,
  which the user confirms by title (FR-022, FR-023).
- **A waiting-for proposal with no owner in the item's text.** The owner field is proposed empty and the user
  supplies it; Feature 2 already refuses an empty owner, and that refusal is what fires if they do not.
- **An accepted split where the user deleted every piece.** There is nothing to write; the accept is refused
  and the original item stands. Discarding an item is what trash is for, and it is one sort decision away.
- **A very long item** — twenty minutes of dictation. There is no length at which the system declines to try;
  a transport that cannot carry it fails, and a failure is already specified.
- **A transport that succeeds but returns something the system cannot make sense of.** Treated as a failure,
  not as a partial proposal to be repaired (FR-064).
- **A transport that hangs.** Bounded at 120 seconds, reported as a failure, and abandonable by the user
  before then without leaving the item changed.
- **The certificate the transport setting points at is missing, unreadable, or expired** — the ordinary case
  on a machine where the credential was never installed, or the day it rolls over. Reported plainly, naming
  the path and the problem but never the material; the layer is off for that request and sorting is untouched.
- **The data directory is committed and pushed with a transport setting in it.** Nothing secret goes with it:
  the file holds a command, an address, and a path. The path may not resolve on another machine, which is the
  missing-credential case above and is reported, not silent.
- **Two windows sorting the same inbox**, one holding a proposal while the other routes the item. The holder's
  accept is refused by the `item-changed` verification. No new concurrency rule is introduced.
- **The user asks for a split, then asks again on the same item.** A second explicit request. Nothing is
  cached, and the second proposal may differ from the first; whichever is on screen is the one that can be
  accepted.
- **An empty or whitespace-only inbox item.** Feature 2's parser treats only lines with text as routable, so
  there is no such item to ask about.
- **The data directory has no projects and no areas at all.** A destination proposal can still name
  waiting-for, trash, or calendar, or propose creating a project or area. It cannot name an existing one,
  because there are none.

## Requirements *(mandatory)*

### Functional Requirements

#### Asking for help — the request is always the user's

- **FR-001**: A suggestion MUST be produced only in response to an explicit user request, made about one
  named inbox item, while sorting.
- **FR-002**: The system MUST NOT produce, prepare, pre-fetch, or send a suggestion on capture, on opening the
  inbox, on advancing to an item, on a timer, on idle, or as part of any background or batch pass.
- **FR-003**: The two kinds of help — splitting an item, and proposing a destination — MUST be requestable
  independently. Asking for one MUST NOT cause the other to be requested, sent, produced, or presented.
- **FR-004**: A suggestion request MUST be scoped to exactly one inbox item or, after an accepted split, one
  resulting piece. A request covering several items, a range, or the remaining inbox MUST NOT be offered.
- **FR-005**: Requesting a suggestion MUST NOT modify the inbox or any destination. Until the user accepts,
  every file in the data directory MUST be byte-identical to what it was before the request. This is FR-035's
  guarantee at the moment of asking.
- **FR-006**: The user MUST be able to abandon a request while it is in flight and return to sorting by hand
  with the item untouched.

#### Splitting a captured item

- **FR-010**: A split proposal MUST present the item broken into proposed pieces, each shown in full as the
  exact text it would become if accepted.
- **FR-010a**: Every proposed piece MUST consist solely of text taken verbatim from the original item. A
  piece MAY join several spans of the original, and those spans MAY be non-contiguous, so that separate false
  starts about one thing become one piece. The system MUST NOT reword, paraphrase, summarise, correct, or add
  text.
- **FR-010b**: A response proposing any text that is not a span of the original item MUST be treated as a
  failed response under FR-064. It MUST NOT be presented as a proposal, and MUST NOT be repaired, trimmed, or
  partially accepted.
- **FR-011**: When the item holds a single thought, the system MUST say there is nothing to split rather than
  manufacturing a division into pieces.
- **FR-012**: Every proposed piece MUST be editable before acceptance. The user MUST be able to change a
  piece's text, remove a piece, and reject the proposal in its entirety.
- **FR-013**: Any text of the original item that no proposed piece carries MUST be shown to the user, marked
  as not carried into any piece, before an accept can complete. Dictated content MUST NOT be dropped
  silently. Because pieces are verbatim spans (FR-010a), this coverage MUST be computed exactly rather than
  estimated.
- **FR-014**: Accepting a split MUST replace the original item with the accepted pieces as separate inbox
  items in a single operation: either every piece is written and the original removed, or nothing changes.
- **FR-015**: Each resulting piece MUST be an ordinary inbox item, indistinguishable on disk from one the user
  captured or typed by hand — the same format, routable by the same rules, carrying no marker, field, or
  annotation recording that a machine proposed it.
- **FR-016**: The resulting pieces MUST carry the original item's capture timestamp and MUST occupy the
  original's position in inbox order, so that inbox order remains capture order and an item hand-written with
  no timestamp yields pieces with none.
- **FR-017**: Rejecting a split MUST leave the item byte-for-byte as it was.
- **FR-018**: If the item's bytes on disk no longer match what was shown, accepting a split MUST be refused,
  nothing MUST be written, and the item MUST be shown as it now reads — the same verification and the same
  refusal sorting already performs.
- **FR-019**: Accepting a split with no pieces remaining MUST be refused and MUST leave the original item in
  place.

#### Proposing a destination

- **FR-020**: A destination proposal MUST name exactly one of the destinations sorting already offers: a
  specific existing project, a specific existing area, the waiting-for list, trash, or calendar. No sixth
  destination MUST be introduced.
- **FR-021**: A destination proposal MUST carry a brief stated reason, expressed in terms of the item's own
  content.
- **FR-022**: A project or area named as an existing destination MUST exist in the data directory as of the
  moment the proposal was made. A name that does not resolve to an existing project or area MUST NOT be
  presented as an existing destination.
- **FR-023**: The system MAY propose creating a new project or area. Such a proposal MUST be presented as
  distinctly new — visibly different from routing to something that exists — and the title MUST be confirmed
  by the user before anything is created.
- **FR-024**: The set of existing projects and areas MUST be read fresh at the moment of the request, so a
  destination created, renamed, or removed by hand or in another window is reflected without a restart.
- **FR-025**: A proposal of the waiting-for list MUST also propose the owner it would be recorded against,
  drawn from the item's own text and left empty when the text names nobody. The user MUST be able to edit or
  replace the owner before accepting.
- **FR-026**: A destination proposal MUST be requestable for a whole item and, after an accepted split, for
  each resulting piece individually.
- **FR-027**: The user MUST be able to accept the proposal, choose a different destination, or reject it.
  Rejecting MUST leave the item exactly as it was.
- **FR-028**: The system MUST NOT rank, score, pre-select, or default to a proposed destination in the manual
  sort interface. A proposal exists only inside a proposal the user asked for.

#### Acting on a proposal — exactly one path to a destination

- **FR-030**: Accepting a destination MUST route the item through the same sort action the user would use by
  hand, with the same validation, the same refusals, the same journaling and crash recovery, and the same
  policy consultation.
- **FR-031**: No destination, rule, refusal, side effect, or capability MUST exist only on the assisted path.
  Anything reachable by accepting a proposal MUST be reachable by sorting by hand.
- **FR-032**: What is written to a destination MUST be identical to what the same decision made by hand
  produces. Nothing on disk MUST record that a suggestion was requested, produced, accepted, or rejected.
- **FR-033**: A refusal returned by the sort action MUST be surfaced to the user unchanged, and MUST NOT be
  retried, worked around, suppressed, or answered with a fresh proposal automatically.
- **FR-034**: This feature MUST NOT declare a new policy decision point, and the number of decision points
  MUST remain five, as Feature 5 left it. A suggestion is a proposal for a human to accept or reject, never an
  allow, warn, or block.
- **FR-035**: Nothing MUST be applied because the system produced it. Every write reachable through this
  feature MUST be traceable to an explicit user acceptance of specific content the user was shown.

#### What is sent, and what never is

- **FR-040**: Nothing MUST leave the machine unless the user has explicitly configured a transport that sends
  it. With no transport configured, no network request, process invocation, or inter-process call MUST be made
  at any point in this feature.
- **FR-041**: The exact content that would be sent MUST be presented to the user, in full and verbatim,
  before it is sent, and the send MUST be an explicit act the user takes with that content available to read.
- **FR-042**: The content sent for a split request MUST be the item's own text and nothing else. No other
  inbox item, no project or area file, no waiting-for entry, no log, and no configuration value MUST be
  included.
- **FR-043**: The content sent for a destination request MUST be the item's (or piece's) own text together
  with the identifying details of existing projects and areas, and nothing else.
- **FR-044**: The identity configuration, the policy configuration, the discard list, the calendar staging
  list, the top-three record, and the weekly logs MUST NOT be sent by this feature under any circumstance.
- **FR-045**: The content displayed under FR-041 MUST be the content the transport receives. A discrepancy
  between what is shown and what is sent MUST be impossible by construction, not avoided by discipline.
- **FR-046**: Nothing sent and nothing returned MUST be written to the data directory except through a user
  acceptance under FR-014 or FR-030. A proposal the user does not accept MUST leave no trace on disk. This is
  FR-035's guarantee at the moment of answering; FR-035 states the rule, and FR-005 and this requirement name
  the two moments it has to hold.

#### How a model is reached — the transport seam

- **FR-050**: *What* is asked for and *how* the model is reached MUST be separate, independently replaceable
  concerns. Changing which transport is used MUST NOT change what is proposed, how it is presented, how it is
  accepted, or any rule in this specification.
- **FR-051**: The transport MUST be chosen by an explicit value stored in the git-tracked data directory,
  alongside the policy and identity configuration, in plain text the user can read and edit with a text editor
  and no application running.
- **FR-051a**: The transport's non-secret parameters — the command to invoke, the endpoint address, and the
  filesystem path at which a credential is found — MUST be stored with that same value, so a user changing
  machines edits one place.
- **FR-051b**: A secret MUST NOT be stored in the data directory. No certificate private key, password, token,
  or other credential material MUST be written to, read from, or required to be placed in the data directory
  by this feature. The data directory MUST remain safe to commit.
- **FR-051c**: A transport requiring a credential MUST read it at call time from the path its configuration
  names. A credential that is absent, unreadable, or rejected MUST be reported plainly, MUST leave the layer
  off for that request, and MUST NOT block or degrade sorting — the same treatment FR-055 gives a malformed
  setting.
- **FR-051d**: A credential's contents MUST NOT be displayed in the payload preview, written to the data
  directory, or included in any message shown to the user. A message about a credential MUST name the path
  and the problem, never the material.
- **FR-052**: The transport MUST NOT be auto-detected. The system MUST NOT probe for a command-line tool on
  `PATH`, a listening local model, an editor host, an environment variable, or any other environment signal
  in order to choose one.
- **FR-053**: Moving the data directory to another machine and changing that one value MUST be sufficient to
  change how the model is reached. No other file in the data directory and no application-level setting MUST
  need to change.
- **FR-054**: An absent transport setting MUST mean the layer is off, silently and normally — not an error,
  not a prompt, not a first-run experience.
- **FR-055**: An unrecognized or malformed transport setting MUST be reported plainly, naming the value read
  and the values that work, MUST leave the layer off, and MUST NOT block or degrade any part of sorting.
- **FR-056**: This feature MUST ship exactly two transports, and they MUST be different in kind: one that
  reaches a model by invoking a command-line tool, and one that reaches a model over HTTPS authenticated by a
  client certificate. Both MUST satisfy every requirement in this specification identically.
- **FR-056a**: The suggestion behavior MUST be verified against both shipped transports, so the seam is
  proven against two genuinely different real environments rather than against one implementation and a
  hypothesis.
- **FR-057**: No plugin loader, module discovery mechanism, or public extension API MUST be built. The
  suggestion interfaces and the transport interface are internal, with the transports that ship wired by that
  one explicit configuration value — the same restraint the policy seam observes.
- **FR-058**: A transport MUST have no knowledge of task management. Nothing about projects, areas, inbox
  items, destinations, or sorting MUST appear in the transport's interface; it carries request content out and
  brings response content back.

#### Absence and failure

- **FR-060**: With no transport configured, sorting MUST behave exactly as Feature 2 shipped it: no suggestion
  control in any state, no disabled or greyed control, no placeholder, no error, and no indication that
  anything is missing or could be configured.
- **FR-061**: Every capability of sorting MUST work with no transport configured and no network available.
  Nothing in the capture, sort, project, review, or retrospective workflows MUST come to depend on this
  feature.
- **FR-062**: A transport that is unconfigured, unavailable, unreachable, times out, returns nothing usable,
  or fails partway MUST land in the same place: the feature is simply not there for that request, and the
  user does the thinking themselves.
- **FR-063**: A failure MUST be reported plainly in one message the user can dismiss, MUST leave the item
  exactly as it was, and MUST NOT block, delay, or alter sorting by hand. The ordinary sort path MUST be
  available immediately after a failure.
- **FR-064**: A response the system cannot make sense of MUST be treated as a failure. It MUST NOT be
  presented as a partial proposal, a repaired proposal, or a best-effort guess.
- **FR-065**: The system MUST NOT retry automatically. A second attempt MUST be a second explicit request by
  the user.
- **FR-066**: A request MUST be abandonable by the user at any point, and abandoning MUST leave the item
  unchanged.
- **FR-066a**: A request MUST be bounded at 120 seconds. The bound MUST be the same for every transport and
  MUST NOT be configurable. Exceeding it MUST be treated as a failure under FR-063: one plain message, no
  write, no automatic retry, and the ordinary sort path available immediately.

#### Durability and scope of what this writes

- **FR-070**: Everything this feature writes MUST be the plain text sorting already writes, in the files
  sorting already writes to. No new file format, index, cache, history, or store of proposals MUST be
  introduced.
- **FR-071**: This feature MUST NOT change how capture works — not the capture surface, not its latency
  budget, not the inbox format it appends, and not the transcription path.
- **FR-072**: This feature MUST NOT propose, suggest, or produce anything about a project's outcome,
  milestones, next action, DRI, or status; about weekly outcomes or the top three; or about the weekly review.
  Its whole subject is one inbox item and where it goes.

### Key Entities

- **Suggestion request**: One explicit ask by the user, about one inbox item or one piece, of one kind
  (split or destination). Carries the item's identity as sorting understands it, and the exact content that
  would be sent. Exists only between the ask and the accept-or-reject; nothing about it is stored.
- **Split proposal**: An ordered set of proposed pieces derived from one item, together with whatever text of
  the original no piece carries. Editable in full. Accepted as a set or not at all.
- **Proposed piece**: Candidate text for one inbox item, composed of one or more verbatim spans of the
  original — possibly non-contiguous — before the user edits it. Becomes an ordinary inbox item on
  acceptance, inheriting the original's capture timestamp and position, and carrying nothing that
  distinguishes it.
- **Destination proposal**: One named destination from sorting's existing five, a brief reason, and — where
  the destination requires one — the field it would be recorded with (a waiting-for owner, a title for a
  project or area to be created). Marked as existing or as new.
- **Transport setting**: The explicit value in the data directory naming how a model is reached, together
  with that transport's non-secret parameters — the command to invoke, the endpoint address, the path at
  which a credential is found. Absent by default, meaning the layer is off. Read as plain text; never
  inferred from the machine; never holding a secret.
- **Existing destination**: A project or area that is present in the data directory, identified by the same
  slug and title sorting already uses. The only projects and areas a proposal may name as existing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With no transport configured, a full inbox sort walk produces files byte-identical to those
  Feature 2 produces for the same decisions, and Feature 2's entire test suite passes unmodified.
- **SC-002**: With no transport configured, a user sorting their inbox encounters zero suggestion controls,
  zero disabled controls, zero prompts, and zero errors relating to this feature.
- **SC-003**: 100% of writes reachable through this feature are traceable to an explicit user acceptance of
  content the user was shown; across the whole test corpus, no proposal reaches disk unaccepted.
- **SC-004**: Across a corpus of at least 20 destination proposals against a fixture data directory, 100% of
  projects and areas named as existing destinations exist in that directory, and 0 invented names are
  presented as existing.
- **SC-005**: For the same decision, the file contents produced by accepting a proposal and by sorting by hand
  are identical — verified for all five destinations, plus create-a-project and create-an-area.
- **SC-006**: A dictated item holding four unrelated thoughts becomes four correctly separated inbox items in
  under 60 seconds of user time, against a baseline of reading and re-capturing by hand.
- **SC-007**: The content displayed before sending matches the content the transport receives, byte for byte,
  in 100% of requests, across both split and destination requests.
- **SC-008**: Across all seven failure modes — unconfigured, unreachable, timeout, unusable response,
  mid-stream failure, malformed transport setting, missing or unreadable credential — the data directory is
  unchanged, exactly one plain message is shown, no automatic retry occurs, and the item is sortable by hand
  immediately.
- **SC-008a**: A transport that never answers is abandoned at 120 seconds, measured from the send, for both
  shipped transports.
- **SC-009**: Switching environments requires editing one setting in one file in the data directory; no other
  file in the data directory changes, and the suggestion test suite passes identically against both shipped
  transports.
- **SC-009a**: Zero secret material — private keys, passwords, tokens — is written to or required to be
  present in the data directory, verified by scanning the whole directory after exercising both transports.
- **SC-010**: Zero files outside those sorting already writes are created, modified, or read for the purpose
  of storing proposals.
- **SC-011**: The number of policy decision points remains five, and no rule in this feature is expressed as
  an allow, warn, or block.
- **SC-012**: Rejecting any proposal, of either kind, leaves every file in the data directory byte-identical
  to its state before the request — verified for both kinds across at least 10 rejections.
- **SC-013**: Across a corpus of at least 20 split proposals, 100% of proposed piece text is present verbatim
  in the original item, and every response containing text that is not is reported as a failure rather than
  shown — 0 reworded pieces presented.

## Out of Scope

Explicitly excluded, and named here so a later feature can claim them rather than this one growing into them:

- **The local HTTP/JSON API** (Feature 7, deferred). The intelligence layer reaches a model from inside the
  application; it does not expose Waypoint's verbs over a network, and nothing here changes Feature 7's
  status or the guards that keep HTTP out of core.
- **Organizing anything without the user's confirmation.** No auto-apply, no "accept all", no confidence
  threshold above which a proposal is applied, no queue of pre-approved decisions.
- **Suggesting anything about projects or milestones** — outcomes, milestone wording, next actions, DRIs,
  status changes, or draining a project's `## Unprocessed` section. Feature 3 deliberately left automatic
  conversion of an unprocessed item to a later feature; this is not that feature, because the user excluded
  it.
- **Drafting the weekly review summary.** Feature 5 shipped `SummaryProvider` with no provider, and the
  ROADMAP anticipated that Feature 8 would supply one. **The user has explicitly excluded it from this
  feature**, so no provider is supplied here and the summary port is not reached. The deviation is recorded
  rather than silently resolved: the port still exists, unimplemented, awaiting a feature that claims it. This
  spec neither changes nor removes it.
- **Background analysis of any kind** — pre-computing suggestions, warming a cache, indexing the inbox,
  scanning on capture, or any work not initiated by an explicit per-item request.
- **Any change to how capture works.** The capture surface, its latency budget, its transcription path, and
  the inbox format it appends are untouched.
- **A plugin loader, transport discovery, or a public extension API.** Adding a transport is a code change
  wired by an explicit configuration value, exactly as adding a policy module would be.
- **A transport for a locally-running model reached over HTTP.** A near-variant of the certificate-
  authenticated HTTPS transport rather than a third shape, and cheap to add once the interface has survived
  two environments. Deferred deliberately, not overlooked.
- **A transport that reaches a model through an editor integration.** The case the user named for work as an
  alternative to certificate authentication. It depends on a host application's extension surface rather than
  on a protocol this project controls, which makes it the transport most likely to force the interface to
  change — so it is worth building second, against a settled interface, rather than first alongside one.
- **Auto-detecting the environment.** Probing for a CLI, a listening model, or an editor host is forbidden by
  FR-052, not merely unimplemented.
- **Learning from the user's decisions.** No history of accepted or rejected proposals, no per-user tuning, no
  feedback signal. Nothing about a proposal is stored, which makes this structural.
- **Suggesting across several items at once**, deduplicating the inbox, merging two items, or reordering it.
  Splitting is one item into several; the inverse is not in scope.
- **Editing a destination file's contents.** A proposal routes an item; it does not rewrite the project it
  lands in.
- **Undo for an accepted proposal.** Sorting has no undo and this path is sorting; trash is append-only and
  recoverable by hand, which is Feature 2's answer and stays the answer.

## Assumptions

- **Splitting and destination-suggestion are two separate requests, never one combined call.** The user
  described "two kinds of help" with independent accept/edit/reject, and asking for one should not send the
  other's content. A combined request would also mean producing a destination proposal for pieces the user has
  not yet agreed exist — a suggestion they did not ask for, which FR-001 forbids.
- **Pieces from an accepted split inherit the original's capture timestamp and position.** Sorting presents
  items in capture order, and stamping pieces with the time of the split would move a two-week-old thought to
  the front of the queue. The pieces are the same thought, divided; they were captured when the original was.
  An item with no timestamp — hand-typed into `inbox.md` — yields pieces with none, because inventing one
  would be worse than the absence Feature 2 already handles.
- **A destination request sends each project's and area's title along with what it is for**, not the bare
  slug and not the whole file. The user's own framing was that suggesting a destination "needs to know what my
  projects and areas actually are"; a list of slugs does not say that, and a proposal made from slugs alone
  would be name-matching dressed up as judgment. The line is drawn at the project's stated outcome — the one
  field that says what "done" means, which is what a person uses to decide — and nothing further. Milestones,
  next actions, DRIs, status, ledger entries, and `## Unprocessed` contents are not sent. Areas have no
  outcome, so an area sends its title alone. The preview under FR-041 is what makes this checkable rather
  than promised.
- **The preview is shown as part of asking, not as an extra confirmation step.** The user asked to see what
  would be sent before it is sent; the request is already an explicit per-item act, and requiring a second
  confirmation of every request would make the assisted path slower than sorting by hand and stop being used.
  Presenting the exact content in the same view where the request is made satisfies "before it's sent"
  without a modal to click through, and it matches Feature 5's FR-109, which made the payload inspectable
  rather than blocking.
- **The system divides; it does not write.** Restricting pieces to verbatim spans is what turns FR-013's
  no-silent-loss guarantee from a heuristic into arithmetic: with paraphrase allowed, a cleaned-up piece
  carries almost none of the original literally, so the check would either fire on every proposal or be
  reduced to a similarity score that is wrong in both directions. It also keeps the model's job to the part
  it is reliable at — finding where one thought ends and the next begins — rather than deciding what the user
  meant. The cost, accepted, is that pieces read like dictation, stutters and all; FR-012 already lets the
  user clean any of them up before accepting, and their words are the thing worth defaulting to.
- **Text the user removes from a split is shown before the accept, not preserved on disk.** Dictated content
  disappearing silently is the failure this feature could most plausibly cause, and surfacing it is enough:
  the user can see what would be lost and put it back. Writing the discarded remainder to `trash.md` was
  considered and rejected — it would make an accepted split a two-destination write, and the user removing a
  false start is exactly the case where they *want* it gone.
- **A split is accepted as a set, in one operation.** Half a split is not a state the inbox should be able to
  hold: an interruption between writing piece two and removing the original would duplicate the user's text.
  Sorting already journals its writes and recovers them; this reuses that discipline rather than inventing a
  second one.
- **The assisted path records nothing about itself, which is enforced by the existing shape of a sort
  decision rather than by a rule.** Feature 2 deliberately gave its decision type no `suggestedBy` field
  ("that would be the first step toward acting on one"). This feature calls that same action and inherits the
  impossibility. FR-032 states the requirement; the data model is what makes it structural.
- **This feature declares no decision point, and the count stays at five.** A proposal carries no opinion the
  system enforces — the user is free to reject every one, and the destination they choose is checked by
  whatever rules the sort action already consults. There is nothing here to allow, warn, or block, and adding
  a point would put an opinion in a layer whose entire premise is that it holds none.
- **The intelligence module is one module with one default implementation**, matching the policy seam's
  restraint. Someone who disagrees with how it *thinks* would write another; that is the expensive, rare case
  and the seam exists for it, unpublished. Adding a transport is the cheap, common case and is what this
  feature makes routine.
- **The 120-second ceiling is a backstop against a hang, not a latency budget.** The user's ability to abandon
  a request is the real control over waiting, which is why the ceiling can afford to be generous rather than
  tuned: it exists so a transport that never answers cannot hold a request open forever. One number for both
  transports is deliberate — a per-transport bound would be two values to defend and the first thing a reader
  has to learn about the layer, and a configurable one would be a setting the user must understand before the
  feature works, when the whole layer is meant to be one setting. The consequence of the number being slightly
  wrong is a plain message and manual sorting, which is a mild failure by design.
- **The transport setting lives in its own file, separate from `policy.md` and `identity.md`.** Those two are
  already separate from each other for the same reason — they are different concerns with different
  lifetimes — and the transport is a fact about *this machine's* reach, the one value a user changes when they
  move. Putting it in `policy.md` would mean a machine-specific value inside a file whose whole point is that
  every client reads identical rules from it. The exact filename and format are the plan's to settle, as the
  ROADMAP says.
- **A path to a credential is not a credential, and that distinction is what keeps the configuration in one
  file.** Storing the secret would put a private key in a git repository and make safety depend on the user
  remembering to exclude it — discipline, which Principle V exists to replace with structure. Storing nothing
  about the connection would mean editing two files in two places on every machine change, which is the thing
  the user asked not to do. Naming the path is the only arrangement where the committed file fully describes
  how this machine reaches a model and still leaks nothing if the repository is read by someone else. The
  cost, accepted, is that a data directory moved to a machine without the credential installed produces a
  reported failure rather than working — which is correct, and is the same failure as an unreachable endpoint.
- **Nothing here is a capture surface**, so Principle VI's latency budget does not apply. The user is waiting
  on a model they explicitly asked to consult; the requirement is that the wait is bounded, abandonable, and
  never blocks the manual path — not that it is instant.
- **The system may propose trash.** It is one of Feature 2's five destinations and the user named it. It is
  worth stating because a proposal to discard is the one a user should scrutinise most, and the answer is the
  same as for every other: they accept, change, or reject it, and trash is append-only and recoverable by
  hand.
- **A model that proposes a destination the item does not support is a failed response, not a special case.**
  If a proposal cannot be expressed as one of the five decisions sorting accepts, there is nothing to present,
  and FR-064 already says what happens to a response that cannot be made sense of.
- **Everything this feature needs already exists.** Sorting's verb, its five destinations, its item
  verification, its journal and recovery, its fresh read of projects and areas, and the interface shape a port
  takes were all shipped by Features 1 through 5. This feature adds the intelligence module, the transports,
  and one configuration value — and reads nothing and writes nothing that sorting does not already read and
  write.
