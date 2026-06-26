// @vitest-environment jsdom
//
// Keep-alive visibility gate for FloatingPanel (MEMO_INSTANT_SWITCH.md follow-up
// — the multi-doc "stacked outline" bug).
//
// THE BUG: with multi-doc keep-alive, N doc panes stay mounted (only the active
// one is display:flex; the rest display:none). Docked FloatingPanels portal to a
// GLOBAL `[data-dock-slot]` anchor resolved via a document-wide querySelector, so
// every warm pane's docked panel collapsed onto the active pane's slot and
// stacked (the user saw one OUTLINE panel per open paper).
//
// THE FIX: FloatingPanel — the single portal-escape chokepoint for every docked
// panel, popped-out card, and float — gates on `useIsVisible()`. A FloatingPanel
// inside a HIDDEN keep-alive pane renders nothing (no portal escape), extending
// the "hidden panes are fully inert" invariant from the measurement hooks to the
// panel/float layer. Default `true` (no provider) ⇒ app-level dialogs/floats
// outside any keep-alive pane are unaffected.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

afterEach(() => {
  cleanup();
});

function Float() {
  return (
    <FloatingPanel
      cardKey="note:n1"
      mode="floating"
      surface="card"
      initialX={100}
      initialY={100}
      initialWidth={300}
      initialHeight={200}
      zIndex={1000}
      onChange={vi.fn()}
    >
      <div data-testid="body">float body</div>
    </FloatingPanel>
  );
}

const shellCount = () =>
  document.querySelectorAll('[data-floating-panel="true"]').length;

describe("FloatingPanel — keep-alive visibility gate", () => {
  it("renders with no provider (default visible — app-level dialogs unaffected)", () => {
    render(<Float />);
    expect(shellCount()).toBe(1);
  });

  it("renders when the keep-alive pane is visible", () => {
    render(
      <KeepAliveVisibilityProvider isVisible={true}>
        <Float />
      </KeepAliveVisibilityProvider>,
    );
    expect(shellCount()).toBe(1);
  });

  it("renders NOTHING when the keep-alive pane is hidden (no portal escape, no stacking)", () => {
    render(
      <KeepAliveVisibilityProvider isVisible={false}>
        <Float />
      </KeepAliveVisibilityProvider>,
    );
    expect(shellCount()).toBe(0);
  });

  it("two hidden panes + one visible pane ⇒ exactly ONE shell (the stacking-bug regression)", () => {
    render(
      <>
        <KeepAliveVisibilityProvider isVisible={false}>
          <Float />
        </KeepAliveVisibilityProvider>
        <KeepAliveVisibilityProvider isVisible={true}>
          <Float />
        </KeepAliveVisibilityProvider>
        <KeepAliveVisibilityProvider isVisible={false}>
          <Float />
        </KeepAliveVisibilityProvider>
      </>,
    );
    // Pre-fix: 3 shells (all panes render + portal). Post-fix: only the visible one.
    expect(shellCount()).toBe(1);
  });
});
