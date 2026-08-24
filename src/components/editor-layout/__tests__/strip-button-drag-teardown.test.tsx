// @vitest-environment jsdom
//
// StripButton — the bespoke strip-icon drag, and the four obligations it owes.
//
// Task 2026-07-15-141 (member B) pinned the TEARDOWN half: the panel-rail icon
// drag appends a fixed z-9999 `#virgil-drag-ghost` (and a
// `#virgil-drop-indicator`) to `document.body` mid-drag, and every terminating
// pointer event must run the SAME single teardown (`cleanupDragArtifacts`) so
// those body-appended nodes can't be orphaned on screen:
//   - `pointerup` (the normal end) — already covered by existing behavior.
//   - `pointercancel` — the browser co-opts the gesture as a scroll/pinch
//     (routine on touch/pen). Per the Pointer Events spec this SUPPRESSES the
//     trailing `pointerup`, so without a cancel handler the ghost is stranded.
//   - unmount mid-drag — no pointerup fires either; the unmount effect reclaims.
//
// Task 439 pins the rest of the law (AGENTS.md → "Pane-drag stability": a
// bespoke gesture inherits COALESCE, SNAPSHOT, COMMIT ONCE and the two POINTER
// INVARIANTS, and IMPORTS the invariants rather than re-deriving them):
//   - a right/middle press arms nothing, so it can neither toggle the panel nor
//     commit a move (pre-439 `onPointerUp` fired for ANY button and fell through
//     to `onClick()`);
//   - a press whose release the button never observed is ended by the
//     missed-release failsafe, so a later HOVER cannot become a phantom drag
//     that takes pointer capture with nothing pressed;
//   - the move path costs ONE coalesced frame and, after the gesture's single
//     geometry sweep, ZERO forced-layout reads;
//   - what the hover OFFERS is what the release ACCEPTS, because both read the
//     same snapshot.
//
// Task 440 renegotiates the two legs that pinned an INDEX. The commit's payload
// is now the IDENTITY of the panel the icon lands in front of (`null` =
// append), because the strip is a filtered PROJECTION of `prefs.placements` and
// an index counted off it is not an index into the model — see
// `src/hooks/__tests__/strip-drop-identity.test.tsx` for the model half. Those
// two legs asserted the defect as the contract, so their EXPECTATIONS move and
// their gestures do not.
//
// **jsdom defaults `PointerEvent.buttons` to 0**, which the missed-release bail
// reads as "the release already happened" — so EVERY live pointer event below
// passes `{ button: 0, buttons: 1 }` explicitly. That is not boilerplate: it is
// the proof the invariant is wired (measured — all five pre-439 legs fail
// against the fixed component until the field is added), and it is the trap
// AGENTS.md records for `bespoke-gesture-missed-release.test.tsx`.
//
// jsdom's pointer-capture is a stub (installed below), so the touch/pen path
// and the real context-menu race still owe a preview eyeball — but the wiring
// itself is faithfully exercised here.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

// StripButton lives in the same module as `useStripHandlers`, which imports the
// heavy `panel-column` chain (pane-resize / useViewPrefs / storage). StripButton
// itself never touches it, so stub it out to keep this a focused unit test.
vi.mock("../panel-column", () => ({ measureOmniGap: () => 0 }));

import { render, fireEvent, cleanup } from "@testing-library/react";
import { StripButton } from "../drag-drop";

// jsdom ships pointer-capture methods as no-throwing stubs in some versions and
// omits them in others; force them present so the drag-start capture can't throw
// and short-circuit ghost creation.
let setPointerCapture: ReturnType<typeof vi.fn>;
beforeAll(() => {
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

// ── A controllable animation-frame clock ────────────────────────────────────
// The move path is rAF-coalesced, so the frame queue is the unit the cost legs
// measure. A real (or auto-flushing) clock makes "eight events queued ONE frame"
// unobservable.
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(performance.now());
}

beforeEach(() => {
  setPointerCapture = vi.fn();
  Element.prototype.setPointerCapture =
    setPointerCapture as unknown as Element["setPointerCapture"];
  frames.clear();
  nextFrameId = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.set(++nextFrameId, cb);
    return nextFrameId;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    frames.delete(id);
  }) as typeof cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Belt-and-suspenders: a failing assertion shouldn't leak a ghost into the
  // next test's document.body.
  document.getElementById("virgil-drag-ghost")?.remove();
  document.getElementById("virgil-drop-indicator")?.remove();
});

// ── The fixture ─────────────────────────────────────────────────────────────
// A REAL left strip carrying the dragged icon plus two sibling icons, so the
// snapshot has slots to resolve against and the drop index is a real answer.
// `paneStrip` fails OPEN when nothing is visible (jsdom reports every element
// hidden), so the `[data-strip-side]` container below is what it resolves.
const RECTS: Record<string, { top: number; bottom: number }> = {
  notes: { top: 60, bottom: 100 },
  todos: { top: 100, bottom: 140 },
  outline: { top: 140, bottom: 180 },
};

