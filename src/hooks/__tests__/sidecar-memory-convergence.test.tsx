// @vitest-environment jsdom
//
// Task 1078 — "make memory agree with what disk now holds" has ONE owner per
// half: `convergeOnWrite` after every merged write, `useSidecarReread` after
// every external change. Before it:
//
//  - a merged save absorbed a skill's commit onto disk, stamped the ledger, and
//    memory never learned of it (the watcher sees our own fingerprint) — an
//    agent's card invisible until reopen, an agent's EDIT reverted by the user's
//    next touch of that card;
//  - `useFootnotes` never re-read `footnotes.json` at all;
//  - `useBibReview` re-read wholesale on a private 10 s timer;
//  - a re-read a write overtook merged pre-write disk and dropped the user's
//    just-saved insert from memory.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const disk = new Map<string, unknown>();
/** Runs inside the next mutate, BEFORE its in-lock read: a skill's commit. */
let foreignCommit: (() => void) | null = null;
/** When set, the next `readSidecarIfExists` snapshots disk now but resolves
 *  only when the test releases it. */
let gateNextReread: { release: () => void } | null = null;
let armGate = false;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: async (_d: string, f: string, dflt: unknown) =>
      disk.has(f) ? structuredClone(disk.get(f)) : dflt,
    readSidecarIfExists: async (_d: string, f: string) => {
      const v = disk.has(f) ? structuredClone(disk.get(f)) : null;
      if (armGate) {
        armGate = false;
        await new Promise<void>((resolve) => {
          gateNextReread = { release: resolve };
        });
      }
      return v;
    },
    writeSidecar: async (_h: unknown, f: string, v: unknown) => {
      disk.set(f, structuredClone(v));
    },
    mutateSidecar: async (
      _h: unknown,
      f: string,
      dflt: unknown,
      mutate: (cur: unknown) => unknown,
    ) => {
      await new Promise((r) => setTimeout(r, 0));
      const hook = foreignCommit;
      foreignCommit = null;
      hook?.();
      const cur = disk.has(f) ? structuredClone(disk.get(f)) : dflt;
      const next = mutate(cur);
      if (next === null) return null;
      disk.set(f, structuredClone(next));
      return next;
    },
  }),
);

import { usePersistentState } from "../usePersistentState";
import { useFootnotes } from "../useFootnotes";
import { useBibReview } from "../useBibReview";
import { dispatchSidecarChanged } from "@/lib/sidecar-watcher";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

interface Card {
  id: string;
  body: string;
  title?: string;
}
interface Notes {
  cards: Card[];
}
const NOTES = "notes.json";
const DOC = "doc-converge";

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

beforeEach(() => {
  disk.clear();
  foreignCommit = null;
  gateNextReread = null;
  armGate = false;
  __resetForTests();
  beginDocPipeline(DOC);
});

