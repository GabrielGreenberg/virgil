// @vitest-environment jsdom
//
// Dev-backend bundle-write serialization.
//
// storage-fsa serializes every bundle write through enqueueDocWrite's
// per-doc "bundle" subkey; storage-dev historically ran its fetches with NO
// queue, so two writeDocBundle calls for the same doc could interleave. The
// killer interleaving: an autosave that already re-read the OLD on-disk
// preamble lands its PUT AFTER a code-pane delimiters-override commit,
// resurrecting the stale preamble permanently (the masked-loss signature of
// the code-pane bug, reappearing intermittently in the dev/Claude-Preview
// backend used to verify the fix). These tests pin the fix: dev
// writeDocBundle calls for the same doc are chained per-doc, with the disk
// re-read happening INSIDE the chained task.
//
// Harness: global fetch is mocked with an in-memory file map (same approach
// as stat-files-dev.test.ts). A one-shot gate can stall the FIRST .tex PUT,
// modelling a slow write — pre-fix, the second (delimiters) write would
// complete during the stall and then be clobbered by the released first PUT.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// document-settings.ts (transitive dep) imports the `@/lib/storage` barrel,
// which vitest can't resolve through the CJS require — stub it.
// (Documented gotcha: vitest_extension_barrel_storage_mock.)
vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import type { JSONContent } from "@tiptap/react";
import { writeDocBundle } from "@/lib/storage-dev";
import {
  beginDocPipeline,
  endDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { __resetDiskLedgerForTests } from "@/lib/disk-ledger";

const DOC_ID = "devdoc";
const TEX_PATH = `/api/dev/doc/${DOC_ID}/document.tex`;

const INDEX_ENTRY = {
  id: DOC_ID,
  name: DOC_ID,
  createdAt: "2026-01-01T00:00:00Z",
  lastModifiedAt: "2026-01-01T00:00:00Z",
  sourcePath: `virgil-data/doc_${DOC_ID}/document.tex`,
};

// The stale on-disk .tex: preamble carries the OLD marker.
const OLD_TEX = `\\documentclass{article}
\\usepackage{amsmath}
% OLD-PREAMBLE

\\begin{document}

Old body. %!v:ab12

\\end{document}
`;

// The code-pane-edited delimiters: NEW marker, never on disk before.
const NEW_DELIMITERS = {
  preamble:
    "\\documentclass{article}\n\\usepackage{amsmath}\n% NEW-PREAMBLE\n\n\\begin{document}\n\n",
  postamble: "\n\\end{document}\n",
};

const CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "ab12" },
      content: [{ type: "text", text: "Body from the editor." }],
    },
  ],
};

// ---------------------------------------------------------------------------
// In-memory fetch fake
// ---------------------------------------------------------------------------

const files = new Map<string, string>();
// One-shot: when set, the next .tex PUT carrying the STALE preamble (the
// autosave's — its body contains the OLD marker) awaits this before landing.
let texPutGate: Promise<void> | null = null;

function headers(map: Record<string, string> = {}) {
  const lower = new Map(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (k: string) => lower.get(k.toLowerCase()) ?? null };
}

function okText(body: string) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: headers(),
  };
}

function notFound() {
  return {
    ok: false,
    status: 404,
    text: async () => "",
    json: async () => ({}),
    headers: headers(),
  };
}

async function fakeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<unknown> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (method === "PUT") {
    if (
      url === TEX_PATH &&
      texPutGate &&
      String(init?.body).includes("% OLD-PREAMBLE")
    ) {
      const g = texPutGate;
      texPutGate = null; // one-shot
      await g;
    }
    files.set(url, String(init?.body));
    return okText("");
  }
  if (method === "HEAD") {
    if (!files.has(url)) return notFound();
    return {
      ok: true,
      status: 200,
      headers: headers({
        "Last-Modified": "Mon, 22 Jun 2026 12:00:00 GMT",
        "Content-Length": String(files.get(url)!.length),
      }),
    };
  }
  if (url === "/api/dev/index.json") {
    return okText(JSON.stringify({ docs: [INDEX_ENTRY] }));
  }
  if (!files.has(url)) return notFound();
  return okText(files.get(url)!);
}

beforeEach(() => {
  resetPipelines();
  __resetDiskLedgerForTests();
  files.clear();
  files.set(TEX_PATH, OLD_TEX);
  texPutGate = null;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  resetPipelines();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("storage-dev writeDocBundle — per-doc serialization", () => {
  it("a slow autosave PUT cannot land after a delimiters commit (the stale-preamble resurrection)", async () => {
    const h = beginDocPipeline(DOC_ID);

    // Stall the FIRST .tex PUT — the autosave's, which re-read (and will
    // write) the OLD preamble.
    let releasePut!: () => void;
    texPutGate = new Promise<void>((res) => {
      releasePut = res;
    });

    const autosave = writeDocBundle(h, structuredClone(CONTENT));
    const commit = writeDocBundle(h, structuredClone(CONTENT), {
      delimiters: NEW_DELIMITERS,
    });

    // Give the (broken, pre-fix) interleaving every chance to happen: the
    // commit gets macrotask turns while the autosave PUT is stalled. With
    // the per-doc chain it must WAIT instead.
    await new Promise((res) => setTimeout(res, 10));
    releasePut();
    await Promise.all([autosave, commit]);
    endDocPipeline(h);

    const finalTex = files.get(TEX_PATH)!;
    // The delimiters commit landed LAST: the new preamble survives…
    expect(finalTex).toContain("% NEW-PREAMBLE");
    // …and the stale disk preamble was not resurrected over it.
    expect(finalTex).not.toContain("% OLD-PREAMBLE");
  });

  it("an autosave AFTER a delimiters commit re-reads the fresh preamble inside its chained task and preserves it", async () => {
    const h = beginDocPipeline(DOC_ID);

    const commit = writeDocBundle(h, structuredClone(CONTENT), {
      delimiters: NEW_DELIMITERS,
    });
    const autosave = writeDocBundle(h, structuredClone(CONTENT));
    await Promise.all([commit, autosave]);
    endDocPipeline(h);

    const finalTex = files.get(TEX_PATH)!;
    // The follow-up autosave's disk re-read happened AFTER the commit's PUT
    // (inside the chained task), so it preserved the new preamble.
    expect(finalTex).toContain("% NEW-PREAMBLE");
    expect(finalTex).not.toContain("% OLD-PREAMBLE");
  });
});
