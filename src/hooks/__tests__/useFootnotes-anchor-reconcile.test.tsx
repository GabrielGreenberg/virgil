// @vitest-environment jsdom
//
// Task 233 — the two halves of "anchor the unanchored", on the footnotes hook.
//
// A footnote that was archived (its `\footnote` atom spliced out, body kept in
// `footnotes.json`, ref flagged `archived` + `unanchored`) and then unarchived
// is a re-placeable parked ref. Dropping it back into the prose rebuilds the
// atom — and the atom's `content` attr is the ONLY home of the body, so the
// rebuild has to read it from the card:
//
//   1. `contentFor(id)` — the card's live body, normalized. Without it the
//      create branch planted an empty atom and `getFootnotes()` re-derived the
//      panel AND the serialized `\footnote{}` from that empty node: the user's
//      text was destroyed in the document, not just dropped from the card.
//   2. `markAnchored(id)` — the reconcile. The ref is no longer parked, so both
//      flags clear; otherwise the panel keeps listing it as an atomless ref
//      alongside the now-live footnote (the stale duplicate).
//
// The sibling `selectAtomlessFootnoteRefs` test pins the derivation that makes
// the duplicate impossible even when the flag DOES linger.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { FootnotesState } from "@/lib/types";

const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
}));

import { useFootnotes } from "../useFootnotes";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-fn-anchor";
const BODY = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Smith (2020) argues X" }] },
  ],
};

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});

function lastFootnotes(): FootnotesState | undefined {
  return [...writes].reverse().find((w) => w.file === "footnotes.json")?.data as
    | FootnotesState
    | undefined;
}

function seed(extra: Record<string, unknown> = {}) {
  DISK["footnotes.json"] = {
    footnotes: [
      { id: "fn-1", content: BODY, createdAt: "2026-01-01T00:00:00.000Z", ...extra },
    ],
  } satisfies FootnotesState;
}

describe("useFootnotes — contentFor (the body the re-placed atom rebuilds from)", () => {
  it("returns the card's live body", async () => {
    beginDocPipeline(DOC);
    seed({ unanchored: true });
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    expect(result.current.contentFor("fn-1")).toEqual(BODY);
  });

  it("normalizes a legacy HTML-string body into a doc (never hands back a raw string)", async () => {
    beginDocPipeline(DOC);
    DISK["footnotes.json"] = {
      footnotes: [
        {
          id: "fn-legacy",
          // Pre-JSON footnotes stored HTML. The atom's `content` attr must be a
          // doc, so the accessor migrates on read exactly like the load path.
          content: "<p>legacy body</p>" as unknown as FootnotesState["footnotes"][0]["content"],
          createdAt: "2026-01-01T00:00:00.000Z",
          unanchored: true,
        },
      ],
    } as FootnotesState;
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    const c = result.current.contentFor("fn-legacy");
    expect(c?.type).toBe("doc");
    expect(JSON.stringify(c)).toContain("legacy body");
  });

  it("returns null for an unknown id (the create branch then uses its empty fallback)", async () => {
    beginDocPipeline(DOC);
    seed();
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    expect(result.current.contentFor("nope")).toBeNull();
  });
});

describe("useFootnotes — markAnchored (the parked intent clears)", () => {
  it("clears BOTH unanchored and archived, mirroring the citation re-anchor rule", async () => {
    beginDocPipeline(DOC);
    // The archive→unarchive shape: `setArchived(true)` sets both flags jointly,
    // unarchive clears only `archived`, so a parked ref carries `unanchored`.
    seed({ unanchored: true, archived: true });
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));

    await act(async () => {
      result.current.markAnchored("fn-1");
    });

    await waitFor(() => {
      const ref = lastFootnotes()?.footnotes.find((f) => f.id === "fn-1");
      expect(ref?.unanchored).toBeUndefined();
      expect(ref?.archived).toBeUndefined();
    });
    // The body is untouched — anchoring reconciles intent, never content.
    expect(lastFootnotes()!.footnotes[0].content).toEqual(BODY);
  });

  it("is a no-op (no sidecar write) when the ref is already anchored", async () => {
    beginDocPipeline(DOC);
    seed();
    const { result } = renderHook(() => useFootnotes(DOC));
    await waitFor(() => expect(result.current.footnoteRefs).toHaveLength(1));
    writes.length = 0;

    await act(async () => {
      result.current.markAnchored("fn-1");
      result.current.markAnchored("does-not-exist");
    });

    expect(writes.filter((w) => w.file === "footnotes.json")).toHaveLength(0);
  });
});
