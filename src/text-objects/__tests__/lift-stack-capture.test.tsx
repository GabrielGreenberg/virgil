// @vitest-environment jsdom
//
// Task 456 — **the content lift's Stack terminal**, driven through the REAL
// `beginLift` gesture.
//
// Gabriel: "Dropping items on the stack is still not working. It darkens on
// mouse over, but when you let go, the text dragged just pops out (as if you
// were dragging to anywhere else outside the page)."
//
// The Stack had three capture producers in design and two in code. The float
// drag (`FloatingPanel` → `virgil-stack-drop`) was fixed and capability-gated
// by task 332; the HTML5 `MIME_TEXT_INSERT` drop lives on the icon itself; and
// the CONTENT LIFT — dragging a paragraph / heading / list item / selection
// straight out of the document — had no stack terminal at all. `onUp` had
// exactly two: `commitDropSession()` (a doc move) and `popOutAtRect(...)` (a
// float). It never asked `isOverStackIcon`, and `onMove` never lit the ring.
//
// It DARKENED anyway, which is the false-affordance half: the lift overlay is
// `pointer-events: none` (the content-drag click-through law), so the button
// underneath received `mouseenter` and painted its ordinary hover background.
// The hover OFFERED and the commit REFUSED — the exact class tasks 258/321/332
// closed on the other gestures, surviving here because the offer was an
// accident of plain hover styling rather than a deliberate ring.
//
// **No pre-456 suite could see any of this.** `stack-capture-affordance`
// drives the REAL `FloatingPanel` gesture and is blind to the lift by
// construction; every lift suite in the repo (`lift-overlay-motion-cost`,
// `grab-handle-*`) drives a gesture with no icon rect published at all, where
// `isOverStackIcon` is false everywhere and the terminal is unrepresentable.
//
// jsdom defaults `buttons` to 0 and `isMissedRelease` ends the gesture on a
// move without the primary button held, so every LIVE move here passes
// `buttons: 1` explicitly — the trap the task-333 and task-439 suites record.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import type { Editor } from "@tiptap/react";

// The float-body/header chrome pulls panel-primitives → `@/lib/storage`, whose
// backend pick is a raw require the vitest resolver can't follow (the known
// barrel gotcha). Nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

// The session machinery (hit-test, indicator, LayoutGestureBus edges) is not
// what this suite measures — but WHICH of the three terminals ran is, so these
// stay observable.
const beginDropSession = vi.fn();
const commitDropSession = vi.fn(async () => undefined);
const cancelDropSession = vi.fn();
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (a: unknown) => beginDropSession(a),
  commitDropSession: () => commitDropSession(),
  cancelDropSession: () => cancelDropSession(),
}));

// The transient-anchor strip: the one thing a `linkedRange` capture owes that
// a paragraph capture does not.
const removeTransientAnchor = vi.fn();
vi.mock("@/links/links", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  removeTransientAnchor: (editor: unknown, id: string) =>
    removeTransientAnchor(editor, id),
}));

// The doc range behind a `linkedAnchor` mark — the ONE thing the real
// `linkedRange` registry hooks resolve through. Mocking it (rather than the
// hooks) keeps `renderGhost` / `liftSourceRect` REAL.
const linkedDocRange = { current: null as { from: number; to: number } | null };
vi.mock("@/lib/linked-anchor-range", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  findLinkedAnchorRange: () => linkedDocRange.current,
}));

// The anchor resolve is O(1) through the `data-uuid` decoration in production;
// here it hands back a real element with the kind attr `resolveAnchorDom`
// validates.
const anchorDom = { current: null as HTMLElement | null };
vi.mock("@/lib/marginalia-blocks", () => ({
  resolveDomForUuid: () => anchorDom.current,
}));

// The geometry service's viewport frame. `containsContentZone` decides
// ghost-vs-popout; each leg sets the predicate it needs.
const inContentZone = { current: (_x: number, _y: number) => false };
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({
    frameRef: {
      current: {
        containsContentZone: (x: number, y: number) => inContentZone.current(x, y),
      },
    },
    version: 0,
  }),
}));

import { LiftHost, useLiftHost, type LiftHostApi } from "@/text-objects/LiftHost";
import {
  setStackIconRect,
  setStackDropTarget,
  getStackDropTarget,
} from "@/lib/stack/stack-drop-target";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { StackIcon } from "@/components/stack/StackIcon";
import {
  beginContentGesture,
  endContentGesture,
} from "@/lib/pane-resize/layout-gesture-bus";

