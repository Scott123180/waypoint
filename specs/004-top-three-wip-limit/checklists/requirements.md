# Specification Quality Checklist: Weekly Top Three and WIP Limit

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-14
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

**Iteration 1** — three issues found and fixed:

1. *Implementation detail leak*: FR-052 through FR-056 name core, the policy module, and decision points.
   **Resolved as intentional, not a leak.** Module placement is a first-class user-stated requirement in
   this feature's input ("it lives in the policy module rather than in core… so the weekly review… can use
   it without going through policy") and is mandated by Constitution Principle V, which reviewers must
   treat as blocking. The vocabulary is the project's own domain language, not a technology choice: no
   language, framework, library, file API, or data structure is named anywhere in the spec. Feature 003's
   spec sets the same precedent.
2. *Untestable ambiguity rule*: "ambiguous against another distinct name" had no operational definition,
   so FR-028 could not be verified. Fixed by defining ambiguity as a strict leading-word subsequence
   collision, with the reasoning recorded in Assumptions and worked examples in scenarios and edge cases.
3. *Unbounded scope on two forks*: whether `waiting` counts toward the limit, and whether an ambiguous DRI
   counts. Both are now decided explicitly (FR-042, FR-043) with the rationale in Assumptions rather than
   left to the plan.

**Iteration 2** — all items pass. Zero `[NEEDS CLARIFICATION]` markers; the four genuine forks in the road
(waiting status, ambiguous counting, block-vs-warn, past-week editability) were each resolvable from the
roadmap's decision log and the constitution, so they are recorded as documented assumptions instead of
being escalated as questions.

**Iteration 3** — review feedback incorporated; all items still pass:

- The migration of Feature 3's two rules is the only part of this feature that touches shipped behavior, so
  "unchanged" was sharpened from an outcome claim to a testable one. FR-062a pins *when* each rule fires,
  not only what it says; FR-062b requires the equivalence be asserted by pre-move tests run unmodified, and
  names the failure mode explicitly (editing a test to match the relocated rule). SC-014a covers the trigger
  boundaries, and US4 gained two scenarios for the silent side — a fourth milestone accepted, and marking
  done with nothing open asking nothing.
- Two accepted limitations are now recorded in Assumptions so neither is later rediscovered as a defect:
  `waiting` acting as a pressure valve on the WIP limit, and the leading-word ambiguity rule not detecting
  collisions between two other people. Both are deliberate, and the reasoning for not solving them here is
  written down. The `waiting` one carries forward to ROADMAP Feature 5, whose stale waiting-for check is
  where it surfaces.

**Clarification session 2026-08-14** — 5 questions asked and answered; 16/16 items passing before and
after, no checkbox state changes. Three of the five closed gaps this checklist had wrongly marked as
passing: "requirements are testable" missed that FR-003 deferred the week identifier to a convention that
does not exist in code, and "success criteria are measurable" missed that the spec carried no performance
criterion at all while adding a vault-wide scan to a path with a shipped 100 ms budget. Recorded here
because the checklist passed a spec that had those holes — the items are worded as if a reviewer already
knows what to look for.

### Cross-artifact consistency

- Preserves Feature 3 FR-009 (a missing DRI is not a structure gap) — see FR-033, FR-034. This answers the
  ROADMAP open question "Surfacing 'needs a DRI' must not reuse Feature 3's structure gap" in favor of a
  separate derived signal, not an amendment to FR-009.
- Answers the ROADMAP open question on identity file naming/format and on case- and
  punctuation-insensitive matching — see FR-018, FR-019, FR-022 through FR-027, and Assumptions.
- Discharges the constitution's Sync Impact Report follow-up assigning the milestone cap and the
  open-milestone confirmation to this feature — see FR-061, FR-062.
