// @vitest-environment jsdom
//
// CollabStatusPill — the topbar pen-status pill (badge variant) + its kebab menu.
//
// Pins surface #6 of the dialog/overlay primitive-unification cluster (task 033):
// the kebab "Collaborator options" dropdown folds off its old inline
// `absolute z-[1000]` div — which was trapped under the sticky Virgil bar's z-30
// stacking context, below floating panels / popped cards (z-1200+) — onto the
// shared `<Menu>` primitive, BODY-PORTALED at the chrome-menu tier
// (OPEN_CHROME_MENU_Z = 2000). This mirrors its documented sibling
// ExternalChangeBadge.
//
// Contracts pinned:
//   1. the kebab menu renders under document.body, NOT inside the pill wrapper
//      (escapes the topbar z-30 trap);
//   2. it carries the chrome-menu z tier (2000), not the old 1000;
//   3. "Edit identity…" fires onEditIdentity and closes the menu;
//   4. the pending-request line shows only when I hold the pen and a request
//      is queued;
//   5. the icon variant renders NO menu (a pure toggle).
//
// The collab hook is mocked so this is a focused chrome test, not a full app boot.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type { CollabHook } from "@/hooks/useCollab";

// ── mock the shared collab context ──────────────────────────────────────
let currentCollab: CollabHook;
vi.mock("@/hooks/useCollab", () => ({
  useCollabContext: () => currentCollab,
}));

import CollabStatusPill from "../CollabStatusPill";

const noop = () => {};

/** A minimal enabled-collab hook with the pen free (I don't hold it). */
function collab(over: Partial<CollabHook> = {}): CollabHook {
  return {
    enabled: true,
    identity: { name: "Me", color: "#7191b0" },
    sidecar: {} as CollabHook["sidecar"],
    pen: { status: "free", holder: null, idleSec: null, staleSec: null, requestedBy: [] },
    canEditMainText: true,
    iHavePen: false,
    partnerColor: null,
    setIdentity: noop,
    enableCollab: async () => {},
    disableCollab: async () => {},
    takePen: async () => {},
    passPen: async () => {},
    requestPen: async () => {},
    takeOver: async () => {},
    bumpActivity: noop,
    claimCard: async () => {},
    releaseClaim: async () => {},
    getCardClaim: () => null,
    updateSelection: noop,
    updateCursorParagraph: noop,
    getCardSelections: () => [],
    getCursorSelections: () => [],
    ...over,
  } as CollabHook;
}

const props = {
  onEnableRequest: noop,
  onEditIdentity: vi.fn(),
  onDisable: noop,
};

beforeEach(() => {
  props.onEditIdentity.mockClear();
  currentCollab = collab();
});

afterEach(() => cleanup());

describe("CollabStatusPill — kebab menu (surface #6 portal fix)", () => {
  it("body-portals the kebab menu (escapes the topbar z-30 trap)", () => {
    const { container } = render(<CollabStatusPill {...props} variant="badge" />);
    fireEvent.click(screen.getByLabelText("Collaborator options"));
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    // Must NOT be a descendant of the pill's own wrapper (that's the whole point).
    expect(container.contains(menu)).toBe(false);
  });

  it("carries the chrome-menu z tier (2000), not the old inline 1000", () => {
    render(<CollabStatusPill {...props} variant="badge" />);
    fireEvent.click(screen.getByLabelText("Collaborator options"));
    const menu = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.style.zIndex).toBe("2000");
  });

  it("'Edit identity…' fires onEditIdentity and closes the menu", () => {
    render(<CollabStatusPill {...props} variant="badge" />);
    fireEvent.click(screen.getByLabelText("Collaborator options"));
    fireEvent.click(screen.getByText("Edit identity…"));
    expect(props.onEditIdentity).toHaveBeenCalledTimes(1);
    // Menu closed → no role="menu" in the tree.
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("shows the pending-request line only when I hold the pen with a queued request", () => {
    // I hold the pen and a partner has requested it → line shows.
    currentCollab = collab({
      iHavePen: true,
      pen: {
        status: "active",
        holder: "Me",
        idleSec: 0,
        staleSec: null,
        requestedBy: [{ name: "Ada", requestedAt: "" }],
      } as CollabHook["pen"],
    });
    render(<CollabStatusPill {...props} variant="badge" />);
    fireEvent.click(screen.getByLabelText("Collaborator options"));
    expect(screen.getByText(/Pending request: Ada/)).toBeTruthy();
  });

  it("hides the pending-request line when I do NOT hold the pen", () => {
    currentCollab = collab({
      iHavePen: false,
      pen: {
        status: "active",
        holder: "Ada",
        idleSec: 0,
        staleSec: null,
        requestedBy: [{ name: "Me", requestedAt: "" }],
      } as CollabHook["pen"],
    });
    render(<CollabStatusPill {...props} variant="badge" />);
    fireEvent.click(screen.getByLabelText("Collaborator options"));
    expect(screen.queryByText(/Pending request/)).toBeNull();
  });

  it("renders NO menu affordance in the icon variant (pure toggle)", () => {
    render(<CollabStatusPill {...props} variant="icon" />);
    expect(screen.queryByLabelText("Collaborator options")).toBeNull();
  });
});