async function mountNotes(initial: Notes) {
  disk.set(NOTES, initial);
  const hook = renderHook(() =>
    usePersistentState<Notes>(DOC, NOTES, { cards: [] }, { debounceMs: 0 }),
  );
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

describe("a merged write SHOWS what it absorbed (convergeOnWrite)", () => {
  it("a skill's card committed under the user's save appears in memory", async () => {
    const { result } = await mountNotes({ cards: [{ id: "a", body: "A" }] });
    foreignCommit = () => {
      disk.set(NOTES, { cards: [{ id: "a", body: "A" }, { id: "agent", body: "AI" }] });
    };
    act(() => {
      result.current.update((s) => ({ cards: [...s.cards, { id: "c", body: "C" }] }));
    });
    await settle();
    const ids = (s: Notes) => s.cards.map((c) => c.id).sort();
    expect(ids(disk.get(NOTES) as Notes)).toEqual(["a", "agent", "c"]);
    expect(ids(result.current.state)).toEqual(["a", "agent", "c"]);
  });

  it("an agent's EDIT absorbed by a save survives the user's next edit of that card", async () => {
    const { result } = await mountNotes({
      cards: [
        { id: "a", body: "A" },
        { id: "y", body: "Y" },
      ],
    });
    foreignCommit = () => {
      disk.set(NOTES, {
        cards: [
          { id: "a", body: "A" },
          { id: "y", body: "Y-by-agent" },
        ],
      });
    };
    act(() => {
      result.current.update((s) => ({
        cards: s.cards.map((c) => (c.id === "a" ? { ...c, body: "A2" } : c)),
      }));
    });
    await settle();
    expect(result.current.state.cards.find((c) => c.id === "y")?.body).toBe("Y-by-agent");
    // The user now touches y — a field the agent did not.
    act(() => {
      result.current.update((s) => ({
        cards: s.cards.map((c) => (c.id === "y" ? { ...c, title: "T" } : c)),
      }));
    });
    await settle();
    const y = (disk.get(NOTES) as Notes).cards.find((c) => c.id === "y");
    expect(y).toEqual({ id: "y", body: "Y-by-agent", title: "T" });
  });

  it("the clean path is unchanged: nothing foreign → memory is exactly what was saved", async () => {
    const { result } = await mountNotes({ cards: [{ id: "a", body: "A" }] });
    let saved: Notes | null = null;
    act(() => {
      result.current.update((s) => {
        saved = { cards: [...s.cards, { id: "c", body: "C" }] };
        return saved;
      });
    });
    await settle();
    expect(result.current.state).toBe(saved);
  });
});

describe("the external re-read discards a read a write overtook", () => {
  it("a write that starts and lands mid-read does not drop the user's insert", async () => {
    const { result } = await mountNotes({ cards: [{ id: "a", body: "A" }] });
    armGate = true;
    act(() => dispatchSidecarChanged({ docId: DOC, filename: NOTES }));
    await waitFor(() => expect(gateNextReread).not.toBeNull());
    // The read holds the pre-write snapshot; the user's insert lands now.
    act(() => {
      result.current.update((s) => ({ cards: [...s.cards, { id: "c", body: "C" }] }));
    });
    await settle();
    expect((disk.get(NOTES) as Notes).cards.map((c) => c.id)).toEqual(["a", "c"]);
    await act(async () => {
      gateNextReread!.release();
    });
    await settle();
    expect(result.current.state.cards.map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("useFootnotes re-reads on an external change", () => {
  const body = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("a skill's footnote write reaches memory without a reopen", async () => {
    disk.set("footnotes.json", { footnotes: [{ id: "f1", content: body("one") }] });
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs.map((f) => f.id)).toEqual(["f1"]));
    disk.set("footnotes.json", {
      footnotes: [
        { id: "f1", content: body("one") },
        { id: "f2", content: body("two") },
      ],
    });
    act(() => dispatchSidecarChanged({ docId: DOC, filename: "footnotes.json" }));
    await waitFor(() =>
      expect(result.current.footnoteRefs.map((f) => f.id)).toEqual(["f1", "f2"]),
    );
  });
});

describe("useBibReview converges through the shared doors", () => {
  const FILE = "bib-review-requests.json";

  it("has no private poller", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/hooks/useBibReview.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/setInterval\s*\(/);
    expect(src).toMatch(/useSidecarReread<BibReviewState>\(/);
  });

  it("an external completion is merged in on the watcher's event", async () => {
    disk.set(FILE, {
      requests: [{ bibKey: "k1", type: "fields", requestedAt: "t", status: "pending" }],
    });
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    disk.set(FILE, {
      requests: [{ bibKey: "k1", type: "fields", requestedAt: "t", status: "complete" }],
    });
    act(() => dispatchSidecarChanged({ docId: DOC, filename: FILE }));
    await waitFor(() => expect(result.current.getRequestStatus("k1", "fields")).toBe("complete"));
  });

  it("a request filed while a skill completes another shows both", async () => {
    disk.set(FILE, {
      requests: [{ bibKey: "k1", type: "fields", requestedAt: "t", status: "pending" }],
    });
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    foreignCommit = () => {
      disk.set(FILE, {
        requests: [{ bibKey: "k1", type: "fields", requestedAt: "t", status: "complete" }],
      });
    };
    act(() => { void result.current.requestReview("k2", "notes"); });
    await settle();
    expect(result.current.getRequestStatus("k1", "fields")).toBe("complete");
    expect(result.current.getRequestStatus("k2", "notes")).toBe("pending");
  });
});
