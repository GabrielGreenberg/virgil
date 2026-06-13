// @vitest-environment jsdom
//
// Chip #37 sibling — the footnote orphan-suppression PRODUCER.
//
// footnote-sync.ts documented a `suppressOrphanRef` latch ("deletions done
// via handleDeleteFootnote pre-register the id so the teardown event doesn't
// resurrect the footnote as an orphan"), but the PRODUCER that armed the ref
// had been removed. So a deliberate trash-delete of a NON-EMPTY footnote
// resurrected as an orphan card on the next orphan-detector teardown event.
//
// The fix: `handleDeleteFootnote` dispatches `virgil-footnote-suppress-orphan`
// (synchronously, before the atom is removed), and `useFootnoteSyncBridges`
// arms `suppressOrphanRef` on it. The orphan-detector's deferred
// `virgil-footnote-orphaned` then finds the id latched and swallows it.
//
// These pins drive the real hook with a real ref + state setter and assert:
//   1. suppress-then-orphaned → NO orphan card (the deliberate delete).
//   2. orphaned WITHOUT a prior suppress → orphan card IS created (an
//      organic delete, e.g. the user backspacing the marker, still orphans).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type { OrphanedFootnote } from "@/lib/types";
import { useFootnoteSyncBridges } from "../footnote-sync";

function setup() {
  const orphans: OrphanedFootnote[] = [];
  let current: OrphanedFootnote[] = orphans;
  const setOrphanedFootnotes = vi.fn(
    (updater: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof updater === "function" ? updater(current) : updater;
    },
  );
  const deleteSnippet = vi.fn();

  const hook = renderHook(() => {
    const suppressOrphanRef = useRef<Set<string>>(new Set());
    useFootnoteSyncBridges({ suppressOrphanRef, setOrphanedFootnotes, deleteSnippet });
    return suppressOrphanRef;
  });

  return {
    suppressRef: hook.result.current,
    getOrphans: () => current,
    setOrphanedFootnotes,
  };
}

function fireSuppress(footnoteId: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-suppress-orphan", { detail: { footnoteId } }),
  );
}

function fireOrphaned(footnoteId: string, content: unknown) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-orphaned", { detail: { footnoteId, content } }),
  );
}

describe("footnote orphan-suppression producer (#37 sibling)", () => {
  it("a suppressed footnote does NOT resurrect as an orphan card", () => {
    const { suppressRef, getOrphans } = setup();

    act(() => {
      // Producer: handleDeleteFootnote arms the latch before the atom is gone.
      fireSuppress("fn-deliberate");
    });
    // The id is now latched.
    expect(suppressRef.current.has("fn-deliberate")).toBe(true);

    act(() => {
      // The orphan-detector's deferred teardown event arrives.
      fireOrphaned("fn-deliberate", { type: "doc", content: [] });
    });

    // No orphan card was created, and the latch was consumed (one-shot).
    expect(getOrphans()).toEqual([]);
    expect(suppressRef.current.has("fn-deliberate")).toBe(false);
  });

  it("an un-suppressed teardown still creates an orphan card", () => {
    const { getOrphans } = setup();

    act(() => {
      fireOrphaned("fn-organic", { type: "doc", content: [] });
    });

    const orphans = getOrphans();
    expect(orphans.length).toBe(1);
    expect(orphans[0].footnoteId).toBe("fn-organic");
  });
});
