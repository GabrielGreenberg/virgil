// @vitest-environment jsdom
//
// Task 712 guardrail — a LOADER is not a transform. Every card-sidecar
// migrator must carry a key it does not know through the load (an agent
// extension such as archive-card's `originalPanel`/`originalCard`/`archivedAt`),
// while still retiring the legacy anchor keys it CONSUMED into `links`. One row
// per migrator SHAPE, loaded through the real hook so the assertion covers the
// same path `persistMigrationOnLoad` writes back.
//
// Task 715 adds the FILE level of the same rule. 712 carried the envelope of a
// RECORD; every top-level migrator was still the rebuild the doctrine condemns,
// so anything an agent wrote beside `cards` was destroyed on the next save —
// live, not latent, for `document-settings.json`, whose `settingsEdit` op
// merges arbitrary keys. `withSidecarEnvelope` wraps each migrator; the three
// describes below are (1) the per-record legs 712 wrote, (2) a per-FILE leg
// that an unknown top-level key survives the load and the write-back while
// each legacy top-level key is retired, and (3) a CENSUS — every
// `usePersistentState` migrate registration in `src/` must be enveloped, so a
// new sidecar joins the rule by existing rather than by being remembered.
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
import { carryUnknownKeys, withSidecarEnvelope } from "@/lib/sidecar-migrate";
import { migrateArchive } from "../useArchive";
import { migrateNotes } from "../useNotes";
import { migrateRevisions } from "../useRevisions";
import { migrateCutter } from "../useCutter";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { migrateDocumentSettings } from "@/lib/document-settings";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

// ---------------------------------------------------------------------------
// Task 715 — the FILE's own envelope.
// ---------------------------------------------------------------------------

/** The unknown top-level key an agent might park beside the list key. */
const TOP = { agentCursor: { lastSeen: "2026-09-22T00:00:00.000Z" } };

describe("every sidecar migrator carries unknown TOP-LEVEL keys through a load", () => {
  it("notes.json — legacy `notes` retired, unknown key carried", () => {
    const out = migrateNotes({
      notes: [{ id: "n1", title: "legacy", content: {}, ...base }],
      ...TOP,
    });
    expect(out.cards.length).toBe(1);
    expect((out as unknown as Rec).notes).toBeUndefined();
    expect((out as unknown as Rec).agentCursor).toEqual(TOP.agentCursor);
  });

  it("revisions.json — legacy arrays retired, unknown key carried", () => {
    const out = migrateRevisions({
      comments: [{ id: "v1", text: "a", ...base }],
      generalRevisions: [],
      textRevisions: [],
      ...TOP,
    });
    expect(out.cards.length).toBe(1);
    expect((out as unknown as Rec).comments).toBeUndefined();
    expect((out as unknown as Rec).generalRevisions).toBeUndefined();
    expect((out as unknown as Rec).textRevisions).toBeUndefined();
    expect((out as unknown as Rec).agentCursor).toEqual(TOP.agentCursor);
  });

  it("cutter.json — legacy `cuts` retired, unknown key carried", () => {
    const out = migrateCutter({
      cuts: [{ id: "c1", title: "x", content: {}, createdAt: base.createdAt }],
      ...TOP,
    });
    expect(out.cards.length).toBe(1);
    expect((out as unknown as Rec).cuts).toBeUndefined();
    expect((out as unknown as Rec).agentCursor).toEqual(TOP.agentCursor);
  });

  it("document-settings.json — the CLUSTER'S LIVE MEMBER: an agent-set key survives, legacy `style` does not", () => {
    const out = migrateDocumentSettings({ style: "classic", agentNote: "set by /editor/style-merge" });
    expect(out.styleId).toBe("classic");
    expect((out as unknown as Rec).style).toBeUndefined();
    expect((out as unknown as Rec).agentNote).toBe("set by /editor/style-merge");
  });

  it("archive.json — an unknown top-level key survives the write-back too", async () => {
    beginDocPipeline("doc-ta");
    mockRead.mockResolvedValue({ snippets: [], ...TOP });
    const { result } = renderHook(() => useArchive("doc-ta"));
    await waitFor(() => expect(result.current.snippets).toEqual([]));
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    const written = mockWrite.mock.calls.at(-1)!.find(
      (a: unknown) => !!a && typeof a === "object" && "snippets" in (a as object),
    ) as Rec;
    expect(written.agentCursor).toEqual(TOP.agentCursor);
  });

  it("todos / reports / orphaned-footnotes — the unknown key rides through the hook", async () => {
    for (const [docId, sidecar, hook, read] of [
      ["doc-tt", { items: [], ...TOP }, useTodos, (a: { items: unknown[] }) => a.items],
      ["doc-tr", { cards: [], ...TOP }, useReports, (a: { cards: unknown[] }) => a.cards],
      [
        "doc-to",
        { version: 1, orphans: [], ...TOP },
        useOrphanedFootnotes,
        (a: { orphans: unknown[] }) => a.orphans,
      ],
    ] as const) {
      __resetForTests();
      mockWrite.mockReset();
      mockWrite.mockResolvedValue(undefined);
      beginDocPipeline(docId);
      mockRead.mockResolvedValue(sidecar);
      const { result } = renderHook(() => (hook as (d: string) => unknown)(docId));
      await waitFor(() =>
        expect((read as (a: unknown) => unknown[])(result.current)).toEqual([]),
      );
      // The hook's API object is not the state, so prove the carry on the
      // write-back — the same bytes `persistMigrationOnLoad` lands on disk.
      await waitFor(() => expect(mockWrite).toHaveBeenCalled());
      const written = mockWrite.mock.calls.at(-1)!.find(
        (a: unknown) => !!a && typeof a === "object" && "agentCursor" in (a as object),
      ) as Rec | undefined;
      expect(written?.agentCursor).toEqual(TOP.agentCursor);
    }
  });
});

