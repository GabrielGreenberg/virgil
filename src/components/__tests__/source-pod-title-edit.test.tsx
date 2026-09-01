// @vitest-environment jsdom
/**
 * TASK 529 M3 — the source pod's `+T` title, the LIVENESS half of the class.
 *
 * Pre-529 the commit was deferred 100 ms and then read
 * `inputRef.current?.value ?? ""` — from a render closure in which the input
 * still existed. Both of its guards (`if (editingTitle)` in the timeout and
 * again inside `commitTitle`) were captured from that render, so both were
 * permanently `true` and dead. That guard was the author's own attempt at THIS
 * law — "Escape ended the edit, so don't commit" — written against a value a
 * batched `setState` can never change under it.
 *
 * Three failures fell out, and this suite drives each:
 *   (a) the fold chevron `preventDefault`s its mousedown, so the input never
 *       blurs at all; the collapse then unmounts it and the edit was silently
 *       DISCARDED;
 *   (b) where a blur did land first, the deferred commit woke with a dead ref,
 *       computed `""` and wrote `parTitle: null` — DELETING an existing title;
 *   (c) `editingTitle` was never cleared, so re-expanding the pod dropped
 *       straight back into edit mode on a pod nobody asked to edit.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: (_t, p) => (p === "__esModule" ? true : p === "then" ? undefined : noop) });
});

// The pod hosts a CodeMirror surface we never drive here; the title affordance
// lives in the NodeViewWrapper's own chrome, above it.
// Only the React COMPONENT is stubbed — the module's `EditorView` /
// `EditorState` re-exports stay real, because the pod builds a theme and an
// extension list from them at module scope.
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: () => <div data-testid="cm" />,
}));
// Partial: the pod's own NodeViewWrapper needs a NodeView context it has no
// business having in a unit test, but the module is imported transitively by
// half the editor and must otherwise stay real.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

import { render, cleanup, fireEvent, act } from "@testing-library/react";
import SourcePodNodeView, { type SourcePodConfig } from "@/components/SourcePodNodeView";

afterEach(cleanup);

const CONFIG: SourcePodConfig = {
  hostClass: "tex-block",
  sourceAttr: "source",
  chipLabel: "TeX",
  kindLabel: "LaTeX block",
  emptyLabel: "(empty)",
  confirmMessage: "Delete this block?",
};

/** Drive the REAL pod with a live `attrs` object, so `updateAttributes` behaves
 *  the way ProseMirror's does: the next render sees the written value. */
function renderPod(initial: Record<string, unknown>) {
  const attrs: Record<string, unknown> = { source: "\\emph{x}", collapsed: false, parTitle: null, ...initial };
  const updateAttributes = vi.fn((patch: Record<string, unknown>) => {
    Object.assign(attrs, patch);
    rerenderNow();
  });
  let rerenderNow = () => {};
  const view = render(
    <SourcePodNodeView
      node={{ attrs } as never}
      updateAttributes={updateAttributes}
      deleteNode={vi.fn()}
      config={CONFIG}
      cardContext={false}
    />,
  );
  rerenderNow = () =>
    view.rerender(
      <SourcePodNodeView
        node={{ attrs } as never}
        updateAttributes={updateAttributes}
        deleteNode={vi.fn()}
        config={CONFIG}
        cardContext={false}
      />,
    );
  const q = <T extends Element>(sel: string) => view.container.querySelector(sel) as T | null;
  return {
    attrs,
    updateAttributes,
    view,
    rerenderNow,
    titleInput: () => q<HTMLInputElement>("input.par-title-input"),
    addBtn: () => q<HTMLElement>(".par-title-add"),
    titleText: () => q<HTMLElement>(".par-title-text"),
    chevron: () => q<HTMLElement>(".source-pod-fold-chevron")!,
  };
}

