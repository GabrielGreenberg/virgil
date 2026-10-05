// @vitest-environment jsdom
//
// Task 959 — a load that HEALS must be written back.
//
// `loadedCreatedAt` (task 946) heals a missing/malformed `createdAt` to the
// load time. That value is only stable once it reaches disk; a panel that
// never writes its load back re-heals the same card to a NEW "now" on every
// open, so it sorts as newest each time. Revisions and Cutter were the two
// card panels that did not opt into `persistMigrationOnLoad`. This suite pins:
//   1. the census — every hook whose migrator heals registers write-back;
//   2. the behaviour — two consecutive loads of a revisions/cutter card with no
//      `createdAt` agree, and the file gains the healed value;
//   3. losslessness of the write-back — a file carrying BOTH a current
//      `cards[]` and a consumed legacy array keeps both (the legacy key is
//      consumed, so a skipped entry would be deleted on open).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walkFiles } from "@/lib/__tests__/_source-scan";

const disk = new Map<string, unknown>();
const mockWrite = vi.fn(
  async (handle: { docId: string }, filename: string, value: unknown) => {
    disk.set(`${handle.docId}/${filename}`, structuredClone(value));
  },
);
const mockRead = vi.fn(async (docId: string, filename: string) => {
  const v = disk.get(`${docId}/${filename}`);
  return v === undefined ? null : structuredClone(v);
});

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...(a as [string, string])),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...(a as [string, string])),
    writeSidecar: (...a: unknown[]) =>
      mockWrite(...(a as [{ docId: string }, string, unknown])),
  }),
);

import { useRevisions, migrateRevisions } from "../useRevisions";
import { useCutter, migrateCutter } from "../useCutter";
import { usePersistentState } from "../usePersistentState";
import { withSidecarEnvelope } from "@/lib/sidecar-migrate";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  disk.clear();
  mockWrite.mockClear();
  mockRead.mockClear();
  __resetForTests();
});

// ---------------------------------------------------------------------------
// 1. The census — a migrator that heals is a migrator that writes back.
// ---------------------------------------------------------------------------

const SRC = resolve(__dirname, "../..");

describe("census — every healing loader writes its load back", () => {
  const files: (readonly [string, string])[] = [];
  for (const full of walkFiles(SRC, { skipDirs: ["__tests__"] })) {
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
    if (full.endsWith("sidecar-migrate.ts")) continue; // the heal's own definition
    files.push([full, readFileSync(full, "utf8")] as const);
  }
  const healers = files.filter(([, t]) => t.includes("loadedCreatedAt("));

  it("finds the healing loaders (the census is not vacuous)", () => {
    expect(healers.length).toBeGreaterThanOrEqual(6);
  });

  it("each registers `persistMigrationOnLoad: true` beside its usePersistentState", () => {
    const offenders = healers
      .filter(
        ([, t]) =>
          !(t.includes("usePersistentState<") && /persistMigrationOnLoad:\s*true/.test(t)),
      )
      .map(([f]) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. The behaviour — a healed createdAt is stable across loads.
// ---------------------------------------------------------------------------

async function loadTwice<C extends { id: string; createdAt: string }>(
  docId: string,
  open: () => { current: { cards: C[] } },
): Promise<[string, string]> {
  beginDocPipeline(docId);
  const first = open();
  await waitFor(() => expect(first.current.cards.length).toBe(1));
  const a = first.current.cards[0].createdAt;
  await waitFor(() => expect(mockWrite).toHaveBeenCalled());
  cleanup();
  await new Promise((r) => setTimeout(r, 5));
  const second = open();
  await waitFor(() => expect(second.current.cards.length).toBe(1));
  return [a, second.current.cards[0].createdAt];
}

describe("a healed createdAt survives a re-open", () => {
  it("revisions.json", async () => {
    disk.set("doc-r/revisions.json", {
      cards: [{ kind: "comment", id: "r1", text: "agent-written", links: [] }],
    });
    const [a, b] = await loadTwice("doc-r", () => renderHook(() => useRevisions("doc-r")).result);
    expect(b).toBe(a);
    const onDisk = disk.get("doc-r/revisions.json") as { cards: { createdAt?: string }[] };
    expect(onDisk.cards[0].createdAt).toBe(a);
  });

  it("cutter.json", async () => {
    disk.set("doc-c/cutter.json", {
      cards: [{ kind: "comment", id: "c1", text: "agent-written", links: [] }],
    });
    const [a, b] = await loadTwice("doc-c", () => renderHook(() => useCutter("doc-c")).result);
    expect(b).toBe(a);
    const onDisk = disk.get("doc-c/cutter.json") as { cards: { createdAt?: string }[] };
    expect(onDisk.cards[0].createdAt).toBe(a);
  });
});

// The write-back persists the migration the panel is SHOWING, not a second
// one: a healing migrator is impure (each run stamps its own "now"), so a
// re-derivation from the unchanged file would store a different value than
// the open panel holds. Pinned with a migrator that answers differently on
// every call, so the result cannot depend on two runs landing in one ms.
describe("the write-back stores the shown migration when disk is unchanged", () => {
  it("does not re-run an impure migrator against the same file", async () => {
    beginDocPipeline("doc-p");
    disk.set("doc-p/p.json", { n: 0 });
    let calls = 0;
    const migrate = withSidecarEnvelope(() => ({ n: ++calls }));
    const { result } = renderHook(() =>
      usePersistentState<{ n: number }>("doc-p", "p.json", { n: 0 }, {
        migrate,
        persistMigrationOnLoad: true,
      }),
    );
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    expect(disk.get("doc-p/p.json")).toEqual(result.current.state);
  });
});

// ---------------------------------------------------------------------------
// 3. Lossless write-back — current + legacy arrays side by side.
// ---------------------------------------------------------------------------

const T = "2026-01-01T00:00:00.000Z";

describe("a consumed legacy array beside `cards[]` is folded, not dropped", () => {
  it("revisions: `comments[]` entries join `cards[]`; a duplicate id keeps the current card", () => {
    const out = migrateRevisions({
      cards: [{ kind: "comment", id: "a", text: "current", createdAt: T, links: [] }],
      comments: [
        { id: "a", text: "stale legacy twin", createdAt: T },
        { id: "b", text: "legacy only", createdAt: T },
      ],
    });
    expect(out.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect((out.cards[0] as { text: string }).text).toBe("current");
    expect("comments" in out).toBe(false);
    // Idempotent: what the write-back stores re-loads unchanged.
    expect(migrateRevisions(out)).toEqual(out);
  });

  it("cutter: `cuts[]` entries join `cards[]`; a duplicate id keeps the current card", () => {
    const out = migrateCutter({
      cards: [{ kind: "comment", id: "a", text: "current", createdAt: T, links: [] }],
      cuts: [
        { id: "a", title: "stale legacy twin", createdAt: T },
        { id: "b", title: "legacy only", createdAt: T },
      ],
    });
    expect(out.cards.map((c) => c.id)).toEqual(["a", "b"]);
    expect((out.cards[0] as { text: string }).text).toBe("current");
    expect("cuts" in out).toBe(false);
    expect(migrateCutter(out)).toEqual(out);
  });
});
