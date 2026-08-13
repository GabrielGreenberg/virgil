// @vitest-environment jsdom
//
// `ai-requests.json` has ONE serialized authority (task 220).
//
// The defect this pins was a MODEL mismatch between two writers, not a broken
// writer: the inbox hook persisted its whole in-memory snapshot with no
// read-merge, and the card-flag bridge read-modify-wrote with its read OUTSIDE
// the serialized write critical section. Each was internally consistent; each
// was only ever wrong about what the OTHER had just done. Nothing threw and no
// existing suite could see it, because every one of them exercised a single
// writer at a time.
//
// So the legs here are the two an isolated test of either writer structurally
// cannot be:
//
//   1. CONCURRENCY — two writers overlapping over a slow disk, which is where a
//      base read outside the critical section (or a snapshot persist computed
//      from stale React state) loses the other's change. Every leg here fails
//      on the pre-220 implementations.
//   2. CENSUS — the guard that catches the ORIGINAL shape, which is not a
//      writer that misbehaves but a call site that never asks the authority.
//      Nothing in `src/`/`library/` outside the store may name the filename.
//
// Plus the cross-window half: the in-process publish bus reaches only this
// window, so the hook re-hydrates from the `SidecarWatcher`'s external-change
// signal — the channel that makes a peer window's (or a skill's) write converge
// instead of being clobbered by the next local mutation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { commentsStripped } from "./_source-scan";
import type { AiRequest, AiRequestsState } from "@/lib/types";

// ---------------------------------------------------------------------------
// A storage backend that is SLOW and SERIALIZED — the only shape in which the
// defect is observable. `mutateSidecar` runs read → mutate → write inside ONE
// task on the REAL per-key write queue, with an await on each half, so an
// implementation that reads outside the queue interleaves and loses.
// ---------------------------------------------------------------------------
const DISK: Record<string, unknown> = {};

vi.mock("@/lib/storage", async () => {
  const { enqueueWrite } = await import("@/lib/write-queue");
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) => {
      await tick();
      return file in DISK ? DISK[file] : dflt;
    }),
    writeSidecar: vi.fn(
      async (h: { docId: string }, file: string, data: unknown) =>
        enqueueWrite(`${h.docId}/virgil/${file}`, async () => {
          await tick();
          DISK[file] = data;
        }),
    ),
    mutateSidecar: vi.fn(
      async (
        h: { docId: string },
        file: string,
        dflt: unknown,
        mutate: (current: unknown) => unknown,
      ) =>
        enqueueWrite(`${h.docId}/virgil/${file}`, async () => {
          await tick(); // the read — INSIDE the critical section
          const current = file in DISK ? DISK[file] : dflt;
          const next = mutate(current);
          if (next === null) return null;
          await tick(); // the write
          DISK[file] = next;
          return next;
        }),
    ),
  };
});
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn((docId: string) => ({ docId })),
  isStalePipelineError: vi.fn(() => false),
}));

import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { mutateAiRequests, isAiRequestsFile } from "@/lib/ai-requests-store";
import { useAiRequests } from "@/hooks/useAiRequests";
import {
  SIDECAR_CHANGED_EVENT,
  dispatchSidecarChanged,
} from "@/lib/sidecar-watcher";

const DOC = "doc-220";

/**
 * The suite spells the filename because the authority deliberately does NOT
 * export it (see `ai-requests-store.ts`: an importable name is a name a writer
 * can address the file with, which is precisely the census escape). A test may
 * spell it — `PROD_FILES` excludes tests — but it must then prove the private
 * constant and this copy still agree, which the predicate leg below does.
 */
const AI_REQUESTS_FILE = "ai-requests.json";

const onDisk = (): AiRequest[] =>
  ((DISK[AI_REQUESTS_FILE] as AiRequestsState | undefined)?.requests ?? []);

function seed(requests: AiRequest[]): void {
  DISK[AI_REQUESTS_FILE] = { requests } satisfies AiRequestsState;
}

function row(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "req-1",
    kind: "note",
    text: "body",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "draft",
    ...overrides,
  };
}

beforeEach(() => {
  for (const k of Object.keys(DISK)) delete DISK[k];
});