// The icon is bottom-left-anchored; these are the coords its own component
// publishes (a 56px circle inset 12px from the viewport's left/bottom, at the
// 768px jsdom viewport height).
const ICON = { left: 12, top: 700, right: 68, bottom: 756 };
const ON_ICON = { x: 40, y: 728 };
/** Inside the icon's bounding BOX but outside its circle — `isOverStackIcon`
 *  does a radius test after the box reject, and hover≡commit means BOTH halves
 *  must agree here, not just the cheap one. */
const ICON_BOX_CORNER = { x: ICON.left + 2, y: ICON.top + 2 };
const AWAY = { x: 500, y: 300 };
const ORIGIN = { x: 300, y: 400 };

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  cancelDropSession.mockClear();
  removeTransientAnchor.mockClear();
  linkedDocRange.current = null;
  inContentZone.current = () => false;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafQueue = [];
  });
  setStackIconRect(ICON);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  anchorDom.current = null;
  setStackIconRect(null);
  setStackDropTarget(false);
  vi.unstubAllGlobals();
});

const move = (x: number, y: number, buttons = 1) =>
  act(() => {
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: y, buttons, bubbles: true }),
    );
  });

const up = (x: number, y: number) =>
  act(async () => {
    window.dispatchEvent(
      new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true }),
    );
    await Promise.resolve();
  });

interface Harness {
  capture: ReturnType<typeof vi.fn>;
  popOutAtRect: ReturnType<typeof vi.fn>;
  overlayMounted: () => boolean;
}

/** Mount the host and begin a REAL lift. `kind` selects the paragraph
 *  (element) path or the `linkedRange` (mark-over-a-range) path — the two the
 *  task names — and `capture` is the shared stack terminal's REPORT. */
function beginLift(opts: {
  kind?: "paragraph" | "linkedRange";
  capture?: ((key: string) => boolean) | null;
  terminalPolicy?: "grab" | "float";
} = {}): Harness {
  const kind = opts.kind ?? "paragraph";
  const capture = vi.fn(opts.capture ?? (() => true));
  const popOutAtRect = vi.fn();

  const editorDom = document.createElement("div");
  document.body.appendChild(editorDom);

  const source = document.createElement("div");
  source.setAttribute("data-text-object-kind", kind);
  source.innerHTML = "<p>lifted body</p>";
  source.getBoundingClientRect = () =>
    ({ left: 280, top: 380, width: 420, height: 90 }) as DOMRect;
  document.body.appendChild(source);
  anchorDom.current = kind === "paragraph" ? source : null;

  if (kind === "linkedRange") {
    // The real `renderGhost` / `liftSourceRect` hooks run: they resolve the
    // doc range (mocked above), map it through `view.domAtPos`, build a DOM
    // Range, clone its contents and union its client rects. jsdom returns no
    // client rects, so the union is stubbed at the Range prototype.
    linkedDocRange.current = { from: 1, to: 5 };
    const rect = { left: 280, top: 380, right: 700, bottom: 470, width: 420, height: 90 };
    // jsdom's `Range` implements no layout at all — `getClientRects` is not
    // even defined on the prototype — so the union has to be supplied.
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      writable: true,
      value: () =>
        ({
          length: 1,
          0: rect as DOMRect,
          item: () => rect as DOMRect,
          [Symbol.iterator]: function* () {
            yield rect as DOMRect;
          },
        }) as unknown as DOMRectList,
    });
  }

  const textNode = source.firstChild!.firstChild!;
  const editor = {
    view: {
      dom: editorDom,
      domAtPos: () => ({ node: textNode, offset: 0 }),
      nodeDOM: () => null,
    },
    state: {
      doc: {
        // `blockStyleElement` walks from `$pos.depth` down to 1; depth 0 means
        // the loop never runs and it falls back to the editor root. `index(0)`
        // feeds the multi-block test in `renderGhost`.
        resolve: () => ({ depth: 0, index: () => 0, before: () => 0 }),
        descendants: () => undefined,
      },
    },
  } as unknown as Editor;

  let api: LiftHostApi | null = null;
  function Probe() {
    const host = useLiftHost();
    useEffect(() => {
      api = host;
    }, [host]);
    return null;
  }

  const poppedValue = {
    poppedKeys: [],
    isPopped: () => false,
    toggle: () => undefined,
    toggleAtAnchor: () => undefined,
    popOutAtRect,
    close: () => undefined,
    getFloatPosition: () => undefined,
    setFloatPosition: () => undefined,
  } as unknown as PoppedCardsValue;

  const editorRef = { current: editor };
  render(
    <PoppedCardsContext.Provider value={poppedValue}>
      <LiftHost
        editorRef={editorRef}
        onCaptureToStack={opts.capture === null ? undefined : capture}
      >
        <Probe />
      </LiftHost>
    </PoppedCardsContext.Provider>,
  );

  act(() => {
    api?.beginLift({
      ref: { kind, id: "u1" },
      cardKey: `float:textobject:${kind}:u1`,
      origin: ORIGIN,
      terminalPolicy: opts.terminalPolicy ?? "grab",
    });
  });

  return {
    capture,
    popOutAtRect,
    overlayMounted: () =>
      document.querySelector(".lifted-text-overlay") !== null,
  };
}

