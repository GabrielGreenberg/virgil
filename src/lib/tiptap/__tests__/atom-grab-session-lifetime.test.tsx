// @vitest-environment jsdom
//
// Task 644 — **the grab is a SUBSCRIBER to its session's end, not a second
// owner of the same lifetime.**
//
// A drop session ends four ways: the commit, Escape, the controller's own
// post-threshold missed-release failsafe, and a teardown. `InlineAtomGrab`
// released on exactly ONE of them — its own `mouseup` — and its pre-threshold
// missed-release bail is deliberately scoped to the window before the
// controller takes over, so the post-threshold window had no owner at all.
//
// A release the gesture never sees is ordinary: the mouse comes up over the
// PDF pane, another iframe, or outside the window. What the user then got was
// permanent until reload — a translucent copy of the marker glued to the
// cursor, and `if (pending) return false` in `mousedown` turning every
// subsequent grab on that surface into a no-op.
//
// So the legs are about the EXIT PATHS, not about the drag: each drives a real
// post-threshold grab through the real plugin, ends the session by a route the
// gesture cannot see, and asks the two questions the user would — is the ghost
// gone, and does the next grab work.
//
// The extension barrel transitively imports `@/lib/storage`; stub it wholesale
// as the sibling suites do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  __resetDropCtxRegistry,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "@/components/drop-mode/controller";
import type { DropCtx } from "@/components/drop-mode/types";
import { useInlineAtomGhost } from "@/components/drop-mode/inline-atom-ghost";

// ── harness ──────────────────────────────────────────────────────────────────

const BODY = "Some prose \\cite{smith2020} and a \\footnote{note} here.\n";

let editor: Editor | null = null;

