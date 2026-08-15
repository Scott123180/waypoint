<!--
Sync Impact Report
Version change: 1.0.0 → 2.0.0
Modified principles:
  - V. The Core Enforces Process → V. Enforced Process, Separable Policy
    (BACKWARD-INCOMPATIBLE REDEFINITION) Process enforcement remains mandatory
    and unbypassable, but process rules are no longer core domain logic. Core now
    declares named decision points and consults a registered policy module;
    decisions are allow/warn/block plus a displayable reason. Policy configuration
    is stored in the git-tracked data directory alongside projects, areas, and the
    inbox. Exactly one default policy module ships; plugin loaders, module
    discovery, and any public extension API are explicitly out of scope — the seam
    and interface only, internal until deliberately published.
    Prior behavior no longer required: rules encoded directly inside core domain
    logic. Such code now violates the principle and must be relocated behind a
    policy module at a core decision point.
Added sections: none
Removed sections: none
Principle count unchanged: seven (I-VII)
Templates requiring follow-up:
  - .specify/templates/plan-template.md — ⚠ pending manual review to confirm its
    Constitution Check gates reference these seven principles by name
  - .specify/templates/spec-template.md — ⚠ pending manual review for alignment
  - .specify/templates/tasks-template.md — ⚠ pending manual review to ensure
    TDD ordering (tests before implementation) is enforced in generated tasks
Shipped features re-assessed against amended Principle V (original Constitution
Check rows preserved as historical record; a dated "Constitution Amendment Note"
was appended to each plan rather than rewriting the prior assessment):
  - specs/001-quick-capture/plan.md — no policy present; no code change required
  - specs/002-inbox-view-sort/plan.md — no policy present; no code change required
  - specs/003-project-structure/plan.md — two rules reclassified as policy:
    MILESTONE_CAP (block) and the open-milestones confirmation (warn). Both to
    migrate behind decision points as part of Feature 4, which must build the
    policy seam regardless. The structure flag stays in core: derived, read-time,
    non-blocking — a fact about the file, not an opinion about how to work.
Superseded statements left in place as historical record:
  - specs/003-project-structure/plan.md "A scope note on Principle V"
  - specs/003-project-structure/research.md (process rules "live in the core")
  - specs/003-project-structure/spec.md (milestone cap cites Principle V)
Deferred TODOs:
  - TODO(RATIFICATION_DATE): original adoption date unknown; 2026-08-09 (the date
    of first ratification) is retained as the ratification date.
-->

# Waypoint Constitution

## Core Principles

### I. Test-First Development (NON-NEGOTIABLE)
Tests MUST be written before any implementation code and MUST be observed to fail
for the right reason before implementation begins. No task, feature, or fix may
be merged without a preceding failing test that its implementation makes pass.
The Red-Green-Refactor cycle is mandatory; skipping the "Red" step is a
constitution violation, not a style preference.

**Rationale**: TDD is the only mechanism that guarantees every behavior is
specified and verified before it exists, preventing untested logic from
accumulating in a system whose other principles (offline, plain-text,
process-enforcing) depend on correctness being provable, not assumed.

### II. Library-First Architecture
Every feature MUST be implemented as a standalone core module (library) with a
well-defined interface, independent of any client. Clients (CLI, GUI, TUI, or
any other surface) are thin consumers only: they MAY render, route input, and
call the core, but MUST NOT contain domain logic, business rules, or duplicate
state. If two clients need the same behavior, that behavior belongs in the
core, not copied between them.

**Rationale**: Keeping domain logic in one place is what makes multiple clients
possible without divergence, and keeps the core independently testable per
Principle I.

### III. Local-First and Offline
Core functionality MUST NOT depend on external network services, cloud APIs, or
any remote system being reachable. The application MUST fully function with no
network connection. Optional integrations (e.g., sync, backup) MAY exist but
MUST be additive and MUST NOT be required for any core capture, organize, or
review workflow to work.

**Rationale**: A tool for personal productivity and durable record-keeping must
not fail, degrade, or lock out its owner because a third-party service is down,
deprecated, or unreachable.

### IV. Durable Plain-Text Data
All data MUST be stored at rest in human-readable, hand-editable plain text:
markdown for content, and structured plain-text formats (e.g., YAML, JSON,
CSV, TOML) for metadata and structured records. No proprietary binary formats,
opaque databases-as-sole-source-of-truth, or encodings that require the
application itself to read or recover the data. A user MUST be able to read,
search, and manually edit their data with a plain text editor alone, with no
application running.

