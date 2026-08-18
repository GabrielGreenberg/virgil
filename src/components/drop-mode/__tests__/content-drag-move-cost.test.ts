// @vitest-environment jsdom
//
// Task 351 — **the content drag is task 330's float move, one module over.**
//
// Gabriel: dragging bullet-list items is "extremely choppy and rough — should
// be smooth-like-butter Notion-style." The audit found the content drag had
// taken none of the four obligations a bespoke gesture inherits (AGENTS.md,
// "Pane-drag stability"):
//
//   • COALESCE — the hit-test was paced by a 16 ms wall-clock timer whose FAST
//     branch ran the whole thing SYNCHRONOUSLY inside the mousemove handler.
//     On a 240 Hz mouse roughly every fourth raw event forced a layout, and
//     the drop indicator's own React style write landed between two of the
//     gesture's own reads. Read → write → read per frame, by construction.
//   • SNAPSHOT — `feedAutoScroll` opened with `scrollEl.getBoundingClientRect()`
//     on EVERY raw pointer event (a forced layout at 120–240 Hz), to answer
//     "is the pointer within 56 px of an edge?" about a container that cannot
//     move while the pointer is held. The module's own header claimed "zero
//     when idle"; the allowlist tag claimed "per move = a 16 ms throttle
//     gate". Both described the GATE and were silent about the sibling call in
//     the same handler — the task-140 shape the tag convention exists to
//     prevent, in the file that records it.
//
// This suite drives the REAL controller and asserts the cost contract
// directly: what runs per EVENT versus per coalesced FRAME. Every defect leg
// fails on the pre-351 controller (measured by reverting each half in turn).
//
// Scope, stated honestly: `hit-test` is mocked (the precedent
// `controller-commit-flush` and `refused-drop-keeps-float` set), so what is
// measured here is the CONTROLLER's own per-event budget and its coalescing —
// not the hit-test's internal read count, which needs real layout and is owed
// a browser trace.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

/** Every hit-test the controller runs, with the coordinate it ran at. */
const hitTestCalls: Array<{ x: number; y: number }> = [];
vi.mock("../hit-test", () => ({
  hitTest: (x: number, y: number) => {
    hitTestCalls.push({ x, y });
    return null;
  },
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

/** The session's scroll container — resolved through the ONE door, so the
 *  fixture controls it without a real editor pane. */
let scrollEl: HTMLElement | null = null;
vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findEditorScrollFor: () => scrollEl,
  alignEntryToYIfNeeded: () => false,
  scrollEntryIntoViewIfNeeded: () => false,
  scrollHeadingToActiveLine: () => {},
  findRowScroll: () => null,
}));

import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  setDropCtx,
} from "../controller";
import { edgeSpeedFor } from "../auto-scroll";
import {
  armMoveGeometry,
  contentSpanFor,
  disarmMoveGeometry,
  __moveGeometryState,
} from "../move-geometry";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx } from "../types";

const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "n1" });

// ── DOM-measurement instrumentation ──────────────────────────────────
// Counted on `Element.prototype`, so ANY element the gesture reaches is seen.
let reads = 0;
const realRect = Element.prototype.getBoundingClientRect;
const realRects = Element.prototype.getClientRects;
const realQS = Element.prototype.querySelector;
const realQSA = Element.prototype.querySelectorAll;
const realCS = window.getComputedStyle;

function installCounters() {
  reads = 0;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    reads += 1;
    return realRect.call(this);
  };
  Element.prototype.getClientRects = function (this: Element) {
    reads += 1;
    return realRects.call(this);
  };
  Element.prototype.querySelector = function (this: Element, s: string) {
    reads += 1;
    return realQS.call(this, s);
  } as typeof realQS;
  Element.prototype.querySelectorAll = function (this: Element, s: string) {
    reads += 1;
    return realQSA.call(this, s);
  } as typeof realQSA;
  window.getComputedStyle = ((el: Element, pe?: string | null) => {
    reads += 1;
    return realCS.call(window, el, pe);
  }) as typeof realCS;
}

function restoreCounters() {
  Element.prototype.getBoundingClientRect = realRect;
  Element.prototype.getClientRects = realRects;
  Element.prototype.querySelector = realQS;
  Element.prototype.querySelectorAll = realQSA;
  window.getComputedStyle = realCS;
}

const fakeEditor = {
  state: {},
  view: { dispatch() {}, dom: document.createElement("div") },
} as unknown as Editor;

function setup() {
  const ctx: DropCtx = {
    mainEditor: fakeEditor,
    closePopout: () => {},
    confirm: async () => true,
    notes: {
      exists: () => true,
      getAnchorTextObjectIds: () => [],
      addTextObjectLink: () => {},
      removeTextObjectLink: () => {},
      preserveModeBAnchor: () => null,
    },
  } as unknown as DropCtx;
  setDropCtx(ctx);
}

