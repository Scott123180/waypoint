# Contract: Data File Formats

**Location**: `<vault>/top-three.md`, `<vault>/identity.md`, `<vault>/policy.md` | **Feature**:
004-top-three-wip-limit

Extends the conventions set by [Feature 2's vault format](../../002-inbox-view-sort/contracts/vault-format.md)
and [Feature 3's project format](../../003-project-structure/contracts/project-format.md): a `#` title, a
`key: value` preamble, `##` sections, and `- [ ]` task lines. Nothing new is invented, so a user who can
read a project file can read all three of these.

**This is a contract with the user before it is a contract with code.** Feature 5's review and Feature 6's
retrospective will read `top-three.md`, so changes here are breaking changes.

**All three files are optional.** Absent means documented defaults, never an error, and none is created
unless the user asks for it (FR-059).

---

## `top-three.md`

```markdown
# Top three

## 2026-W33

- [x] Ship the policy seam — done 2026-08-14
- [ ] Decide the license
- [ ] Get the roof estimate signed off

## 2026-W32

- [x] Land inbox sort recovery — done 2026-08-08
- [x] Cut v0.3.0 — done 2026-08-09
```

- One `## YYYY-Www` section per week, **newest first**. New weeks are inserted at the top; existing
  sections are never touched (FR-011).
- Each outcome is a task line in the milestone shape: `- [ ] text`, or `- [x] text — done YYYY-MM-DD`.
- No verifier tail is ever written. An outcome is the user's own commitment; there is nobody to name.
- Order within a section is entry order and is preserved on every write.

| Element | Rules |
|---|---|
| `## YYYY-Www` | ISO-8601 week (FR-003). Zero-padded, so sections sort chronologically as text. An unrecognized `##` heading is carried through untouched, never reinterpreted as a week. |
| `- [ ]` / `- [x]` | Same parser as milestones. A checkbox with no text after it is not an outcome — it is a line the user is halfway through typing (Feature 3's rule, unchanged). |
| ` — done YYYY-MM-DD` | Written only when done; removed when reopened (FR-010). Local date. |

**Reading is total.** A week holding four outcomes because it was hand-edited displays four (FR-015). A
line under a week heading that is not a task line stays exactly where it is. The cap governs writes only.

---

## `identity.md`

```markdown
# Identity

me: Scott Rodgers

## Aliases

- scott
- Scott R.
- S Rodgers
```

| Element | Rules |
|---|---|
| `me` | The canonical name, free text. Absent or blank → identity not configured: no DRI resolves to the user and the WIP limit cannot fire (FR-031, FR-049). |
| `## Aliases` | Zero or more `- ` lines, one spelling each. Absent section means no aliases, which is valid — the canonical value alone is enough. |

Aliases are **maintained by the user, by hand**. The application never adds, infers, suggests, learns, or
auto-populates one (FR-030), and offers no alias editor. A redundant alias — one the normalization rules
already cover, like `scott rodgers` against canonical `Scott Rodgers` — is harmless, not an error.

A `dri: me` in a project file is ordinary free text, exactly as Feature 3's format contract says. It
resolves to the user only if `me` appears in this alias list. **No sentinel value is reserved** — that
would mean migrating every existing project, and would break typing a real human name into a file in vim,
which is the case the plain-text format exists to support.

---

## `policy.md`

```markdown
# Policy

wip limit: 3
milestone cap: 4
weekly outcome cap: 3
```

| Key | Default | Meaning |
|---|---|---|
| `wip limit` | `3` | Active projects the user may drive at once. Counts only projects where the DRI resolves to the user (FR-039). |
| `milestone cap` | `4` | Milestones per project. Feature 3's shipped constant, unchanged (FR-061). |
| `weekly outcome cap` | `3` | Outcomes per week (FR-063). |

- Editing this file alone changes enforced behavior for **every** client opening the vault, with no
  application change (FR-058). That is the whole point of storing it here rather than in app config.
- **Absent file → every default.** Which is why the migration is a no-op for existing vaults: none of them
  has this file, and the defaults reproduce Feature 3's behavior exactly.
- **Malformed or out-of-range values fall back per value**, not per file. A typo in `wip limit` must not
  silently restore a milestone cap of 4 when the user deliberately set 6. Out of range means negative or
  non-integer. **Zero is valid** for all three and is honored, not corrected — a `wip limit: 0` refusing
  every activation is a coherent thing to have configured (FR-060).
- A configuration problem is surfaced to the user and **never blocks an operation** (FR-060).

The file holds rules only. It never holds identity — that is a separate file, because identity is a fact
about the data while policy is an opinion about how to work, and identity outlives any policy module
(FR-019).

---

## What none of these files do

- **No file is created unasked.** Opening a vault that has none of them writes nothing (FR-059).
- **No existing project file is touched, migrated, or rewritten** by this feature.
- **Nothing derived is stored.** Resolutions, ambiguity, needs-a-DRI, and the current-week flag are
  computed on every read and appear in none of these files (FR-020b, FR-036).