/** Open the title editor and type `text` into it. */
function beginEdit(p: ReturnType<typeof renderPod>, text: string) {
  const opener = p.addBtn() ?? p.titleText()!;
  act(() => { fireEvent.click(opener); });
  const input = p.titleInput()!;
  expect(input).toBeTruthy();
  input.focus();
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe("(a) the fold chevron no longer discards the edit", () => {
  it("commits the typed title instead of losing it", () => {
    const p = renderPod({ parTitle: null });
    beginEdit(p, "Derivation");

    // The chevron `preventDefault`s its mousedown, so no blur fires — which is
    // exactly why pre-529 nothing committed. Drive the real gesture.
    act(() => {
      fireEvent.mouseDown(p.chevron());
      fireEvent.click(p.chevron());
    });

    expect(p.attrs.parTitle).toBe("Derivation");
    expect(p.attrs.collapsed).toBe(true);
  });

  it("(c) and does not leave the pod stuck in edit mode when it re-expands", () => {
    const p = renderPod({ parTitle: null });
    beginEdit(p, "Derivation");
    act(() => {
      fireEvent.mouseDown(p.chevron());
      fireEvent.click(p.chevron());
    });
    // Re-expand.
    act(() => {
      fireEvent.mouseDown(p.chevron());
      fireEvent.click(p.chevron());
    });
    expect(p.attrs.collapsed).toBe(false);
    expect(p.titleInput()).toBeNull();
    expect(p.titleText()?.textContent).toBe("Derivation");
  });

  it("an EXTERNAL collapse (undo, re-parse) also leaves edit mode", () => {
    const p = renderPod({ parTitle: "Kept" });
    beginEdit(p, "half-typed");
    // Nobody clicked anything — the attr just changed under the pod.
    act(() => {
      p.attrs.collapsed = true;
      p.rerenderNow();
    });
    act(() => {
      p.attrs.collapsed = false;
      p.rerenderNow();
    });
    expect(p.titleInput()).toBeNull();
    // …and the stored title is uncorrupted.
    expect(p.attrs.parTitle).toBe("Kept");
  });
});

describe("(b) no path writes an empty title over a real one", () => {
  it("a commit whose input has unmounted REFUSES rather than writing ''", () => {
    // FAKE TIMERS deliberately: the pre-529 commit was deferred 100 ms, so a
    // leg that never advances the clock gives that implementation no chance to
    // do its damage and passes on it vacuously.
    vi.useFakeTimers();
    try {
      const p = renderPod({ parTitle: "Existing" });
      const input = beginEdit(p, "Existing");

      // The blur-then-unmount window: the blur lands, then the input goes away.
      // Pre-529 the deferred commit woke here, read `null?.value ?? ""` and
      // wrote `parTitle: null` over a title the user never touched.
      act(() => { fireEvent.blur(input); });
      act(() => {
        p.attrs.collapsed = true;
        p.rerenderNow();
      });
      act(() => { vi.advanceTimersByTime(500); });

      expect(p.attrs.parTitle).toBe("Existing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearing the title deliberately still works", () => {
    const p = renderPod({ parTitle: "Existing" });
    const input = beginEdit(p, "");
    act(() => { fireEvent.blur(input); });
    expect(p.attrs.parTitle).toBeNull();
  });
});

describe("Escape cancels; Enter commits once", () => {
  it("Escape leaves the stored title untouched", () => {
    const p = renderPod({ parTitle: "Original" });
    const input = beginEdit(p, "typed over it");
    act(() => { fireEvent.keyDown(input, { key: "Escape" }); });
    expect(p.attrs.parTitle).toBe("Original");
    expect(p.titleInput()).toBeNull();
  });

  it("Enter commits exactly one transaction", () => {
    const p = renderPod({ parTitle: null });
    const input = beginEdit(p, "New title");
    act(() => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(p.attrs.parTitle).toBe("New title");
    const titleWrites = p.updateAttributes.mock.calls.filter((c) => "parTitle" in c[0]);
    expect(titleWrites).toHaveLength(1);
  });

  it("blurring away commits, once", () => {
    const p = renderPod({ parTitle: null });
    const input = beginEdit(p, "By blur");
    act(() => { fireEvent.blur(input); });
    expect(p.attrs.parTitle).toBe("By blur");
    expect(p.updateAttributes.mock.calls.filter((c) => "parTitle" in c[0])).toHaveLength(1);
  });

  it("committing an UNCHANGED title dispatches nothing", () => {
    const p = renderPod({ parTitle: "Same" });
    const input = beginEdit(p, "Same");
    act(() => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(p.updateAttributes.mock.calls.filter((c) => "parTitle" in c[0])).toHaveLength(0);
  });
});
