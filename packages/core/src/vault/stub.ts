/**
 * The minimal project or area file created during sort.
 *
 * Title and status only (FR-009). Feature 3 adds outcome, milestones, next
 * action, DRI, and status semantics as sibling sections; writing empty
 * placeholders for them now would be metadata the user has to maintain before
 * it means anything.
 *
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */
export function renderStub(title: string): string {
  // No `## Unprocessed` heading here: the first routed item creates it with
  // correct spacing. An empty section would also be "something else" beyond
  // title and status, which FR-009 rules out.
  return `# ${title.trim()}\n\nstatus: active\n`;
}
