// @vitest-environment jsdom
/**
 * Task 870 — the three behaviours that were stranded in EditorLayout acting on
 * shell copies of per-pane state, now pane-owned. Each test drives the piece
 * the pane mounts, with the pane's own state:
 *
 *   1. the recently-added pin releases when the selection moves off it
 *      (`RecentlyAddedAutoClear` under the pane's tracker + selections);
 *   2. the Bibliography → citation ring paints in THIS pane's editor only
 *      (`useBibCitationHighlight`);
 *   3. the toolbar-override editor releases on main-editor focus and on the
 *      override's destroy (`useToolbarOverrideEditor`).
 */
import { describe, it, expect } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { createCardStore, CardStoreProvider, type CardStore } from "@/links/_shared/anchored-card-store";
import { SelectionsProvider } from "../contexts/selections";
import { RecentlyAddedProvider, useRecentlyAddedId } from "../contexts/recently-added";
import { RecentlyAddedAutoClear } from "../recently-added-auto-clear";
import { useRecentlyAddedTracker, type RecentlyAddedTracker } from "@/hooks/useRecentlyAddedTracker";
import { CITATION_HIGHLIGHT_BIB_CLASS, useBibCitationHighlight } from "../bib-citation-highlight";
import { linkIdSelector, linkKindSelector } from "@/links/link-dom-contract";
import { useToolbarOverrideEditor } from "@/hooks/useToolbarOverrideEditor";

describe("recently-added pin (pane-owned auto-clear)", () => {
  function PaneTree({ store, onTracker, onPin }: {
    store: CardStore;
    onTracker: (t: RecentlyAddedTracker) => void;
    onPin: (id: string | null) => void;
  }) {
    const tracker = useRecentlyAddedTracker();
    onTracker(tracker);
    return (
      <CardStoreProvider store={store}>
        <RecentlyAddedProvider value={tracker}>
          <SelectionsProvider value={{ selectedBibKey: null, setSelectedBibKey: () => {} }}>
            <RecentlyAddedAutoClear />
            <PinProbe onPin={onPin} />
          </SelectionsProvider>
        </RecentlyAddedProvider>
      </CardStoreProvider>
    );
  }
  function PinProbe({ onPin }: { onPin: (id: string | null) => void }) {
    onPin(useRecentlyAddedId("note"));
    return null;
  }

  it("holds the pin while the new card is selected, releases it when the selection moves", () => {
    const store = createCardStore();
    let tracker!: RecentlyAddedTracker;
    let pin: string | null = null;
    render(<PaneTree store={store} onTracker={(t) => (tracker = t)} onPin={(p) => (pin = p)} />);

    // Card creation: select the new card + mark it added (useCardCreation's pair).
    act(() => {
      store.select({ kind: "note", id: "n1" });
      tracker.markAdded("note", "n1");
    });
    expect(pin).toBe("n1");

    act(() => { store.select({ kind: "note", id: "n2" }); });
    expect(pin).toBeNull();
  });
});

describe("bib → citation ring (pane-scoped)", () => {
  function citationEl(id: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = `<span></span>`;
    const el = host.firstElementChild as HTMLElement;
    // Build the attributes from the ONE selector contract rather than spelling them.
    const probe = `${linkKindSelector("citation")}${linkIdSelector(id)}`;
    for (const m of probe.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) el.setAttribute(m[1], m[2]);
    expect(el.matches(probe)).toBe(true);
    return el;
  }

  it("rings the selected entry's citations in THIS pane only, and clears on deselect", () => {
    const paneA = document.createElement("div");
    const paneB = document.createElement("div");
    const a1 = citationEl("c1");
    const a2 = citationEl("c2");
    const b1 = citationEl("c1"); // same short id in another open doc
    paneA.append(a1, a2);
    paneB.append(b1);
    document.body.append(paneB, paneA); // the hidden pane comes FIRST in the document

    const cits = [
      { citationId: "c1", keys: ["smith2020"] },
      { citationId: "c2", keys: ["jones2019"] },
    ];
    const { rerender } = renderHook(
      ({ key }: { key: string | null }) => useBibCitationHighlight(paneA, cits, key),
      { initialProps: { key: "smith2020" as string | null } },
    );
    expect(a1.classList.contains(CITATION_HIGHLIGHT_BIB_CLASS)).toBe(true);
    expect(a2.classList.contains(CITATION_HIGHLIGHT_BIB_CLASS)).toBe(false);
    expect(b1.classList.contains(CITATION_HIGHLIGHT_BIB_CLASS)).toBe(false);

    rerender({ key: null });
    expect(a1.classList.contains(CITATION_HIGHLIGHT_BIB_CLASS)).toBe(false);
    paneA.remove();
    paneB.remove();
  });
});

describe("toolbar-override editor lifecycle", () => {
  type Handler = () => void;
  function fakeEditor() {
    const handlers = new Map<string, Set<Handler>>();
    const ed = {
      isDestroyed: false,
      on(ev: string, fn: Handler) {
        if (!handlers.has(ev)) handlers.set(ev, new Set());
        handlers.get(ev)!.add(fn);
        return ed;
      },
      off(ev: string, fn: Handler) {
        handlers.get(ev)?.delete(fn);
        return ed;
      },
      emit(ev: string) {
        for (const fn of [...(handlers.get(ev) ?? [])]) fn();
      },
    };
    return ed;
  }

  it("main-editor focus hands the toolbar back to the main editor", () => {
    const main = fakeEditor();
    const card = fakeEditor();
    const { result } = renderHook(() => useToolbarOverrideEditor(main as unknown as Editor));
    act(() => { result.current[1](card as unknown as Editor); });
    expect(result.current[0]).toBe(card);
    act(() => { main.emit("focus"); });
    expect(result.current[0]).toBeNull();
  });

  it("destroying the override editor releases it", () => {
    const main = fakeEditor();
    const card = fakeEditor();
    const { result } = renderHook(() => useToolbarOverrideEditor(main as unknown as Editor));
    act(() => { result.current[1](card as unknown as Editor); });
    act(() => {
      card.isDestroyed = true;
      card.emit("destroy");
    });
    expect(result.current[0]).toBeNull();
  });

  it("an already-destroyed editor is never held", () => {
    const main = fakeEditor();
    const dead = fakeEditor();
    dead.isDestroyed = true;
    const { result } = renderHook(() => useToolbarOverrideEditor(main as unknown as Editor));
    act(() => { result.current[1](dead as unknown as Editor); });
    expect(result.current[0]).toBeNull();
  });
});
