// @vitest-environment jsdom
//
// Task 105 (audit, correctness): `migrateSnippet` must TOLERATE a malformed /
// partially-written archive.json entry, not assert it away. Before the fix it
// used `id: s.id!` / `createdAt: s.createdAt!`, so an entry missing `id` minted
// `id: undefined`. With `persistMigrationOnLoad: true` that keyless shape is
// written back (JSON.stringify drops the undefined key) and re-migrates to
// `undefined` on every load — then `popKey("archive", undefined)` collides
// across every keyless snippet and `deleteSnippet(undefined)` /
// `restoreSnippet(undefined)` match ALL keyless entries at once.
//
// The migrator is exactly the boundary where malformed input (a hand-edit, a
// partial/interrupted write, or an agent sidecar write — a normal Virgil-cowork
// surface) should heal, not crash. These pin that a missing/blank id/createdAt
// gets a fresh stable value and two such entries stay DISTINCT, while a
// well-formed entry round-trips unchanged.
//
// Storage is mocked (per vitest_extension_barrel_storage_mock) only so the
// transitive `@/lib/storage` → `@/lib/storage-fsa` import resolves; the test
// exercises the pure `migrateArchive` function, no hook render.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  readSidecarIfExists: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { migrateArchive } from "../useArchive";

describe("migrateArchive tolerates malformed entries (task 105)", () => {
  it("mints a fresh string id + ISO createdAt for an entry missing both", () => {
    const out = migrateArchive({ snippets: [{ title: "x", content: "y" }] });
    expect(out.snippets).toHaveLength(1);
    const [snip] = out.snippets;
    expect(typeof snip.id).toBe("string");
    expect(snip.id.length).toBeGreaterThan(0);
    // valid ISO timestamp
    expect(typeof snip.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(snip.createdAt))).toBe(false);
  });

  it("gives two keyless entries DISTINCT ids (no undefined collision)", () => {
    const out = migrateArchive({
      snippets: [
        { title: "a", content: "1" },
        { title: "b", content: "2" },
      ],
    });
    expect(out.snippets).toHaveLength(2);
    const [first, second] = out.snippets;
    expect(first.id).toBeTruthy();
    expect(second.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it("heals a blank-string id too (|| not ??)", () => {
    const out = migrateArchive({
      snippets: [{ id: "", createdAt: "", title: "x", content: "y" }],
    });
    const [snip] = out.snippets;
    expect(snip.id).toBeTruthy();
    expect(snip.createdAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(snip.createdAt))).toBe(false);
  });

  it("round-trips a well-formed entry unchanged (id + createdAt preserved)", () => {
    const out = migrateArchive({
      snippets: [
        {
          id: "arc-well-formed",
          createdAt: "2026-01-01T00:00:00.000Z",
          title: "kept",
          content: "body",
        },
      ],
    });
    const [snip] = out.snippets;
    expect(snip.id).toBe("arc-well-formed");
    expect(snip.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