describe("withSidecarEnvelope", () => {
  it("the migrator's own output wins; unknown top-level keys survive", () => {
    const f = withSidecarEnvelope((raw: unknown) => ({
      cards: ((raw as { cards?: unknown[] }).cards ?? []).length,
    }));
    expect(f({ cards: [1, 2], mine: "keep" })).toEqual({ cards: 2, mine: "keep" });
  });

  it("a consumed legacy top-level key is retired, never resurrected", () => {
    const f = withSidecarEnvelope((raw: unknown) => ({ cards: (raw as Rec).legacy ?? [] }), [
      "legacy",
    ]);
    expect(f({ legacy: ["a"], mine: 1 })).toEqual({ cards: ["a"], mine: 1 });
  });

  it("a non-object file (a bare array, null) carries nothing", () => {
    const f = withSidecarEnvelope(() => ({ words: [] as string[] }));
    expect(f(["a", "b"])).toEqual({ words: [] });
    expect(f(null)).toEqual({ words: [] });
  });
});

// ---------------------------------------------------------------------------
// The census — a NEW sidecar joins the rule by existing.
// ---------------------------------------------------------------------------

const SRC = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("census — every usePersistentState migrate registration is enveloped", () => {
  const files = walk(SRC).map((f) => [f, readFileSync(f, "utf8")] as const);

  it("names every registration through a `withSidecarEnvelope` identifier", () => {
    const offenders: string[] = [];
    const envelopedNames = new Set<string>();
    for (const [, text] of files) {
      for (const m of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*withSidecarEnvelope\(/g)) {
        envelopedNames.add(m[1]);
      }
    }
    for (const [file, text] of files) {
      if (!text.includes("usePersistentState<")) continue;
      for (const m of text.matchAll(/\bmigrate:\s*([^,\n]+)/g)) {
        const ref = m[1].trim();
        // An inline arrow / function expression cannot be censused — lift it
        // to a named `withSidecarEnvelope` binding instead.
        if (!/^\w+$/.test(ref) || !envelopedNames.has(ref)) {
          offenders.push(`${file.slice(SRC.length + 1)} → migrate: ${ref}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("finds the registrations it is meant to be guarding (the census is not vacuous)", () => {
    const registrations = files.filter(
      ([, text]) => text.includes("usePersistentState<") && /\bmigrate:/.test(text),
    );
    expect(registrations.length).toBeGreaterThanOrEqual(10);
  });
});
