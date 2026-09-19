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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useRevisions } from "@/hooks/useRevisions";
import { getTextAnchor } from "@/links/links";
import { dispatchAnchorOrphaned } from "@/lib/tiptap/orphan-events";
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

describe("orphan events are DOC-scoped (task 598)", () => {
  it("an orphan in doc A leaves doc B's card untouched when both hold the anchorId", async () => {
    beginDocPipeline("scope-A");
    beginDocPipeline("scope-B");
    seedRevisionWithAnchor();

    const a = renderHook(() => useRevisions("scope-A"));
    const b = renderHook(() => useRevisions("scope-B"));
    await waitFor(() => expect(a.result.current.cards.length).toBe(1));
    await waitFor(() => expect(b.result.current.cards.length).toBe(1));
    mockWrite.mockClear();

    act(() => {
      dispatchAnchorOrphaned({ docId: "scope-A", anchorId: "anc-rev", kind: "note" });
    });

    await waitFor(() =>
      expect(getTextAnchor(a.result.current.cards[0])).toBeNull(),
    );
    expect(getTextAnchor(b.result.current.cards[0])?.anchorId).toBe("anc-rev");
    // B never wrote a sidecar for a deletion that happened in A.
    await new Promise((r) => setTimeout(r, 20));
    for (const call of mockWrite.mock.calls) expect(call[0]).not.toBe("scope-B");
  });

  it("an orphan from a surface with no document (docId null) is heard by nobody", async () => {
    beginDocPipeline("scope-null");
    seedRevisionWithAnchor();
    const { result } = renderHook(() => useRevisions("scope-null"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    act(() => {
      dispatchAnchorOrphaned({ docId: null, anchorId: "anc-rev", kind: "note" });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(getTextAnchor(result.current.cards[0])?.anchorId).toBe("anc-rev");
  });
});

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
          detail: { docId: "kgd-rev", anchorId: "anc-rev", kind: "note" },
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
          detail: { docId: "kgd-rev2", anchorId: "some-other-id", kind: "note" },
        }),
      );
    });

    // The revision's anchor is untouched (the self-filter early-returns).
    await waitFor(() => {
      expect(getTextAnchor(result.current.cards[0])?.anchorId).toBe("anc-rev");
    });
  });
});
