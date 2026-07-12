// @vitest-environment jsdom
//
// Task 107 — a revision comment created from a TEXT SELECTION must be jumpable
// and Omni-anchored, not "free".
//
// The bug: `handleToolbarAddComment` passed `paragraphId = null` when there was
// a live selection (unlike note/cutter, which thread
// `ensureParagraphUuid(sel.from)`). So `addComment(null, undefined, anchor)`
// skipped `addTextObjectLink` and ran only `setTextAnchorLink`, whose
// `textObjectIds` fell back to `getLinkedTextObjectIds(card)` = [] on the
// not-yet-linked card. The resulting Mode-B `linkedRange` link had a valid
// `textRange.anchorId` but `textObjectIds: []` — and the panel/omni jump gate
// (`getLinkedTextObjectIds(card).length > 0`) plus `buildRevisionOmniItems`
// binning both key on `textObjectIds`, so the card was un-jumpable and mis-binned
// `free` despite a live anchor + a correctly-rendered margin marker.
//
// The fix threads the pid at the handler (mirrored here by calling
// `addComment(pid, undefined, anchor)` exactly as the fixed handler does), so the
// canonical `linkedRange` link carries `textObjectIds:[pid]`.
//
// Contract pinned: a selection-anchored revision comment (a) reports
// `getLinkedTextObjectIds().length > 0` — satisfying the jump gate — and (b)
// yields a `buildRevisionOmniItems` item with `pos != null` and
// `anchorState: "anchored"` (NOT `free`), consistent with the note/cutter
// siblings and the already-correct margin marker.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn().mockResolvedValue(undefined);
  mod.readSidecar = vi.fn().mockResolvedValue({ cards: [] });
  mod.readSidecarIfExists = vi.fn().mockResolvedValue({ cards: [] });
  return mod;
});

import { useRevisions } from "@/hooks/useRevisions";
import { buildRevisionOmniItems } from "@/panels/Revisions/omni";
import { getLinkedTextObjectIds, getTextAnchor } from "@/links/links";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  __resetForTests();
});

const PID = "para-uuid-1";
const ANCHOR = { anchorId: "anchor-1", anchorText: "the selected span" };

// The stub arg-bag for `buildRevisionOmniItems`. Only `findParagraphPos` matters
// to the anchor-state contract (it resolves the pid → a live doc position);
// everything else is a no-op the builder threads into the (unrendered) cards.
function omniArgs(cards: import("@/lib/types").RevisionCard[]) {
  return {
    cards,
    selectedId: null,
    setSelectedId: () => {},
    jumpToCard: () => {},
    findParagraphPos: (uuid: string | null) => (uuid === PID ? 42 : null),
    editor: null,
    updateCommentContent: () => {},
    setCommentAiRequest: () => {},
    updateSuggestionField: () => {},
    acceptSuggestion: () => {},
    rejectSuggestion: () => {},
    convertCard: () => {},
    deleteCard: () => {},
  };
}

describe("revision comment from a text selection (task 107)", () => {
  it("threading the pid gives the Mode-B link textObjectIds:[pid] (jump gate satisfied)", async () => {
    beginDocPipeline("doc-107a");
    const { result } = renderHook(() => useRevisions("doc-107a"));

    let card: import("@/lib/types").RevisionRequestCard | undefined;
    act(() => {
      // Exactly the fixed handler's call: pid threaded + Mode-B anchor.
      card = result.current.addComment(PID, undefined, ANCHOR);
    });
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    expect(card).toBeTruthy();
    // The Mode-B text-range anchor survives...
    expect(getTextAnchor(card!)).toEqual({
      anchorId: ANCHOR.anchorId,
      anchorText: ANCHOR.anchorText,
    });
    // ...AND the link carries the containing paragraph, so the jump gate
    // (`getLinkedTextObjectIds(card).length > 0`) is satisfied.
    expect(getLinkedTextObjectIds(card!)).toContain(PID);
    expect(getLinkedTextObjectIds(card!).length).toBeGreaterThan(0);
  });

  it("buildRevisionOmniItems bins it anchored (pos != null), not free", async () => {
    beginDocPipeline("doc-107b");
    const { result } = renderHook(() => useRevisions("doc-107b"));

    act(() => {
      result.current.addComment(PID, undefined, ANCHOR);
    });
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    const items = buildRevisionOmniItems(omniArgs(result.current.cards));
    expect(items).toHaveLength(1);
    expect(items[0].pos).toBe(42);
    expect(items[0].anchorUuid).toBe(PID);
    expect(items[0].anchorState).toBe("anchored");
  });

  it("REGRESSION GUARD: the old paragraphId=null path bins it free (the bug)", async () => {
    beginDocPipeline("doc-107c");
    const { result } = renderHook(() => useRevisions("doc-107c"));

    let card: import("@/lib/types").RevisionRequestCard | undefined;
    act(() => {
      // The pre-fix handler behaviour: null pid + Mode-B anchor only.
      card = result.current.addComment(null, undefined, ANCHOR);
    });
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    // The tell: a valid text anchor but EMPTY textObjectIds → jump gate fails,
    // omni bins free. This documents precisely what the fix eliminates.
    expect(getTextAnchor(card!)).toBeTruthy();
    expect(getLinkedTextObjectIds(card!)).toEqual([]);

    const items = buildRevisionOmniItems(omniArgs(result.current.cards));
    expect(items[0].pos).toBeNull();
    expect(items[0].anchorState).toBe("free");
  });
});
