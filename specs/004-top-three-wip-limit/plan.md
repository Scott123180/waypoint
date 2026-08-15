# Implementation Plan: Weekly Top Three and WIP Limit

**Branch**: `004-top-three-wip-limit` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-top-three-wip-limit/spec.md`

## Summary

Three things ship together, in this order of dependency: a **weekly top three** stored as one plain-text
file holding every week; **identity resolution** in core, answering "is this DRI the user?" as a fact
derived on every read; and a **work-in-progress limit** in the default policy module, which consumes that
answer. Underneath all three, this feature builds **the policy seam** — core declares exactly three named
decision points and consults whatever module is registered, without knowing what the rules are.

The load-bearing technical decisions:

- **The seam is a port.** `PolicyModule` joins `InboxStore`, `VaultStore`, and `Clock` in
  `packages/core/src/ports/` — the directory that already means "core depends on this, someone else
  implements it, it is injected in". The one default module lives in `packages/core/src/policy/` as its own
  module with a one-way dependency, guarded by an import-direction test rather than by a package split
  (research R2, R3).
- **The default module is the default dependency.** `ProjectService` falls back to it when none is
  injected, which is what lets the 24 existing test files that construct `new ProjectService({ vault })`
  still get a refused fifth milestone. Absent `policy.md` yields documented defaults identical to Feature
  3's shipped constants, so the migration is behavior-preserving by construction, not by careful matching.
- **The client-facing refusal shape is frozen, and grows only additively.**
  `packages/desktop/src/renderer/projects.ts:630` branches on `outcome.reason === "open-milestones"` and
  renders `outcome.open`. The seam is free to call these `warn` and `subjects` internally, but the existing
  `ProjectOutcome` fields must reach the client unchanged or the confirmation dialog silently stops
  appearing — a migration failure no core test would catch. The WIP refusal therefore adds a **new**
  `subjects` field rather than reusing `open`: a client already renders `open` as a confirmation list, so
  overloading it would show a WIP block as an offer to complete the project the user was activating.
- **Decision context is lazy.** Core hands each decision point a context whose expensive facts are
  functions, not values. The WIP rule calls `activeProjectsDrivenByUser()`; the milestone cap never does,
  so it pays nothing. This is what keeps core from knowing which rule needs what, and keeps a status change
  from listing the whole vault when no rule asks it to (research R4).
- **One pass over the vault.** `list()` currently reads every project file, then would need every project
  file again to build the ambiguity corpus. Instead the parsed projects are read once and both the corpus
  and the per-project resolution are derived from that array in memory (research R6). Verified by counting
  reads on the fake, not by timing (SC-016c).
- **ISO weeks are computed, not imported.** ~15 lines and a table-driven test across year boundaries; no
  dependency (research R1).

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 22 (`.nvmrc` pins 22; `engines.node >=22`)

**Primary Dependencies**: None added. The feature uses only the standard library and existing workspace
packages. `Intl`/`Temporal` are not used for week computation — see research R1.

**Storage**: Plain-text markdown in the git-tracked vault, outside the app repo. Three new files:
`top-three.md`, `identity.md`, `policy.md`, all at the vault root, all reached through the existing
`VaultStore.read`/`write` (vault-relative paths — **no port change needed**).

**Testing**: `node --test` over compiled output, `TZ=America/New_York` (already pinned in the `test`
script, and load-bearing here because week boundaries are local-time facts).

**Target Platform**: Electron desktop on Linux and macOS. macOS builds are produced by GitHub Actions on a
macOS runner and downloaded as release artifacts; nothing is built or installed on the work machine.

**Project Type**: npm workspaces monorepo — `packages/core` (all domain logic, imports nothing from
Electron) and `packages/desktop` (thin client).

**Performance Goals**: A 100-project list, with identity resolved and ambiguity determined for every
project, within Feature 3's existing 100 ms budget — the budget does not move (SC-016a). Each project file
read at most once per list (SC-016c). Single-project open within 100 ms in a 100-project vault (SC-016b).

**Constraints**: Fully offline. No cached or persisted derived state. No existing project file rewritten or
migrated. Feature 3's test suites must pass byte-for-byte unmodified.

**Scale/Scope**: Single user, single vault. Hundreds of projects, ~52 week-sections a year. The ambiguity
corpus is bounded by the number of distinct person names on projects — tens, not thousands.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Assessed against Constitution v2.0.0, all seven principles.

| Principle | Assessment | How this plan satisfies it |
|---|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS | Every task in Phase 2 is written as a failing test first. The migration in particular is defined by tests that already exist and must not be edited (FR-062b) — the strongest possible form of Red-Green, since the Red is Feature 3's suite failing the moment a rule moves incorrectly. New characterization tests for the trigger boundaries are written *before* the rules are relocated, against current behavior. |
| **II. Library-First** | PASS | All logic lands in `packages/core`. The desktop client gains a top-three window that renders and routes input only. The WIP refusal message, the remediation list, the four-way resolution, the needs-DRI signal, and the week identifier are all produced by core; the renderer formats nothing it could get wrong. |
| **III. Local-First / Offline** | PASS | No network in any path. An offline test mirrors Feature 3's `project-offline.test.ts` for the new services. |
| **IV. Durable Plain-Text** | PASS | Three new files, all markdown, all using the existing `key: value` preamble and `## Section` conventions so they read like projects and areas. The top-three uses the same `- [x] … — done YYYY-MM-DD` line shape as milestones (research R5). Every new file is optional; absence means defaults, never an error, and no file is created unasked (FR-059). |
| **V. Enforced Process, Separable Policy** | PASS | This is the feature that builds the seam. Core declares exactly three decision points and consults the registered module; `PolicyModule` lives in `ports/` and core never inspects a rule. Decisions are exactly `allow`/`warn`/`block` with a displayable reason. Enforcement is inside `ProjectService`/`TopThreeService`, so the future HTTP API and LLM layer inherit it rather than sitting above it. Policy configuration lives in the vault beside the data. Exactly one default module ships; no loader, no discovery, no exported extension API. **One concession, justified in Complexity Tracking**: core imports a single factory to construct the default module. |
| **VI. Instant, Non-Blocking Capture** | PASS — not touched | This feature adds nothing to the capture path. A regression guard is unnecessary; capture's existing budget tests still run. |
| **VII. One Consistent Interaction Model** | PASS | New vocabulary is added to core first and inherited: *top three*, *week*, *outcome*, *the user's / someone else's / unassigned / ambiguous*, *needs a DRI*, *over limit*. The name "top three" is fixed vocabulary and does not change with the configured cap (FR-063b). Refusals reuse the established `{ ok: false, reason, message }` shape, so a client renders a WIP block exactly as it renders a milestone-cap block. |

