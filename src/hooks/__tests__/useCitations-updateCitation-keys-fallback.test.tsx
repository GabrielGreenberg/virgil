// @vitest-environment jsdom
//
// Pins `useCitations.updateCitation` clearing `keys` to `[]` when the incoming
// command is empty / unparseable — aligning it with its two sibling writers
// (`addCitation`, `syncFromEditor`, both `parsed?.keys || []`). Task 081.
//
// Before the alignment `updateCitation` used `parsed?.keys || c.keys`, keeping
// the OLD keys when `parseCiteCommand` returned null. That left two surviving
// symptoms the peer refutation ("self-heals via syncFromEditor") did NOT cover:
//
//   1. Durable, UNANCHORED citations — `syncFromEditor` carries unanchored refs
//      forward verbatim (no atom to reparse), so a stale-keys desync on an
//      unanchored card persists permanently across reloads.
//   2. Misleading delete-confirm — after clearing the only key `command` is ""
//      but `keys` kept `["smith"]`, so `cardHasContent("citation", cit)` (reads
//      `cit.keys`) reports the now-empty citation as still referenced.
//
// The fix: `keys: parsed?.keys || []`, so command and keys can never disagree.

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

describe("useCitations.updateCitation keys fallback", () => {
  it("clears keys to [] when the command becomes empty (delete-confirm symptom)", async () => {
    beginDocPipeline("doc-uk1");
    const { result } = renderHook(() => useCitations("doc-uk1"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{smith2020}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });
    expect(result.current.citations.find((c) => c.id === id)?.keys).toEqual([
      "smith2020",
    ]);

    // Clear the only key — command goes empty. keys must NOT retain ["smith2020"]
    // (else cardHasContent reports the now-empty citation as still referenced).
    act(() => {
      result.current.updateCitation(id, "");
    });
    await waitFor(() => {
      const cit = result.current.citations.find((c) => c.id === id);
      expect(cit?.command).toBe("");
      expect(cit?.keys).toEqual([]);
    });
  });

  it("clears keys to [] on an unparseable command (matches addCitation/syncFromEditor)", async () => {
    beginDocPipeline("doc-uk2");
    const { result } = renderHook(() => useCitations("doc-uk2"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{jones1990}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });

    act(() => {
      result.current.updateCitation(id, "not a cite command");
    });
    await waitFor(() => {
      expect(
        result.current.citations.find((c) => c.id === id)?.keys,
      ).toEqual([]);
    });
  });

  it("clears keys durably for an UNANCHORED citation (no atom to self-heal from)", async () => {
    beginDocPipeline("doc-uk3");
    const { result } = renderHook(() => useCitations("doc-uk3"));

    // Panel-"+" style: an unanchored citation (no in-text \cite atom).
    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{brown1985}", undefined, true).id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });

    // Editing its raw Code field to an unparseable string. Since syncFromEditor
    // carries unanchored refs forward verbatim, stale keys here would never heal.
    act(() => {
      result.current.updateCitation(id, "");
    });
    await waitFor(() => {
      expect(
        result.current.citations.find((c) => c.id === id)?.keys,
      ).toEqual([]);
    });
  });

  it("still adopts the parsed keys when the command IS parseable", async () => {
    beginDocPipeline("doc-uk4");
    const { result } = renderHook(() => useCitations("doc-uk4"));

    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{smith2020}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });

    act(() => {
      result.current.updateCitation(id, "\\citep{jones1990,brown1985}");
    });
    await waitFor(() => {
      expect(
        result.current.citations.find((c) => c.id === id)?.keys,
      ).toEqual(["jones1990", "brown1985"]);
    });
  });
});
