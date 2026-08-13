import type { Clock, VaultStore } from "../ports/index";
import { localDate, trashLine } from "../vault/lists";
import { slugify, uniqueSlug } from "../vault/slug";
import { renderStub } from "../vault/stub";
import { parseArea, setPreambleField, setTitleLine, setUnprocessedBlocks } from "./document";
import type { Area, AreaOutcome, AreaStatus, AreaSummary, RefusalReason } from "./types";

/**
 * The verbs an area has — and, just as deliberately, the ones it does not.
 *
 * A separate service rather than a flag on `ProjectService`, because the
 * difference between a project and an area is the whole point of the
 * distinction. There is no `setOutcome`, no milestone verb, no `complete`, and
 * no `gaps`: an area cannot be asked whether it is structured or finished,
 * because those questions do not typecheck (FR-024, FR-040, FR-041a).
 *
 * That is not minimalism for its own sake. If every ongoing responsibility were
 * permanently flagged as incomplete, the flag would become noise the user
 * learns to ignore, and the projects that genuinely need attention would
 * disappear into it.
 *
 * See specs/003-project-structure/contracts/projects-api.md
 */

export interface AreaServiceDeps {
  vault: VaultStore;
  clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export class AreaService {
  private readonly vault: VaultStore;
  private readonly clock: Clock;

  constructor(deps: AreaServiceDeps) {
    this.vault = deps.vault;
    this.clock = deps.clock ?? systemClock;
  }

  async list(): Promise<AreaSummary[]> {
    const slugs = await this.vault.list("areas");
    const areas = await Promise.all(slugs.map((slug) => this.get(slug)));
    return areas
      .filter((a): a is Area => a !== null)
      .map(({ slug, title, status, rawStatus }) => ({ slug, title, status, rawStatus }));
  }

  async get(slug: string): Promise<Area | null> {
    const content = await this.vault.read(path(slug));
    return content === null ? null : parseArea(content, slug);
  }

  /** Title and status only — the same stub sort writes (FR-040). */
  async create(title: string): Promise<AreaOutcome> {
    const base = slugify(title);
    if (base.length === 0) {
      return refuse("empty-title", "A title is required. Nothing was created.");
    }

    const existing = await this.vault.list("areas");
    if (existing.includes(base)) {
      const found = await this.get(base);
      if (found) return { ok: true, area: found };
    }

    const slug = uniqueSlug(base, existing);
    await this.vault.write(path(slug), renderStub(title));
    return this.reread(slug);
  }

  async setTitle(slug: string, expected: string, next: string): Promise<AreaOutcome> {
    if (next.trim().length === 0) {
      return refuse("empty-title", "An area always has a title. Nothing was changed.");
    }
    return this.writeField(slug, expected, (a) => a.title, (content) => setTitleLine(content, next));
  }

  /**
   * Active or parked, and nothing else.
   *
   * `AreaStatus` has no `done` to pass in, so there is no runtime guard for it
   * here — the type is the guard. A hand-edited `done` in the file is shown as
   * recorded and never rewritten, and calling this moves the area back into
   * range (FR-041, FR-041b, FR-041c).
   */
  async setStatus(slug: string, expected: AreaStatus, next: AreaStatus): Promise<AreaOutcome> {
    if (!isAreaStatus(next)) {
      return refuse("field-changed", `An area is active or parked, never "${String(next)}".`);
    }
    return this.writeField(slug, expected, (a) => a.status, (content) =>
      setPreambleField(content, "status", next),
    );
  }

  /**
   * Clears one item sort routed here, once the user has handled it.
   *
   * Identical in shape to the project verb, and for the same reason: trash
   * first, then removal, so an interrupted dismissal leaves a duplicate the
   * user can see rather than a loss they cannot (FR-046b, FR-046d, research R9).
   */
  async dismissUnprocessed(slug: string, index: number, expectedRaw: string): Promise<AreaOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const area = parseArea(content, slug);
    const item = area.unprocessed[index];
    if (!item || item.raw !== expectedRaw) {
      return refuse(
        "field-changed",
        "That item changed on disk since it was shown, so nothing was written. " +
          "Here is the area as it now reads.",
      );
    }

    await this.vault.appendLine(
      "trash.md",
      trashLine({ text: item.text, capturedAt: item.capturedAt }, this.clock.now()),
    );

    const remaining = area.unprocessed.filter((u) => u.index !== index).map((u) => u.raw);
    await this.vault.write(path(slug), setUnprocessedBlocks(content, remaining));
    return this.reread(slug);
  }

  private async writeField<T>(
    slug: string,
    expected: T,
    read: (a: Area) => T,
    apply: (content: string) => string,
  ): Promise<AreaOutcome> {
    const content = await this.vault.read(path(slug));
    if (content === null) return notFound(slug);

    const actual = read(parseArea(content, slug));
    if (actual !== expected) {
      return refuse(
        "field-changed",
        `That field changed on disk since it was shown, so nothing was written. ` +
          `It now reads: ${String(actual)}`,
      );
    }

    await this.vault.write(path(slug), apply(content));
    return this.reread(slug);
  }

  private async reread(slug: string): Promise<AreaOutcome> {
    const area = await this.get(slug);
    return area ? { ok: true, area } : notFound(slug);
  }
}

// ---------------------------------------------------------------------------

function path(slug: string): string {
  return `areas/${slug}.md`;
}

function isAreaStatus(value: unknown): value is AreaStatus {
  return value === "active" || value === "parked";
}

function refuse(reason: Exclude<RefusalReason, "open-milestones">, message: string): AreaOutcome {
  return { ok: false, reason, message };
}

function notFound(slug: string): AreaOutcome {
  return refuse("not-found", `No area called "${slug}". Nothing was written.`);
}
