// @vitest-environment jsdom
//
// Task 334 — the lifted-overlay ghost's per-move write channel, driven through
// the REAL `beginLift` gesture.
//
// `FloatingPanel`'s move path has had a cost contract since task 330
// (`float-move-gesture-cost.test.tsx`): one queued frame however many events
// arrive, and an equality-bailed `translate3d` write. The lift overlay is the
// SAME shape — RAF-coalesced imperative motion on `position:fixed` portal
// nodes, React rendering on edges only — and it had **no equality bail**, so
// the two hand-rolled copies of one write channel had already diverged. That
// divergence is what task 334 filed, and it is invisible to every census in
// `pane-drag-guardrail`: they ask who installs a listener and what chrome it
// wears, never what a coalesced frame writes.
//
// The bail matters most exactly where a lift gesture sits still: the drop
// controller's edge-zone auto-scroll re-runs its hit-test at a PARKED cursor,
// and a hold over a drop target is how people confirm a target before
// releasing. Every such frame rewrote both nodes' `transform` for a delta
// that had not moved.
//
// jsdom defaults `buttons` to 0 and `isMissedRelease` ends the gesture on a
// move without the primary button held, so every LIVE move here passes
// `buttons: 1` explicitly — the same reason the task-333 suite gives.

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

// The overlay's popout-mode header renders the shared `FloatChromeContent`
// for real (task 437) — the motion channel writes to the header NODE, not to
// anything inside it, so the real children are free and a stub would only hide
// a re-fork. `@/lib/storage` above is what keeps panel-primitives resolvable.

// A lift starts a drop session; the session machinery (hit-test, indicator,
// LayoutGestureBus edges) is not what this suite measures.
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: vi.fn(),
  commitDropSession: vi.fn(async () => undefined),
  cancelDropSession: vi.fn(),
}));

// The anchor resolve is O(1) through the `data-uuid` decoration in production;
// here it hands back a real element with the kind attr `resolveAnchorDom`
// validates.
const anchorDom = { current: null as HTMLElement | null };
vi.mock("@/lib/marginalia-blocks", () => ({
  resolveDomForUuid: () => anchorDom.current,
}));

// The geometry service's viewport frame. `containsContentZone` decides
// ghost-vs-popout; pinning it TRUE keeps the gesture in ghost mode for the
// whole run, so no mode edge re-renders React underneath the motion writes.
vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({
    frameRef: { current: { containsContentZone: () => true } },
    version: 0,
  }),
}));

import { LiftHost, useLiftHost, type LiftHostApi } from "@/text-objects/LiftHost";

// ── RAF harness (the `float-move-gesture-cost` shape): the channel coalesces,
// so nothing is written until a frame runs. Counting queued frames is how the
// coalescing leg distinguishes "one write per frame" from "one write per
// event".
let rafSeq = 0;
let rafCalls = 0;
let frameQueue: FrameRequestCallback[] = [];
const flushFrame = () => {
  const cbs = frameQueue;
  frameQueue = [];
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafSeq = 0;
  rafCalls = 0;
  frameQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCalls += 1;
    frameQueue.push(cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frameQueue = [];
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  anchorDom.current = null;
  vi.unstubAllGlobals();
});

/** Count every `style.transform` WRITE on one element. An own accessor on the
 *  style instance shadows jsdom's prototype accessor, so this sees exactly the
 *  assignments the gesture makes — including a redundant one, which is the
 *  whole point. */
function recordTransformWrites(el: HTMLElement): string[] {
  const writes: string[] = [];
  let value = "";
  Object.defineProperty(el.style, "transform", {
    configurable: true,
    get: () => value,
    set: (v: string) => {
      writes.push(v);
      value = v;
    },
  });
  return writes;
}

const move = (x: number, y: number, buttons = 1) =>
  act(() => {
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: y, buttons, bubbles: true }),
    );
  });

const ORIGIN = { x: 300, y: 400 };

/** Mount the host, begin a REAL paragraph lift, and hand back the overlay's
 *  two motion targets with write recorders installed. */
