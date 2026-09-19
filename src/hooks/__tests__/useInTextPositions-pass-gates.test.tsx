// @vitest-environment jsdom
//
// Task 656 — the measure-pass contracts this hook asserts in prose, PINNED.
//
// THE FINDING. Neither half below was a user-visible defect on the day it was
// filed. What was defective is that three emphatic comments and the law doc
// described behaviour the code did not have, on the keystroke-adjacent path,
// with ZERO test cover — which is precisely how a real regression lands here
// unnoticed:
//
//  (A) `isTypingInPanel` was said to be "read by EVERY pass". It was read by
//      one of the two entry points that can run a pass. The companion one-shot
//      (an items/resolvePos rebuild) asked `canMeasureNow()` alone, so a
//      card-body edit — which mints a fresh `items` identity every 250 ms
//      through the RichTextField debounce — got one ungated synchronous pass
//      per flush. A repo-wide grep over `*.test.ts{,x}` returned zero
//      references to `isTypingInPanel`: the gate a load-bearing comment calls
//      the fix for task 370's "the typed card jumps" report was held by
//      nothing at all.
//
//  (B) the per-card ResizeObserver effect stated its purpose narrowly — "Dep on
//      `measureVersion` so we re-observe whenever cards mount/unmount" — and
//      then keyed on a value that bumps on ANY committed geometry change. A
//      wrap-changing document keystroke therefore paid `disconnect()` + a
//      pod-wide `querySelectorAll` + an O(deck) `observe()` over an item set
//      that had not changed.
//
// THE FIX, and what these legs hold. (A) is answered by `passGate` — ONE
// statement of the policy, asked by both entry points, where the one-shot's
// typing exemption is DECLARED and argued rather than being an omission
// readable only by diffing two hand-written gate lists. (B) is answered by
// keying the observer effect on `observedIdsKey`, the identity of the set the
// pod actually renders a wrapper for.
//
// Leg A1 fails if the chain stops asking the typing gate. Leg A2 fails if
// someone "completes" the fix by gating the one-shot too (which would leave a
// card the user just created with no position — and so no wrapper — until
// blur). Leg A3 is the census: it fails if a third hand-written gate list
// appears. Leg B1 fails on the pre-fix key.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";

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

function mountDoc(paragraphs: number): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Array.from({ length: paragraphs }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `P${i}` },
        content: [{ type: "text", text: `Paragraph number ${i}.` }],
      })),
    },
  });
}

function makeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 800,
    width: 800,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const VIEW_BOTTOM = 800;
function mountRowScroll(): HTMLElement {
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_BOTTOM,
    configurable: true,
  });
  const el = document.createElement("div");
  el.setAttribute("data-virgil-row-scroll", "");
  el.getBoundingClientRect = () => makeRect(0, VIEW_BOTTOM);
  Object.defineProperty(el, "offsetParent", { value: document.body });
  document.body.appendChild(el);
  return el;
}

/** Spaced far enough apart that no card is ever pushed off its natural top, so
 *  a published position IS the measured natural. */
const CARD_H = 60;
const SCALE = 3;

/** jsdom ships no ResizeObserver. This one delivers nothing (leg B1 counts
 *  BINDINGS, not deliveries) but counts every construction and `observe`, which
 *  is exactly the per-rebuild cost the old key was paying. */
let roBuilds = 0;
let roObserves = 0;
let roDisconnects = 0;
class CountingResizeObserver {
  constructor() {
    roBuilds += 1;
  }
  observe(): void {
    roObserves += 1;
  }
  unobserve(): void {}
  disconnect(): void {
    roDisconnects += 1;
  }
}
beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = CountingResizeObserver;
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

type HookOut = ReturnType<typeof useInTextPositions>;

const CE_ID = "card-body-ce";

function Harness({
  editor,
  items,
  sinkRef,
  podRef,
}: {
  editor: Editor;
  items: PositionItem[];
  sinkRef: { current: HookOut | null };
  podRef: { current: HTMLDivElement | null };
}) {
  const out = useInTextPositions(editor, items, true, "data-omni-entry-wrapper");
  React.useLayoutEffect(() => {
    sinkRef.current = out;
  });
  return React.createElement(
    "div",
    {
      ref: (el: HTMLDivElement | null) => {
        podRef.current = el;
        out.panelScrollRef.current = el;
      },
    },
    // The pod's live card body — the thing `isTypingInPanel` looks for.
    // `tabIndex` because jsdom's focusability check is not driven by
    // `contenteditable`; the ATTRIBUTE is what the gate reads.
    React.createElement("div", {
      key: CE_ID,
      id: CE_ID,
      contentEditable: true,
      suppressContentEditableWarning: true,
      tabIndex: 0,
    }),
    // Exactly the consumer's rule: a wrapper exists only where a position does
    // (`OmniViewPanel`: `if (top === undefined) return null`). Leg B1's whole
    // point is that the observer effect's key must track THIS set.
    items
      .filter((it) => out.positions.get(it.id) !== undefined)
      .map((it) =>
        React.createElement(
          "div",
          {
            key: it.id,
            "data-omni-entry-wrapper": it.id,
            ref: (el: HTMLElement | null) => {
              if (el) el.getBoundingClientRect = () => makeRect(0, CARD_H);
            },
          },
          `card ${it.id}`,
        ),
      ),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  roBuilds = roObserves = roDisconnects = 0;
});

