// @vitest-environment jsdom
//
// Task 332 — **what the Stack ring OFFERS is what the capture ACCEPTS.**
//
// Popping out a Report / Report Request / Example and dragging it onto the
// StackIcon lit the illuminated capture ring exactly as a note does, the
// release was accepted, `virgil-stack-drop` fired, `snapshotForStack` returned
// null for the non-stackable kind — and the host closed the float anyway,
// under a comment that read "the user's intent is clear". The card vanished
// from the screen with nothing on the Stack and no message.
//
// The hover gated on `if (cardKey)` plus pure geometry and the receiving host
// asked the registry, so the same question was answered at two moments from
// two tables — the false-affordance family this subsystem has been drained of
// twice (tasks 258, 321). The fix resolves the capability ONCE at mousedown
// from `canCaptureToStack`, and both the ring and the release read that value.
//
// This suite drives the REAL FloatingPanel gesture: mousedown on the header,
// a window mousemove onto the icon's published rect, a window mouseup there.
// Every other guard in this cluster (`assertStackCoverage`, the per-kind
// `Floatable` sweep, the capture-door legs in `float-snapshot.test.ts`) is
// blind to the drag by construction, which is how the gesture shipped for a
// year never asking the facet built to answer it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { resolve } from "node:path";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import {
  setStackIconRect,
  getStackDropTarget,
  setStackDropTarget,
} from "@/lib/stack/stack-drop-target";

// The icon is bottom-left-anchored; these are the coords its own component
// publishes (a 56px circle inset 12px from the viewport's left/bottom).
const ICON = { left: 12, top: 700, right: 68, bottom: 756 };
const ICON_CENTER = { clientX: 40, clientY: 728 };
// Well clear of the icon, and where every gesture below starts.
const AWAY = { clientX: 500, clientY: 300 };
// Every mousemove below must carry the primary button HELD: since task 330 the
// move handler bails on `isMissedRelease` (the `(buttons & 1) === 0` bit test),
// and jsdom defaults `buttons` to 0 — a move without this reads as a release
// the handler never saw, which is exactly the invariant it is there to enforce.
const HELD = { buttons: 1 };