function beginLift() {
  const source = document.createElement("div");
  source.setAttribute("data-text-object-kind", "paragraph");
  source.innerHTML = "<p>lifted body</p>";
  source.getBoundingClientRect = () =>
    ({ left: 280, top: 380, width: 420, height: 90 }) as DOMRect;
  document.body.appendChild(source);
  anchorDom.current = source;

  let api: LiftHostApi | null = null;
  function Probe() {
    const host = useLiftHost();
    useEffect(() => {
      api = host;
    }, [host]);
    return null;
  }

  const editorRef = { current: {} as Editor };
  render(
    <LiftHost editorRef={editorRef}>
      <Probe />
    </LiftHost>,
  );

  act(() => {
    api?.beginLift({
      ref: { kind: "paragraph", id: "u1" },
      cardKey: "float:textobject:paragraph:u1",
      origin: ORIGIN,
      terminalPolicy: "grab",
    });
  });

  const root = document.querySelector<HTMLElement>(".lifted-text-overlay");
  const header = document.querySelector<HTMLElement>(".lifted-text-overlay__header");
  if (!root || !header) throw new Error("the lift overlay did not mount");
  return { root, header, rootWrites: recordTransformWrites(root), headerWrites: recordTransformWrites(header) };
}

describe("the lifted overlay's motion channel coalesces and equality-bails (task 334)", () => {
  it("queues ONE frame however many moves arrive, and writes both portal nodes once", () => {
    const { rootWrites, headerWrites } = beginLift();
    const before = rafCalls;

    for (let i = 1; i <= 8; i += 1) move(ORIGIN.x + i, ORIGIN.y + i);
    expect(rafCalls - before, "one frame queued for eight events").toBe(1);
    expect(rootWrites, "nothing is written before the frame runs").toEqual([]);

    flushFrame();
    // The delta is the LAST event's, not the first — the handler advances a
    // closure var and the frame reads it.
    expect(rootWrites).toEqual(["translate3d(8px, 8px, 0)"]);
    expect(headerWrites).toEqual(["translate3d(8px, 8px, 0)"]);
  });

  it("bails a frame whose delta has not changed — the divergence task 334 filed", () => {
    const { rootWrites, headerWrites } = beginLift();

    move(ORIGIN.x + 40, ORIGIN.y + 20);
    flushFrame();
    expect(rootWrites).toEqual(["translate3d(40px, 20px, 0)"]);

    // A hold: the pointer re-enters the same coordinate (drag auto-scroll
    // re-running its hit-test at a parked cursor, or the user pausing over a
    // drop target). The frame runs and must write NOTHING.
    move(ORIGIN.x + 40, ORIGIN.y + 20);
    flushFrame();
    expect(rootWrites, "a re-entered coordinate must not rewrite the shell").toHaveLength(1);
    expect(headerWrites, "…nor the header").toHaveLength(1);

    // A real move still lands.
    move(ORIGIN.x + 41, ORIGIN.y + 20);
    flushFrame();
    expect(rootWrites).toEqual([
      "translate3d(40px, 20px, 0)",
      "translate3d(41px, 20px, 0)",
    ]);
  });

  it("returns to the empty rest value at zero delta rather than an identity transform", () => {
    // The float shell's own convention (`applyTranslate`): `willChange` holds
    // the layer, so a zero delta drops the property instead of writing
    // `translate3d(0px, 0px, 0)`. Pinned so the two copies of this channel
    // agree on their rest value as well as on their bail.
    const { rootWrites } = beginLift();
    move(ORIGIN.x + 12, ORIGIN.y);
    flushFrame();
    move(ORIGIN.x, ORIGIN.y);
    flushFrame();
    expect(rootWrites).toEqual(["translate3d(12px, 0px, 0)", ""]);
  });

  it("cancels the queued frame on the missed-release bail (no stale write behind the end path)", () => {
    const { rootWrites } = beginLift();
    move(ORIGIN.x + 60, ORIGIN.y + 60);
    // A move with the primary button no longer held: the mouseup was
    // swallowed. `cleanup()` must cancel the frame this gesture queued.
    move(ORIGIN.x + 900, ORIGIN.y + 900, 0);
    flushFrame();
    expect(
      rootWrites,
      "a bailed gesture must not commit a coordinate one frame later",
    ).toEqual([]);
  });
});
