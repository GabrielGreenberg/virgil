// @vitest-environment jsdom
//
// Task 598 — a listener mounted once per pane answers only while its pane is
// the SHOWN one. Two-pane fixture, hidden pane FIRST (the DOM order
// `EditorLayout` renders the keep-alive block in), both panes' cards in the
// document the way `display:none` leaves them.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import {
  KeepAliveVisibilityProvider,
  usePaneScopedListener,
} from "@/lib/keep-alive/visibility-context";
import {
  usePristineCardManager,
  type PristineCardManager,
} from "@/hooks/usePristineCardManager";
import { usePanelCardHoverBridge } from "@/links/_shared/usePanelCardHoverBridge";

afterEach(cleanup);

// jsdom ships no `CSS.escape`; the ids here need no escaping.
if (typeof globalThis.CSS === "undefined") {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

function PristinePane({
  paneId,
  onManager,
  onDiscard,
}: {
  paneId: string;
  onManager: (m: PristineCardManager) => void;
  onDiscard: (id: string) => void;
}) {
  const manager = usePristineCardManager();
  useEffect(() => {
    onManager(manager);
    return manager.forKind("notes").registerDiscard(onDiscard);
  }, [manager, onManager, onDiscard]);
  return (
    <div data-testid={`pane-${paneId}`}>
      <div data-pristine-card-kind="note" data-pristine-card-id={`card-${paneId}`}>
        blank card
      </div>
      <p data-testid={`prose-${paneId}`}>prose</p>
    </div>
  );
}

function Slot({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div style={{ display: visible ? "block" : "none" }}>
      <KeepAliveVisibilityProvider isVisible={visible}>{children}</KeepAliveVisibilityProvider>
    </div>
  );
}

function mountPristinePanes(visibleB: boolean) {
  const managers: Record<string, PristineCardManager> = {};
  const discarded: string[] = [];
  const onDiscard = (id: string) => discarded.push(id);
  const tree = (bVisible: boolean) => (
    <>
      <Slot visible={bVisible}>
        <PristinePane paneId="B" onManager={(m) => (managers.B = m)} onDiscard={onDiscard} />
      </Slot>
      <Slot visible={!bVisible}>
        <PristinePane paneId="A" onManager={(m) => (managers.A = m)} onDiscard={onDiscard} />
      </Slot>
    </>
  );
  const utils = render(tree(visibleB));
  managers.A.forKind("notes").markNew("card-A");
  managers.B.forKind("notes").markNew("card-B");
  return { ...utils, managers, discarded, rerenderWith: (b: boolean) => utils.rerender(tree(b)) };
}

describe("pristine discard is pane-scoped", () => {
  it("a blank card in a HIDDEN pane survives a click in the visible pane", async () => {
    const { getByTestId, discarded } = mountPristinePanes(false);
    act(() => {
      getByTestId("prose-A").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    expect(discarded).not.toContain("card-B");
  });

  it("a blank card in the VISIBLE pane is still discarded on click-away", async () => {
    const { getByTestId, discarded } = mountPristinePanes(false);
    act(() => {
      getByTestId("prose-A").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    expect(discarded).toEqual(["card-A"]);
  });

  it("the gate follows a visibility flip WITHOUT a remount (the ref, not the render value)", async () => {
    const { getByTestId, discarded, rerenderWith } = mountPristinePanes(false);
    // Switch to B with no pointerdown (a keyboard switch), then click in B.
    rerenderWith(true);
    act(() => {
      getByTestId("prose-B").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    // B is now shown: its own blank card goes; A's (now hidden) survives.
    expect(discarded).toEqual(["card-B"]);
  });
});

describe("panel hover bridge is pane-scoped", () => {
  function HoverPane({ id, onHover }: { id: string; onHover: (id: string | null) => void }) {
    usePanelCardHoverBridge((entity) => onHover(entity));
    return (
      <div data-card-key={`float:card:note:${id}`} data-testid={`card-${id}`}>
        card
      </div>
    );
  }

  it("does not call setHover from a hidden pane", () => {
    const hiddenHover = vi.fn();
    const visibleHover = vi.fn();
    const { getAllByTestId } = render(
      <>
        <Slot visible={false}>
          <HoverPane id="n1" onHover={hiddenHover} />
        </Slot>
        <Slot visible>
          <HoverPane id="n1" onHover={visibleHover} />
        </Slot>
      </>,
    );
    // The visible copy is the second in DOM order.
    const visibleCard = getAllByTestId("card-n1")[1];
    act(() => {
      visibleCard.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(visibleHover).toHaveBeenCalledWith("n1");
    expect(hiddenHover).not.toHaveBeenCalled();
  });
});

describe("usePaneScopedListener", () => {
  function Listener({ onKey, enabled }: { onKey: () => void; enabled?: boolean }) {
    usePaneScopedListener("window", "keydown", onKey, { enabled });
    return null;
  }

  it("answers only in the shown pane, and `enabled:false` removes the listener", () => {
    const hidden = vi.fn();
    const shown = vi.fn();
    const off = vi.fn();
    render(
      <>
        <Slot visible={false}>
          <Listener onKey={hidden} />
        </Slot>
        <Slot visible>
          <Listener onKey={shown} />
          <Listener onKey={off} enabled={false} />
        </Slot>
      </>,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(shown).toHaveBeenCalledTimes(1);
    expect(hidden).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
  });

  it("outside any provider (legacy mount) behaves as always-visible", () => {
    const fn = vi.fn();
    render(<Listener onKey={fn} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