describe("the content lift has a Stack terminal (task 456)", () => {
  it("a paragraph lift released on the icon CAPTURES, and spawns no popout", async () => {
    const h = beginLift();
    expect(h.overlayMounted(), "the lift ghost mounted").toBe(true);

    move(ON_ICON.x, ON_ICON.y);
    await up(ON_ICON.x, ON_ICON.y);

    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.capture).toHaveBeenCalledWith("float:textobject:paragraph:u1");
    // The document is untouched: a capture is a COPY, so no doc move commits…
    expect(commitDropSession).not.toHaveBeenCalled();
    // …and the session that was opened at threshold cross is cancelled.
    expect(cancelDropSession).toHaveBeenCalled();
    // The reported symptom, pinned: no float pops out.
    expect(h.popOutAtRect).not.toHaveBeenCalled();
    expect(h.overlayMounted(), "the gesture tore down").toBe(false);
  });

  it("CONTROL — released away from the icon it still pops out, exactly as before", async () => {
    const h = beginLift();
    move(AWAY.x, AWAY.y);
    await up(AWAY.x, AWAY.y);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.popOutAtRect).toHaveBeenCalledTimes(1);
    expect(cancelDropSession).toHaveBeenCalled();
  });

  it("CONTROL — released over CONTENT it still commits the doc move", async () => {
    inContentZone.current = () => true;
    const h = beginLift();
    move(AWAY.x, AWAY.y);
    await up(AWAY.x, AWAY.y);

    expect(h.capture).not.toHaveBeenCalled();
    expect(h.popOutAtRect).not.toHaveBeenCalled();
    expect(commitDropSession).toHaveBeenCalledTimes(1);
  });

  it("a `linkedRange` selection lift captures AND strips its transient anchor", async () => {
    const h = beginLift({ kind: "linkedRange" });
    expect(h.overlayMounted(), "the range ghost mounted").toBe(true);

    move(ON_ICON.x, ON_ICON.y);
    await up(ON_ICON.x, ON_ICON.y);

    expect(h.capture).toHaveBeenCalledWith("float:textobject:linkedRange:u1");
    expect(h.popOutAtRect).not.toHaveBeenCalled();
    // The transient (cardless, invisible) mark minted for a plain selection
    // grab has no further job once the capture read it — the same guarded call
    // the move and popout terminals make.
    expect(removeTransientAnchor).toHaveBeenCalledTimes(1);
    expect(removeTransientAnchor.mock.calls[0][1]).toBe("u1");
  });
});

