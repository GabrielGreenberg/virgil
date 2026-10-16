// @vitest-environment jsdom
//
// Task 1147 — a pane's pointer-derived state ends when the pane is hidden.
// A kept-alive pane flipped to display:none under a resting pointer gets no
// mouseleave, so a card hovered at a paper switch stayed lit forever.
// `usePaneHideReset` is the door; EditorPane routes the card hover through it.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  KeepAliveVisibilityProvider,
  usePaneHideReset,
} from "@/lib/keep-alive/visibility-context";
import { createCardStore, type CardStore } from "@/links/_shared/anchored-card-store";

afterEach(cleanup);

function Pane({ store }: { store: CardStore }) {
  usePaneHideReset(() => store.setHover(null));
  return null;
}

function Harness({ visible, store }: { visible: boolean; store: CardStore }) {
  return (
    <KeepAliveVisibilityProvider isVisible={visible}>
      <Pane store={store} />
    </KeepAliveVisibilityProvider>
  );
}

describe("usePaneHideReset", () => {
  it("clears the hover on the visible→hidden edge, and it stays clear on return", () => {
    const store = createCardStore();
    const { rerender } = render(<Harness visible store={store} />);
    store.setHoverFor({ kind: "note", id: "a" }, true);
    rerender(<Harness visible store={store} />);
    expect(store.getState().hover).toEqual({ kind: "note", id: "a" });

    rerender(<Harness visible={false} store={store} />);
    expect(store.getState().hover).toBeNull();

    rerender(<Harness visible store={store} />);
    expect(store.getState().hover).toBeNull();
  });

  it("does not fire on show — a hover taken while visible survives re-renders", () => {
    let resets = 0;
    function Counting({ visible }: { visible: boolean }) {
      return (
        <KeepAliveVisibilityProvider isVisible={visible}>
          <Counter />
        </KeepAliveVisibilityProvider>
      );
    }
    function Counter() {
      usePaneHideReset(() => resets++);
      return null;
    }
    const { rerender } = render(<Counting visible={false} />);
    expect(resets).toBe(1); // mounted hidden: nothing of ours can be hovered
    rerender(<Counting visible />);
    rerender(<Counting visible />);
    expect(resets).toBe(1);
    rerender(<Counting visible={false} />);
    expect(resets).toBe(2);
  });

  it("clears on unmount (a cold-evicted or closed pane gets no mouseleave either)", () => {
    const store = createCardStore();
    const { unmount } = render(<Harness visible store={store} />);
    store.setHoverFor({ kind: "todo", id: "b" }, true);
    unmount();
    expect(store.getState().hover).toBeNull();
  });
});

describe("wiring — EditorPane ends its hover authority on hide", () => {
  it("routes the authority's null leg through usePaneHideReset", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../components/EditorPane.tsx"),
      "utf8",
    );
    expect(src).toMatch(/usePaneHideReset\(\(\)\s*=>\s*_setHoveredEntity\(null,\s*null\)\)/);
  });
});
