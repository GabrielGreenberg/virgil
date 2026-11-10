// @vitest-environment jsdom
//
// Task 1548 — in CARET mode the ⚡ menu's lifetime is gated on focus, and the
// gate read "the editor lost focus" as "the head line went away". The lightning
// colour popover's native `<input type="color">` takes focus ON PURPOSE (the
// MenuProvider's mousedown fence exempts inputs), so opening the custom picker
// unmounted the menu — and the popover inside it — the same frame, and the pick
// landed on a detached input. The gate now asks "editor focused OR the OPEN
// menu family holds focus" (`MenuProvider`'s `familyRef`).
//
// Harness shared with `SelectionActionsMenu-bolt-toggle.test.tsx`; the panel is
// a minimal body on the REAL `<MenuProvider>` with a NESTED provider standing
// in for `SelectionColorPopover` (portaled to body, so it is a family member
// only through the provider tree — the real topology).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

const h = vi.hoisted(() => {
  const cache = {
    editorEl: { offsetHeight: 100 },
    podRight: 800,
    editorRight: 780,
    scrollTop: 0,
    scrollBottom: 600,
    paperEl: null,
    toPortalCoords: (x: number, y: number) => ({ x, y }),
  };
  return {
    coords: { left: 200, top: 100, bottom: 120 },
    cache,
    cacheRef: { current: cache as unknown },
    picked: [] as string[],
  };
});

vi.mock("@/lib/editor-geometry/use-viewport-frame", () => ({
  useViewportFrame: () => ({ frameRef: h.cacheRef, version: 0 }),
}));
vi.mock("@/lib/editor-geometry", () => ({
  coordsAtPosCached: (editor: Editor, pos: number) => {
    try {
      return editor.view.coordsAtPos(pos);
    } catch {
      return null;
    }
  },
}));
vi.mock("../ActionsMenuPanel", async () => {
  const { MenuProvider } = await import("../menu/MenuProvider");
  type FamilyRef = import("react").MutableRefObject<
    import("../menu/menu-family").MenuFamilyTest | null
  >;
  function Panel({
    triggerRect,
    triggerEl,
    familyRef,
    onClose,
  }: {
    triggerRect: DOMRect;
    triggerEl?: HTMLElement | null;
    familyRef?: FamilyRef;
    onClose: () => void;
  }) {
    return (
      <MenuProvider
        id="lightning"
        layout="composite"
        role="menu"
        anchorRect={triggerRect}
        placements={[{ side: "below", align: "start" }]}
        excludeRefs={[triggerEl ?? null]}
        familyRef={familyRef}
        onClose={onClose}
        ariaLabel="Selection actions"
      >
        <div data-testid="actions-menu-panel" />
        <MenuProvider
          id="lightning-color"
          layout="list"
          role="menu"
          anchorRect={triggerRect}
          placements={[{ side: "below", align: "start" }]}
          onClose={() => {}}
          ariaLabel="Text color"
        >
          <input
            data-testid="custom-color"
            type="color"
            onChange={(e) => h.picked.push(e.currentTarget.value)}
          />
        </MenuProvider>
      </MenuProvider>
    );
  }
  return { ActionsMenuPanel: Panel };
});
vi.mock("../Hint", () => ({ useHint: () => ({}) }));
vi.mock("../editor-layout/panel-icons", () => ({
  IconZap: () => <span data-testid="icon-zap" />,
}));
vi.mock("@/lib/scroll-reposition-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/scroll-reposition-probe")>()),
  recordScrollPlacement: () => {},
}));
vi.mock("@/lib/marginalia", () => ({
  computeBoltLeftFromPod: () => 760,
  MARGINALIA_BOLT_SIZE: 20,
}));
vi.mock("@/lib/anchor-uuid", () => ({
  resolveAnchorableNode: () => ({ nodePos: 5 }),
  resolveAnchorUuidAndKind: () => ({ uuid: "u1", kind: "paragraph" }),
}));

import { SelectionActionsMenu } from "../SelectionActionsMenu";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type TestEditor = Editor & { isFocused: boolean; emit: (evt: string) => void };

