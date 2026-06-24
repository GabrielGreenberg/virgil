// @vitest-environment jsdom
//
// Regression: the click-away (pointerdown) discard in `usePristineCardManager`
// must DEFER past the card body editor's blur-flush, not fire synchronously.
//
// Why: RichTextField debounces its `onChange` (250ms) and only flushes it on
// `blur` — and `blur` fires AFTER `pointerdown`. The flushed onChange routes
// through the owning hook's edit setter, which calls `markDirty(id)`. So a card
// the user typed into within the debounce window is STILL pristine at
// pointerdown time. The old synchronous discard deleted it then → data loss.
// The manager now collects outside-click candidates on pointerdown and re-checks
// membership on a `setTimeout(0)`: by then the blur-flush's markDirty has run, so
// a typed-into card is spared, while a genuinely-untouched blank card is still
// discarded.
//
// This pins the universal fix for the data-loss class that the footnote-specific
// fix (EditorPane handleEditFootnote markDirty + deferred content-checked
// discard) first addressed in one place.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePristineCardManager } from "../usePristineCardManager";

// jsdom ships no global `CSS` object, but the manager builds its lookup selector
// with `CSS.escape` (always present in real browsers). Polyfill a minimal,
// spec-faithful-enough escape so the pointerdown path runs under jsdom.
if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
  };
}

function mountCard(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-pristine-card-id", id);
  document.body.appendChild(el);
  return el;
}

function clickAway(): void {
  // A pointerdown on an element OUTSIDE every pristine card's DOM. Dispatched on
  // a connected element so it propagates through `document`, where the manager's
  // capture-phase listener lives.
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  outside.remove();
}

describe("pristine click-away discard defers past the blur-flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("spares a card marked dirty during the deferred window", () => {
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("notes");
    const discard = vi.fn();
    act(() => {
      notes.registerDiscard(discard);
      notes.markNew("note-typed");
    });
    mountCard("note-typed");

    // User clicks away while still inside the 250ms debounce window.
    act(() => {
      clickAway();
    });
    // The discard is deferred — nothing fires synchronously on pointerdown.
    expect(discard).not.toHaveBeenCalled();

    // The blur-flush lands: RichTextField flushes onChange → the owning hook's
    // edit setter calls markDirty synchronously, BEFORE the deferred timer.
    act(() => {
      notes.markDirty("note-typed");
    });

    // Deferred re-check runs: the card is no longer pristine → spared.
    act(() => {
      vi.runAllTimers();
    });
    expect(discard).not.toHaveBeenCalled();
    expect(notes.isPristine("note-typed")).toBe(false);
  });

  it("still discards a genuinely-untouched blank card after the defer", () => {
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("notes");
    const discard = vi.fn();
    act(() => {
      notes.registerDiscard(discard);
      notes.markNew("note-blank");
    });
    mountCard("note-blank");

    act(() => {
      clickAway();
    });
    // Nothing flushed — no markDirty. The deferred re-check still finds it
    // pristine and discards it.
    act(() => {
      vi.runAllTimers();
    });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith("note-blank");
    expect(notes.isPristine("note-blank")).toBe(false);
  });

  it("does not discard when the click lands inside the card", () => {
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("notes");
    const discard = vi.fn();
    act(() => {
      notes.registerDiscard(discard);
      notes.markNew("note-inside");
    });
    const card = mountCard("note-inside");

    act(() => {
      const inner = document.createElement("span");
      card.appendChild(inner);
      inner.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(discard).not.toHaveBeenCalled();
    expect(notes.isPristine("note-inside")).toBe(true);
  });

  it("defers each kind independently in one click-away", () => {
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("notes");
    const todos = result.current.forKind("todo");
    const noteDiscard = vi.fn();
    const todoDiscard = vi.fn();
    act(() => {
      notes.registerDiscard(noteDiscard);
      todos.registerDiscard(todoDiscard);
      notes.markNew("n1");
      todos.markNew("t1");
    });
    mountCard("n1");
    mountCard("t1");

    act(() => {
      clickAway();
    });
    // The note gets typed into during the defer; the todo stays blank.
    act(() => {
      notes.markDirty("n1");
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(noteDiscard).not.toHaveBeenCalled();
    expect(todoDiscard).toHaveBeenCalledWith("t1");
  });

  it("does not double-discard when discardAll() runs during the deferred window", () => {
    // Panel-close (discardAll) can land between the click-away pointerdown and
    // the deferred re-check. discardAll clears the Set and discards once; the
    // deferred pass must then find the id gone and skip — exactly one discard,
    // never two.
    const { result } = renderHook(() => usePristineCardManager());
    const notes = result.current.forKind("notes");
    const discard = vi.fn();
    act(() => {
      notes.registerDiscard(discard);
      notes.markNew("note-da");
    });
    mountCard("note-da");

    act(() => {
      clickAway();
    });
    act(() => {
      notes.discardAll();
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith("note-da");
    expect(notes.isPristine("note-da")).toBe(false);
  });
});