const ITEMS: PositionItem[] = [
  { id: "c0", pos: 30 },
  { id: "c1", pos: 150 },
  { id: "c2", pos: 260 },
];

function setup() {
  vi.useFakeTimers();
  mountRowScroll();
  const editor = mountDoc(200);
  const docSize = editor.state.doc.content.size;

  // The one thing the scenario moves. Every top is `pos * SCALE + shift`.
  let shift = 0;

  const editorDom = editor.view.dom as HTMLElement;
  const CONTENT_H = docSize * SCALE;
  editorDom.getBoundingClientRect = () => makeRect(0, CONTENT_H);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => CONTENT_H,
    configurable: true,
  });

  const coordsSpy = vi
    .spyOn(editor.view, "coordsAtPos")
    .mockImplementation((pos: number) => {
      const top = pos * SCALE + shift;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.round(Math.max(0, Math.min(docSize, (top - shift) / SCALE))),
      inside: -1,
    }),
  );

  const sinkRef: { current: HookOut | null } = { current: null };
  const podRef: { current: HTMLDivElement | null } = { current: null };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness editor={editor} items={ITEMS} sinkRef={sinkRef} podRef={podRef} />
    </KeepAliveVisibilityProvider>,
  );

  const idle = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  return {
    editor,
    sinkRef,
    podRef,
    coordsSpy,
    setShift: (v: number) => {
      shift = v;
    },
    tops: () => ITEMS.map((it) => sinkRef.current?.positions.get(it.id) ?? null),
    idle,
    /** Type into the pod's card body, the way production does: focus lands on a
     *  `contenteditable` INSIDE the pod. No document transaction — a card-body
     *  edit dispatches none, which is the whole reason the gate is about focus
     *  rather than about the editor. */
    focusCardBody: async () => {
      await act(async () => {
        (document.getElementById(CE_ID) as HTMLElement).focus();
      });
    },
    blurCardBody: async () => {
      await act(async () => {
        (document.getElementById(CE_ID) as HTMLElement).blur();
        podRef.current?.dispatchEvent(new Event("focusout", { bubbles: false }));
      });
    },
    /** A REAL chain trigger — the window-resize path, which goes through the
     *  gesture park into the one convergence door like every other. */
    fireChainTrigger: async () => {
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
      });
    },
    rerender: (items: PositionItem[]) =>
      view.rerender(
        <KeepAliveVisibilityProvider isVisible={true}>
          <Harness editor={editor} items={items} sinkRef={sinkRef} podRef={podRef} />
        </KeepAliveVisibilityProvider>,
      ),
    unmount: () => {
      view.unmount();
      editor.destroy();
    },
  };
}

