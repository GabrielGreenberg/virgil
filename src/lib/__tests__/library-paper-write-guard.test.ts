// @vitest-environment jsdom
//
// Read-only-Reader invariant: a `library-paper:<citekey>` doc must NEVER
// persist ANY write. The Reader mounts a full EditorPane whose derive-on-mount
// effects (citations, footnotes, …) arm a debounced `writeSidecar(...)`, AND
// the load path fires a minted-UUID writeback (`writeTex` + `writeDocBundle`).
// For a library-paper docId there is no registered folder handle, so in
// production FSA each of those `requireDocHandle` calls throws a wave of "No
// folder handle stored for doc library-paper:<citekey>", and in dev each
// silently PUTs to the read-only source. So the guard must cover the WHOLE
// write class, not just the citations sidecar:
//   - storage-fsa: EVERY write funnels through `enqueueDocWrite`, so ONE guard
//     at that funnel covers writeSidecar / writeTex / writeDocBundle / writeBib
//     / writePdf / the figure writers + the load-writeback.
//   - storage-dev: no common funnel, so each write entry point that takes a
//     `DocWriteHandle` guards directly (writeSidecar / writeTex /
//     writeDocBundle / writeBib / writePdf / figure writers + the inline
//     load-writeback in readDocBundle).
//
// These tests pin both halves of the invariant — the second is the critical
// "zero blast radius" assertion:
//   1. library-paper docId → the write is a no-op that resolves WITHOUT
//      reaching the side-effecting downstream (fsa: never hits requireDocHandle,
//      so no "No folder handle stored" throw; dev: never hits fetch/putText).
//   2. a normal (non-library-paper) docId is UNAFFECTED — it still proceeds
//      into the real write path (fsa: still throws /No folder handle/ when no
//      handle is registered; dev: still attempts the PUT/fetch). This proves
//      the guard is specific to `library-paper:` and the funnel guard did NOT
//      swallow real writes.
//
// We exercise writeSidecar AND writeTex AND writeDocBundle (the three writes
// the live smoke observed fire on a Reader open). Both backends are covered.
// The `@/lib/storage` barrel does `require("@/lib/storage-{fsa,dev}")` at
// module top-level, which vitest's resolver can't alias (it isn't a real ESM
// import) → "Cannot find module". document-settings.ts (a transitive dep of
// BOTH backends) imports that barrel, so we stub it. We import the backends
// DIRECTLY and never call through the barrel, so a no-op stub suffices.
// (Documented gotcha: vitest_extension_barrel_storage_mock.)
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

// A minimal valid TipTap doc for writeDocBundle (it runs assignUuids +
// serializeToLatex on `content`).
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

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

import {
  writeSidecar as writeSidecarFsa,
  writeTex as writeTexFsa,
  writeDocBundle as writeDocBundleFsa,
} from "@/lib/storage-fsa";
import { flushWrites } from "@/lib/write-queue";

