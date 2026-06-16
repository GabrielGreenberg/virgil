// @vitest-environment jsdom
//
// Pins `useCitations.commandFor(id)` — the read accessor the citation drop
// spec's "anchor the unanchored" create branch consumes
// (`ctx.citations.commandFor`). It must:
//   - return the card's serialized `\cite{…}` command for a keyed citation,
//   - return null for an empty / keyless DRAFT (no parseable citekey),
//   - return null for an unknown id.
// This closes the F downstream gap: the accessor was declared in
// drop-mode/types.ts and consumed in Citations/drop-spec.ts, but implemented
// nowhere — so citation create silently declined.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Storage layer — the hook reads a sidecar (citations.json) + the .bib. Stub
// both so the hook runs in-memory.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({ bibText: "", detectedPackage: undefined })),
  writeBib: vi.fn(async () => undefined),
}));

import { useCitations } from "../useCitations";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  __resetForTests();
});

describe("useCitations.commandFor", () => {
  it("returns the serialized command for a keyed citation", async () => {
    beginDocPipeline("doc-cf");
    const { result } = renderHook(() => useCitations("doc-cf"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{smith2020}").id;
    });

    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });
    expect(result.current.commandFor(id)).toBe("\\cite{smith2020}");
  });

  it("returns the full command verbatim for a multi-key / pre-post citation", async () => {
    beginDocPipeline("doc-cf2");
    const { result } = renderHook(() => useCitations("doc-cf2"));
    const COMMAND = "\\citep[see][ch.2]{jones1990,smith2001}";

    let id = "";
    act(() => {
      id = result.current.addCitation(COMMAND).id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });
    expect(result.current.commandFor(id)).toBe(COMMAND);
  });

  it("returns null for an empty / keyless DRAFT (\\cite{})", async () => {
    beginDocPipeline("doc-cf3");
    const { result } = renderHook(() => useCitations("doc-cf3"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });
    expect(result.current.commandFor(id)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    beginDocPipeline("doc-cf4");
    const { result } = renderHook(() => useCitations("doc-cf4"));
    expect(result.current.commandFor("does-not-exist")).toBeNull();
  });
});