/** A scroll container with a real band — 800px tall, top at 0.
 *
 *  jsdom answers an all-zero rect for everything, so the fixture stubs this
 *  element's OWN `getBoundingClientRect` — which SHADOWS `Element.prototype`,
 *  so the prototype counter above cannot see it. Count at the source instead
 *  (the trap `float-move-gesture-cost` records; measured here by neutering the
 *  fix, where the prototype-only version reported zero and passed vacuously). */
function makeScroller(): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => {
    reads += 1;
    return {
      top: 0,
      bottom: 800,
      left: 0,
      right: 600,
      width: 600,
      height: 800,
      x: 0,
      y: 0,
      toJSON() {},
    } as DOMRect;
  };
  document.body.appendChild(el);
  return el;
}

const move = (x: number, y: number) =>
  window.dispatchEvent(
    // `buttons: 1` — every producer is a hold-drag, and the missed-release
    // failsafe cancels a move whose primary button is up.
    new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1 }),
  );

/** Let a scheduled frame (rAF, or the setTimeout safety net behind it) run. */
const frame = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  hitTestCalls.length = 0;
  scrollEl = makeScroller();
  setup();
});

afterEach(() => {
  restoreCounters();
  cancelDropSession();
  setDropCtx(null);
  scrollEl?.remove();
  scrollEl = null;
  disarmMoveGeometry();
});

describe("content-drag move path — per-event cost", () => {
  it("the RAW pointer path measures NOTHING (the snapshot obligation)", async () => {
    expect(
      beginDropSession({
        cardKey: CARD_KEY,
        origin: { x: 10, y: 400 },
        externalCommit: true,
      }),
    ).toBe(true);
    await frame();

    installCounters();
    // The door captures LAZILY, so the gesture's ONE geometry read lands on
    // its first move rather than at `beginDropSession`. That is the whole
    // budget: one, for the gesture.
    move(20, 400);
    expect(reads).toBe(1);

    reads = 0;
    for (let i = 0; i < 12; i++) move(21 + i, 401 + i);
    // Pre-351: 12 more `deltaFor` rect reads on the scroll container, plus a
    // full hit-test inline on roughly every 16 ms boundary.
    expect(reads).toBe(0);
  });

  it("a burst of events costs ONE hit-test, at the LAST coordinate", async () => {
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 400 },
      externalCommit: true,
    });
    await frame();
    hitTestCalls.length = 0;

    for (let i = 0; i < 8; i++) move(20 + i, 400 + i);
    // Nothing has run yet — the pass is scheduled, not inline.
    expect(hitTestCalls).toHaveLength(0);
    await frame();
    expect(hitTestCalls).toHaveLength(1);
    // The pass reads the LIVE pointer at frame time rather than closing over
    // the coordinate of the event that scheduled it.
    expect(hitTestCalls[0]).toEqual({ x: 27, y: 407 });
  });

  it("edge-zone arming is pure arithmetic — no DOM read at pointer rate", () => {
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 400 },
      externalCommit: true,
    });
    const target = { el: scrollEl!, top: 0, bottom: 800 };
    installCounters();
    for (let i = 0; i < 50; i++) edgeSpeedFor(target, 100 + i);
    expect(reads).toBe(0);
    // …and it still answers the zone correctly from the snapshotted band.
    expect(edgeSpeedFor(target, 400)).toBe(0); // middle
    expect(edgeSpeedFor(target, 2)).toBeLessThan(0); // top zone → scroll up
    expect(edgeSpeedFor(target, 798)).toBeGreaterThan(0); // bottom zone
  });

  it("the gesture's ONE end path drops the geometry snapshot", async () => {
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 400 },
      externalCommit: true,
    });
    move(20, 400);
    expect(__moveGeometryState().armed).toBe(true);
    cancelDropSession();
    expect(__moveGeometryState()).toEqual({ armed: false, captured: false });
    // A pass queued behind the release must not run against a dead session.
    hitTestCalls.length = 0;
    await frame();
    expect(hitTestCalls).toHaveLength(0);
  });
});

describe("content span memo — the horizontal half of the snapshot", () => {
  it("resolves a block's extent ONCE per gesture, live when disarmed", () => {
    const block = document.createElement("div");
    block.textContent = "item";
    document.body.appendChild(block);

    armMoveGeometry(() => null);
    installCounters();
    for (let i = 0; i < 6; i++) contentSpanFor(block);
    const armedReads = reads;
    restoreCounters();
    expect(armedReads).toBeGreaterThan(0); // the first resolve is real
    // Six hovers over the same list item, one resolve.
    installCounters();
    for (let i = 0; i < 6; i++) contentSpanFor(block);
    expect(reads).toBe(0);
    restoreCounters();

    // Disarmed (every non-drag caller, and every unit test that drives the
    // placement builders directly) reads live, exactly as before.
    disarmMoveGeometry();
    installCounters();
    contentSpanFor(block);
    contentSpanFor(block);
    expect(reads).toBeGreaterThanOrEqual(armedReads);
    restoreCounters();
    block.remove();
  });
});
