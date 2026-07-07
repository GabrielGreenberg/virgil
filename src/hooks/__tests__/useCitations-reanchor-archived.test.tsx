// @vitest-environment jsdom
//
// Task 079 pin — re-anchoring an ARCHIVED citation must clear BOTH `archived`
// and `unanchored`. `setArchived(id, true)` sets the two flags jointly (archiving
// splices the \cite atom out, so the ref becomes genuinely unanchored). Dragging
// the archived card back into the prose routes to `addCitation(command, id)` with
// `markUnanchored` falsy → the re-anchor branch. Pre-fix it cleared only
// `unanchored`, leaving the card live in-text yet still filed under the archive
// tray (getArchived => !!c.archived).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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

describe("useCitations — re-anchor an archived citation (task 079)", () => {
  it("clears BOTH archived and unanchored when the archived card is re-anchored", async () => {
    beginDocPipeline("doc-ra");
    const { result } = renderHook(() => useCitations("doc-ra"));

    // 1. Anchored citation.
    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{smith2020}").id;
    });
    await waitFor(() =>
      expect(result.current.citations.some((c) => c.id === id)).toBe(true),
    );

    // 2. Archive it — sets archived:true AND unanchored:true jointly.
    act(() => {
      result.current.setArchived(id, true);
    });
    await waitFor(() => {
      const c = result.current.citations.find((x) => x.id === id)!;
      expect(c.archived).toBe(true);
      expect(c.unanchored).toBe(true);
    });

    // 3. Re-anchor it (drag back into the editor): addCitation with the reused
    //    id and no markUnanchored → the re-anchor branch fires.
    act(() => {
      result.current.addCitation("\\cite{smith2020}", id);
    });

    await waitFor(() => {
      const c = result.current.citations.find((x) => x.id === id)!;
      expect(c.unanchored).toBeFalsy();
      expect(c.archived).toBeFalsy(); // pre-fix: still true → stuck in archive tray
    });
  });

  it("does not disturb an archived citation that is NOT being re-anchored", async () => {
    beginDocPipeline("doc-ra2");
    const { result } = renderHook(() => useCitations("doc-ra2"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{jones1990}").id;
    });
    await waitFor(() =>
      expect(result.current.citations.some((c) => c.id === id)).toBe(true),
    );
    act(() => {
      result.current.setArchived(id, true);
    });
    await waitFor(() => {
      const c = result.current.citations.find((x) => x.id === id)!;
      expect(c.archived).toBe(true);
      expect(c.unanchored).toBe(true);
    });
  });
});