describe("the ring is the OFFER, and it offers exactly what the release accepts", () => {
  it("lights over the icon, clears on leave, and clears on release", async () => {
    beginLift();
    expect(getStackDropTarget()).toBe(false);

    move(ON_ICON.x, ON_ICON.y);
    expect(getStackDropTarget(), "the ring lights over the icon").toBe(true);

    move(AWAY.x, AWAY.y);
    expect(getStackDropTarget(), "and clears on leave").toBe(false);

    move(ON_ICON.x, ON_ICON.y);
    await up(ON_ICON.x, ON_ICON.y);
    expect(getStackDropTarget(), "and never survives the gesture").toBe(false);
  });

  it("the ONE end path clears it — a swallowed mouseup cannot leave it lit", () => {
    const h = beginLift();
    move(ON_ICON.x, ON_ICON.y);
    expect(getStackDropTarget()).toBe(true);

    // The missed-release bail: a move with the primary button no longer held
    // means the mouseup was swallowed. It returns without reaching `onUp`, so
    // a ring cleared per-terminal would stay lit with no gesture left to
    // accept it.
    move(ON_ICON.x + 1, ON_ICON.y + 1, 0);
    expect(getStackDropTarget()).toBe(false);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.overlayMounted()).toBe(false);
  });

  it("hover ≡ commit at the icon's CIRCLE, not merely its box", async () => {
    const h = beginLift();
    move(ICON_BOX_CORNER.x, ICON_BOX_CORNER.y);
    expect(getStackDropTarget(), "the corner of the box is not the circle").toBe(false);

    await up(ICON_BOX_CORNER.x, ICON_BOX_CORNER.y);
    expect(h.capture, "and the release refuses exactly where the ring was dark")
      .not.toHaveBeenCalled();
    expect(h.popOutAtRect).toHaveBeenCalledTimes(1);
  });

  it("no terminal wired → no ring and no capture (the optional-prop contract)", async () => {
    const h = beginLift({ capture: null });
    move(ON_ICON.x, ON_ICON.y);
    expect(getStackDropTarget()).toBe(false);

    await up(ON_ICON.x, ON_ICON.y);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.popOutAtRect).toHaveBeenCalledTimes(1);
  });

  it("a `float`-policy lift offers no Stack terminal (its float's HEADER is the one)", async () => {
    const h = beginLift({ terminalPolicy: "float" });
    move(ON_ICON.x, ON_ICON.y);
    expect(getStackDropTarget()).toBe(false);

    await up(ON_ICON.x, ON_ICON.y);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.popOutAtRect).not.toHaveBeenCalled();
    expect(commitDropSession).toHaveBeenCalledTimes(1);
  });
});

describe("THE REPORT IS THE PERMISSION", () => {
  it("a refused capture falls through to the popout rather than eating the gesture", async () => {
    const h = beginLift({ capture: () => false });
    move(ON_ICON.x, ON_ICON.y);
    await up(ON_ICON.x, ON_ICON.y);

    expect(h.capture).toHaveBeenCalledTimes(1);
    // Nothing landed on the Stack, so the user is left holding what they
    // grabbed — the rule task 332 earned on the float path.
    expect(h.popOutAtRect).toHaveBeenCalledTimes(1);
    expect(h.overlayMounted()).toBe(false);
  });
});

describe("the icon's own chrome speaks once, and truly (task 456)", () => {
  /** The rendered fill of the portaled button. */
  function mountIcon() {
    render(
      <StackIcon
        open={false}
        onToggle={() => undefined}
        mainEditor={null}
        source={{ docId: "d1" }}
        bibCtx={{ getBibEntry: () => undefined, getAnnotation: () => undefined }}
      />,
    );
    const btn = document.querySelector<HTMLElement>('[data-stack-icon-hit="true"]');
    if (!btn) throw new Error("the stack icon did not mount");
    return btn;
  }

  it("hovering darkens it at rest, and says NOTHING during a content drag", () => {
    const btn = mountIcon();
    const rest = btn.style.background;

    act(() => {
      btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    const hovered = btn.style.background;
    expect(hovered, "at rest, hover reads as an ordinary hover").not.toBe(rest);

    // The lift overlay is `pointer-events: none`, so the button keeps
    // receiving `mouseenter` through a drag. Its plain darken then reads as a
    // drop affordance — which for every payload the Stack cannot take is an
    // offer nothing accepts. During a content drag the ONLY signal is the real
    // ring.
    act(() => {
      beginContentGesture("test-drag");
    });
    expect(btn.style.background, "mid-drag the darken stops speaking").toBe(rest);

    // …and the ring still does.
    act(() => {
      setStackDropTarget(true);
    });
    expect(btn.style.background).not.toBe(rest);

    act(() => {
      setStackDropTarget(false);
      endContentGesture();
    });
    expect(btn.style.background, "the darken returns when the drag ends").toBe(hovered);
  });
});
