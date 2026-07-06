// @vitest-environment jsdom
//
// P6: writePdf is best-effort persistence returning a structured
// WritePdfResult. These pin the three outcomes in BOTH backends:
//   - library/read-only paper → { status: "skipped" } (never persists; the
//     in-memory viewer still shows the PDF).
//   - a real write → { status: "written" }.
//   - a rejected write (dev PUT !resp.ok) → { status: "failed" } — the
//     previously-swallowed-failure bug.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// document-settings.ts (transitive dep) imports the `@/lib/storage` barrel,
// which vitest can't resolve through the CJS require — stub it.
// (Documented gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import { writePdf as writePdfDev } from "@/lib/storage-dev";
import { writePdf as writePdfFsa } from "@/lib/storage-fsa";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
  type DocWriteHandle,
} from "@/lib/multi-window/doc-pipeline";

const LIBRARY_DOC = "library-paper:smith2020";
const NORMAL_DOC = "regular-doc-123";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe("storage-dev writePdf → WritePdfResult", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetPipelines();
  });
  afterEach(() => {
    resetPipelines();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("library paper → { status: 'skipped' } and NEVER calls fetch", async () => {
    fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    const res = await writePdfDev(h, PDF_BYTES);
    expect(res).toEqual({ status: "skipped" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a 200 PUT → { status: 'written' }", async () => {
    // Empty index → getPdfFilename falls back to document.pdf; the PUT returns 200.
    fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ docs: [] }), { status: 200 });
      }
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const h = beginDocPipeline(NORMAL_DOC);
    const res = await writePdfDev(h, PDF_BYTES);
    endDocPipeline(h);
    expect(res).toEqual({ status: "written" });
  });

  it("a rejected PUT (!resp.ok) → { status: 'failed' } (the swallowed-failure bug)", async () => {
    fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ docs: [] }), { status: 200 });
      }
      return new Response("nope", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const h = beginDocPipeline(NORMAL_DOC);
    const res = await writePdfDev(h, PDF_BYTES);
    endDocPipeline(h);
    expect(res.status).toBe("failed");
  });

  it("a thrown fetch → { status: 'failed' }", async () => {
    fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ docs: [] }), { status: 200 });
      }
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const h = beginDocPipeline(NORMAL_DOC);
    const res = await writePdfDev(h, PDF_BYTES);
    endDocPipeline(h);
    expect(res.status).toBe("failed");
  });
});

describe("storage-fsa writePdf → WritePdfResult", () => {
  beforeEach(() => resetPipelines());
  afterEach(() => {
    resetPipelines();
    vi.clearAllMocks();
  });

  it("library paper → { status: 'skipped' } (explicit, distinguishable from success)", async () => {
    const h: DocWriteHandle = { docId: LIBRARY_DOC, pipelineId: "reader-pipe" };
    const res = await writePdfFsa(h, PDF_BYTES);
    expect(res).toEqual({ status: "skipped" });
  });
});