function stubRects() {
  return vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      const id = (this as HTMLElement).dataset?.panelId;
      if (id && RECTS[id]) {
        const { top, bottom } = RECTS[id];
        return {
          top,
          bottom,
          left: 0,
          right: 40,
          width: 40,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      }
      // The strip container itself.
      return {
        top: 50,
        bottom: 400,
        left: 0,
        right: 40,
        width: 40,
        height: 350,
        x: 0,
        y: 50,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

function renderButton() {
  const onClick = vi.fn();
  const onMove = vi.fn();
  const utils = render(
    <div data-strip-side="left">
      <StripButton
        panelId="notes"
        active={false}
        onClick={onClick}
        onMove={onMove}
        side="left"
      />
      <button data-panel-id="todos" />
      <button data-panel-id="outline" />
    </div>,
  );
  const btn = utils.getByLabelText(/notes/i);
  return { ...utils, btn, onClick, onMove };
}

/** A LIVE pointer event — primary button held, which jsdom will not do for us. */
const held = (x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  button: 0,
  buttons: 1,
  isPrimary: true,
});

// Drive a real drag past the 5px threshold so the ghost is appended to body.
function startDrag(btn: HTMLElement) {
  fireEvent.pointerDown(btn, held(0, 0));
  fireEvent.pointerMove(btn, held(20, 20));
}

describe("StripButton drag-interruption teardown", () => {
  it("appends the drag ghost once the drag passes threshold", () => {
    const { btn } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();
  });

  it("a pointercancel reclaims the ghost (no orphan on document.body)", () => {
    const { btn, onMove } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    fireEvent.pointerCancel(btn, { pointerId: 1 });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(document.getElementById("virgil-drop-indicator")).toBeNull();
    // A cancelled drag must NOT commit a move.
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a lostpointercapture reclaims the ghost", () => {
    const { btn } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    fireEvent.lostPointerCapture(btn, { pointerId: 1 });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
  });

  it("unmount mid-drag reclaims the ghost", () => {
    const { btn, unmount } = renderButton();
    startDrag(btn);
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();

    unmount();

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
  });

  it("a normal pointerup still tears down and commits the move", () => {
    const restore = stubRects();
    const { btn, onMove } = renderButton();
    startDrag(btn);
    fireEvent.pointerUp(btn, held(20, 20));

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(onMove).toHaveBeenCalledTimes(1);
    restore.mockRestore();
  });
});

describe("StripButton pointer invariants (task 439)", () => {
  it("a right-press neither toggles the panel nor commits a move", () => {
    const { btn, onClick, onMove } = renderButton();
    const right = { clientX: 10, clientY: 10, pointerId: 1, button: 2, buttons: 2 };

    fireEvent.pointerDown(btn, right);
    fireEvent.pointerUp(btn, right);

    // Pre-439 this fell through to `handledByPointer = true; onClick()` and
    // opened/closed the panel beside the context menu the same press opens.
    expect(onClick).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
  });

  it("a middle-press does nothing", () => {
    const { btn, onClick, onMove } = renderButton();
    const middle = { clientX: 10, clientY: 10, pointerId: 1, button: 1, buttons: 4 };

    fireEvent.pointerDown(btn, middle);
    fireEvent.pointerMove(btn, { ...middle, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(btn, { ...middle, clientX: 40, clientY: 40 });

    expect(onClick).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("a press whose release the button never sees cannot become a phantom drag", () => {
    const { btn, onClick, onMove } = renderButton();

    // The user presses the icon; the release lands somewhere this button never
    // hears about (the context menu ate it, the pointer left the button under
    // threshold and released over the editor, a release over an iframe).
    fireEvent.pointerDown(btn, held(0, 0));

    // Later the user simply HOVERS back over the icon. `pointermove` fires with
    // no button held. Pre-439 this crossed the 5px threshold against the stale
    // origin: a ghost appeared under a pointer with nothing pressed, and
    // `setPointerCapture` retargeted every pointer event in the document here.
    fireEvent.pointerMove(btn, {
      clientX: 60,
      clientY: 60,
      pointerId: 1,
      buttons: 0,
    });

    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(document.getElementById("virgil-drop-indicator")).toBeNull();
    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();

    // …and the gesture is genuinely ENDED, not merely skipped: the user's next
    // ordinary click behaves as a first click rather than resuming the phantom.
    fireEvent.pointerDown(btn, held(60, 60));
    fireEvent.pointerUp(btn, held(60, 60));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a live drag still moves the panel (the accepting control)", () => {
    const restore = stubRects();
    const { btn, onMove, onClick } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 130));
    expect(document.getElementById("virgil-drag-ghost")).not.toBeNull();
    fireEvent.pointerUp(btn, held(10, 130));

    // slots (the dragged `notes` filtered out) = [todos mid 120, outline mid 160]
    // → y=130 lands in the gap BEFORE `outline`. Renegotiated for task 440: the
    // commit names that panel rather than counting to it.
    expect(onMove).toHaveBeenCalledWith("notes", "left", "outline");
    expect(onClick).not.toHaveBeenCalled();
    restore.mockRestore();
  });

  it("what the hover OFFERS is what the release ACCEPTS (one snapshot, both readers)", () => {
    const restore = stubRects();
    const { btn, onMove } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 110));
    flushFrames();

    const ind = document.getElementById("virgil-drop-indicator")!;
    // The bar rests 2px above `todos` (top 100), and it moves by TRANSFORM: the
    // pre-439 element eased its `top`, a main-thread layout animation restarted
    // on most frames of the drag.
    // x = strip.left + 4 (the bar is inset inside the strip), y = todos.top - 2.
    expect(ind.style.transform).toBe("translate3d(4px, 98px, 0)");
    expect(ind.style.top).toBe("0px");

    fireEvent.pointerUp(btn, held(10, 110));
    // The SAME reference, not the same integer (task 440): the panel whose top
    // edge the bar is drawn against is the panel the commit names. Derived from
    // the painted bar rather than hard-coded, so the two cannot re-fork — a
    // literal on both sides is two tables agreeing by transcription.
    const barY = Number(/translate3d\(\d+px, (\d+)px/.exec(ind.style.transform)![1]);
    const offeredId = Object.keys(RECTS).find((id) => RECTS[id].top - 2 === barY)!;
    expect(offeredId).toBe("todos");
    expect(onMove).toHaveBeenCalledWith("notes", "left", offeredId);
    restore.mockRestore();
  });

  it("a drop past the last icon appends (names no panel)", () => {
    const restore = stubRects();
    const { btn, onMove } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 300)); // below every slot's midpoint
    flushFrames();

    // The bar rests 2px BELOW the last icon — the "append" affordance.
    const ind = document.getElementById("virgil-drop-indicator")!;
    expect(ind.style.transform).toBe(`translate3d(4px, ${RECTS.outline.bottom + 2}px, 0)`);

    fireEvent.pointerUp(btn, held(10, 300));
    // `null`, never `slots.length` — an integer here would be an index into a
    // list this strip is only a filtered view of.
    expect(onMove).toHaveBeenCalledWith("notes", "left", null);
    restore.mockRestore();
  });
});

describe("StripButton move-path cost (task 439)", () => {
  it("eight raw pointer moves queue ONE frame, at the LAST coordinate", () => {
    const restore = stubRects();
    const { btn } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 70)); // crosses threshold
    flushFrames();

    for (let i = 1; i <= 8; i++) fireEvent.pointerMove(btn, held(10, 100 + i));
    expect(frames.size).toBe(1);

    flushFrames();
    const ghost = document.getElementById("virgil-drag-ghost")!;
    // The frame reads the LIVE pointer, not the coordinate that scheduled it.
    expect(ghost.style.transform).toBe(`translate3d(${10 - 18}px, ${108 - 18}px, 0)`);
    restore.mockRestore();
  });

  it("after the gesture's ONE geometry sweep the move path forces ZERO layout", () => {
    const rectSpy = stubRects();
    const { btn } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 70));
    flushFrames(); // the sweep: one strip resolve + one rect per button

    expect(rectSpy).toHaveBeenCalled(); // the snapshot really happened

    // Count on the ELEMENT as well as `Element.prototype` — the trap
    // `float-move-gesture-cost` records is a fixture that shadows the prototype,
    // which makes a prototype-only counter report zero and the leg pass
    // vacuously under its own neuter.
    const strip = document.querySelector<HTMLElement>("[data-strip-side]")!;
    const queryAll = vi.spyOn(strip, "querySelectorAll");
    const docQueryAll = vi.spyOn(document, "querySelectorAll");
    const protoQueryAll = vi.spyOn(Element.prototype, "querySelectorAll");
    rectSpy.mockClear();

    for (let i = 1; i <= 20; i++) {
      fireEvent.pointerMove(btn, held(10, 90 + i));
      flushFrames();
    }

    expect(rectSpy).not.toHaveBeenCalled();
    expect(queryAll).not.toHaveBeenCalled();
    expect(protoQueryAll).not.toHaveBeenCalled();
    expect(docQueryAll).not.toHaveBeenCalled();
    rectSpy.mockRestore();
  });

  it("a bailed gesture cannot commit a frame behind itself", () => {
    const restore = stubRects();
    const { btn, onMove } = renderButton();

    fireEvent.pointerDown(btn, held(10, 60));
    fireEvent.pointerMove(btn, held(10, 130)); // a frame is now queued
    expect(frames.size).toBe(1);

    // The release lands where the button can't see it; the next hover ends the
    // gesture. The queued frame must be CANCELLED, not left to paint a ghost
    // that has already been removed (task 333's rule).
    fireEvent.pointerMove(btn, { clientX: 10, clientY: 200, pointerId: 1, buttons: 0 });
    expect(frames.size).toBe(0);

    flushFrames();
    expect(document.getElementById("virgil-drag-ghost")).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    restore.mockRestore();
  });
});
