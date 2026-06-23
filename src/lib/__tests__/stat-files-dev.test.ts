// @vitest-environment jsdom
//
// Chip 1 (statFiles) — dev backend HEAD parsing.
//
// The dev backend's statFiles issues a HEAD per file to the dev route and
// parses Last-Modified → mtimeMs and Content-Length → size. 404 → null.
// Here we mock global fetch to assert that header-parsing contract without a
// real dev server.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// storage-dev imports the `@/lib/storage` barrel transitively only via
// storage-fsa's pure re-exports (detectBibPackage); those are pure and load
// fine. No barrel stub needed for the dev backend, but harmless to add.
vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import { statFiles } from "@/lib/storage-dev";

type HeadResponse = {
  ok: boolean;
  status: number;
  headers: Map<string, string>;
};

function makeRes(
  status: number,
  headers: Record<string, string> = {},
): HeadResponse {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) map.set(k.toLowerCase(), v);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => map.get(name.toLowerCase()) ?? null,
    } as unknown as Map<string, string>,
  } as unknown as HeadResponse;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("storage-dev statFiles — HEAD parsing", () => {
  it("issues a HEAD and parses Last-Modified + Content-Length", async () => {
    const lastMod = "Mon, 22 Jun 2026 12:00:00 GMT";
    fetchMock.mockResolvedValue(
      makeRes(200, { "Last-Modified": lastMod, "Content-Length": "1234" }),
    );

    const res = await statFiles("doc1", ["main.tex"]);

    // Verify it was a HEAD, not a body-downloading GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/dev/doc/doc1/main.tex");
    expect((init as RequestInit).method).toBe("HEAD");

    expect(res["main.tex"]).not.toBeNull();
    expect(res["main.tex"]!.mtimeMs).toBe(new Date(lastMod).getTime());
    expect(res["main.tex"]!.size).toBe(1234);
  });

  it("maps a 404 to null", async () => {
    fetchMock.mockResolvedValue(makeRes(404));
    const res = await statFiles("doc1", ["gone.tex"]);
    expect(res["gone.tex"]).toBeNull();
  });

  it("maps a fetch rejection (network error) to null", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const res = await statFiles("doc1", ["main.tex"]);
    expect(res["main.tex"]).toBeNull();
  });

  it("defaults mtimeMs/size to 0 when headers are missing", async () => {
    fetchMock.mockResolvedValue(makeRes(200)); // no headers
    const res = await statFiles("doc1", ["main.tex"]);
    expect(res["main.tex"]).toEqual({ mtimeMs: 0, size: 0 });
  });

  it("stats multiple files, keyed by the same relPaths", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("main.tex")) {
        return Promise.resolve(
          makeRes(200, {
            "Last-Modified": "Mon, 22 Jun 2026 12:00:00 GMT",
            "Content-Length": "10",
          }),
        );
      }
      return Promise.resolve(makeRes(404));
    });

    const res = await statFiles("doc1", ["main.tex", "references.bib"]);
    expect(res["main.tex"]).not.toBeNull();
    expect(res["main.tex"]!.size).toBe(10);
    expect(res["references.bib"]).toBeNull();
  });

  it("routes library-paper docs through the dev-library endpoint", async () => {
    fetchMock.mockResolvedValue(
      makeRes(200, {
        "Last-Modified": "Mon, 22 Jun 2026 12:00:00 GMT",
        "Content-Length": "5",
      }),
    );
    await statFiles("library-paper:smith2020", ["main.tex"]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/dev-library/papers/smith2020/main.tex");
  });
});
