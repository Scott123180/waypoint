import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { catalogOf } from "../src/suggest/catalog";
import { FakeVaultStore } from "./sort-fakes";

/**
 * The suggestion service's only read source (research R6).
 *
 * Feature 6 got its read-only guarantee by narrowing a dependency to
 * `Pick<VaultStore, "list" | "read">`. That gives write-immunity but still
 * typechecks `read("identity.md")`. This goes one step further: the directory
 * is a *parameter* constrained to two values and the slug is a separate
 * argument, so there is no string a caller could pass that names
 * `identity.md`, `policy.md`, `trash.md`, `calendar.md`, `top-three.md`, or
 * anything under `log/`.
 *
 * "This feature never reads those files" is therefore not a rule anyone has to
 * remember. It is a thing the type cannot express.
 */

function vaultWith(files: Record<string, string>): FakeVaultStore {
  const vault = new FakeVaultStore();
  for (const [path, content] of Object.entries(files)) vault.files.set(path, content);
  return vault;
}

describe("the catalog names a directory, never a path", () => {
  test("lists the slugs in projects and in areas", async () => {
    const catalog = catalogOf(
      vaultWith({
        "projects/roof-repair.md": "# Roof repair\n",
        "projects/vendor-consolidation.md": "# Vendor Consolidation\n",
        "areas/home.md": "# Home\n",
      }),
    );

    assert.deepEqual(await catalog.list("projects"), ["roof-repair", "vendor-consolidation"]);
    assert.deepEqual(await catalog.list("areas"), ["home"]);
  });

  test("reads a file by directory and slug", async () => {
    const catalog = catalogOf(vaultWith({ "projects/roof-repair.md": "# Roof repair\n" }));
    assert.equal(await catalog.read("projects", "roof-repair"), "# Roof repair\n");
  });

  test("an absent slug reads as null rather than throwing", async () => {
    const catalog = catalogOf(vaultWith({}));
    assert.equal(await catalog.read("projects", "gone"), null);
  });

  test("exposes exactly two verbs, both of them reads", () => {
    const catalog = catalogOf(vaultWith({}));
    assert.deepEqual(Object.keys(catalog).sort(), ["list", "read"]);
    for (const verb of ["write", "append", "appendLine", "remove", "delete"]) {
      assert.equal(
        (catalog as unknown as Record<string, unknown>)[verb],
        undefined,
        `the catalog must not expose "${verb}"`,
      );
    }
  });

  test("the files this feature must never read are not nameable through it", async () => {
    const catalog = catalogOf(
      vaultWith({
        "identity.md": "me: Someone\n",
        "policy.md": "wip limit: 3\n",
        "trash.md": "- discarded\n",
        "calendar.md": "- an appointment\n",
        "top-three.md": "# This week\n",
        "log/2026-W33.md": "# A past review\n",
        "projects/real.md": "# Real\n",
      }),
    );

    // `read` takes a directory and a slug. The nearest a caller can get to
    // `identity.md` is `read("projects", "../identity")`, and the catalog does
    // not join that into a path outside its two directories.
    assert.equal(await catalog.read("projects", "../identity"), null);
    assert.equal(await catalog.read("areas", "../../etc/passwd"), null);
    assert.equal(await catalog.read("projects", "../trash"), null);

    // And `list` cannot reach `log/` at all, even though `VaultStore.list`
    // accepts it — the catalog's union is narrower than the store's.
    assert.deepEqual(await catalog.list("projects"), ["real"]);
  });
});

describe("fresh on every call", () => {
  test("a project created in another window appears without a restart", async () => {
    const vault = vaultWith({ "projects/one.md": "# One\n" });
    const catalog = catalogOf(vault);

    assert.deepEqual(await catalog.list("projects"), ["one"]);

    // Another window writes while this one is open (FR-024).
    vault.files.set("projects/two.md", "# Two\n");

    assert.deepEqual(await catalog.list("projects"), ["one", "two"]);
  });

  test("nothing is cached between reads of the same slug", async () => {
    const vault = vaultWith({ "projects/one.md": "# One\n" });
    const catalog = catalogOf(vault);

    await catalog.read("projects", "one");
    vault.files.set("projects/one.md", "# One, renamed\n");

    assert.equal(await catalog.read("projects", "one"), "# One, renamed\n");
    assert.deepEqual(vault.readLog, ["projects/one.md", "projects/one.md"], "the second read hit the store");
  });
});