/** A CARET-mode editor (collapsed selection) whose focus the test flips. */
function makeCaretEditor(): TestEditor {
  const listeners: Record<string, Array<() => void>> = {};
  const dom = document.createElement("div");
  document.body.appendChild(dom);
  return {
    isDestroyed: false,
    isFocused: true,
    state: { selection: { empty: true, from: 15, to: 15, head: 15 } },
    view: { dom, coordsAtPos: () => h.coords },
    commands: { scrollIntoView: () => {} },
    on: (evt: string, cb: () => void) => {
      (listeners[evt] ??= []).push(cb);
    },
    off: (evt: string, cb: () => void) => {
      listeners[evt] = (listeners[evt] ?? []).filter((c) => c !== cb);
    },
    emit: (evt: string) => (listeners[evt] ?? []).forEach((cb) => cb()),
  } as unknown as TestEditor;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame;
  h.picked = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const bolt = () =>
  document.querySelector(
    'button[aria-label="Open actions menu"]',
  ) as HTMLButtonElement | null;
const panel = () => document.querySelector('[data-testid="actions-menu-panel"]');
const colorInput = () =>
  document.querySelector('[data-testid="custom-color"]') as HTMLInputElement | null;

const flush = () =>
  act(() => {
    vi.advanceTimersByTime(20);
  });

/** Open the menu from the bolt, then let the nested provider auto-register
 *  into the lightning menu's exclude set (it does so a tick after mount). */
function openMenu(editor: TestEditor) {
  render(<SelectionActionsMenu editor={editor} />);
  expect(bolt(), "caret mode + focused editor shows the bolt").toBeTruthy();
  act(() => {
    fireEvent.click(bolt()!);
  });
  flush();
  expect(panel()).toBeTruthy();
  expect(colorInput()).toBeTruthy();
}

/** Focus moves from the editor to `el` — the editor reports the blur, as
 *  TipTap does on the view's DOM blur. */
function moveFocusTo(editor: TestEditor, el: HTMLElement) {
  act(() => {
    editor.isFocused = false;
    el.focus();
    editor.emit("blur");
  });
  flush();
}

describe("SelectionActionsMenu — caret-mode focus gate counts the open menu family (task 1548)", () => {
  it("focus moving INTO the menu's own colour picker keeps the menu and the popover mounted, and the pick lands", () => {
    const editor = makeCaretEditor();
    openMenu(editor);

    const input = colorInput()!;
    moveFocusTo(editor, input);
    expect(document.activeElement).toBe(input);
    expect(panel(), "the menu survives its own picker taking focus").toBeTruthy();
    expect(colorInput(), "the colour popover is still mounted").toBe(input);
    expect(bolt(), "the bolt keeps its resting paint").toBeTruthy();

    act(() => {
      fireEvent.change(input, { target: { value: "#ff0000" } });
    });
    expect(h.picked).toEqual(["#ff0000"]);
  });

  it("focus moving OUTSIDE the menu family still closes it (task 154 / 753 semantics)", () => {
    const editor = makeCaretEditor();
    openMenu(editor);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    moveFocusTo(editor, outside);
    expect(panel(), "focus left for an unrelated control").toBeNull();
    expect(bolt(), "caret mode with no focus holder hides the bolt").toBeNull();
  });

  it("Tab out of the colour input to an outside control closes the menu (the open menu re-asks on focusin)", () => {
    const editor = makeCaretEditor();
    openMenu(editor);
    moveFocusTo(editor, colorInput()!);
    expect(panel()).toBeTruthy();

    // No editor event this time — the editor was already blurred.
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => {
      outside.focus();
    });
    flush();
    expect(panel()).toBeNull();
  });

  it("with the menu CLOSED, an unfocused caret editor still shows no bolt (first-paint gate unchanged)", () => {
    const editor = makeCaretEditor();
    editor.isFocused = false;
    render(<SelectionActionsMenu editor={editor} />);
    flush();
    expect(bolt()).toBeNull();
  });
});
