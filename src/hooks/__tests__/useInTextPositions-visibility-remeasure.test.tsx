// @vitest-environment jsdom
//
// Regression guard for the KEEP-ALIVE RE-SHOW path in `useInTextPositions`
// (MEMO_INSTANT_SWITCH.md §4 — the "instant warm switch" fix).
//
// THE INVARIANT: "hidden is frozen, not torn down; re-show is a REPUBLISH of
// cached geometry, not a re-measure — unless something provably changed while
// hidden." The L2/L3 keep-alive subsystem hides the doc editor with
// `display:none` and re-shows it WITHOUT remounting. While hidden, a card
// measured by `useInTextPositions` would read `coordsAtPos`/`getBoundingClientRect`
// as zero rects (the `display:none` signature).
//
// THE FIX (this is what these pins lock — note step 4 INVERTS the prior guard):
//   - hidden:        measurement BAILS before any DOM read AND the cached
//                    `naturalRef` is RETAINED (not cleared). Inert.
//   - CLEAN re-show: NO re-measure — the cached deck is still correct (doc
//                    unchanged, pod-relative tops are scroll-invariant). ZERO
//                    `coordsAtPos`. (Previously this re-fired a full measure; the
//                    whole point of the fix is that it no longer does.)
//   - DIRTY re-show: a structural change while hidden (or a width change) opts
//                    back into ONE bounded re-measure (deferred), so cards that
//                    shifted while hidden land correctly.
//   - disabled:      `enabledProp=false` still CLEARS (genuinely-off panel).
//
// The observable proxy for "measurement ran against the DOM" is a spy on
// `editor.view.coordsAtPos` — `measure()` calls it once per item and bails BEFORE
// reaching it when hidden / clean. (jsdom lays nothing out, so the returned
// `positions` map is empty regardless — the spy is the only faithful signal; the
// pixel correction is feel-checked in a real browser against the L2 bounce.)
//
// The CLEAR-vs-RETAIN distinction is observed indirectly: a HIDDEN→shown editor
// does NOT re-measure (retained cache ⇒ clean re-show ⇒ 0 coords), whereas a
// DISABLED→re-enabled editor DOES (cleared cache ⇒ cold re-measure ⇒ >0 coords).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import { render, act } from "@testing-library/react";
import React from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useInTextPositions, type PositionItem } from "@/hooks/useInTextPositions";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "First paragraph." }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: "Second paragraph." }] },
      ],
    },
  });
}

/** Capture the hook's live return so tests can assert on positions retention. */
type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  bump,
  enabledProp = true,
  sink,
}: {
  editor: Editor;
  items: PositionItem[];
  bump: number;
  enabledProp?: boolean;
  sink: { current: HookOut | null };
}) {
  const out = useInTextPositions(
    editor,
    items,
    enabledProp,
    "data-omni-entry-wrapper",
  );
  sink.current = out;
  return React.createElement(
    "div",
    { ref: out.panelScrollRef, "data-bump": bump },
    React.createElement("div", { "data-omni-entry-wrapper": "a" }, "card a"),
    React.createElement("div", { "data-omni-entry-wrapper": "b" }, "card b"),
  );
}

/** Flush the requestLowPriority deferral (double-rAF / setTimeout fallback). */
async function flushDeferred() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
}

