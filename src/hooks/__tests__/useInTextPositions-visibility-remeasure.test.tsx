// @vitest-environment jsdom
//
// Regression guard for the KEEP-ALIVE RE-SHOW re-measure path in
// `useInTextPositions` (MEMO_KEEPALIVE_BUILD.md §2 F2 + MEMO_CARD_GUTTER_STACKING.md).
//
// THE BUG CLASS: the L2/L3 keep-alive subsystem hides the doc editor with
// `display:none` and re-shows it WITHOUT remounting. While hidden, a card
// measured by `useInTextPositions` reads `coordsAtPos`/`getBoundingClientRect`
// as zero rects (the `display:none` signature) — so if the deck were measured
// while hidden, or if NOTHING re-measured on re-show, the Omni margin cards
// could stay stale / piled at the top after a tab-switch back.
//
// THE FIX (by construction, not a separate visibility trigger): visibility is
// folded into `enabled` (`enabled = enabledProp && isVisible`), and `enabled`
// is a dep of BOTH the `measure` callback and the measurement `useLayoutEffect`.
// So:
//   - hidden  (isVisible=false ⇒ enabled=false): the effect's `!enabled` branch
//     bails and clears — NO measurement runs (hidden editor stays INERT, the
//     keystroke-sanctity invariant).
//   - re-show (isVisible=true  ⇒ enabled=true): `measure` is re-created and the
//     whole effect RE-RUNS, re-arming the settle loop and re-measuring against
//     the now-laid-out editor.
//
// These pins lock that lifecycle. The observable proxy for "measurement ran
// against the DOM" is a spy on `editor.view.coordsAtPos` — `measure()` calls it
// once per item, and bails BEFORE reaching it when not enabled. A plain
// re-render that does NOT change visibility must NOT re-fire measurement (no
// keystroke-path / steady-state churn).
//
// (LIVE-FSA OWED: jsdom can't lay out, so the real hidden→show layout settle —
// fonts/KaTeX/expex reflow that corrects the deck's pixel tops — is not
// exercised here; only the re-FIRE of measurement is. The pixel correction must
// still be feel-checked in a real browser against the L2 paper↔Library bounce.)

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
    texBlockIsPoppedRef: { current: undefined },
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

/** Mounts the hook with its `panelScrollRef` attached to a real DOM node and a
 *  rendered card so `measure()` reaches `coordsAtPos` (it bails early if the
 *  pod ref isn't attached). `bumpRef` lets a test force a plain re-render that
 *  changes NOTHING about visibility or items. */
function Harness({
  editor,
  items,
  bump,
}: {
  editor: Editor;
  items: PositionItem[];
  bump: number;
}) {
  const { panelScrollRef } = useInTextPositions(
    editor,
    items,
    true,
    "data-omni-entry-wrapper",
  );
  // `bump` is read so a re-render with a new bump is a genuine React re-render.
  return React.createElement(
    "div",
    { ref: panelScrollRef, "data-bump": bump },
    React.createElement(
      "div",
      { "data-omni-entry-wrapper": "a" },
      "card a",
    ),
    React.createElement(
      "div",
      { "data-omni-entry-wrapper": "b" },
      "card b",
    ),
  );
}

describe("useInTextPositions — keep-alive re-show re-measures", () => {
  it("re-runs measurement on hidden→visible, stays inert while hidden, and does not re-fire on a plain re-render", () => {
    const editor = mountDoc();
    const items: PositionItem[] = [
      { id: "a", pos: 1 },
      { id: "b", pos: 5 },
    ];
    const coordsSpy = vi.spyOn(editor.view, "coordsAtPos");

    let visible = true;
    let bump = 0;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <Harness editor={editor} items={items} bump={bump} />
      </KeepAliveVisibilityProvider>
    );

    const r = render(<Tree />);

    // (1) Initial VISIBLE mount measures: one coordsAtPos per item.
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    // (2) A plain re-render with NO visibility/items change must NOT re-fire
    //     measurement — nothing on the keystroke/steady-state path.
    coordsSpy.mockClear();
    act(() => {
      bump = 1;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBe(0);

    // (3) HIDE (keep-alive display:none): the measurement effect bails before
    //     any DOM read — the hidden editor is INERT (keystroke sanctity).
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

    // (4) RE-SHOW (display:none→show, no remount): measurement RE-FIRES against
    //     the now-laid-out editor. This is the keep-alive re-show fix.
    coordsSpy.mockClear();
    act(() => {
      visible = true;
      r.rerender(<Tree />);
    });
    expect(coordsSpy.mock.calls.length).toBeGreaterThan(0);

    r.unmount();
    editor.destroy();
  });
});
