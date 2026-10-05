// @vitest-environment jsdom
//
// Task 946 — ONE rule for a loaded card's creation time. A card record with
// no (or an unparseable) `createdAt` used to be DROPPED by the Reports,
// Revisions and Cutter loaders (Reports then deleted it from disk on open),
// passed through as `undefined` by Notes/Todos (a NaN sort), and healed ad hoc
// by the Archive. Every card migrator now heals through `loadedCreatedAt`, and
// the four panels sort through the one `byCreatedAt` comparator.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({}),
);

import { migrateReports } from "../useReports";
import { migrateRevisions } from "../useRevisions";
import { migrateCutter } from "../useCutter";
import { migrateNotes } from "../useNotes";
import { migrateTodos } from "../useTodos";
import { migrateArchive } from "../useArchive";
import { byCreatedAt } from "../useRecentlyAddedTracker";
import { loadedCreatedAt } from "@/lib/sidecar-migrate";

const STAMP = "2026-01-02T03:04:05.000Z";
const isIso = (v: unknown) =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

type Row = {
  name: string;
  load: (record: Record<string, unknown>) => Array<{ id: string; createdAt: string }>;
};

const ROWS: Row[] = [
  { name: "report", load: (c) => migrateReports({ cards: [{ kind: "report", ...c }] }).cards },
  { name: "report-request", load: (c) => migrateReports({ cards: [{ kind: "report-request", ...c }] }).cards },
  { name: "revision comment", load: (c) => migrateRevisions({ cards: [{ kind: "comment", ...c }] }).cards },
  { name: "revision suggestion", load: (c) => migrateRevisions({ cards: [{ kind: "suggestion", ...c }] }).cards },
  { name: "revision legacy comments[]", load: (c) => migrateRevisions({ comments: [c] }).cards },
  { name: "cutter comment", load: (c) => migrateCutter({ cards: [{ kind: "comment", ...c }] }).cards },
  { name: "cutter suggestion", load: (c) => migrateCutter({ cards: [{ kind: "suggestion", ...c }] }).cards },
  { name: "cutter legacy cuts[]", load: (c) => migrateCutter({ cuts: [c] }).cards },
  { name: "note", load: (c) => migrateNotes({ cards: [{ kind: "note", ...c }] }).cards },
  { name: "highlight", load: (c) => migrateNotes({ cards: [{ kind: "highlight", ...c }] }).cards },
  { name: "todo", load: (c) => migrateTodos({ items: [c] }).items },
  { name: "archive", load: (c) => migrateArchive({ snippets: [c] }).snippets },
];

describe("card loaders heal a missing createdAt instead of dropping the card", () => {
  for (const row of ROWS) {
    describe(row.name, () => {
      for (const [label, value] of [
        ["absent", undefined],
        ["empty", ""],
        ["unparseable", "not a date"],
      ] as const) {
        it(`loads a record whose createdAt is ${label}`, () => {
          const rec: Record<string, unknown> = { id: "c1", links: [] };
          if (value !== undefined) rec.createdAt = value;
          const out = row.load(rec);
          expect(out).toHaveLength(1);
          expect(out[0].id).toBe("c1");
          expect(isIso(out[0].createdAt)).toBe(true);
        });
      }
      it("round-trips a well-formed createdAt unchanged", () => {
        const out = row.load({ id: "c1", createdAt: STAMP, links: [] });
        expect(out[0].createdAt).toBe(STAMP);
      });
    });
  }

  it("still drops a record with no id (identity cannot be healed)", () => {
    expect(migrateReports({ cards: [{ kind: "report", createdAt: STAMP }] }).cards).toHaveLength(0);
    expect(migrateRevisions({ cards: [{ kind: "comment", createdAt: STAMP }] }).cards).toHaveLength(0);
    expect(migrateCutter({ cards: [{ kind: "comment", createdAt: STAMP }] }).cards).toHaveLength(0);
  });
});

describe("loadedCreatedAt", () => {
  it("keeps a parseable value byte-for-byte and heals anything else", () => {
    expect(loadedCreatedAt("2026-01-02")).toBe("2026-01-02");
    for (const bad of [undefined, null, "", "garbage", 42]) {
      expect(isIso(loadedCreatedAt(bad))).toBe(true);
    }
  });
});

describe("byCreatedAt — the one panel comparator", () => {
  it("orders by instant, puts unparseable values last, and is deterministic", () => {
    const items = [
      { id: "late", createdAt: "2026-03-01T00:00:00.000Z" },
      { id: "bad", createdAt: undefined as unknown as string },
      { id: "early", createdAt: "2026-01-01T00:00:00.000Z" },
      // Same instant as `late`, spelled with an offset: compares by time.
      { id: "offset", createdAt: "2026-02-28T19:00:00.000-05:00" },
      { id: "mid", createdAt: "2026-02-01T00:00:00.000Z" },
    ];
    const a = [...items].sort(byCreatedAt).map((i) => i.id);
    const b = [...items].reverse().sort(byCreatedAt).map((i) => i.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe("early");
    expect(a[1]).toBe("mid");
    expect(a.slice(2, 4).sort()).toEqual(["late", "offset"]);
    expect(a[4]).toBe("bad");
  });
});
