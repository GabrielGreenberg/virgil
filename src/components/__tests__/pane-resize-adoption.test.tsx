// @vitest-environment jsdom
//
// Editor-side pane-resize adoption (library-UI refactor P5): the editor's
// dividers — the panel↔editor gutter (PanelColumn), the stacked-band divider
// (BandDivider), the code splitter (SplitWithCode), the main-editor split
// (SplitEditorPanes), and the zen margins (ZenMargin) — run on the shared
// gesture engine (src/lib/pane-resize) with the discipline the old useDragGap
// family violated:
//
//   - live geometry is IMPERATIVE (a flex/style write per RAF frame, or the
//     one justified local-state exception in SplitWithCode) — never a
//     viewPrefs/store round-trip per mousemove;
//   - persistence commits EXACTLY once, on release (spied via
//     Storage.prototype.setItem: zero writes during synthetic moves);
//   - Escape ends without committing and re-syncs the DOM from the source
//     of truth;
//   - a zero-move gesture (plain click) commits nothing — the old 3px
//     deadzone's contract, now enforced at the commit edge. For the
//     ratio-valued dividers the guard compares the engine px against the
//     exact getValue() snapshot: a ratio round-trip ((r·track)/track) is
//     not IEEE-exact for ~10% of stored (ratio, track) pairs, so the
//     awkward-pair cases below FAIL on ratio-equality guards;
//   - gesture-edge side effects (syncBeforeDrag / isResizing) ride the
//     pane-drag bus, and EditorScrollbar suppresses its thumb on the same
//     bus (the retired virgil:drag-gap-start/end window events' consumer).

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
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
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));
// SplitEditorPanes mounts a second ProseMirror view — irrelevant to gesture
// mechanics; stub it.
vi.mock("@/components/EditorMirror", () => ({
  default: () => <div data-testid="mirror" />,
}));

// Controllable ResizeObserver stub — SplitWithCode's container-width RO is
// fired by hand so the mid-drag live-layout assertion has a real width.
type RoCallback = (entries: { contentRect: { width: number } }[]) => void;
const roInstances: { cb: RoCallback; targets: Element[] }[] = [];
class ResizeObserverStub {
  cb: RoCallback;
  targets: Element[] = [];
  constructor(cb: RoCallback) {
    this.cb = cb;
    roInstances.push(this);
  }
  observe(t: Element) {
    this.targets.push(t);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

import { useRef, useState } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { PanelColumn } from "@/components/editor-layout/panel-column";
import { BandDivider } from "@/components/panel-primitives";
import { SplitWithCode } from "@/components/editor-layout/split-with-code";
import { SplitEditorPanes } from "@/components/editor-layout/split-editor-panes";
import { ZenMargin } from "@/components/editor-layout/zen-margin";
import { EditorScrollbar } from "@/components/editor-layout/editor-scrollbar";
import { MIN_BAND_PX, type PanelId } from "@/hooks/useViewPrefs";
import {
  beginPaneDrag,
  endPaneDrag,
  isPaneDragging,
  __resetPaneDragBusForTest,
} from "@/lib/pane-resize/pane-drag-bus";
import {
  isDragShieldMounted,
  unmountDragShield,
} from "@/lib/pane-resize/drag-shield";

// ── jsdom shims (repo testing convention: pointer capture + deterministic RAF) ──

beforeAll(() => {
  Object.assign(Element.prototype, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  });
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).setPointerCapture;
  delete (Element.prototype as Partial<Element>).releasePointerCapture;
});

let rafSeq = 0;
let rafCallbacks = new Map<number, FrameRequestCallback>();
const flushRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafCallbacks = new Map();
  roInstances.length = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCallbacks.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks.delete(id);
  });
  __resetPaneDragBusForTest();
  unmountDragShield();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Gesture helpers ─────────────────────────────────────────────────────────

const down = (el: Element, clientX = 100, clientY = 100) =>
  fireEvent.pointerDown(el, {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    clientX,
    clientY,
  });
const pe = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
const move = (el: Element, clientX: number, clientY = 100) =>
  act(() => {
    el.dispatchEvent(pe("pointermove", { buttons: 1, clientX, clientY }));
    flushRaf();
  });
const up = (el: Element) =>
  act(() => {
    el.dispatchEvent(pe("pointerup", { buttons: 0 }));
  });