function ctx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: undefined,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(ctx()),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${BODY}\\end{document}\n`,
    ) as never,
    editable: true,
  });
  setDropCtx({
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
    requestAnchorFlush: () => {},
  } as unknown as DropCtx);
  return editor;
}

/** Drive THIS plugin's own `handleDOMEvents.mousedown` at an atom; returns the
 *  gesture's verdict (true = it armed a grab and took the press). */
function press(ed: Editor, domType = "footnote"): boolean {
  const atomEl = ed.view.dom.querySelector<HTMLElement>(
    `[data-type="${domType}"]`,
  );
  expect(atomEl, `fixture has no [data-type="${domType}"] atom`).toBeTruthy();
  const plugin = ed.state.plugins.find((pl) =>
    String((pl as unknown as { key?: string }).key ?? "").startsWith(
      "inlineAtomGrab",
    ),
  );
  expect(plugin, "InlineAtomGrab is not mounted").toBeTruthy();
  const handlers = plugin!.props.handleDOMEvents as unknown as Record<
    string,
    (view: unknown, event: MouseEvent) => boolean
  >;
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, "target", { value: atomEl });
  return handlers.mousedown(ed.view, event) === true;
}

/** Past the 8px threshold, with the primary button still held — the real
 *  event shape, since `isMissedRelease` reads `buttons`. */
function dragPastThreshold(): void {
  window.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 200,
      clientY: 200,
      buttons: 1,
    }),
  );
}

beforeEach(() => {
  __resetDropCtxRegistry();
});

afterEach(() => {
  cancelDropSession();
  editor?.destroy();
  editor = null;
  __resetDropCtxRegistry();
  vi.restoreAllMocks();
});

// ── 1. every exit path releases the gesture ──────────────────────────────────

describe("a drop session that ends WITHOUT the grab's own mouseup", () => {
  it("post-threshold: the controller's missed-release clears the ghost and frees the latch", () => {
    const ed = mount();
    const ghost = renderHook(() => useInlineAtomGhost());

    expect(press(ed)).toBe(true);
    dragPastThreshold();
    // The gesture is genuinely underway — session live, ghost lifted.
    expect(getDropSession()).not.toBeNull();
    ghost.rerender();
    expect(ghost.result.current).not.toBeNull();

    // The release happened where nobody saw it (over the PDF pane / an
    // iframe). The next move reports the button is no longer held, and the
    // CONTROLLER — not the grab — ends the session.
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 240,
        clientY: 240,
        buttons: 0,
      }),
    );
    expect(getDropSession()).toBeNull();

    ghost.rerender();
    expect(ghost.result.current, "the ghost outlived its session").toBeNull();
    // …and the latch is free, so the surface still has a grab gesture.
    expect(press(ed), "the next grab was refused by a stale latch").toBe(true);
  });

  it("post-threshold: Escape clears the ghost and frees the latch", () => {
    const ed = mount();
    const ghost = renderHook(() => useInlineAtomGhost());

    expect(press(ed)).toBe(true);
    dragPastThreshold();
    expect(getDropSession()).not.toBeNull();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(getDropSession()).toBeNull();

    ghost.rerender();
    expect(ghost.result.current).toBeNull();
    expect(press(ed)).toBe(true);
  });

  it("the grab's OWN mouseup still commits — the subscription does not pre-empt it", () => {
    const ed = mount();
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    expect(getDropSession()).not.toBeNull();
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    // `commitDropSession` is async; the session is ended either way by the
    // time the microtask queue drains, and the latch must be free NOW because
    // `onUp` releases before it commits.
    expect(press(ed)).toBe(true);
  });
});

// ── 2. the view owns the listeners ───────────────────────────────────────────

describe("the plugin view's destroy()", () => {
  it("removes every window listener a press installed", () => {
    const ed = mount();
    const added: string[] = [];
    const removed: string[] = [];
    const realAdd = window.addEventListener.bind(window);
    const realRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((...args) => {
      added.push(String(args[0]));
      return realAdd(...(args as Parameters<typeof realAdd>));
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((...args) => {
      removed.push(String(args[0]));
      return realRemove(...(args as Parameters<typeof realRemove>));
    });

    expect(press(ed)).toBe(true);
    dragPastThreshold();
    // mousedown installed mousemove + mouseup; the threshold-cross armed the
    // capture-phase click swallow.
    expect(added).toEqual(
      expect.arrayContaining(["mousemove", "mouseup", "click"]),
    );

    ed.destroy();
    editor = null;
    // Every one of them is gone — including the click swallow, whose only
    // other bound was a 500 ms wall clock.
    for (const type of ["mousemove", "mouseup", "click"]) {
      expect(
        removed.filter((t) => t === type).length,
        `window "${type}" listener outlived the view`,
      ).toBeGreaterThanOrEqual(added.filter((t) => t === type).length);
    }
    // A session this grab started does not outlive the editor it names.
    expect(getDropSession()).toBeNull();
  });

  it("a pre-threshold press torn down mid-hold leaves nothing armed", () => {
    const ed = mount();
    expect(press(ed)).toBe(true);
    // No movement at all — no session, no ghost, just the two window listeners.
    ed.destroy();
    editor = null;
    expect(getDropSession()).toBeNull();
    // A stray later move must not reach a dead editor's handler.
    expect(() => dragPastThreshold()).not.toThrow();
    expect(getDropSession()).toBeNull();
  });
});

// ── 3. the click guard is clocked from the RELEASE (task 1132) ───────────────
//
// The click the guard swallows follows the physical mouseup. Its 500 ms inner
// bound used to start at the drag THRESHOLD, so any drag held longer than half
// a second had retired the guard before the click came — and releasing back
// over the atom opened its Card as if it had been clicked.

describe("the post-drag click guard", () => {
  /** Count the clicks that reach the atom itself (bubble phase, as the
   *  atom's own Card-opening handler sees them). */
  function watchAtomClicks(ed: Editor): {
    el: HTMLElement;
    count: () => number;
  } {
    const el = ed.view.dom.querySelector<HTMLElement>(
      '[data-type="footnote"]',
    )!;
    let n = 0;
    el.addEventListener("click", () => n++);
    return { el, count: () => n };
  }
  const click = (el: HTMLElement) =>
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  const mouseup = (el: HTMLElement) =>
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, buttons: 0 }));

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a SLOW drag released over the atom still swallows the click; a later click is real", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    vi.advanceTimersByTime(1000); // held well past the old threshold-clock
    mouseup(atom.el);
    click(atom.el);
    expect(atom.count(), "the post-drag click opened the Card").toBe(0);

    vi.advanceTimersByTime(600);
    click(atom.el);
    expect(atom.count(), "a later real click was swallowed").toBe(1);
  });

  it("the guard retires 500 ms after the release when no click follows", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    mouseup(atom.el);
    vi.advanceTimersByTime(499);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(2);
    click(atom.el);
    expect(atom.count()).toBe(1);
  });

  it("Escape mid-drag, a long hold, then release over the atom: still swallowed", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(getDropSession()).toBeNull();
    vi.advanceTimersByTime(1000); // button still down — no clock yet
    mouseup(atom.el);
    click(atom.el);
    expect(atom.count()).toBe(0);
  });

  it("an unseen release (button-up move) starts the clock — no stale guard lingers", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 240,
        clientY: 240,
        buttons: 0,
      }),
    );
    vi.advanceTimersByTime(501);
    click(atom.el);
    expect(atom.count()).toBe(1);
  });

  it("a fresh press retires the guard at once — its click is a real one", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    dragPastThreshold();
    // Released where nobody saw it, no move since; the next thing is a new press.
    cancelDropSession();
    atom.el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }),
    );
    click(atom.el);
    expect(atom.count()).toBe(1);
  });

  it("a no-drag press arms no guard", () => {
    const ed = mount();
    const atom = watchAtomClicks(ed);
    expect(press(ed)).toBe(true);
    mouseup(atom.el);
    click(atom.el);
    expect(atom.count()).toBe(1);
  });
});
