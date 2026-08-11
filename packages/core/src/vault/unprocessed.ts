/**
 * Inserting a routed item under a project or area's `## Unprocessed` section.
 *
 * A pure string function so it can be tested exhaustively against
 * hand-shaped files. Everything outside the section is preserved byte for
 * byte, including structure a later feature or the user added
 * (FR-019a, FR-019b, SC-003a).
 *
 * See specs/002-inbox-view-sort/contracts/vault-format.md
 */

export const UNPROCESSED_HEADING = "## Unprocessed";

/** Matches `## Unprocessed` exactly — `###` is somebody else's section. */
function isUnprocessedHeading(line: string): boolean {
  return line.trimEnd() === UNPROCESSED_HEADING;
}

/** Any other `## ` heading, which bounds the section. */
function isSiblingHeading(line: string): boolean {
  return line.startsWith("## ") && !isUnprocessedHeading(line);
}

export function insertUnprocessed(content: string, itemBlock: string): string {
  const item = itemBlock.endsWith("\n") ? itemBlock : `${itemBlock}\n`;

  if (content.length === 0) {
    return `${UNPROCESSED_HEADING}\n\n${item}`;
  }

  const lines = content.split("\n");
  const headingIdx = lines.findIndex(isUnprocessedHeading);

  if (headingIdx === -1) {
    // No section yet: append one, leaving every existing byte in place. A file
    // the user created by hand keeps exactly what they wrote.
    const separator = content.endsWith("\n") ? "" : "\n";
    const blank = content.endsWith("\n\n") ? "" : "\n";
    return `${content}${separator}${blank}${UNPROCESSED_HEADING}\n\n${item}`;
  }

  // The section runs to the next sibling heading, or to end of file.
  let endIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (isSiblingHeading(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  // Back up over trailing blank lines so the item joins the list rather than
  // landing after the spacing that separates this section from the next.
  let insertAt = endIdx;
  while (insertAt > headingIdx + 1 && (lines[insertAt - 1] ?? "").trim().length === 0) {
    insertAt -= 1;
  }

  const itemLines = item.replace(/\n$/, "").split("\n");
  lines.splice(insertAt, 0, ...itemLines);
  return lines.join("\n");
}
