// @vitest-environment jsdom
//
// Task 1150 — no hover claim outlives the element that made it.
//
// Browsers fire no `mouseleave` when the hovered element is REMOVED, so a
// claimant that released only on `mouseleave` left the doc's hover slot naming
// a card whose marker/card had unmounted under the pointer (a "+K" crowd
// popover closing on a marker click; a card collapsing into a group). The
// claim door, `useHoverClaim`, releases its OWN claim on unmount / ref change —
// and only its own. The census half lives in `hover-clear-door.test.ts`.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MarkerButton } from "@/components/Marginalia";
import type { MarginaliaMarker } from "@/lib/marginalia";
import {
  CardStoreProvider,
  createCardStore,
  useHoverClaim,
  type AnchoredCardRef,
  type CardStore,
} from "../anchored-card-store";

afterEach(cleanup);

function marker(entityId: string): MarginaliaMarker {
  return {
    id: `${entityId}:p1`,
    textObjectId: "p1",
    type: "note",
    entityKind: "note",
    entityId,
  } as MarginaliaMarker;
}

/** A card-root stand-in: the shell spreads `setHovering` as `onHoverChange`. */
function CardRoot({ cardRef, label }: { cardRef: AnchoredCardRef; label: string }) {
  const { setHovering } = useHoverClaim(cardRef);
  return (
    <div
      data-testid={label}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    />
  );
}

function withStore(store: CardStore, children: React.ReactNode) {
  return <CardStoreProvider store={store}>{children}</CardStoreProvider>;
}

describe("useHoverClaim — a claim is released when its element unmounts", () => {
  it("MarkerButton: mouseenter, then unmount under the pointer → hover is null", () => {
    const store = createCardStore();
    const { rerender } = render(
      withStore(store, <MarkerButton m={marker("a")} dragEnabled={false} />),
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(store.getState().hover).toEqual({ kind: "note", id: "a" });
    rerender(withStore(store, null));
    expect(store.getState().hover).toBeNull();
  });

  it("card root: mouseenter, then unmount → hover is null", () => {
    const store = createCardStore();
    const ref = { kind: "note", id: "a" } as AnchoredCardRef;
    const { rerender } = render(withStore(store, <CardRoot cardRef={ref} label="a" />));
    fireEvent.mouseEnter(screen.getByTestId("a"));
    expect(store.getState().hover).toEqual(ref);
    rerender(withStore(store, null));
    expect(store.getState().hover).toBeNull();
  });

  it("A hovered, then B hovered, then A unmounts → hover stays B", () => {
    const store = createCardStore();
    const a = { kind: "note", id: "a" } as AnchoredCardRef;
    const b = { kind: "note", id: "b" } as AnchoredCardRef;
    const { rerender } = render(
      withStore(store, <><CardRoot cardRef={a} label="a" /><CardRoot cardRef={b} label="b" /></>),
    );
    // No mouseleave on A — the ordering a portal or a removal produces.
    fireEvent.mouseEnter(screen.getByTestId("a"));
    fireEvent.mouseEnter(screen.getByTestId("b"));
    rerender(withStore(store, <>{null}<CardRoot cardRef={b} label="b" /></>));
    expect(store.getState().hover).toEqual(b);
  });

  it("releases only its OWN claim: an unhovered sibling surface of the same ref unmounts silently", () => {
    const store = createCardStore();
    const a = { kind: "note", id: "a" } as AnchoredCardRef;
    const { rerender } = render(
      withStore(store, <><MarkerButton m={marker("a")} dragEnabled={false} /><CardRoot cardRef={a} label="card" /></>),
    );
    // The marker holds the claim; the card for the same ref never claimed.
    fireEvent.mouseEnter(screen.getByRole("button"));
    rerender(withStore(store, <><MarkerButton m={marker("a")} dragEnabled={false} />{null}</>));
    expect(store.getState().hover).toEqual(a);
  });

  it("a slot lit by the AUTHORITY (text bridge) is not cleared by an unclaimed card's unmount", () => {
    const store = createCardStore();
    const a = { kind: "note", id: "a" } as AnchoredCardRef;
    const { rerender } = render(withStore(store, <CardRoot cardRef={a} label="a" />));
    store.setHover(a);
    rerender(withStore(store, null));
    expect(store.getState().hover).toEqual(a);
  });

  it("a mouseleave already released the claim — unmount afterwards is silent", () => {
    const store = createCardStore();
    const a = { kind: "note", id: "a" } as AnchoredCardRef;
    const { rerender } = render(withStore(store, <CardRoot cardRef={a} label="a" />));
    fireEvent.mouseEnter(screen.getByTestId("a"));
    fireEvent.mouseLeave(screen.getByTestId("a"));
    store.setHover(a); // re-lit by the text bridge afterwards
    rerender(withStore(store, null));
    expect(store.getState().hover).toEqual(a);
  });

  it("a ref CHANGE releases the old identity's claim", () => {
    const store = createCardStore();
    const a = { kind: "note", id: "a" } as AnchoredCardRef;
    const b = { kind: "note", id: "b" } as AnchoredCardRef;
    const { rerender } = render(withStore(store, <CardRoot cardRef={a} label="x" />));
    fireEvent.mouseEnter(screen.getByTestId("x"));
    rerender(withStore(store, <CardRoot cardRef={b} label="x" />));
    expect(store.getState().hover).toBeNull();
  });
});