afterEach(() => {
  cleanup();
  setStackIconRect(null);
  setStackDropTarget(false);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

/** Mount a floating card shell for `cardKey`; returns its header + rect sink. */
function mountFloat(cardKey: string) {
  const onChange = vi.fn();
  render(
    <FloatingPanel
      cardKey={cardKey}
      mode="floating"
      surface="card"
      initialX={300}
      initialY={200}
      initialWidth={320}
      initialHeight={240}
      zIndex={1200}
      onChange={onChange}
    >
      <div data-testid="body">float body</div>
    </FloatingPanel>,
  );
  setStackIconRect(ICON);
  return {
    header: document.querySelector<HTMLDivElement>('[data-testid="body"]')!,
    onChange,
  };
}

/**
 * Drag the float's header from AWAY onto the icon and release there.
 * Returns what the ring said mid-drag and every `virgil-stack-drop` detail the
 * release dispatched — the two halves that must agree.
 */
function dragOntoIcon(cardKey: string) {
  const { header, onChange } = mountFloat(cardKey);
  const drops: unknown[] = [];
  const onDrop = (e: Event) => drops.push((e as CustomEvent).detail);
  window.addEventListener("virgil-stack-drop", onDrop);
  try {
    fireEvent.mouseDown(header, AWAY);
    act(() => {
      fireEvent.mouseMove(window, { ...ICON_CENTER, ...HELD });
    });
    const ringLit = getStackDropTarget();
    act(() => {
      fireEvent.mouseUp(window, ICON_CENTER);
    });
    return { ringLit, drops, onChange };
  } finally {
    window.removeEventListener("virgil-stack-drop", onDrop);
  }
}

describe("dragging a float onto the StackIcon", () => {
  it("a NOTE float lights the ring and dispatches the capture", () => {
    // The non-regression half: the shipped gesture for a kind the Stack really
    // does carry is untouched.
    const { ringLit, drops } = dragOntoIcon("note:n1");
    expect(ringLit).toBe(true);
    expect(drops).toHaveLength(1);
    expect((drops[0] as { cardKey: string }).cardKey).toBe("note:n1");
  });

  it.each(["report", "report-request", "example"])(
    "a %s float lights NO ring and its release dispatches nothing",
    (kind) => {
      // The defect, verbatim. Both legs fail pre-fix: the ring lit off pure
      // geometry, and the release dispatched off the same geometry — after
      // which the host closed the float over an empty capture.
      const { ringLit, drops } = dragOntoIcon(`${kind}:x1`);
      expect(ringLit).toBe(false);
      expect(drops).toEqual([]);
    },
  );

  it("a TEXT-OBJECT float still captures (the family is capture-capable)", () => {
    const { ringLit, drops } = dragOntoIcon("float:textobject:paragraph:u1");
    expect(ringLit).toBe(true);
    expect(drops).toHaveLength(1);
  });

  it("a non-capturable float releasing over the icon leaves the ring clear", () => {
    // The fall-through half of "Done when": a refused float takes the normal
    // drop/redock path, and nothing leaves the module-level ring signal armed
    // for the next gesture.
    dragOntoIcon("report:x1");
    expect(getStackDropTarget()).toBe(false);
  });

  it("a release over the icon PERSISTS where the user left the float", () => {
    // The stack-drop branch returns before the shared position commit, which
    // was harmless only while the host closed the float unconditionally. Now
    // that it closes only on a capture that landed, a refusal it cannot
    // foresee (a deleted source) would strand the float over the icon at a
    // rect nothing had stored — visible on the next reload.
    const { onChange } = dragOntoIcon("note:n1");
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as { x: number; y: number };
    // The header was grabbed at AWAY and released at the icon centre, so the
    // committed rect must carry that delta — not the mount-time origin.
    expect(last.x).toBe(300 + (ICON_CENTER.clientX - AWAY.clientX));
    expect(last.y).toBe(200 + (ICON_CENTER.clientY - AWAY.clientY));
  });

  it("a capturable float released AWAY from the icon dispatches nothing", () => {
    // Geometry still has to hold: the capability is a gate, not a bypass.
    const { header } = mountFloat("note:n1");
    const drops: unknown[] = [];
    const onDrop = (e: Event) => drops.push((e as CustomEvent).detail);
    window.addEventListener("virgil-stack-drop", onDrop);
    fireEvent.mouseDown(header, AWAY);
    act(() => {
      fireEvent.mouseMove(window, { clientX: 520, clientY: 320, ...HELD });
    });
    expect(getStackDropTarget()).toBe(false);
    act(() => {
      fireEvent.mouseUp(window, { clientX: 520, clientY: 320 });
    });
    window.removeEventListener("virgil-stack-drop", onDrop);
    expect(drops).toEqual([]);
  });
});

describe("the host closes the float only on a capture that landed", () => {
  /**
   * The census, and the leg with teeth for the OTHER half of the fix. The
   * `virgil-stack-drop` handler lives inside `EditorPane`, a component no unit
   * test mounts — and the part that could misbehave was never
   * `captureFloatToStack` (whose refusals are pinned in
   * `cards/__tests__/float-snapshot.test.ts`) but the call site that closed the
   * float without reading its report. So read the source of that one handler
   * and require the guard to precede the close.
   *
   * RENEGOTIATED by task 456, with the reason here. The pre-456 form required
   * the HANDLER ITSELF to spell `captureFloatToStack(` + `if (!item) return;`,
   * which pinned this as the ONE capture site — true when the float drag was
   * the only producer with a terminal, and exactly what a second producer had
   * to break. The content lift (dragging a paragraph / heading / list item /
   * selection out of the document onto the icon) now enters the SAME terminal,
   * so the door moved one function out: `EditorPane.captureKeyToStack`. The
   * invariant is unchanged and is asserted in the two halves it now has —
   * the terminal goes through the capture door and reports, and the handler
   * closes the float only on that report.
   */
  const src = readFileSync(
    resolve(__dirname, "../EditorPane.tsx"),
    "utf8",
  );

  it("EditorPane's stack-drop handler guards the close on the report", () => {
    const start = src.indexOf('window.addEventListener("virgil-stack-drop"');
    expect(start, "the stack-drop listener moved — re-aim this census").toBeGreaterThan(0);
    // The handler is declared immediately above its own registration; take the
    // enclosing effect body by walking back to the `const onDrop =` it installs.
    const bodyStart = src.lastIndexOf("const onDrop = ", start);
    expect(bodyStart).toBeGreaterThan(0);
    const body = src.slice(bodyStart, start);

    const guard = body.indexOf("if (!captureKeyToStack(cardKey)) return;");
    const close = body.indexOf("closeCardPopout(");
    expect(guard, "the handler must enter the ONE stack terminal").toBeGreaterThan(-1);
    expect(close, "the float is closed on the report, never before it").toBeGreaterThan(guard);
    expect(
      body.indexOf("captureFloatToStack("),
      "and it must not re-derive the capture itself",
    ).toBe(-1);
  });

  it("the shared terminal is the capture door, and it reports", () => {
    const at = src.indexOf("const captureKeyToStack = useCallback(");
    expect(at, "the shared stack terminal moved — re-aim this census").toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("[popoutsDeps],", at));

    const capture = body.indexOf("captureFloatToStack(");
    const refuse = body.indexOf("if (!item) return false;");
    const add = body.indexOf("addStackItem(");
    expect(capture, "the terminal goes through the ONE capture door").toBeGreaterThan(-1);
    expect(refuse, "an empty capture returns the refusal before anything else")
      .toBeGreaterThan(capture);
    // The bib carry is the add door's obligation (task 235) and nothing may
    // reach the Stack around it.
    expect(add, "and a capture that landed enters the ONE add door").toBeGreaterThan(refuse);
    expect(body.includes("return true;"), "…and reports that it landed").toBe(true);
  });

  it("the content lift enters that SAME terminal (task 456)", () => {
    // The leg with teeth for task 456. The terminal was never the part that
    // could misbehave — a second, private capture site inside `LiftHost` is,
    // and it would type-check perfectly, ask no capability, carry no bib and
    // report to nobody. So: exactly one production consumer of the prop, and
    // it is handed the shared terminal.
    expect(
      src.includes("onCaptureToStack={captureKeyToStack}"),
      "LiftHost must be handed the shared stack terminal",
    ).toBe(true);

    // Comments stripped: the prop's own docstring NAMES the shared terminal's
    // door and its bib obligation, which is exactly the prose a bare grep
    // would indict.
    const host = commentsStripped(
      readFileSync(resolve(__dirname, "../../text-objects/LiftHost.tsx"), "utf8"),
    );
    // No private door: the lift may not resolve, serialize or add on its own.
    for (const needle of [
      "captureFloatToStack",
      "snapshotForStack",
      "snapshotTextObject",
      "addStackItem",
    ]) {
      expect(host.includes(needle), `LiftHost must not spell \`${needle}\``).toBe(false);
    }
    // What it DOES own is the two-sided contract: one capability read, one
    // geometry predicate, read by both the ring and the release.
    expect(host.includes("canCaptureToStack(cardKey)")).toBe(true);
    expect(host.includes("isOverStackIcon(mv.clientX, mv.clientY)")).toBe(true);
    expect(host.includes("isOverStackIcon(upEv.clientX, upEv.clientY)")).toBe(true);
  });
});