**Blocking-principle review (I, III, IV, V)**: no violations. The single Principle V concession is recorded
below with its rejected alternatives.

### Post-design re-check (after Phase 1)

Re-run against the completed contracts. Still PASS on all seven. Three things the design surfaced that the
pre-design check had not:

- **Principle II gained a concrete guard.** `resolveDri` takes the corpus as an argument rather than
  fetching it, which is what forces the caller to have parsed the projects once. A function that fetched
  its own corpus would make the quadratic implementation the easy one to write — so the single-pass
  requirement is enforced by the signature, not by discipline. Likewise `Week.current` and every refusal
  message come from core, so the renderer cannot compute a week boundary or phrase a limit differently
  from the future API.
- **Principle VII is at risk in one specific place, now pinned.** The renderer branches on the literal
  `"open-milestones"` and reads `outcome.open`. The seam's internal vocabulary (`warn`, `subjects`) must
  translate back to exactly that at the boundary, or a client silently loses a confirmation. Recorded in
  [policy-seam.md](./contracts/policy-seam.md) and covered by a desktop-level test, because no core test
  would catch it.
- **Principle V's "no extension surface" is a testable claim, not a promise.** The import-direction test
  is what keeps `identity/` free of any dependency on `policy/`, which is the property Feature 5 and
  Feature 6 will rely on. Without it, the boundary is a comment.