describe("useInTextPositions — the measure-pass gates are read, not asserted (task 656)", () => {
  it("A1 · a CHAIN trigger during card typing commits nothing, and blur snaps it to truth", async () => {
    const s = setup();
    await s.idle(1500);
    const settled = s.tops();
    expect(settled.every((t) => t !== null)).toBe(true);

    // The user is now typing into a card body in this pod.
    await s.focusCardBody();

    // The document geometry moves under them and a real chain trigger fires.
    // `isTypingInPanel` must hold this: a speculative pass that re-positions
    // every card mid-keystroke is the "typed card jumps / reads as carriage
    // return" report task 370 was filed for.
    s.setShift(120);
    const beforeReads = s.coordsSpy.mock.calls.length;
    await s.fireChainTrigger();
    await s.idle(1500);

    expect(s.coordsSpy.mock.calls.length).toBe(beforeReads);
    expect(s.tops()).toEqual(settled);

    // On blur the focusout handler re-arms the SAME door, so the deck settles
    // to the truth it was holding back — the gate is a `deferred`, never an
    // `inert`, and this is the half that says the held pass is not lost.
    await s.blurCardBody();
    await s.idle(1500);
    const after = s.tops();
    expect(after.every((t) => t !== null)).toBe(true);
    after.forEach((top, i) => {
      expect(top! - settled[i]!).toBeGreaterThan(100);
    });

    s.unmount();
  });

  it("A2 · an ITEMS REBUILD during card typing still measures — the exemption, on purpose", async () => {
    // The other half of the policy, and the reason `passGate` takes an entry
    // point rather than returning one boolean. A rebuild is not speculation:
    // a card was added, and until a pass commits it has no position, so the
    // consumer renders NO WRAPPER for it. Gating this on typing would leave a
    // card the user just created invisible until they clicked away.
    const s = setup();
    await s.idle(1500);
    await s.focusCardBody();

    const withNew = [...ITEMS, { id: "c3", pos: 400 }];
    await act(async () => {
      s.rerender(withNew);
    });

    // Synchronously, in the rebuild's own commit — not a frame later, and not
    // after blur.
    expect(s.sinkRef.current?.positions.get("c3")).toBeGreaterThan(0);

    s.unmount();
  });

  it("A3 · the typing gate has exactly ONE consumer — the policy door", async () => {
    // The census, and the leg with the teeth. A1 can only speak for the path it
    // drives; what caused the finding was a SECOND hand-written gate list, and
    // nothing behavioural can see one of those being added. So: outside its own
    // declaration, `isTypingInPanel` may be read in exactly one place.
    const raw = fs.readFileSync(
      path.resolve(__dirname, "../useInTextPositions.ts"),
      "utf8",
    );
    // `codeOnlyLines` blanks comments AND string literals while PRESERVING the
    // line structure, so it is the right thing to ask "is this line code?" and
    // the wrong thing to read a literal out of. Select by the stripped line,
    // report the raw one.
    const rawLines = raw.split("\n");
    const codeLines = codeOnlyLines(raw).split("\n");
    const callSites = codeLines
      .map((text, i) => ({ code: text.trim(), raw: rawLines[i].trim() }))
      .filter((l) => /\bisTypingInPanel\s*\(/.test(l.code))
      .filter((l) => !/const isTypingInPanel = useCallback/.test(l.code));
    expect(callSites.map((l) => l.raw)).toEqual([
      'if (via === "chain" && isTypingInPanel()) return "typing";',
    ]);

    // …and both entry points reach a pass through that door. A bare
    // `canMeasureNow()` branch beside a `measure()` call is how this started.
    const askLines = codeLines
      .map((text, i) => ({ code: text, raw: rawLines[i] }))
      .filter((l) => /\bpassGate\s*\(/.test(l.code));
    expect(askLines.length).toBe(2); // the chain and the rebuild, and nothing else
    const asked = askLines.map((l) => l.raw).join("\n");
    expect(asked).toContain('passGate("chain")');
    expect(asked).toContain('passGate("rebuild")');
  });

  it("B1 · a committed geometry change with an UNCHANGED item set rebinds no observer", async () => {
    const s = setup();
    await s.idle(1500);
    const settled = s.tops();
    expect(settled.every((t) => t !== null)).toBe(true);

    // Non-vacuity: the effect really did bind the deck, so "it did not rebind"
    // below is a statement about a live observer rather than about an effect
    // that never ran.
    expect(roBuilds).toBeGreaterThanOrEqual(1);
    expect(roObserves).toBeGreaterThanOrEqual(ITEMS.length);
    const builds = roBuilds;
    const observes = roObserves;
    const disconnects = roDisconnects;

    // The wrap-changing keystroke, in miniature: every top moves, the item set
    // does not. The pass MUST commit (that is what makes the leg a real
    // measurement of the key, not of an inert hook) …
    s.setShift(200);
    await s.fireChainTrigger();
    await s.idle(1500);
    const moved = s.tops();
    moved.forEach((top, i) => {
      expect(top! - settled[i]!).toBeGreaterThan(100);
    });

    // … and the observer must not have been torn down and rebuilt for it.
    // Pre-fix the effect was keyed on `measureVersion`, which this commit
    // bumps, so all three counters move here.
    expect(roBuilds).toBe(builds);
    expect(roObserves).toBe(observes);
    expect(roDisconnects).toBe(disconnects);

    s.unmount();
  });

  it("B1b · a card ARRIVING still rebinds — the stated purpose, kept", async () => {
    // The control. Narrowing the key must not cost the effect the one job its
    // comment claims: a wrapper that mounts has to be observed, or a card that
    // grows after mount never moves the deck again.
    const s = setup();
    await s.idle(1500);
    const builds = roBuilds;

    await act(async () => {
      s.rerender([...ITEMS, { id: "c3", pos: 400 }]);
    });
    await s.idle(1500);

    expect(s.sinkRef.current?.positions.get("c3")).toBeGreaterThan(0);
    expect(roBuilds).toBeGreaterThan(builds);

    s.unmount();
  });
});