const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

const stubRect = (el: Element, rect: Partial<DOMRect>) => {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
      width: 0, height: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
};

// ── PanelColumn panel↔editor gutter ─────────────────────────────────────────

function renderPanelColumn() {
  const onPanelPrefChange = vi.fn((w: number) => {
    // Simulate the real consumer's persistence tail (viewPrefs → storage) so
    // the setItem spy measures persist CADENCE, not just the spy wiring.
    localStorage.setItem("test-panel-pref", String(w));
  });
  const onResizingChange = vi.fn();
  const onSyncBeforeDrag = vi.fn();
  const utils = render(
    <PanelColumn
      side="left"
      panelPref={300}
      onPanelPrefChange={onPanelPrefChange}
      onResizingChange={onResizingChange}
      onSyncBeforeDrag={onSyncBeforeDrag}
      omni={<div data-testid="omni" />}
      stack={[]}
      onTradeHeight={vi.fn()}
      onResizeBottomEdge={vi.fn()}
      onFocusBand={vi.fn()}
    />,
  );
  const col = utils.container.querySelector('[data-flex-col="left"]')!;
  stubRect(col, { width: 300 });
  const handle = utils.container.querySelector(
    '[data-pane-resize-id^="editor-panel-left"]',
  )!;
  return { ...utils, col: col as HTMLElement, handle, onPanelPrefChange, onResizingChange, onSyncBeforeDrag };
}

describe("PanelColumn gutter on the pane-resize engine", () => {
  it("tracks the drag with imperative flex writes, persists EXACTLY once on release, and never touches storage mid-move", () => {
    const h = renderPanelColumn();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    down(h.handle, 100);
    // Begin-edge side effects fired once, on the bus edge.
    expect(h.onSyncBeforeDrag).toHaveBeenCalledTimes(1);
    expect(h.onResizingChange).toHaveBeenCalledExactlyOnceWith(true);

    move(h.handle, 150);
    expect(h.col.style.flex).toBe("0 0 350px");
    move(h.handle, 180);
    expect(h.col.style.flex).toBe("0 0 380px");
    // Zero React/persist traffic during the gesture.
    expect(h.onPanelPrefChange).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    up(h.handle);
    expect(h.onPanelPrefChange).toHaveBeenCalledExactlyOnceWith(380);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(h.onResizingChange).toHaveBeenLastCalledWith(false);
    expect(h.onResizingChange).toHaveBeenCalledTimes(2);
  });

  it("Escape restores the source-of-truth width and commits nothing", () => {
    const h = renderPanelColumn();
    down(h.handle, 100);
    move(h.handle, 220);
    expect(h.col.style.flex).toBe("0 0 420px");

    escape();
    // restore() rewrites from the panelPref prop (the store value), not the
    // measured px — the Reader-safe re-sync.
    expect(h.col.style.flex).toBe("0 0 300px");
    expect(h.onPanelPrefChange).not.toHaveBeenCalled();
    // End edge still runs the isResizing teardown.
    expect(h.onResizingChange).toHaveBeenLastCalledWith(false);
  });

  it("a plain click (zero-move gesture) never writes prefs — the old deadzone contract at the commit edge", () => {
    const h = renderPanelColumn();
    down(h.handle, 100);
    up(h.handle);
    expect(h.onPanelPrefChange).not.toHaveBeenCalled();
  });

  it("ignores a foreign gesture's bus edges (instance-scoped id filter)", () => {
    const h = renderPanelColumn();
    act(() => {
      beginPaneDrag({ id: "library-nav", axis: "x" });
    });
    act(() => {
      endPaneDrag({ id: "library-nav", axis: "x" });
    });
    expect(h.onSyncBeforeDrag).not.toHaveBeenCalled();
    expect(h.onResizingChange).not.toHaveBeenCalled();
  });
});

// ── BandDivider (stacked-band boundary) ─────────────────────────────────────

