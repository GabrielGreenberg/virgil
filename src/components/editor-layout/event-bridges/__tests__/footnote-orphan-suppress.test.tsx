// @vitest-environment jsdom
//
// Chip #37 sibling — the footnote orphan-suppression PRODUCER, now driving the
// per-pane `useFootnoteOrphanBridges` hook (the orphan web moved out of the
// EditorLayout shell into EditorPane, per-doc + docId-routed).
//
// `handleDeleteFootnote` dispatches `virgil-footnote-suppress-orphan`
// (synchronously, before the atom is removed) and the bridge arms its internal
// latch on it. The orphan-detector's deferred `virgil-footnote-orphaned` then
// finds the id latched and swallows it. Both events carry the originating
// `docId` so a bridge only ever acts on its own doc's events.
//
// These pins drive the real hook with a real state setter and assert:
//   1. suppress-then-orphaned → NO orphan card (the deliberate delete).
//   2. the latch is ONE-SHOT — a second teardown of the same id orphans.
//   3. orphaned WITHOUT a prior suppress → orphan card IS created (an organic
//      delete, e.g. the user backspacing the marker, still orphans).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { OrphanedFootnote } from "@/lib/types";
import { useFootnoteOrphanBridges } from "../footnote-sync";

const DOC = "docA";

function setup(docId: string = DOC) {
  let current: OrphanedFootnote[] = [];
  const setOrphanedFootnotes = vi.fn(
    (updater: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof updater === "function" ? updater(current) : updater;
    },
  );
  renderHook(() =>
    useFootnoteOrphanBridges({ docId, store: { setOrphanedFootnotes } }),
  );
  return { getOrphans: () => current, setOrphanedFootnotes };
}

function fireSuppress(footnoteId: string, docId = DOC) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-suppress-orphan", { detail: { footnoteId, docId } }),
  );
}

function fireOrphaned(footnoteId: string, content: unknown, docId = DOC) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-orphaned", { detail: { footnoteId, content, docId } }),
  );
}

describe("footnote orphan-suppression producer (#37 sibling)", () => {
  it("a suppressed footnote does NOT resurrect as an orphan card", () => {
    const { getOrphans } = setup();

    act(() => {
      // Producer: handleDeleteFootnote arms the latch before the atom is gone.
      fireSuppress("fn-deliberate");
    });
    act(() => {
      // The orphan-detector's deferred teardown event arrives.
      fireOrphaned("fn-deliberate", { type: "doc", content: [] });
    });

    expect(getOrphans()).toEqual([]);
  });

  it("the suppress latch is one-shot: a second teardown of the same id orphans", () => {
    const { getOrphans } = setup();

    act(() => fireSuppress("fn-x"));
    act(() => fireOrphaned("fn-x", { type: "doc", content: [] })); // swallowed
    expect(getOrphans()).toEqual([]);

    act(() => fireOrphaned("fn-x", { type: "doc", content: [] })); // latch consumed → orphans
    expect(getOrphans().map((o) => o.footnoteId)).toEqual(["fn-x"]);
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

  it("ignores an orphan event that originated in a DIFFERENT doc (FN-A2-03)", () => {
    const { getOrphans } = setup("docA");

    act(() => {
      // A teardown in doc B reaches this (doc A) bridge's window listener, but
      // the docId filter rejects it — no cross-doc bleed.
      fireOrphaned("fn-from-B", { type: "doc", content: [] }, "docB");
    });

    expect(getOrphans()).toEqual([]);
  });
});
