// @vitest-environment jsdom
// Task 1458 — per-CARD lookups resolve in the pane the gesture came from.
//
// Task 1393 scoped the per-PANE markers (columns, strips, dock slots). The
// per-card lookups — the marker click's "show me this card", its selection
// alignment, the omni entry scroll, `jumpToLink`'s card end, `usePlacement`'s
// card Y — still took the focused-or-first-VISIBLE match. Card ids are unique
// only per document, so two Library Readers side by side can both mount
// `note:n1`; the read-only Reader need not take focus on a click, so a click in
// the RIGHT Reader acted on the LEFT Reader's card. Every leg here builds TWO
// VISIBLE panes with no focus, and asks for the SECOND pane's answer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { act } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import {
  PANE_OWNER_ATTR,
  PANE_ROOT_ATTR,
  paneRootOf,
  resolvePaneMarker,
} from "../pane-dom";
import { findOmniEntry, openForCard } from "../event-bridges/open-for-card";
import { useMarkerClickBridges } from "../event-bridges/marker-clicks";
import {
  dispatchLinkedAnchorClick,
  paneRootForDoc,
  registerPaneClickHost,
  type PaneClickHost,
} from "@/lib/pane-click-origin";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import type { CardStore } from "@/links/_shared/anchored-card-store";
import type { OmniCategory } from "@/panels/Omni";

function visible<T extends HTMLElement>(e: T): T {
  Object.defineProperty(e, "offsetParent", { configurable: true, get: () => document.body });
  Object.defineProperty(e, "offsetHeight", { configurable: true, get: () => 100 });
  return e;
}

function node(attrs: Record<string, string>, ...kids: HTMLElement[]): HTMLElement {
  const e = visible(document.createElement("div"));
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.appendChild(k);
  return e;
}

const KEY = "float:card:note:n1";

/** A visible pane root holding (optionally) an omni entry for KEY. */
function pane(id: string, withEntry: boolean): HTMLElement {
  const kids = withEntry
    ? [node({ "data-omni-entry-wrapper": KEY }, node({ "data-omni-entry": KEY }))]
    : [];
  const root = node({ [PANE_ROOT_ATTR]: id }, ...kids);
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
  (document.activeElement as HTMLElement | null)?.blur?.();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the pane's TERRITORY: root + the portals it owns", () => {
  it("an element inside a pane-owned float answers that pane as its owner", () => {
    const b = pane("B", false);
    const inFloat = node({});
    document.body.appendChild(node({ [PANE_OWNER_ATTR]: "B" }, inFloat));
    expect(paneRootOf(inFloat)).toBe(b);
  });

  it("a scoped lookup finds a card in its own popped float, never a neighbour's", () => {
    pane("A", true);
    const b = pane("B", false);
    const bFloatCard = node({ "data-card-key": "note:n1" });
    document.body.appendChild(node({ [PANE_OWNER_ATTR]: "B" }, bFloatCard));
    const aCard = node({ "data-card-key": "note:n1" });
    document.querySelector(`[${PANE_ROOT_ATTR}="A"]`)!.appendChild(aCard);
    expect(resolvePaneMarker('[data-card-key="note:n1"]', "fail-open", b)).toBe(bFloatCard);
  });
});

describe("card-key lookups resolve by ownership (two visible panes, no focus)", () => {
  it("findOmniEntry answers the SCOPED pane's entry, not the first visible one", () => {
    pane("A", true);
    const b = pane("B", true);
    const got = findOmniEntry(KEY, "data-omni-entry-wrapper", b);
    expect(got).not.toBeNull();
    expect(paneRootOf(got)).toBe(b);
  });

  it("openForCard does not treat the OTHER Reader's omni card as 'already showing'", () => {
    pane("A", true); // the left Reader shows the card…
    const b = pane("B", false); // …the right Reader, where the click came from, does not
    const setActiveLeft = vi.fn();
    const setActiveRight = vi.fn();
    openForCard(
      {
        omniKey: KEY,
        entrySelector: '[data-link-card="note:n1"]',
        panelId: "notes",
        cardKind: "note",
        skipScroll: true,
        scope: () => b,
      },
      {
        prefs: { placements: [], dockStack: { left: [], right: [] } } as unknown as ViewPrefs,
        setActiveLeft,
        setActiveRight,
        tryScrollOmniEntry: () => false,
        getOmniEnabled: () => new Set<OmniCategory>(["notes" as OmniCategory]),
      },
    );
    // B's own panel opens; on the old code the LEFT Reader's entry satisfied
    // Rule 1 and nothing opened in the pane the user clicked in.
    expect(setActiveLeft.mock.calls.length + setActiveRight.mock.calls.length).toBe(1);
  });
});

describe("the marker-click bridge scopes every lookup to the ORIGIN pane", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("a Reader click's env names that Reader's pane root", () => {
    pane("A", true);
    const b = pane("B", false);
    const host: PaneClickHost = {
      cardStore: { select: vi.fn() } as unknown as CardStore,
      getPrefs: () =>
        ({ placements: [], dockStack: { left: [], right: [] } }) as unknown as ViewPrefs,
      setActiveLeft: vi.fn(),
      setActiveRight: vi.fn(),
      getOmniEnabled: () => new Set<OmniCategory>(["notes" as OmniCategory]),
      setSelectedErrorId: vi.fn(),
      getPaneRoot: () => b,
    };
    unregister = registerPaneClickHost("reader-B", host);
    expect(paneRootForDoc("reader-B")).toBe(b);
    renderHook(() =>
      useMarkerClickBridges({
        prefsRef: { current: {} as ViewPrefs },
        setActiveLeft: vi.fn(),
        setActiveRight: vi.fn(),
        tryScrollOmniEntry: () => false,
        getOmniEnabled: () => new Set(),
        setSelectedErrorId: vi.fn(),
        setActiveRef: vi.fn(),
        setAtomCreateRequest: vi.fn(),
        setActiveMath: vi.fn(),
        setActiveFigure: vi.fn(),
        getActiveCardStore: () => ({ select: vi.fn() }) as unknown as CardStore,
        getActiveDocId: () => "doc-editor",
      }),
    );
    act(() => {
      dispatchLinkedAnchorClick({ docId: "reader-B", entityId: "n1", kind: "note" });
    });
    // The Reader B pane opens its own panel — the left Reader's visible omni
    // card no longer answers the click.
    const opened =
      (host.setActiveLeft as ReturnType<typeof vi.fn>).mock.calls.length +
      (host.setActiveRight as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(opened).toBe(1);
  });
});