**Rationale**: Data must outlive the application. Plain text guarantees
recoverability, greppability, and freedom from vendor or version lock-in.

### V. Enforced Process, Separable Policy
Process rules MUST be enforced by the system and MUST NOT be left to user
discipline, documentation, or client-side convention. They are NOT, however,
part of core domain logic. Core defines what things are and what may be done to
them; policy defines what should be allowed, discouraged, or blocked. The two
MUST be separate modules.

- **Core owns the enforcement points.** Core MUST declare a defined set of
  named decision points — for example, before a project's status changes,
  before a milestone is marked done, before a review is closed — and MUST
  consult whatever policy module is registered at each one. Core MUST NOT
  know what the rules are; it knows only where rules are consulted.
- **Decisions are a closed set.** A policy decision MUST return exactly one of
  `allow`, `warn`, or `block`, together with a reason the client can display.
- **No client can bypass a rule another client enforces.** Because enforcement
  lives at core's decision points rather than in a layer above it, all clients
  MUST receive the same decision for the same action.
- **Policy configuration lives with the data, not with the application.** It
  MUST be stored in the same git-tracked data directory as projects, areas, and
  the inbox. Any client opening that data directory therefore loads the same
  rules by construction, so clients cannot disagree about policy, and rules
  travel with the data across machines.
- **One default module, no extension surface yet.** The application ships with
  exactly one default policy module. A plugin loader, module discovery
  mechanism, or public extension API MUST NOT be built at this time — build the
  seam and the interface only. The interface is internal until deliberately
  published.

**Rationale**: Discipline that depends on the user remembering to follow a
process fails under load, so the system must enforce it. But rules change far
more often than the domain does, and entangling them makes both harder to
change and harder to test. Separating them keeps the domain stable while the
rules stay editable, and anchoring the seam inside core — rather than above it
— is what preserves the unbypassable, all-clients-agree guarantee. Storing
configuration alongside the data makes agreement structural rather than a
convention each client must honor.

### VI. Instant, Non-Blocking Capture
The capture surface MUST respond to the user within a tight, defined time
budget on every interaction, and MUST NEVER block on disk I/O or network I/O.
Capture MUST succeed (from the user's perspective) even if persistence is
deferred, queued, or retried asynchronously; a slow or failing disk/network
operation MUST NOT be visible as latency or failure at the capture surface.

**Rationale**: Capture is the entry point for all data in the system; if it
hesitates, users route around it, and the system loses its reason to exist.

### VII. One Consistent Interaction Model
All clients MUST share the same set of core verbs and vocabulary for
interacting with the system. No client may introduce its own concepts, terms,
or verbs that do not exist in the core; new concepts are added to the core
first, and all clients inherit them uniformly. A user's mental model, once
learned in any one client, MUST transfer directly to every other client.

**Rationale**: A single consistent vocabulary is what makes multiple clients
feel like one system rather than several disconnected tools, and is the direct
consequence of Principle II (Library-First): if clients cannot invent domain
logic, they cannot invent domain vocabulary either.

## Governance

This constitution supersedes all other project practices, conventions, and
prior informal agreements. Where a proposed change, plan, or piece of code
conflicts with a principle above, the principle wins unless the constitution
itself is first amended.

**Amendment procedure**: Amendments are proposed as edits to this file. Each
amendment MUST update the Sync Impact Report (HTML comment at the top of this
file), bump the version per the policy below, and update the "Last Amended"
date. Amendments that remove or redefine a principle's non-negotiable
guarantee require explicit acknowledgment in the commit/PR description of what
prior behavior is no longer required.

**Versioning policy**: This constitution is versioned MAJOR.MINOR.PATCH.
- MAJOR: A principle is removed, or an existing principle's guarantee is
  redefined in a backward-incompatible way.
- MINOR: A new principle or governance section is added, or an existing
  principle's guidance is materially expanded.
- PATCH: Wording clarifications, typo fixes, or non-semantic refinements.

**Compliance review**: Every plan and task list produced by the Spec Kit
workflow MUST include a Constitution Check step that verifies alignment with
all seven principles above before implementation proceeds. Any deviation MUST
be justified in writing (a "Complexity Tracking" or equivalent section) or the
plan MUST be revised to comply. Reviewers MUST treat violations of Principles
I (Test-First), III (Local-First), IV (Plain-Text Data), and V (Enforced
Process, Separable Policy) as blocking, not advisory.

**Version**: 2.0.0 | **Ratified**: 2026-08-09 | **Last Amended**: 2026-08-13