describe("useInTextPositions — keep-alive re-show is a republish, not a re-measure", () => {
  it("stays inert + retains cache while hidden; CLEAN re-show does NOT re-measure; DIRTY re-show does", async () => {
    const editor = mountDoc();
    const items: PositionItem[] = [
      { id: "a", pos: 1 },
      { id: "b", pos: 5 },
    ];
    // jsdom lays nothing out, so real coordsAtPos throws (→ every item skipped →
    // naturalRef never populates → the retain/dirty logic can't be exercised).
    // Mock a valid rect so naturalRef populates; the spy still counts each call
    // (the observable proxy for "a measure pass ran against the DOM").
    const coordsSpy = vi
      .spyOn(editor.view, "coordsAtPos")
      .mockImplementation((pos: number) => ({
        top: 10 + pos,
        bottom: 22 + pos,
        left: 0,
        right: 0,
      }));
    const sink: { current: HookOut | null } = { current: null };

    let visible = true;
    let bump = 0;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <Harness editor={editor} items={items} bump={bump} sink={sink} />
      </KeepAliveVisibilityProvider>
    );

    const r = render(<Tree />);
    void sink; // retained for symmetry; positions are empty under jsdom

    // (1) Initial VISIBLE mount measures: one coordsAtPos per item. Drain the
    //     cold-mount settle rAF so it can't bleed into a later step's flush.
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);
    await flushDeferred();

    // (2) A plain re-render with NO visibility/items change must NOT re-fire.
    coordsSpy.mockClear();
    act(() => {
      bump = 1;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0);

    // (3) HIDE: the measurement bails before any DOM read (inert) AND the cached
    //     positions are RETAINED (not cleared) — the deck survives the hide.
    coordsSpy.mockClear();
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0);

    // A plain re-render WHILE HIDDEN also does nothing.
    act(() => {
      bump = 2;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0);

    // (4) CLEAN RE-SHOW (no structural/width change while hidden): the cached deck
    //     is still correct, so NO re-measure fires. THIS IS THE FIX — it INVERTS
    //     the old guard (which asserted a re-measure here). Assert synchronously
    //     AND after a flush: the clean path neither measures now nor schedules a
    //     deferred one.
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0); // no synchronous re-measure
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBe(0); // and none deferred

    // (5) DIRTY RE-SHOW: a structural change while hidden marks the hook dirty, so
    //     the next re-show runs ONE bounded (deferred) re-measure.
    // Hide again.
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    // Structural change while hidden → onBlocksAdded → dirty flag set.
    act(() => {
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
          attrs: { uuid: "P0" },
          content: [{ type: "text", text: "Inserted while hidden." }],
        })
        .run();
    });
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    r.unmount();
    editor.destroy();
  });

  it("a DIRTY verdict survives a re-show whose deferred converge is cancelled by a quick re-hide (task 1125)", async () => {
    // The dirty flag is a "needs re-measure" fact: it may be cleared only by the
    // pass that honours it, never by the SCHEDULING of that pass. Pre-1125 the
    // re-show effect cleared it at flip time and deferred the converge; a re-hide
    // before the deferral ran cancelled the converge (effect cleanup) and the
    // verdict was gone — the next re-show took the CLEAN branch and republished
    // stale anchor Ys.
    const editor = mountDoc();
    const items: PositionItem[] = [
      { id: "a", pos: 1 },
      { id: "b", pos: 5 },
    ];
    const coordsSpy = vi
      .spyOn(editor.view, "coordsAtPos")
      .mockImplementation((pos: number) => ({
        top: 10 + pos,
        bottom: 22 + pos,
        left: 0,
        right: 0,
      }));
    const sink: { current: HookOut | null } = { current: null };

    let visible = true;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <Harness editor={editor} items={items} bump={0} sink={sink} />
      </KeepAliveVisibilityProvider>
    );
    const r = render(<Tree />);
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0); // cache populated
    await flushDeferred();

    // Hide, then a structural change while hidden → dirty.
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    act(() => {
      editor
        .chain()
        .insertContentAt(editor.state.doc.content.size, {
          type: "paragraph",
          attrs: { uuid: "P0" },
          content: [{ type: "text", text: "Inserted while hidden." }],
        })
        .run();
    });

    // Flick: show, then hide again BEFORE the low-priority converge flushes.
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBe(0); // the converge was cancelled

    // Return with NO further edits and the same width: the verdict must still
    // stand, so the re-show converges and re-measures.
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    r.unmount();
    editor.destroy();
  });

  it("a width change consumed by a REJECTED (degenerate) pass still reads dirty on the next re-show (task 1627)", async () => {
    // The width baseline (`lastWidthRef`) is a per-pass fact like every other:
    // it moves only in measure()'s ONE commit block. Pre-1627 it moved at the
    // TOP of measure(), so a pass that then rejected itself as degenerate had
    // already consumed the width change — the next re-show compared the live
    // width against the advanced baseline, read CLEAN, and republished tops
    // taken at the OLD width (and the next visible pass was a carry pass).
    const editor = mountDoc();
    const items: PositionItem[] = [
      { id: "a", pos: 1 },
      { id: "b", pos: 5 },
    ];
    // jsdom reports clientWidth 0, which the dirty gate treats as "no
    // baseline"; drive a real width so the gate is live.
    let width = 500;
    Object.defineProperty(editor.view.dom, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    // Good layout vs. the un-laid-out fingerprint: every distinct anchor
    // strongly above the pod (jsdom's pod rect top is 0).
    let degenerate = false;
    const coordsSpy = vi
      .spyOn(editor.view, "coordsAtPos")
      .mockImplementation((pos: number) => {
        const top = degenerate ? -1000 + pos : 10 + pos;
        return { top, bottom: top + 12, left: 0, right: 0 };
      });
    const sink: { current: HookOut | null } = { current: null };

    let visible = true;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <Harness editor={editor} items={items} bump={0} sink={sink} />
      </KeepAliveVisibilityProvider>
    );
    const r = render(<Tree />);
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0); // good cache at width 500
    await flushDeferred();

    // Hide; the window resizes while hidden.
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    width = 600;

    // Re-show while layout is still settling: the width change reads DIRTY,
    // the converge runs — and every pass it takes is degenerate, so each one
    // REJECTS itself and commits nothing.
    degenerate = true;
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0); // the rejected pass(es) ran

    // Hide again before any pass committed; layout then finishes.
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    degenerate = false;

    // Return at the same (new) width with no edits: the cached deck is still
    // the width-500 one, so the re-show must take the DIRTY branch and
    // re-measure. Pre-fix the rejected pass had advanced the baseline to 600
    // and this read CLEAN — zero coordsAtPos.
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    // And once a pass COMMITS at the new width, the baseline has moved: a
    // further hide→re-show at that width is CLEAN again.
    act(() => {
      visible = false;
      r.rerender(<Tree />);
    });
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    await flushDeferred();
    expect(coordsSpy.mock.calls.length).toBe(0);

    r.unmount();
    editor.destroy();
  });

  it("genuinely-disabled (enabledProp=false) clears + re-enable re-measures (distinct from hidden retention)", () => {
    const editor = mountDoc();
    const items: PositionItem[] = [
      { id: "a", pos: 1 },
      { id: "b", pos: 5 },
    ];
    const coordsSpy = vi.spyOn(editor.view, "coordsAtPos");
    const sink: { current: HookOut | null } = { current: null };

    let enabledProp = true;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={true}>
        <Harness editor={editor} items={items} bump={0} enabledProp={enabledProp} sink={sink} />
      </KeepAliveVisibilityProvider>
    );
    const r = render(<Tree />);
    void sink;
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0); // measured on mount

    // Disable: bail, no measure.
    coordsSpy.mockClear();
    act(() => {
      enabledProp = false;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0);

    // Re-enable: the wiring effect (keyed on enabledProp) re-runs and re-measures
    // the cleared cache cold — UNLIKE a hidden→shown re-show, which is a no-op.
    coordsSpy.mockClear();
    act(() => {
      enabledProp = true;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    r.unmount();
    editor.destroy();
  });
});
