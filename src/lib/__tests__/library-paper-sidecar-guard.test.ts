// @vitest-environment jsdom
//
// Read-only-Reader invariant: a `library-paper:<citekey>` doc must NEVER
// persist a sidecar. The Reader mounts a full EditorPane whose derive-on-mount
// effects (citations, footnotes, …) arm a debounced `writeSidecar(...)`; for a
// library-paper docId there is no registered folder handle, so in production
// FSA `writeSidecar`→`requireDocHandle` throws a wave of "No folder handle
// stored for doc library-paper:<citekey>", and in dev it silently PUTs to
// /api/dev-library — corrupting the read-only source. `writeSidecar` is the
// single SSOT every card-hook sidecar write funnels through, so the guard
// lives there in BOTH backends.
//
// These tests pin both halves of the invariant — the second is the critical
// "zero blast radius" assertion:
//   1. library-paper docId → writeSidecar is a no-op that resolves WITHOUT
//      reaching the side-effecting downstream (fsa: never hits requireDocHandle,
//      so no "No folder handle stored" throw; dev: never hits fetch/putText).
//   2. a normal (non-library-paper) docId is UNAFFECTED — it still proceeds
//      into the real write path (fsa: still throws /No folder handle/ when no
//      handle is registered; dev: still attempts the PUT/fetch). This proves
//      the guard is specific to `library-paper:` and breaks nothing for real
//      docs.
//
// Both backends are covered. The `@/lib/storage` barrel does
// `require("@/lib/storage-{fsa,dev}")` at module top-level, which vitest's
// resolver can't alias (it isn't a real ESM import) → "Cannot find module".
// document-settings.ts (a transitive dep of BOTH backends) imports that
// barrel, so we stub it. We import the backends DIRECTLY and never call
// through the barrel, so a no-op stub suffices. (Documented gotcha:
// vitest_extension_barrel_storage_mock.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

// storage-fsa's requireDocHandle reads the folder handle from @/lib/doc-index,
// which is backed by idb-keyval — undefined in jsdom (no indexedDB) and would
// reject with a misleading ReferenceError. Mock the module so an UNregistered
// doc deterministically returns null → requireDocHandle throws the real
// "No folder handle stored" error (the production symptom). The rest of the
// write path (write-queue, doc-lock, pipeline registry) runs for real.
vi.mock("@/lib/doc-index", () => ({
  getDocHandle: vi.fn(async () => null),
  setDocHandle: vi.fn(async () => {}),
  purgeDoc: vi.fn(async () => {}),
  readIndex: vi.fn(async () => ({ docs: [] })),
  writeIndex: vi.fn(async () => {}),
}));

import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";

const LIBRARY_DOC = "library-paper:smith2020";
const NORMAL_DOC = "regular-doc-123";

// ---------------------------------------------------------------------------
// FSA backend
// ---------------------------------------------------------------------------
//
// No doc handle is ever registered (the real getDocHandle returns null for an
// unregistered doc). For a NORMAL doc the write therefore reaches
// requireDocHandle and throws /No folder handle/ — that throw is exactly the
// production symptom the library-paper guard suppresses. We let the real
// doc-index module run (getDocHandle reads from idb-keyval, which returns
// undefined in jsdom for any unstored id → null → throw), so this is a true
// behavioral test of the write path, not a mock of it.

import { writeSidecar as writeSidecarFsa } from "@/lib/storage-fsa";
import { flushWrites } from "@/lib/write-queue";

describe("storage-fsa writeSidecar — library-paper guard", () => {
  beforeEach(() => {
    resetPipelines();
  });
  afterEach(() => {
    resetPipelines();
    vi.clearAllMocks();
  });

  it("library-paper docId → no-op that resolves (never reaches requireDocHandle, never throws No-folder-handle)", async () => {
    // The library-paper handle isn't even an active pipeline — the guard
    // short-circuits BEFORE enqueueDocWrite's assertActive, so a bare,
    // never-registered handle is the faithful Reader case.
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    // Resolves without throwing. If the guard were absent it would fall into
    // enqueueDocWrite → assertActive (StalePipelineError) or requireDocHandle
    // (No folder handle) — either way it would reject.
    await expect(
      writeSidecarFsa(h, "citations.json", { citations: [] }),
    ).resolves.toBeUndefined();
  });

  it("normal docId is UNAFFECTED — still reaches the write path and throws /No folder handle/ when no handle is registered", async () => {
    // Active pipeline so the write clears enqueueDocWrite's assertActive and
    // proceeds into requireDocHandle, which throws because no folder handle
    // was ever stored for this id. This proves the guard did NOT swallow a
    // normal write — the guard is specific to `library-paper:`.
    const h = beginDocPipeline(NORMAL_DOC);
    // enqueueWrite stores a `.finally`-chained COPY of the task promise in its
    // per-key queue (so one failed write doesn't poison the queue). That copy
    // rejects too; if nothing observes it synchronously it surfaces as an
    // unhandled rejection. Pre-attach a no-op catch to the queue copy via
    // flushWrites (which swallows) BEFORE awaiting our own assertion, so both
    // promise branches are handled. (The existing load-writeback test settles
    // via flushWrites for the same reason.)
    const writePromise = writeSidecarFsa(h, "citations.json", { citations: [] });
    const drained = flushWrites(`${NORMAL_DOC}/virgil/citations.json`);
    await expect(writePromise).rejects.toThrow(/No folder handle/);
    await drained;
    endDocPipeline(h);
  });
});

// ---------------------------------------------------------------------------
// Dev backend
// ---------------------------------------------------------------------------
//
// The dev writeSidecar PUTs via fetch to /api/dev-library (library) or
// /api/dev (normal). We spy on global fetch: the library-paper guard must
// short-circuit BEFORE any fetch; a normal doc must still issue the PUT.

import { writeSidecar as writeSidecarDev } from "@/lib/storage-dev";

describe("storage-dev writeSidecar — library-paper guard", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPipelines();
    fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    resetPipelines();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("library-paper docId → no-op that resolves and NEVER calls fetch (no PUT to /api/dev-library)", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(
      writeSidecarDev(h, "citations.json", { citations: [] }),
    ).resolves.toBeUndefined();
    // The critical zero-blast-radius assertion: nothing reached the network,
    // so the read-only library source was never touched.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normal docId is UNAFFECTED — still issues the PUT via fetch", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await writeSidecarDev(h, "citations.json", { citations: [] });
    endDocPipeline(h);
    // The guard did NOT swallow a normal write: it proceeded into putText →
    // fetch with a PUT to the regular dev-doc endpoint.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain(`/api/dev/doc/${NORMAL_DOC}/virgil/citations.json`);
    expect((init as RequestInit).method).toBe("PUT");
  });
});
