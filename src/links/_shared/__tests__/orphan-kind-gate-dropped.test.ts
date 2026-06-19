// @vitest-environment jsdom
//
// CHIP 5 — orphan-event kind-gate drop (BUG1 routing).
//
// On reload the `virgil-anchor-orphaned` event carries the parser-default
// `kind:"note"` for EVERY `\vlid` pair (the parser hardcodes it). Before this
// chip, each panel gated its orphan listener on `kind`, so e.g. the Revisions
// panel ignored its OWN orphaned revision mark (it arrived labeled "note") and
// the revision card kept a dead textRange. Dropping the gate — relying on each
// `clearCardAnchor`'s anchorId self-filter (no-match early-return) — lets the
// OWNING panel clear its card regardless of the stale event kind.
//
// This pins it end-to-end through the REAL `useRevisions` hook: a revision card
// with a Mode-B anchor, an orphan event mislabeled `kind:"note"`, the
// revision's textRange cleared.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

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
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { useRevisions } from "@/hooks/useRevisions";
import { getTextAnchor } from "@/links/links";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

function seedRevisionWithAnchor() {
  mockRead.mockResolvedValue({
    cards: [
      {
        id: "r1",
        kind: "comment",
        content: { type: "doc", content: [] },
        author: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        links: [
          {
            id: "r1@anc",
            kind: "anchor",
            anchor: {
              type: "textObject",
              targetKind: "linkedRange",
              textObjectIds: ["para-A"],
              margin: { side: "right" },
              textRange: { anchorId: "anc-rev", textSnapshot: "the span" },
            },
            // The sidecar SSOT kind: a revision comment.
            target: { type: "card", ref: { kind: "revision-comment", id: "r1" } },
            createdAt: "",
          },
        ],
      },
    ],
  });
}

describe("orphan kind-gate dropped — owning panel clears regardless of event kind", () => {
  it("a revision mark reloaded/orphaned as kind:'note' still clears the revision card's textRange", async () => {
    beginDocPipeline("kgd-rev");
    seedRevisionWithAnchor();

    const { result } = renderHook(() => useRevisions("kgd-rev"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));
    // Precondition: the card carries a live Mode-B text anchor.
    expect(getTextAnchor(result.current.cards[0])).not.toBeNull();

    // The guard fires the orphan event with the STALE parser-default kind.
    act(() => {
      window.dispatchEvent(
        new CustomEvent("virgil-anchor-orphaned", {
          detail: { anchorId: "anc-rev", kind: "note" },
        }),
      );
    });

    // The Revisions panel cleared its own card's textRange despite the event
    // claiming kind:"note" — the kind gate is gone.
    await waitFor(() =>
      expect(getTextAnchor(result.current.cards[0])).toBeNull(),
    );
  });

  it("an unrelated anchorId is a no-op (clearCardAnchor self-filter holds)", async () => {
    beginDocPipeline("kgd-rev2");
    seedRevisionWithAnchor();

    const { result } = renderHook(() => useRevisions("kgd-rev2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("virgil-anchor-orphaned", {
          detail: { anchorId: "some-other-id", kind: "note" },
        }),
      );
    });

    // The revision's anchor is untouched (the self-filter early-returns).
    await waitFor(() => {
      expect(getTextAnchor(result.current.cards[0])?.anchorId).toBe("anc-rev");
    });
  });
});
