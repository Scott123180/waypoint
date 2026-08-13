/**
 * Project and area files as they actually appear on disk.
 *
 * The gnarly one matters most: the vault is git-tracked and the user is invited
 * to hand-edit it, so every parser and writer has to survive content this
 * feature never wrote.
 *
 * See specs/003-project-structure/contracts/project-format.md
 */

/** Exactly what sort writes. Must stay a valid project forever (FR-005). */
export const STUB = "# Roof repair\n\nstatus: active\n";

/** A stub that already collected routed items before anyone added structure. */
export const STUB_WITH_UNPROCESSED = `# Roof repair

status: active

## Unprocessed

- 2026-08-11T09:14:02-04:00 Call the roofer back about the estimate
- Buy a tarp before it rains
- 2026-08-11T09:20:00-04:00 Ask about the insurance claim
`;

/** The shape this feature produces once a project is fully structured. */
export const STRUCTURED = `# Roof repair

status: active
next action: Call the roofer back for a revised estimate
dri: me

## Outcome

The roof survives a full winter with no leak, and the insurance claim is settled.

## Milestones

- [x] Estimate approved by insurer — @Priya — done 2026-08-14
- [ ] Materials delivered on site — @me
- [ ] Work signed off and claim paid — @Priya

## Unprocessed

- 2026-08-11T09:14:02-04:00 Call the roofer back about the estimate
`;

/** A completed project, for date-range scanning. */
export const COMPLETED = `# Fix the fence

status: done
next action: Nothing — done
dri: me
completed: 2026-03-14

## Outcome

The fence stands through a gale.

## Milestones

- [x] Panels ordered — @me — done 2026-03-02
- [x] Panels fitted — @Sam — done 2026-03-14
`;

/**
 * Hand-shaped. Every deviation here is deliberate:
 * unknown preamble key, unknown section, sections in the "wrong" order,
 * a milestone whose definition of done contains both separators, and
 * no trailing newline at EOF.
 */
export const GNARLY = `# Q3  Planning & Review

status: waiting
priority: high
next action: Chase Dana for the headcount numbers

## Milestones

- [ ] Draft the plan — decide budget vs — headcount — @dana@example.com
- [x] Book the room — done 2026-07-02
- [ ] No verifier on this one

## Outcome

Everyone knows what they own for Q3.

Two paragraphs, because the outcome needed one.

## Notes

Something the user typed that nothing in the app knows about.

## Unprocessed

- 2026-08-11T09:14:02-04:00 A routed item
  with a continuation line

- [ ] This looks like a milestone but lives under Unprocessed`;

/** More milestones than the app would ever add. Read in full, never truncated (FR-013b). */
export const SIX_MILESTONES = `# Overcommitted

status: active

## Milestones

- [ ] One
- [ ] Two
- [x] Three — done 2026-08-01
- [ ] Four
- [ ] Five
- [ ] Six
`;

/** Title only — no status line at all. Reads as active (FR-002). */
export const TITLE_ONLY = "# Bare\n";

/** Multi-byte content, to catch anything that assumes one byte per character. */
export const UTF8 = `# Café — naïve 日本語 🎉

status: parked
dri: José

## Outcome

Ship the thing 🚀 without mojibake.

## Milestones

- [x] Encode — @René — done 2026-05-01
`;

export const AREA = `# Home maintenance

status: active

## Unprocessed

- 2026-08-11T14:02:55-04:00 Gutters need clearing before autumn
`;

/** An area hand-edited into something it is not. Stays an area (FR-041c, FR-043). */
export const AREA_HAND_MANGLED = `# Home maintenance

status: done

## Milestones

- [ ] This does not belong here and must survive anyway
`;

/** Everything a parser or writer must survive, for round-trip sweeps. */
export const ALL_PROJECT_FIXTURES: ReadonlyArray<readonly [string, string]> = [
  ["STUB", STUB],
  ["STUB_WITH_UNPROCESSED", STUB_WITH_UNPROCESSED],
  ["STRUCTURED", STRUCTURED],
  ["COMPLETED", COMPLETED],
  ["GNARLY", GNARLY],
  ["SIX_MILESTONES", SIX_MILESTONES],
  ["TITLE_ONLY", TITLE_ONLY],
  ["UTF8", UTF8],
  ["AREA", AREA],
  ["AREA_HAND_MANGLED", AREA_HAND_MANGLED],
  ["EMPTY", ""],
  ["NO_TRAILING_NEWLINE", "# Bare\n\nstatus: active"],
  ["BLANK_LINES_EVERYWHERE", "\n\n# Spaced\n\n\nstatus: active\n\n\n"],
];