/**
 * Flush React, THEN let the storage I/O land.
 *
 * Both matter, and the order is load-bearing rather than incidental. A setter
 * here schedules its persist from inside a `setState` UPDATER, which React
 * invokes lazily during the next render — so a naive `await act(async () => {
 * setter(); await sleep(20); })` waits BEFORE the updater has even run, and the
 * write is still unscheduled when the assertion reads the disk. Every leg below
 * would then "fail on the pre-fix implementation" for a timing reason instead of
 * a content one — an unfalsifiable defect leg wearing a passing one's clothes,
 * which is exactly what the first draft of this suite did. Calling the setter in
 * a SYNC `act` forces the flush; the async `act` then drains the queued I/O.
 */
async function settle(ms = 40): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// ---------------------------------------------------------------------------
// 1. CONCURRENCY — no lost update
// ---------------------------------------------------------------------------

describe("ai-requests: one serialized read-modify-merge authority", () => {
  it("two overlapping bridge toggles both land (a read outside the lock loses one)", async () => {
    // Fired without awaiting the first — exactly how two panel checkboxes (or a
    // checkbox and a card-lifecycle unbridge) overlap in the live app. With the
    // read OUTSIDE the write queue both calls read `[]`, and the second write
    // clobbers the first row.
    await Promise.all([
      bridgeCardAiRequestFlag(DOC, "todo", "card-A", true, { text: "A" }, "toggle"),
      bridgeCardAiRequestFlag(DOC, "note", "card-B", true, { text: "B" }, "toggle"),
    ]);

    const ids = onDisk().map((r) => r.linkedTo?.cardId).sort();
    expect(ids).toEqual(["card-A", "card-B"]);
  });

  it("overlapping store mutations compose — each merges over the previous RESULT", async () => {
    seed([]);
    await Promise.all([
      mutateAiRequests(DOC, (reqs) => [...reqs, row({ id: "a" })]),
      mutateAiRequests(DOC, (reqs) => [...reqs, row({ id: "b" })]),
      mutateAiRequests(DOC, (reqs) => [...reqs, row({ id: "c" })]),
    ]);
    expect(onDisk().map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("a declined mutation (null) writes nothing at all", async () => {
    seed([row({ id: "keep" })]);
    const result = await mutateAiRequests(DOC, () => null);
    expect(result).toBeNull();
    expect(onDisk().map((r) => r.id)).toEqual(["keep"]);
  });

  it("no doc / no active write handle persists nothing and reports null", async () => {
    seed([row({ id: "keep" })]);
    expect(await mutateAiRequests(null, (reqs) => [...reqs, row({ id: "x" })]))
      .toBeNull();
    expect(onDisk().map((r) => r.id)).toEqual(["keep"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The HOOK no longer persists a snapshot — the stale-base clobber
// ---------------------------------------------------------------------------

describe("useAiRequests writes are merges, not snapshots", () => {
  it("deleting one row keeps a row that landed on disk AFTER this hook's read", async () => {
    // The two-window lost-update, reduced to its mechanism: window A (or an
    // `/editor/*` skill) adds a row straight to disk with no in-process publish,
    // so THIS hook's state is stale. Its next mutation must merge over disk.
    // The pre-220 whole-snapshot persist wrote its own stale list and the peer's
    // row vanished, silently.
    seed([row({ id: "mine" })]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.requests.map((r) => r.id)).toEqual(["mine"]);

    seed([row({ id: "mine" }), row({ id: "peer" })]); // peer write, no publish

    act(() => {
      result.current.deleteRequest("mine");
    });
    await settle();

    expect(onDisk().map((r) => r.id)).toEqual(["peer"]);
    // …and the hook adopted the authoritative post-write list.
    expect(result.current.requests.map((r) => r.id)).toEqual(["peer"]);
  });

  it("a hook add and a bridge toggle overlapping both survive", async () => {
    seed([]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addRequest("note", "from the composer");
      void bridgeCardAiRequestFlag(DOC, "todo", "card-Z", true, { text: "Z" }, "toggle");
    });
    await settle();

    expect(onDisk()).toHaveLength(2);
    expect(onDisk().some((r) => r.text === "from the composer")).toBe(true);
    expect(onDisk().some((r) => r.linkedTo?.cardId === "card-Z")).toBe(true);
  });

  it("updating a row a peer already deleted does NOT resurrect it", async () => {
    seed([row({ id: "gone" })]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    seed([]); // peer deleted it

    act(() => {
      result.current.updateRequestText("gone", "edited after the fact");
    });
    await settle();

    expect(onDisk()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The cross-window half — external-change re-hydrate
// ---------------------------------------------------------------------------

describe("useAiRequests re-hydrates on an external sidecar change", () => {
  it("adopts the on-disk list when the watcher reports this file changed", async () => {
    seed([]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.requests).toHaveLength(0);

    // A peer window / a skill wrote the file. The in-process publish bus never
    // crosses a window boundary, so the ONLY signal is the watcher's.
    seed([row({ id: "from-elsewhere" })]);
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: AI_REQUESTS_FILE });
    });
    await settle();

    expect(result.current.requests.map((r) => r.id)).toEqual(["from-elsewhere"]);
  });

  it("ignores a change to another sidecar, and to another doc", async () => {
    seed([]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    seed([row({ id: "should-not-appear" })]);
    act(() => {
      dispatchSidecarChanged({ docId: DOC, filename: "notes.json" });
      dispatchSidecarChanged({ docId: "another-doc", filename: AI_REQUESTS_FILE });
    });
    await settle();

    expect(result.current.requests).toHaveLength(0);
  });

  it("REPLAYS a change that arrived while a mutation was in flight", async () => {
    // The watcher emits ONCE per external change and re-baselines its ledger
    // BEFORE emitting, so a dirty-guard that merely skips loses the change until
    // the next external write — permanently, if none comes. The deferral has to
    // be a debt that the mutation drain replays. Pinned with a mutation that
    // resolves WITHOUT publishing (a declined mutator), which is the case no
    // published result can cover for.
    seed([row({ id: "mine" })]);
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      // Declines on disk (no such id) ⇒ no write, no publish — but it still
      // holds `inFlight` for the duration of its round-trip.
      result.current.deleteRequest("not-on-disk");
      // …and the external change lands inside that window.
      seed([row({ id: "from-elsewhere" })]);
      dispatchSidecarChanged({ docId: DOC, filename: AI_REQUESTS_FILE });
    });
    await settle();

    expect(result.current.requests.map((r) => r.id)).toEqual(["from-elsewhere"]);
  });

  it("the listener is torn down with the hook", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useAiRequests(DOC));
    await waitFor(() =>
      expect(add.mock.calls.some((c) => c[0] === SIDECAR_CHANGED_EVENT)).toBe(true),
    );
    unmount();
    expect(remove.mock.calls.some((c) => c[0] === SIDECAR_CHANGED_EVENT)).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 4. CENSUS — the leg with teeth. The authority was never the part that could
//    misbehave; a call site that writes the file without asking it is.
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(REPO, p);
const isTest = (p: string) => /__tests__|\.test\.tsx?$/.test(p);
const PROD_FILES = [
  ...walk(path.join(REPO, "src")),
  ...walk(path.join(REPO, "library")),
].filter((f) => !isTest(f));

/** The two files entitled to name the sidecar: the authority itself, and the
 *  bundle vocabulary (a list of every sidecar filename, which is what it is
 *  for). Both may only SHRINK. */
const FILENAME_OWNERS = new Set([
  "src/lib/ai-requests-store.ts",
  "src/lib/sidecar-files.ts",
]);

/**
 * Lines that name the file as PROSE inside a string — a dev-only error message,
 * not an I/O target. Keyed by a fragment of the PROSE rather than by the file
 * (task 204's rule): a file-scoped exemption would also excuse a real write
 * added to that file later, and `card-registry.tsx` is a file where one could
 * plausibly appear. Never excuses a write.
 */
const PERMITTED_PROSE_MENTIONS = ["row will strand"];

/**
 * The files entitled to call the raw sidecar primitive at all. Everything else
 * reaches storage through a per-file authority (this one, or `usePersistentState`
 * for the single-writer sidecars).
 *
 * This leg exists because the filename grep alone cannot see the escape that
 * matters: `mutateSidecar` is a PUBLIC export of the storage barrel, so a writer
 * holding the filename by any route — an imported constant, an element of
 * `ALL_SIDECAR_FILENAMES` — addresses the file without ever spelling it. Keeping
 * the name private (see the store) closes the realistic route; this closes the
 * category.
 */
const PERMITTED_MUTATE_SIDECAR_CALLERS = new Set([
  "src/lib/ai-requests-store.ts",
]);

/**
 * STATED LIMIT — the census covers the two TypeScript silos only.
 *
 * `ai-requests.json` has a THIRD writer that no grep over `src/`/`library/` can
 * govern: the `/editor/*` skills (`editor/scripts/*.py`), which read-modify-write
 * the file straight on disk, out of process, while the paper is open. No Web
 * Lock reaches them — `withDocLock` is a same-browser primitive — so the
 * serialized authority does NOT serialize against python, and it was never
 * claimed to. What covers that writer is the OTHER half of this design: every
 * in-app mutation merges over the freshly-read on-disk list (so a skill's row is
 * never computed away from a stale base), and the `SidecarWatcher` re-hydrate
 * (so the live inbox converges on what the skill wrote). Recorded here rather
 * than papered over — a guard that overstates its reach is the failure mode this
 * whole suite is about.
 */
const CENSUS_ROOTS_ARE_TS_ONLY = true;

describe("census: nothing outside the authority names ai-requests.json", () => {
  it("finds the authority itself (the walker is not blind)", () => {
    expect(PROD_FILES.map(rel)).toContain("src/lib/ai-requests-store.ts");
    expect(CENSUS_ROOTS_ARE_TS_ONLY).toBe(true);
  });

  it("the stripper keeps literals and drops comments (self-check on a FIXTURE)", () => {
    // The canary must not stand on the defect. Proving "literals survive" from
    // the one production line the allowlist exists to drain is circular: drain
    // that entry and the proof evaporates while the leg keeps passing —
    // vacuously, because zero post-strip lines would contain the needle at all.
    // A synthetic fixture proves the stripper's two behaviours independently of
    // whatever production happens to contain today.
    const fixture = [
      `// a comment naming ai-requests.json must vanish`,
      `/* and a block one naming ai-requests.json too */`,
      `const target = "ai-requests.json";`,
    ].join("\n");
    const stripped = commentsStripped(fixture);
    expect(stripped).toContain(`"ai-requests.json"`);
    expect(stripped.split("\n")[0]).not.toContain("ai-requests.json");
    expect(stripped.split("\n")[1]).not.toContain("ai-requests.json");
  });

  it("the private filename and this suite's copy still agree", () => {
    // The store no longer exports the name, so nothing else can drift onto a
    // stale spelling — but THIS file holds a hand-written copy, and a rename
    // that missed it would make every seed/assert above address a file the
    // production code never touches. Ask the predicate.
    expect(isAiRequestsFile(AI_REQUESTS_FILE)).toBe(true);
    expect(isAiRequestsFile("notes.json")).toBe(false);
  });

  it("only the authority calls the raw serialized-RMW primitive", () => {
    const offenders: string[] = [];
    for (const file of PROD_FILES) {
      const r = rel(file);
      if (PERMITTED_MUTATE_SIDECAR_CALLERS.has(r)) continue;
      // The storage layer DEFINES and re-exports it; that is not a call site.
      if (/^src\/lib\/storage(-fsa|-dev)?\.ts$/.test(r)) continue;
      const code = commentsStripped(fs.readFileSync(file, "utf8"));
      if (/\bmutateSidecar\s*\(/.test(code)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });

  it("no other production file spells the filename", () => {
    const offenders: string[] = [];
    for (const file of PROD_FILES) {
      const r = rel(file);
      if (FILENAME_OWNERS.has(r)) continue;
      // Literals are KEPT (the needle lives inside quotes); only comments go.
      const lines = commentsStripped(fs.readFileSync(file, "utf8")).split("\n");
      for (const line of lines) {
        if (!line.includes("ai-requests.json")) continue;
        if (PERMITTED_PROSE_MENTIONS.some((p) => line.includes(p))) continue;
        offenders.push(`${r}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the two in-app writers reach storage only through the authority", () => {
    for (const f of ["src/lib/ai-request-bridge.ts", "src/hooks/useAiRequests.ts"]) {
      const code = commentsStripped(fs.readFileSync(path.join(REPO, f), "utf8"));
      // A snapshot write is exactly the model this task retired; a bare
      // `readSidecar` here is the base-outside-the-lock half of it.
      expect(code, `${f} must not call writeSidecar`).not.toMatch(/\bwriteSidecar\s*\(/);
      expect(code, `${f} must not call readSidecar`).not.toMatch(/\breadSidecar\s*\(/);
    }
  });

  it("the prose exemptions are all still live (no stale entries)", () => {
    const all = PROD_FILES.map((f) => commentsStripped(fs.readFileSync(f, "utf8"))).join("\n");
    for (const p of PERMITTED_PROSE_MENTIONS) {
      expect(all, `stale exemption: ${p}`).toContain(p);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