function renderBandDivider() {
  const onTradeHeight = vi.fn();
  const Harness = () => {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <div ref={ref}>
        <div
          data-dock-slot="left:0"
          data-panel-id="notes"
          style={{ flex: "0 1 auto" }}
        />
        <div
          data-dock-slot="left:1"
          data-panel-id="todos"
          style={{ flex: "0 0 100px" }}
        />
        <BandDivider
          side="left"
          aboveId={"notes" as PanelId}
          belowId={"todos" as PanelId}
          onTradeHeight={onTradeHeight}
          containerRef={ref}
        />
      </div>
    );
  };
  const utils = render(<Harness />);
  const above = utils.container.querySelector<HTMLElement>('[data-panel-id="notes"]')!;
  const below = utils.container.querySelector<HTMLElement>('[data-panel-id="todos"]')!;
  // Sum 550 leaves real play above MIN_BAND_PX (140) on both sides.
  stubRect(above, { height: 300 });
  stubRect(below, { height: 250 });
  const handle = utils.container.querySelector(
    '[data-pane-resize-id^="band-divider-left"]',
  )!;
  return { ...utils, above, below, handle, onTradeHeight };
}

describe("BandDivider on the pane-resize engine", () => {
  it("trades the conserved sum imperatively per frame and commits ONE onTradeHeight on release", () => {
    const h = renderBandDivider();
    down(h.handle, 100, 100);
    move(h.handle, 100, 130); // +30px downward → above grows
    expect(h.above.style.flex).toBe("0 0 330px");
    expect(h.below.style.flex).toBe("0 0 220px");
    expect(h.onTradeHeight).not.toHaveBeenCalled();

    up(h.handle);
    expect(h.onTradeHeight).toHaveBeenCalledExactlyOnceWith("notes", 330, "todos", 220);
  });

  it("clamps the boundary so neither band drops below MIN_BAND_PX", () => {
    const h = renderBandDivider();
    down(h.handle, 100, 100);
    move(h.handle, 100, -1000);
    expect(h.above.style.flex).toBe(`0 0 ${MIN_BAND_PX}px`);
    expect(h.below.style.flex).toBe(`0 0 ${550 - MIN_BAND_PX}px`);
  });

  it("a plain click restores the rendered flex strings (a content-sized band is never pinned to pixels)", () => {
    const h = renderBandDivider();
    down(h.handle, 100, 100);
    up(h.handle);
    expect(h.onTradeHeight).not.toHaveBeenCalled();
    expect(h.above.style.flex).toBe("0 1 auto");
    expect(h.below.style.flex).toBe("0 0 100px");
  });

  it("Escape restores both bands' start flex and commits nothing", () => {
    const h = renderBandDivider();
    down(h.handle, 100, 100);
    move(h.handle, 100, 140);
    expect(h.above.style.flex).toBe("0 0 340px");
    escape();
    expect(h.above.style.flex).toBe("0 1 auto");
    expect(h.below.style.flex).toBe("0 0 100px");
    expect(h.onTradeHeight).not.toHaveBeenCalled();
  });
});

// ── SplitWithCode (code splitter) ───────────────────────────────────────────

