<!--
Sync Impact Report
Version change: [TEMPLATE] → 1.0.0
Modified principles: N/A (initial ratification; template placeholders replaced)
Added sections:
  - Core Principles I-VII (Test-First Development, Library-First Architecture,
    Local-First & Offline, Durable Plain-Text Data, Core Enforces Process,
    Instant Non-Blocking Capture, One Consistent Interaction Model)
  - Governance
Removed sections:
  - [SECTION_2_NAME] / [SECTION_3_NAME] placeholders (not needed; all substantive
    constraints are captured as principles per user input)
Templates requiring follow-up:
  - .specify/templates/plan-template.md — ⚠ pending manual review to confirm its
    Constitution Check gates reference these seven principles by name
  - .specify/templates/spec-template.md — ⚠ pending manual review for alignment
  - .specify/templates/tasks-template.md — ⚠ pending manual review to ensure
    TDD ordering (tests before implementation) is enforced in generated tasks
Deferred TODOs:
  - TODO(RATIFICATION_DATE): original adoption date unknown; using today's date
    (2026-08-09) as the ratification date since this is the first ratified version.
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

### V. The Core Enforces Process
Rituals that give the system its value — inbox-zero processing, the weekly
review sequence, work-in-progress limits, and any other defined ritual — MUST
be enforced in core logic (e.g., blocking disallowed state transitions,
refusing to exceed limits, requiring review steps to complete in order). These
rules MUST NOT be left to user memory, documentation, or client-side
convention; a client that bypasses the core cannot bypass the rule.

**Rationale**: Discipline that depends on the user remembering to follow a
process fails under load. Encoding the ritual in the core is what makes the
system trustworthy across all clients and over time.

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
I (Test-First), III (Local-First), IV (Plain-Text Data), and V (Core Enforces
Process) as blocking, not advisory.

**Version**: 1.0.0 | **Ratified**: 2026-08-09 | **Last Amended**: 2026-08-09
