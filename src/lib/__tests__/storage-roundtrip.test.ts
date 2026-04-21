import { describe, it, expect } from "vitest";
import { migrateCardLinks } from "@/links/migrate-card";

/**
 * Roundtrip guard: a sidecar JSON in canonical shape should survive
 * load → migrate → re-serialize byte-for-byte. Catches accidental field
 * drops when the usePersistentState factory is edited.
 */
describe("sidecar roundtrip (canonical shape)", () => {
  it("notes: migrate + re-serialize produces identical JSON", () => {
    const canonical = {
      notes: [
        {
          id: "note-1",
          title: "",
          content: { type: "doc", content: [] },
          createdAt: "2026-01-01T00:00:00Z",
          links: [
            {
              id: "note-1@para-a",
              kind: "anchor",
              anchor: { type: "anchor", paragraphIds: ["para-a"], margin: { side: "right" } },
              target: { type: "card", ref: { kind: "note", id: "note-1" } },
              createdAt: "",
            },
          ],
        },
      ],
    };
    // Serialize, parse, re-migrate the items, serialize again.
    const serialized = JSON.stringify(canonical);
    const parsed = JSON.parse(serialized);
    const migratedLinks = migrateCardLinks("note", parsed.notes[0]);
    expect(migratedLinks).toEqual(canonical.notes[0].links);

    const reserialized = JSON.stringify({
      notes: [{ ...parsed.notes[0], links: migratedLinks }],
    });
    expect(reserialized).toBe(serialized);
  });

  it("archive: migrate preserves title + content fields", () => {
    const canonical = {
      snippets: [
        {
          id: "arc-1",
          title: "old draft",
          content: { type: "doc", content: [] },
          createdAt: "2026-01-01T00:00:00Z",
          links: [],
        },
      ],
    };
    const parsed = JSON.parse(JSON.stringify(canonical));
    const links = migrateCardLinks("archive", parsed.snippets[0]);
    expect(links).toEqual([]);
    // The non-links fields must not be mutated by the migration helper.
    expect(parsed.snippets[0]).toEqual(canonical.snippets[0]);
  });

  it("legacy → canonical: a one-shot upgrade is stable on the second pass", () => {
    const legacy = {
      id: "cut-1",
      content: { type: "doc", content: [] },
      paragraphIds: ["p-1"],
    };
    const firstLinks = migrateCardLinks("cut", legacy);
    expect(firstLinks).toHaveLength(1);

    // After migration, persist the new shape (links[] canonical, legacy
    // field dropped) — second pass should not change anything.
    const upgraded = { id: legacy.id, content: legacy.content, links: firstLinks };
    const secondLinks = migrateCardLinks("cut", upgraded);
    expect(secondLinks).toBe(firstLinks);
  });
});
