// @vitest-environment jsdom
//
// Task 1332 — a MANUAL Refresh of a sidecar goes through the same re-read
// policy as a watcher signal (`useSidecarReread`, task 1078): deferred while a
// write is armed or in flight, merged rather than adopted, stale reads
// discarded, the merge base advanced by the read.
//
// Before it the AI window's Refresh (and its refresh-on-open) called two raw
// doors: `useBibSettings.refresh` adopted `readSidecar(...)` wholesale, and
// `useBibReview.refresh` re-ran the MOUNT loader, which also moved the merge
// base. A Refresh inside the 300 ms write window adopted pre-request disk, the
// armed write then landed the request and advanced the base to it, and the next
// bib-settings mutation wrote memory (without the request) against a base that
// had it — a "user deletion" — so the request vanished from disk. Silent.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { codeOnly, REPO_ROOT } from "../../lib/__tests__/_source-scan";

const disk = new Map<string, unknown>();
/** When set, the next merged write holds IN FLIGHT until the test releases it. */
let writeGate: Promise<void> | null = null;
let writesStarted = 0;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: async (_d: string, f: string, dflt: unknown) =>
      disk.has(f) ? structuredClone(disk.get(f)) : dflt,
    readSidecarIfExists: async (_d: string, f: string) =>
      disk.has(f) ? structuredClone(disk.get(f)) : null,
    writeSidecar: async (_h: unknown, f: string, v: unknown) => {
      disk.set(f, structuredClone(v));
    },
    mutateSidecar: async (
      _h: unknown,
      f: string,
      dflt: unknown,
      mutate: (cur: unknown) => unknown,
    ) => {
      writesStarted += 1;
      const gate = writeGate;
      writeGate = null;
      if (gate) await gate;
      const cur = disk.has(f) ? structuredClone(disk.get(f)) : dflt;
      const next = mutate(cur);
      if (next === null) return null;
      disk.set(f, structuredClone(next));
      return next;
    },
  }),
);

import { useBibSettings } from "../useBibSettings";
import { useBibReview } from "../useBibReview";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-1332";

function gate() {
  let release!: () => void;
  writeGate = new Promise<void>((r) => {
    release = r;
  });
  return release;
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

beforeEach(() => {
  disk.clear();
  writeGate = null;
  writesStarted = 0;
  __resetForTests();
  beginDocPipeline(DOC);
});

describe("useBibSettings · a Refresh never drops a just-filed entry request", () => {
  const FILE = "bib-settings.json";
  const req = (id: string) => ({
    id,
    description: id,
    status: "pending" as const,
    createdAt: "t",
  });
  const ids = () =>
    ((disk.get(FILE) as { entryRequests: { id: string }[] }).entryRequests ?? []).map(
      (r) => r.id,
    );

  it("DEFECT: Refresh while the write is ARMED and then IN FLIGHT keeps the request; the next mutation leaves it on disk", async () => {
    disk.set(FILE, { generalBibPath: null, entryRequests: [req("A"), req("X")] });
    const { result } = renderHook(() => useBibSettings(DOC));
    await waitFor(() => expect(result.current.entryRequests).toHaveLength(2));

    const release = gate();
    act(() => result.current.addEntryRequest("new"));
    expect(result.current.entryRequests).toHaveLength(3);

    // ARMED (inside the 300 ms debounce): disk still lacks the request.
    act(() => result.current.refresh());
    await settle();
    expect(result.current.entryRequests, "armed-window Refresh deferred").toHaveLength(3);

    // IN FLIGHT: the debounce fired, the write is held under the lock.
    await waitFor(() => expect(writesStarted).toBe(1), { timeout: 2000 });
    act(() => result.current.refresh());
    await settle();
    expect(result.current.entryRequests, "in-flight Refresh deferred").toHaveLength(3);

    await act(async () => {
      release();
    });
    await settle();
    expect(ids()).toHaveLength(3);
    expect(result.current.entryRequests).toHaveLength(3);

    // The mutation that used to read the vanished request as a user deletion.
    act(() => result.current.removeEntryRequest("X"));
    await waitFor(() => expect(ids()).toHaveLength(2), { timeout: 2000 });
    const newId = result.current.entryRequests.find((r) => r.description === "new")?.id;
    expect(newId).toBeTruthy();
    expect(ids()).toEqual(["A", newId]);
  });

  it("CONTROL: a clean Refresh MERGES an external addition in", async () => {
    disk.set(FILE, { generalBibPath: null, entryRequests: [req("A")] });
    const { result } = renderHook(() => useBibSettings(DOC));
    await waitFor(() => expect(result.current.entryRequests).toHaveLength(1));
    disk.set(FILE, { generalBibPath: null, entryRequests: [req("A"), req("B")] });
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.entryRequests.map((r) => r.id)).toEqual(["A", "B"]),
    );
  });
});

