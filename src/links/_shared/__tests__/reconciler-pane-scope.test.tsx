// @vitest-environment jsdom
//
// Task 1639 — the anchor reconciler's PANEL-CARD leg is scoped to its own pane.
//
// Every mounted `EditorPane` (keep-alive capacity 3, the Reader up to 4) runs
// its own reconciler. The panel-card sweep + restamp used to query `document`,
// so pane B's run stripped pane A's `data-card-selected` and A's popped float's
// `data-contains-active-card` — and A's effect does not re-run on return, so
// A's window ring stayed gone. Card keys are unique only per DOCUMENT, so a
// document-wide STAMP also lit the twin a second pane of the same doc mounts.
//
// Harness: two `[data-pane-root]` roots, each rendering the SAME card key (the
// same-doc-twice case, which is also the strictest form of the cross-doc one),
// plus pane A's popped float portalled to <body> with `data-pane-owner="A"`.
// Two reconcilers, two stores, no editor (the panel-card leg runs without one).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { act, renderHook } from "@testing-library/react";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { createCardStore } from "@/links/_shared/anchored-card-store";
import { cardKeyForEntity } from "@/links/_shared/entity-hover";
import type { EntityCollectionSlots } from "@/cards/entity-collections";

const NOTE = { kind: "note" as const, id: "n1" };
const KEY = cardKeyForEntity(NOTE)!;

const collections = {
  notes: [{ id: NOTE.id }],
  cutterCards: [],
  comments: [],
  todoItems: [],
  archiveSnippets: [],
  reportCards: [],
  examples: [],
  highlights: [],
} as unknown as EntityCollectionSlots;

const NONE: ReadonlySet<string> = new Set();

function card(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-key", KEY);
  return el;
}

function mountPanes() {
  const rootA = document.createElement("div");
  rootA.setAttribute("data-pane-root", "A");
  const cardA = card();
  rootA.appendChild(cardA);

  const floatA = document.createElement("div");
  floatA.setAttribute("data-floating-panel", "");
  floatA.setAttribute("data-pane-owner", "A");
  const floatCardA = card();
  floatA.appendChild(floatCardA);

  const rootB = document.createElement("div");
  rootB.setAttribute("data-pane-root", "B");
  const cardB = card();
  rootB.appendChild(cardB);

  document.body.append(rootA, floatA, rootB);
  return { rootA, floatA, rootB, cardA, floatCardA, cardB };
}

function reconcilerFor(paneRootId: string | null) {
  const store = createCardStore();
  const hook = renderHook(() =>
    useAnchorHighlightReconciler({
      editor: null,
      collections,
      store,
      panelSides: {},
      archivedCardIds: NONE,
      paneRootId,
    }),
  );
  return { store, hook };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("anchor reconciler — the panel-card leg stays inside its own pane (task 1639)", () => {
  it("pane B's run does not strip pane A's selection stamps or its float's window ring", () => {
    const dom = mountPanes();
    const a = reconcilerFor("A");
    const b = reconcilerFor("B");

    act(() => a.store.select(NOTE));
    expect(dom.cardA.getAttribute("data-card-selected")).toBe("true");
    expect(dom.floatCardA.getAttribute("data-card-selected")).toBe("true");
    expect(dom.floatA.getAttribute("data-contains-active-card")).toBe("true");
    // A's stamp did not reach B's twin of the same card.
    expect(dom.cardB.getAttribute("data-card-selected")).toBeNull();

    // Hover in B → B's reconciler sweeps + restamps.
    act(() => b.store.setHover(NOTE));
    expect(dom.cardB.getAttribute("data-card-hovered")).toBe("true");

    // A's stamps survive B's sweep…
    expect(dom.cardA.getAttribute("data-card-selected")).toBe("true");
    expect(dom.floatCardA.getAttribute("data-card-selected")).toBe("true");
    expect(dom.floatA.getAttribute("data-contains-active-card")).toBe("true");
    // …and B's hover lit none of A's twins.
    expect(dom.cardA.getAttribute("data-card-hovered")).toBeNull();
    expect(dom.floatCardA.getAttribute("data-card-hovered")).toBeNull();

    // B un-hovers: B's sweep clears only B.
    act(() => b.store.setHoverFor(NOTE, false));
    expect(dom.cardB.getAttribute("data-card-hovered")).toBeNull();
    expect(dom.floatA.getAttribute("data-contains-active-card")).toBe("true");

    // CONTROL — A's own sweep still clears A, float ring included.
    act(() => a.store.clearSelection());
    expect(dom.cardA.getAttribute("data-card-selected")).toBeNull();
    expect(dom.floatCardA.getAttribute("data-card-selected")).toBeNull();
    expect(dom.floatA.getAttribute("data-contains-active-card")).toBeNull();

    a.hook.unmount();
    b.hook.unmount();
  });

  it("a pane-less host (paneRootId null) still paints — the ladder, not nothing", () => {
    const dom = mountPanes();
    const host = reconcilerFor(null);
    act(() => host.store.select(NOTE));
    // jsdom lays nothing out, so no match is "visible" and the ladder answers
    // every match: the pre-1639 reach, for the host that has no pane.
    expect(dom.cardA.getAttribute("data-card-selected")).toBe("true");
    host.hook.unmount();
  });
});
