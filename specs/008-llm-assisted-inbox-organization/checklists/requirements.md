# Specification Quality Checklist: LLM-Assisted Inbox Organization

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-17
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation record

**Iteration 1** — two issues found and fixed:

- *No implementation details*: an earlier draft of FR-058 named the transport interface's method signature
  ("takes prompt text, returns response text"). Rewritten in domain terms — the transport "carries request
  content out and brings response content back" — which states the same boundary without prescribing a shape.
  File references that remain (`inbox.md`, `identity.md`, `policy.md`, `trash.md`, `calendar.md`,
  `top-three.md`, `log/`) are retained deliberately: under Constitution Principle IV the on-disk plain-text
  layout is a user-facing surface the user reads and hand-edits, and specs 003, 005, and 006 name these files
  for the same reason.
- *Success criteria measurable*: SC-004 and SC-012 originally read "no invented names" and "rejection is
  clean" with no corpus size. Both now name a minimum count so the criterion can pass or fail.

**Iteration 2** — one [NEEDS CLARIFICATION] marker remains, at FR-056 (which transports ship). Presented to
the user as Question 1. All other items pass.

**Iteration 3 (`/speckit-clarify`, 2026-08-17)** — four questions asked and answered; all items now pass.
The FR-056 marker is resolved and three further gaps found by the ambiguity scan were closed:

- *Which transports ship* (FR-056, FR-056a) — two, different in kind: a command-line tool and a
  certificate-authenticated HTTPS endpoint.
- *Where connection details and credentials live* (FR-051a–FR-051d) — non-secret parameters and a credential
  **path** in the data directory; never the secret bytes. This was a genuine security gap: the spec required
  the transport setting to live in a git-tracked directory while the chosen transport needs a private key.
- *The unquantified bound on a request* (FR-066a) — 120 seconds, one number for both transports, not
  configurable. FR-066 previously said "bounded" with no bound, which made SC-008's timeout case untestable.
- *Whether a proposed piece may reword the original* (FR-010a, FR-010b) — verbatim spans only. This was
  load-bearing for FR-013: the no-silent-loss check is exact arithmetic over spans, and would have degraded
  into an unreliable similarity heuristic had paraphrase been allowed.

### Notes on deliberate spec choices

- **Two candidates resolved by informed guess rather than a question**, recorded in Assumptions:
  1. *What a destination request sends about each project and area* — resolved as title plus the project's
     stated outcome, nothing further, grounded in the user's own phrase "needs to know what my projects and
     areas actually are" and bounded tightly because the preview (FR-041) makes the boundary checkable.
  2. *Whether the payload preview blocks each send* — resolved as shown-in-the-asking-view rather than a
     second confirmation, following Feature 5's FR-109 ("inspectable before it is sent") and avoiding a
     friction cost that would make the assisted path slower than sorting by hand.

  The transport question was not resolved by guess because the user named four environments joined by "or"
  ("a command-line tool **or** a model running locally"; "certificate-based authentication, **or** ... an
  editor integration"), and the difference between building two and building four is the single largest scope
  lever in the feature. It was answered in iteration 3: two transports, with the other two named in Out of
  Scope as deliberate deferrals rather than omissions.

- **Zero new decision points.** Stated as FR-034 and defended in Assumptions. This feature holds no opinion
  the system enforces, so Principle V's seam is consulted through the existing sort action and the count
  stays at the five Feature 5 left.

- **A recorded deviation from the ROADMAP.** The ROADMAP names Feature 8 as "the feature that supplies a
  summary provider" for Feature 5's port. The user explicitly excluded weekly-review summary drafting from
  this feature. The exclusion is honored and the conflict is stated in Out of Scope rather than resolved
  silently in either direction; the port remains shipped-and-unimplemented, awaiting a feature that claims it.

- **Feature number 8, directory `008`.** Resequenced ahead of the deferred Feature 7 (local HTTP/JSON API).
  The number is preserved because `specs/002-inbox-view-sort/data-model.md`, `specs/003-project-structure/`,
  and core source comments already cite "Feature 8" for exactly this work; `specs/007-*` stays reserved for
  the local API.