No new violations. The Complexity Tracking table is unchanged — the design did not introduce a second
concession.

## Project Structure

### Documentation (this feature)

```text
specs/004-top-three-wip-limit/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── policy-seam.md   # Decision points, Decision shape, default module, config
│   ├── identity-api.md  # Core identity resolution
│   ├── top-three-api.md # TopThreeService verbs + IPC
│   └── data-files.md    # identity.md, policy.md, top-three.md on-disk formats
├── checklists/
│   └── requirements.md  # Written by /speckit-specify, updated by /speckit-clarify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/core/src/
├── ports/
│   └── index.ts                  # MODIFIED: + PolicyModule, Decision, decision-point payloads
├── identity/                     # NEW — core, usable without policy
│   ├── normalize.ts              # the four formatting rules, nothing else
│   ├── identity-config.ts        # parse identity.md → { canonical, aliases }
│   ├── corpus.ts                 # distinct person names from parsed projects
│   └── resolve.ts                # four-way resolution + ambiguity
├── policy/                       # NEW — the one default module
│   ├── policy-config.ts          # parse policy.md → limits, with defaults
│   └── default-policy.ts         # WIP limit, milestone cap, weekly outcome cap
├── weekly/                       # NEW
│   ├── types.ts                  # WeekId, Outcome, Week, OutcomeRef, refusals
│   ├── iso-week.ts               # week id from a Date; no dependency
│   ├── top-three-document.ts     # parse/render top-three.md, surgical writes
│   └── top-three-service.ts      # the verbs
├── projects/
│   ├── project-service.ts        # MODIFIED: consult decision points; resolution in summaries
│   ├── types.ts                  # MODIFIED: + DriResolution, needsDri, refusal reasons
│   └── gaps.ts                   # UNCHANGED — FR-009 preserved, deliberately untouched
└── index.ts                      # MODIFIED: export the new public surface

packages/core/tests/                # ~20 new test files; Feature 3's existing files unmodified
packages/desktop/src/
├── main/
│   ├── main.ts                   # MODIFIED: wire top-three window + default policy
│   ├── ipc.ts                    # MODIFIED: + top-three channels
│   └── top-three-window.ts       # NEW
└── renderer/
    ├── top-three.html            # NEW
    └── top-three.ts              # NEW
```

**Structure Decision**: The existing two-package monorepo is kept. `identity/`, `policy/`, and `weekly/`
are new sibling modules inside `packages/core/src`, matching how `capture/`, `inbox/`, `sort/`, and
`projects/` are already organised. Policy is a **module** boundary, not a package boundary — see
Complexity Tracking for why a third workspace package was rejected, and how the boundary is enforced
instead.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Core imports one factory (`createDefaultPolicy`) from the policy module, so `ProjectService` can default to it when no module is injected. | Feature 3's suites construct `new ProjectService({ vault })` with no policy and assert the fifth milestone is refused. FR-062b forbids editing those tests. Something must supply the default module, and the only place that does not require editing every call site is the service's own default. Core still never inspects a rule: it constructs an opaque module and reads `allow`/`warn`/`block` back. | **Injecting policy at every call site** — would require editing the 24 existing test files that construct the service, which is precisely the failure FR-062b names. **A no-op default** — the milestone cap would silently stop firing for every existing caller, a behavior change disguised as a refactor. **A separate `packages/policy` workspace** — core defaulting to it makes a package cycle (`core → policy → core`); breaking the cycle means moving the default construction to the client, which reintroduces the "edit every test" problem and, worse, makes the rules bypassable by any caller that constructs the service directly — exactly what Principle V forbids. The directory can be extracted to a package later, when the extension API is deliberately published; the import-direction test makes that extraction mechanical. |
| Three decision points, when the WIP limit alone would need one. | The constitution's Sync Impact Report assigns the milestone cap and the open-milestone confirmation to this feature, and the clarification session put the weekly outcome cap in policy for the same reason. | Fewer points would leave shipped rules inside core domain logic, which the amended Principle V now classifies as a violation. FR-063a caps it at exactly three and forbids declaring a fourth speculatively. |