describe("useBibReview · a Refresh during an in-flight request write keeps the row", () => {
  const FILE = "bib-review-requests.json";

  it("DEFECT: the new row survives a Refresh and lands beside a later request", async () => {
    disk.set(FILE, {
      requests: [{ bibKey: "k1", type: "fields", requestedAt: "t", status: "pending" }],
    });
    const { result } = renderHook(() => useBibReview(DOC));
    await waitFor(() => expect(result.current.requests).toHaveLength(1));

    const release = gate();
    let done!: Promise<unknown>;
    act(() => {
      done = result.current.requestReview("k2", "notes");
    });
    await waitFor(() => expect(writesStarted).toBe(1));
    act(() => result.current.refresh());
    await settle();
    expect(result.current.getRequestStatus("k2", "notes")).toBe("pending");

    await act(async () => {
      release();
      await done;
    });
    await settle();
    expect(result.current.getRequestStatus("k2", "notes")).toBe("pending");

    // A base moved under the write would read k2 as deleted here.
    await act(async () => {
      await result.current.requestReview("k3", "fields");
    });
    const keys = (disk.get(FILE) as { requests: { bibKey: string }[] }).requests.map(
      (r) => r.bibKey,
    );
    expect(keys).toEqual(expect.arrayContaining(["k1", "k2", "k3"]));
  });
});

describe("census · a sidecar is read into hook memory only through a sanctioned door", () => {
  // Every production call of `readSidecar` / `readSidecarIfExists` outside the
  // storage layer, with why it is not a raw refresh. A new one fails here: a
  // re-read of a record sidecar belongs in `useSidecarReread` (`rereadNow` for a
  // manual Refresh), never in a private `read → setState`.
  const ALLOWED: Record<string, { count: number; why: string }> = {
    "src/hooks/useSidecarReread.ts": { count: 1, why: "THE re-read door (watcher + manual)" },
    "src/hooks/usePersistentState.ts": { count: 1, why: "mount loader" },
    "src/hooks/useFootnotes.ts": { count: 1, why: "mount loader" },
    "src/hooks/useBibReview.ts": {
      count: 1,
      why: "mount loader (also the refusal reconcile — no write in flight)",
    },
    "src/hooks/useEditorUIState.ts": { count: 1, why: "per-view UI state, not a record sidecar" },
    "src/hooks/useCollab.ts": { count: 1, why: "cowork pen/presence poll; writes via mutate" },
    "src/lib/ai-requests-store.ts": { count: 1, why: "the inbox store's own guarded read" },
    "src/lib/document-settings.ts": { count: 1, why: "one-shot settings load" },
  };

  function walk(dir: string, out: string[] = []): string[] {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "__tests__") continue;
        walk(p, out);
      } else if (/\.tsx?$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  it("no unlisted production read of a sidecar into memory", () => {
    const found: Record<string, number> = {};
    for (const abs of walk(path.join(REPO_ROOT, "src"))) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      if (rel.startsWith("src/lib/storage")) continue;
      const n = (codeOnly(fs.readFileSync(abs, "utf8")).match(
        /\breadSidecar(?:IfExists)?\s*(?:<[^>()]*>)?\s*\(/g,
      ) ?? []).length;
      if (n) found[rel] = n;
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWED).map(([k, v]) => [k, v.count]),
    );
    expect(found).toEqual(expected);
  });

  it("both Refresh doors are the shared re-read", () => {
    const settings = codeOnly(
      fs.readFileSync(path.join(REPO_ROOT, "src/hooks/useBibSettings.ts"), "utf8"),
    );
    expect(settings).toMatch(/const refresh = reread;/);
    const review = codeOnly(
      fs.readFileSync(path.join(REPO_ROOT, "src/hooks/useBibReview.ts"), "utf8"),
    );
    expect(review).toMatch(/const refresh = rereadNow;/);
  });
});