describe("storage-fsa — library-paper write guard (enqueueDocWrite funnel)", () => {
  beforeEach(() => {
    resetPipelines();
  });
  afterEach(() => {
    resetPipelines();
    vi.clearAllMocks();
  });

  // The library-paper handle isn't even an active pipeline — the funnel guard
  // short-circuits BEFORE enqueueDocWrite's assertActive, so a bare,
  // never-registered handle is the faithful Reader case. If the guard were
  // absent, each of these would fall into assertActive (StalePipelineError) or
  // requireDocHandle (No folder handle) and reject.
  it("library-paper writeSidecar → no-op that resolves (never reaches requireDocHandle)", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(
      writeSidecarFsa(h, "citations.json", { citations: [] }),
    ).resolves.toBeUndefined();
  });

  it("library-paper writeTex → no-op that resolves (never reaches requireDocHandle, no No-folder-handle throw)", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(writeTexFsa(h, "\\documentclass{article}")).resolves.toBeUndefined();
  });

  it("library-paper writeDocBundle → no-op that resolves (never reaches requireDocHandle, no No-folder-handle throw)", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(writeDocBundleFsa(h, EMPTY_DOC)).resolves.toBeUndefined();
  });

  // Zero blast radius: a normal doc still reaches the real write path. An
  // active pipeline clears enqueueDocWrite's assertActive; requireDocHandle
  // then throws because no folder handle was ever stored for this id. This
  // proves the funnel guard is specific to `library-paper:` and did NOT
  // swallow a real write. enqueueWrite stores a `.finally`-chained COPY of the
  // task promise in its per-key queue; that copy rejects too, so we drain it
  // via flushWrites BEFORE/around the assertion to avoid an unhandled rejection.
  it("normal writeSidecar is UNAFFECTED — still throws /No folder handle/", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    const writePromise = writeSidecarFsa(h, "citations.json", { citations: [] });
    const drained = flushWrites(`${NORMAL_DOC}/virgil/citations.json`);
    await expect(writePromise).rejects.toThrow(/No folder handle/);
    await drained;
    endDocPipeline(h);
  });

  it("normal writeTex is UNAFFECTED — still reaches the real write path and rejects", async () => {
    // writeTex → getTexFileHandle → getDocMetaOrThrow runs first and throws
    // "Doc … not in index" (readIndex is mocked empty) BEFORE requireDocHandle.
    // The exact message differs from the sidecar/bundle writers; what matters
    // for zero-blast-radius is that the funnel guard did NOT make it a no-op —
    // it proceeded into the real write path and rejected. (Either the index
    // error or the folder-handle error proves the write was attempted.)
    const h = beginDocPipeline(NORMAL_DOC);
    const writePromise = writeTexFsa(h, "\\documentclass{article}");
    // writeTex shares the "bundle" queue subkey with writeDocBundle (total
    // .tex-write ordering), so the drain targets that key.
    const drained = flushWrites(`${NORMAL_DOC}/bundle`);
    await expect(writePromise).rejects.toThrow(/not in index|No folder handle/);
    await drained;
    endDocPipeline(h);
  });

  it("normal writeDocBundle is UNAFFECTED — still throws /No folder handle/", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    const writePromise = writeDocBundleFsa(h, EMPTY_DOC);
    const drained = flushWrites(`${NORMAL_DOC}/bundle`);
    await expect(writePromise).rejects.toThrow(/No folder handle/);
    await drained;
    endDocPipeline(h);
  });
});

// ---------------------------------------------------------------------------
// Dev backend
// ---------------------------------------------------------------------------
//
// The dev writes PUT via fetch to /api/dev-library (library) or /api/dev
// (normal). We spy on global fetch: the library-paper guard must short-circuit
// BEFORE any fetch; a normal doc must still issue the PUT(s).

import {
  writeSidecar as writeSidecarDev,
  writeTex as writeTexDev,
  writeDocBundle as writeDocBundleDev,
} from "@/lib/storage-dev";

describe("storage-dev — library-paper write guard (per-entry-point)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPipelines();
    // Default 200 + empty body. writeDocBundle for a NORMAL doc reads the
    // existing sidecar/.tex via fetchJson/fetchText first, so an OK empty
    // response keeps those reads happy before the PUTs fire.
    fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    resetPipelines();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("library-paper writeSidecar → no-op that resolves and NEVER calls fetch", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(
      writeSidecarDev(h, "citations.json", { citations: [] }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("library-paper writeTex → no-op that resolves and NEVER calls fetch", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(writeTexDev(h, "\\documentclass{article}")).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("library-paper writeDocBundle → no-op that resolves and NEVER calls fetch", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    await expect(writeDocBundleDev(h, EMPTY_DOC)).resolves.toBeUndefined();
    // Zero blast radius: not even the read-before-write probes fire, because
    // the guard short-circuits at the top of the function.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normal writeSidecar is UNAFFECTED — still issues the PUT via fetch", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await writeSidecarDev(h, "citations.json", { citations: [] });
    endDocPipeline(h);
    // The write issues exactly one PUT to the sidecar path. (A second, HEAD,
    // fetch now follows — the disk-ledger stamp's post-write re-stat, the
    // own-write guard for the live-sidecar-reactivity SidecarWatcher — so we
    // filter for the PUT rather than asserting a total fetch count, mirroring the
    // `writeTex` case below.)
    const putCalls = fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls.length).toBe(1);
    const [url, init] = putCalls[0];
    expect(String(url)).toContain(`/api/dev/doc/${NORMAL_DOC}/virgil/citations.json`);
    expect((init as RequestInit).method).toBe("PUT");
  });

  it("normal writeTex is UNAFFECTED — still issues the PUT via fetch", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await writeTexDev(h, "\\documentclass{article}");
    endDocPipeline(h);
    // The guard did NOT swallow a normal write: it proceeded into putText.
    const putCalls = fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("normal writeDocBundle is UNAFFECTED — still issues PUT(s) via fetch", async () => {
    const h = beginDocPipeline(NORMAL_DOC);
    await writeDocBundleDev(h, EMPTY_DOC);
    endDocPipeline(h);
    const putCalls = fetchSpy.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });
});