describe("SplitWithCode on the pane-resize engine", () => {
  function renderSplit(ratio = 0.5) {
    const onRatioChange = vi.fn((r: number) => {
      localStorage.setItem("test-code-ratio", String(r));
    });
    const utils = render(
      <SplitWithCode
        open
        ratio={ratio}
        onRatioChange={onRatioChange}
        left={<div data-testid="left" />}
        right={<div data-testid="right" />}
      />,
    );
    const container = utils.container.firstElementChild!;
    stubRect(container, { width: 808, left: 0 });
    // Feed the container-width RO by hand (contentRect 808) so clipPx math
    // has a live width: track = 808 - 8 = 800.
    act(() => {
      for (const ro of roInstances) {
        if (ro.targets.includes(container)) {
          ro.cb([{ contentRect: { width: 808 } }]);
        }
      }
    });
    const handle = utils.container.querySelector('[data-pane-resize-id="code-split"]')!;
    const wrapper = utils.container.querySelector<HTMLElement>(
      "[data-virgil-codesplit-editor]",
    )!;
    return { ...utils, handle, wrapper, onRatioChange };
  }

  it("keeps the split LIVE through local state mid-drag (the justified exception) but persists the ratio EXACTLY once on release", () => {
    const h = renderSplit();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(h.wrapper.style.width).toBe("400px"); // 0.5 × 800

    down(h.handle, 404);
    move(h.handle, 484); // +80px → ratio 0.6
    // The live layout DID move (compressed/clip decisions depend on it)…
    expect(h.wrapper.style.width).toBe("480px");
    // …but nothing persisted mid-drag.
    expect(h.onRatioChange).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    up(h.handle);
    expect(h.onRatioChange).toHaveBeenCalledExactlyOnceWith(0.6);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("Escape drops the live ratio back to the stored prop and commits nothing", () => {
    const h = renderSplit();
    down(h.handle, 404);
    move(h.handle, 484);
    expect(h.wrapper.style.width).toBe("480px");
    escape();
    expect(h.wrapper.style.width).toBe("400px");
    expect(h.onRatioChange).not.toHaveBeenCalled();
  });

  it("a plain click commits nothing even at a stored ratio whose px round-trip is float-inexact", () => {
    // (0.18781541441960967 × 800) / 800 !== 0.18781541441960967 — a ratio-
    // equality guard fires a spurious pref write (and an EditorLayout-wide
    // re-render) on ~10% of persisted (ratio, width) pairs; the exact-px
    // guard cannot.
    const h = renderSplit(0.18781541441960967);
    down(h.handle, 404);
    up(h.handle);
    expect(h.onRatioChange).not.toHaveBeenCalled();
  });

  it("closing the code pane mid-drag (the handle's conditional branch unmounts) never wedges the shield or bus", () => {
    // The handle lives in the `{open && …}` branch while SplitWithCode stays
    // permanently mounted — flipping `open` mid-gesture removes the CAPTURED
    // element, which per Pointer Events fires lostpointercapture at the
    // DOCUMENT (jsdom doesn't implement implicit release — dispatch it). The
    // engine's removal failsafes must end the gesture: shield down, bus
    // ended, the last live value committed exactly once (missed-release
    // semantics), so the pane-drag machinery can't wedge app input.
    const h = renderSplit();
    down(h.handle, 404);
    move(h.handle, 484);
    expect(isPaneDragging()).toBe(true);
    expect(isDragShieldMounted()).toBe(true);

    h.rerender(
      <SplitWithCode
        open={false}
        ratio={0.5}
        onRatioChange={h.onRatioChange}
        left={<div data-testid="left" />}
        right={<div data-testid="right" />}
      />,
    );
    expect(document.contains(h.handle)).toBe(false);
    act(() => {
      document.dispatchEvent(pe("lostpointercapture", {}));
    });

    expect(isPaneDragging()).toBe(false);
    expect(isDragShieldMounted()).toBe(false);
    expect(h.onRatioChange).toHaveBeenCalledExactlyOnceWith(0.6);
  });
});

// ── SplitEditorPanes (main-editor split) ────────────────────────────────────

describe("SplitEditorPanes on the pane-resize engine", () => {
  // jsdom's CSS parser rejects the unitless-basis `flex: r 1 0` shorthand
  // (browsers accept it) and silently drops the write, so the parsed CSSOM
  // reads back "". Record writes through a shadowing accessor instead —
  // both React's style commit and the component's imperative writes assign
  // `el.style.flex` directly, so the recorder sees every write.
  const trackFlex = (el: HTMLElement) => {
    let last = "";
    Object.defineProperty(el.style, "flex", {
      configurable: true,
      get: () => last,
      set: (v: string) => {
        last = String(v);
      },
    });
    return () => last;
  };

  function renderEditorSplit(ratio: number) {
    const onRatioChange = vi.fn();
    const utils = render(
      <SplitEditorPanes
        editorInstance={null}
        canonical={<div data-testid="canonical" />}
        ratio={ratio}
        onRatioChange={onRatioChange}
        onClose={vi.fn()}
        sectionPath={[]}
        mirrorSectionPath={[]}
      />,
    );
    const container = utils.container.firstElementChild!;
    stubRect(container, { height: 700 });
    const top = utils.container.querySelector<HTMLElement>('[data-editor-pane="top"]')!;
    const bottom = utils.container.querySelector<HTMLElement>('[data-editor-pane="bottom"]')!;
    const handle = utils.container.querySelector('[data-pane-resize-id="editor-split"]')!;
    return {
      ...utils,
      handle,
      onRatioChange,
      topFlex: trackFlex(top),
      bottomFlex: trackFlex(bottom),
    };
  }

  it("tracks the drag with imperative flex writes on both panes and commits the ratio EXACTLY once on release", () => {
    const h = renderEditorSplit(0.5);
    down(h.handle, 100, 100);
    move(h.handle, 100, 170); // +70px on a 700px track
    const r = 420 / 700;
    expect(h.topFlex()).toBe(`${r} 1 0`);
    expect(h.bottomFlex()).toBe(`${1 - r} 1 0`);
    expect(h.onRatioChange).not.toHaveBeenCalled();

    up(h.handle);
    expect(h.onRatioChange).toHaveBeenCalledExactlyOnceWith(r);
  });

  it("a plain click commits nothing and restores the prop flex even at a float-inexact stored ratio", () => {
    // (0.7704422063444001 × 700) / 700 !== 0.7704422063444001 — the exact-px
    // zero-move guard must hold where a ratio round-trip compare breaks.
    const ratio = 0.7704422063444001;
    const h = renderEditorSplit(ratio);
    down(h.handle, 100, 100);
    up(h.handle);
    expect(h.onRatioChange).not.toHaveBeenCalled();
    expect(h.topFlex()).toBe(`${ratio} 1 0`);
    expect(h.bottomFlex()).toBe(`${1 - ratio} 1 0`);
  });
});

// ── ZenMargin (zen-mode page margins) ───────────────────────────────────────

// Wired like the real consumer (EditorPane → viewPrefs): marginPref and
// isResizing round-trip through state, so the begin-edge `0 0 …px` pin and
// the end-edge swap back to the resting `1 100 …px` flex are exercised, not
// just spied.
function renderZenMargin(side: "left" | "right") {
  const onMarginPrefChange = vi.fn();
  const onResizingChange = vi.fn();
  const onSyncBeforeDrag = vi.fn();
  const Harness = () => {
    const [pref, setPref] = useState(200);
    const [resizing, setResizing] = useState(false);
    return (
      <ZenMargin
        side={side}
        marginPref={pref}
        onMarginPrefChange={(w) => {
          onMarginPrefChange(w);
          setPref(w);
        }}
        isResizing={resizing}
        onResizingChange={(r) => {
          onResizingChange(r);
          setResizing(r);
        }}
        onSyncBeforeDrag={onSyncBeforeDrag}
      />
    );
  };
  const utils = render(<Harness />);
  const col = utils.container.querySelector<HTMLElement>(`[data-flex-col="${side}"]`)!;
  stubRect(col, { width: 200 });
  // getValue() clamps against the flex parent's free width — give it room.
  Object.defineProperty(utils.container, "clientWidth", {
    configurable: true,
    get: () => 1000,
  });
  const handle = utils.container.querySelector(
    `[data-pane-resize-id^="zen-margin-${side}"]`,
  )!;
  return { ...utils, col, handle, onMarginPrefChange, onResizingChange, onSyncBeforeDrag };
}

describe("ZenMargin on the pane-resize engine", () => {
  it("left margin: imperative flex-basis per frame, begin-edge sync/isResizing, ONE pref commit on release, resting flex restored", () => {
    const h = renderZenMargin("left");
    down(h.handle, 100);
    expect(h.onSyncBeforeDrag).toHaveBeenCalledTimes(1);
    expect(h.onResizingChange).toHaveBeenCalledExactlyOnceWith(true);
    // isResizing render pins the drag-shape flex.
    expect(h.col.style.flex).toBe("0 0 200px");

    move(h.handle, 160);
    expect(h.col.style.flex).toBe("0 0 260px");
    expect(h.onMarginPrefChange).not.toHaveBeenCalled();

    up(h.handle);
    expect(h.onMarginPrefChange).toHaveBeenCalledExactlyOnceWith(260);
    expect(h.onResizingChange).toHaveBeenLastCalledWith(false);
    expect(h.onResizingChange).toHaveBeenCalledTimes(2);
    // End-edge render swaps back to the resting flex at the committed pref.
    expect(h.col.style.flex).toBe("1 100 260px");
  });

  it("right margin grows as the pointer moves LEFT toward the editor (direction −1)", () => {
    const h = renderZenMargin("right");
    down(h.handle, 400);
    move(h.handle, 340); // 60px toward the axis origin → margin +60
    expect(h.col.style.flex).toBe("0 0 260px");
    up(h.handle);
    expect(h.onMarginPrefChange).toHaveBeenCalledExactlyOnceWith(260);
  });

  it("Escape restores the flex from the marginPref prop and commits nothing", () => {
    const h = renderZenMargin("left");
    down(h.handle, 100);
    move(h.handle, 160);
    expect(h.col.style.flex).toBe("0 0 260px");

    escape();
    expect(h.onMarginPrefChange).not.toHaveBeenCalled();
    expect(h.onResizingChange).toHaveBeenLastCalledWith(false);
    // restore() rewrote 200px from the prop; the end-edge render then swaps
    // in the resting shape at the unchanged pref.
    expect(h.col.style.flex).toBe("1 100 200px");
  });

  it("a plain click (zero-move) never writes prefs", () => {
    const h = renderZenMargin("left");
    down(h.handle, 100);
    up(h.handle);
    expect(h.onMarginPrefChange).not.toHaveBeenCalled();
    expect(h.col.style.flex).toBe("1 100 200px");
  });

  it("bus-edge side effects are instance-scoped: a same-side sibling (keep-alive doc panes) and a foreign gutter never fire them", () => {
    // TWO same-side instances in ONE root (keep-alive panes mount a ZenMargin
    // per side each) — a bare side-keyed gesture id would fire BOTH.
    const a = { onResizingChange: vi.fn(), onSyncBeforeDrag: vi.fn() };
    const b = { onResizingChange: vi.fn(), onSyncBeforeDrag: vi.fn() };
    const utils = render(
      <div>
        <ZenMargin
          side="left"
          marginPref={200}
          onMarginPrefChange={vi.fn()}
          onResizingChange={a.onResizingChange}
          onSyncBeforeDrag={a.onSyncBeforeDrag}
        />
        <ZenMargin
          side="left"
          marginPref={200}
          onMarginPrefChange={vi.fn()}
          onResizingChange={b.onResizingChange}
          onSyncBeforeDrag={b.onSyncBeforeDrag}
        />
      </div>,
    );
    const handles = utils.container.querySelectorAll(
      '[data-pane-resize-id^="zen-margin-left"]',
    );
    expect(handles).toHaveLength(2);

    down(handles[0], 100);
    up(handles[0]);
    expect(a.onSyncBeforeDrag).toHaveBeenCalledTimes(1);
    expect(a.onResizingChange).toHaveBeenCalledTimes(2);
    expect(b.onSyncBeforeDrag).not.toHaveBeenCalled();
    expect(b.onResizingChange).not.toHaveBeenCalled();

    // Foreign gestures (a Library gutter) are filtered out too.
    act(() => {
      beginPaneDrag({ id: "library-nav", axis: "x" });
    });
    act(() => {
      endPaneDrag({ id: "library-nav", axis: "x" });
    });
    expect(b.onResizingChange).not.toHaveBeenCalled();
  });
});

// ── EditorScrollbar thumb suppression rides the bus ─────────────────────────

describe("EditorScrollbar drag suppression (bus, not window events)", () => {
  function renderScrollbar() {
    const Harness = () => {
      const rowRef = useRef<HTMLDivElement>(null);
      const ecRef = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div ref={rowRef} data-testid="row">
            <div ref={ecRef} data-testid="ec" />
          </div>
          <EditorScrollbar rowRef={rowRef} editorColRef={ecRef} />
        </div>
      );
    };
    const utils = render(<Harness />);
    return utils;
  }

  it("hides the thumb on ANY pane-drag begin edge and restores it on end (cross-silo: a Library gutter drag suppresses the Reader's thumb too)", () => {
    // Scroll metrics must make the row scrollable BEFORE mount-time refresh.
    Object.defineProperty(HTMLDivElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 2000;
      },
    });
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 500;
      },
    });
    try {
      const utils = renderScrollbar();
      const thumbHost = document.querySelector<HTMLElement>(
        'div[style*="position: fixed"]',
      );
      expect(thumbHost).not.toBeNull();
      const thumb = thumbHost!.firstElementChild as HTMLElement;
      expect(thumb.style.opacity).toBe("1");

      act(() => {
        beginPaneDrag({ id: "library-list", axis: "x" });
      });
      expect(thumb.style.opacity).toBe("0");

      act(() => {
        endPaneDrag({ id: "library-list", axis: "x" });
      });
      expect(thumb.style.opacity).toBe("1");
      utils.unmount();
    } finally {
      delete (HTMLDivElement.prototype as { scrollHeight?: unknown }).scrollHeight;
      delete (HTMLDivElement.prototype as { clientHeight?: unknown }).clientHeight;
    }
  });
});
