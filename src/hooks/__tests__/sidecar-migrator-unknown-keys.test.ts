// @vitest-environment jsdom
//
// Task 712 guardrail — a LOADER is not a transform. Every card-sidecar
// migrator must carry a key it does not know through the load (an agent
// extension such as archive-card's `originalPanel`/`originalCard`/`archivedAt`),
// while still retiring the legacy anchor keys it CONSUMED into `links`. One row
// per migrator SHAPE, loaded through the real hook so the assertion covers the
// same path `persistMigrationOnLoad` writes back.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useNotes } from "../useNotes";
import { useTodos } from "../useTodos";
import { useArchive } from "../useArchive";
import { useReports } from "../useReports";
import { useCutter } from "../useCutter";
import { useRevisions } from "../useRevisions";
import { useOrphanedFootnotes } from "../useOrphanedFootnotes";
import { carryUnknownKeys } from "@/lib/sidecar-migrate";
import { migrateArchive } from "../useArchive";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };
const EXT = { agentExtension: { from: "a future skill", n: 3 } };

type Rec = Record<string, unknown>;

async function loadThrough<T>(
  docId: string,
  sidecar: unknown,
  hook: (docId: string) => T,
  records: (api: T) => Rec[],
  expected: number,
): Promise<Rec[]> {
  beginDocPipeline(docId);
  mockRead.mockResolvedValue(sidecar);
  const { result } = renderHook(() => hook(docId));
  await waitFor(() => expect(records(result.current).length).toBe(expected));
  return records(result.current);
}

describe("every card-sidecar migrator carries unknown keys through a load", () => {
  it("notes.json — note + highlight", async () => {
    const got = await loadThrough(
      "doc-n",
      {
        cards: [
          { kind: "note", id: "n1", title: "", content: {}, ...base, ...EXT },
          { kind: "highlight", id: "h1", highlightColor: null, ...base, ...EXT },
        ],
      },
      (d) => useNotes(d),
      (a) => a.cards as unknown as Rec[],
      2,
    );
    for (const c of got) expect(c.agentExtension).toEqual(EXT.agentExtension);
  });

  it("todos.json", async () => {
    const got = await loadThrough(
      "doc-t",
      { items: [{ id: "t1", text: "x", notes: "", done: true, ...base, ...EXT }] },
      (d) => useTodos(d),
      (a) => a.items as unknown as Rec[],
      1,
    );
    expect(got[0].agentExtension).toEqual(EXT.agentExtension);
    expect(got[0].done).toBe(true);
  });

  it("reports.json — report + report-request", async () => {
    const got = await loadThrough(
      "doc-r",
      {
        cards: [
          { kind: "report", id: "r1", title: "", text: "a", content: {}, ...base, ...EXT },
          { kind: "report-request", id: "r2", text: "b", content: {}, ...base, ...EXT },
        ],
      },
      (d) => useReports(d),
      (a) => a.cards as unknown as Rec[],
      2,
    );
    for (const c of got) expect(c.agentExtension).toEqual(EXT.agentExtension);
  });

  it("cutter.json — comment + suggestion", async () => {
    const got = await loadThrough(
      "doc-c",
      {
        cards: [
          { kind: "comment", id: "c1", text: "a", content: {}, ...base, ...EXT },
          { kind: "suggestion", id: "c2", original_text: "o", ...base, ...EXT },
        ],
        goal: null,
      },
      (d) => useCutter(d),
      (a) => a.cards as unknown as Rec[],
      2,
    );
    for (const c of got) expect(c.agentExtension).toEqual(EXT.agentExtension);
  });

  it("revisions.json — comment + suggestion", async () => {
    const got = await loadThrough(
      "doc-v",
      {
        cards: [
          { kind: "comment", id: "v1", text: "a", content: {}, ...base, ...EXT },
          { kind: "suggestion", id: "v2", original_text: "o", ...base, ...EXT },
        ],
        tracker: null,
      },
      (d) => useRevisions(d),
      (a) => a.cards as unknown as Rec[],
      2,
    );
    for (const c of got) expect(c.agentExtension).toEqual(EXT.agentExtension);
  });

  it("orphaned-footnotes.json", async () => {
    const got = await loadThrough(
      "doc-o",
      { version: 1, orphans: [{ footnoteId: "f1", content: {}, ...EXT }] },
      (d) => useOrphanedFootnotes(d),
      (a) => a.orphans as unknown as Rec[],
      1,
    );
    expect(got[0].agentExtension).toEqual(EXT.agentExtension);
  });

  it("archive.json — the agent origin record survives the load AND the write-back", async () => {
    const originalCard = {
      kind: "note",
      id: "a1",
      title: "Why",
      content: { type: "doc", content: [] },
      aiRequest: false,
      createdAt: "2025-12-12T00:00:00.000Z",
      links: [],
    };
    const got = await loadThrough(
      "doc-a",
      {
        snippets: [
          {
            id: "a1",
            title: "Why",
            content: { type: "doc", content: [] },
            ...base,
            originalPanel: "notes",
            originalCard,
            archivedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      (d) => useArchive(d),
      (a) => a.snippets as unknown as Rec[],
      1,
    );
    expect(got[0].originalPanel).toBe("notes");
    expect(got[0].originalCard).toEqual(originalCard);
    expect(got[0].archivedAt).toBe("2026-09-01T00:00:00.000Z");
    // persistMigrationOnLoad writes the migrated value back — it must be whole.
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    const written = mockWrite.mock.calls.at(-1)!.find(
      (a: unknown) => !!a && typeof a === "object" && "snippets" in (a as object),
    ) as { snippets: Rec[] };
    expect(written.snippets[0].originalPanel).toBe("notes");
    expect(written.snippets[0].originalCard).toEqual(originalCard);
    expect(written.snippets[0].archivedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("carryUnknownKeys — what a load may NOT carry", () => {
  it("the migrator's own output wins over the raw value", () => {
    expect(carryUnknownKeys({ a: "raw", b: 1 }, { a: "normalized" })).toEqual({
      a: "normalized",
      b: 1,
    });
  });

  it("legacy anchor keys consumed into links are retired, not resurrected", () => {
    const out = carryUnknownKeys(
      { id: "x", paragraphIds: ["p"], anchorId: "q", anchorText: "t", keep: 1 },
      { id: "x", links: [] },
    );
    expect(out).toEqual({ id: "x", links: [], keep: 1 });
  });

  it("a migrator's named consumed keys are retired", () => {
    expect(carryUnknownKeys({ text: "legacy", k: 1 }, { content: {} }, ["text"])).toEqual({
      content: {},
      k: 1,
    });
  });

  it("archive: legacy `text` is consumed into content, not carried", () => {
    const s = migrateArchive({ snippets: [{ id: "s", text: "plain", ...base }] }).snippets[0];
    expect((s as unknown as Rec).text).toBeUndefined();
    expect(s.content).toBeTruthy();
  });
});
