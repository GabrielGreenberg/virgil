// @vitest-environment jsdom
//
// TASK 737 — the grab menu FOLLOWS the live document while it is open.
//
// The menu never takes focus and never blocks the document, so the document
// keeps moving underneath it. Before this task everything the menu knew was a
// snapshot taken at open: the selection's `from`/`to` numbers (clamped, never
// mapped — Delete removed whatever text had shifted into them), the handle's
// one-shot rect (the menu stayed parked over a block it no longer pointed at),
// and the rows' greyed state (memoized with no document key). Every leg below
// mutates the document BETWEEN open and select.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the
// sibling-suite gotcha.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { DragHandleMenu, type DragHandleAction } from "@/components/DragHandleMenu";
import type { DragHandleRef } from "../drag-handle-actions";
import {
  followGrabTarget,
  initialGrabSpan,
  liveGrabRef,
  type GrabTargetState,
} from "../grab-menu-target";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const PARA = (uuid: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});

function mount(): Editor {
  const editableRef: RefObject<boolean> = { current: true };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [PARA("p-A", "alpha beta gamma"), PARA("p-B", "second")],
    },
  });
}

/** "beta" inside p-A (p-A opens at 0, text starts at 1). */
const BETA: DragHandleRef = { kind: "selection", from: 7, to: 11, paragraphId: "p-A" };

const text = (ed: Editor, r: { from: number; to: number }) =>
  ed.state.doc.textBetween(r.from, r.to);

/** Run one command and hand back the transaction it dispatched. */
function capture(ed: Editor, run: () => void) {
  const seen: import("@tiptap/pm/state").Transaction[] = [];
  const h = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) =>
    seen.push(transaction);
  ed.on("transaction", h);
  run();
  ed.off("transaction", h);
  return seen;
}

let editor: Editor;
beforeEach(() => {
  editor = mount();
});
afterEach(() => {
  cleanup();
  editor.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) The follow rule itself
// ---------------------------------------------------------------------------

describe("task 737 — followGrabTarget", () => {
  const seed = (ref: DragHandleRef): GrabTargetState => ({
    span: initialGrabSpan(editor.state.doc, ref),
    stale: false,
  });

  it("an insert BEFORE the selection shifts it onto the same text", () => {
    expect(text(editor, BETA)).toBe("beta");
    const trs = capture(editor, () => editor.commands.insertContentAt(1, "XX"));
    const next = followGrabTarget(BETA, seed(BETA), trs);
    expect(next.stale).toBe(false);
    const live = liveGrabRef(BETA, next, editor.state.doc)!;
    expect(live).toMatchObject({ kind: "selection", from: 9, to: 13, paragraphId: "p-A" });
    expect(text(editor, live as { from: number; to: number })).toBe("beta");
  });

  it("an insert AT either boundary is outside the selection (not stale)", () => {
    const trs = capture(editor, () => editor.commands.insertContentAt(11, "!"));
    const next = followGrabTarget(BETA, seed(BETA), trs);
    expect(next.stale).toBe(false);
    expect(next.span).toEqual({ from: 7, to: 11 });
  });

  it("an edit INSIDE the selection makes it stale — the text is not the text it was opened on", () => {
    const trs = capture(editor, () => editor.commands.insertContentAt(9, "Z"));
    const next = followGrabTarget(BETA, seed(BETA), trs);
    expect(next.stale).toBe(true);
    expect(liveGrabRef(BETA, next, editor.state.doc)).toBeNull();
  });

  it("deleting the selected text makes it stale", () => {
    const trs = capture(editor, () => editor.commands.deleteRange({ from: 5, to: 13 }));
    expect(followGrabTarget(BETA, seed(BETA), trs).stale).toBe(true);
  });

  it("a mark-only step over the selection leaves the text — not stale", () => {
    const trs = capture(editor, () =>
      editor.chain().setTextSelection({ from: 7, to: 11 }).setBold().run(),
    );
    expect(trs.some((t) => t.docChanged)).toBe(true);
    expect(followGrabTarget(BETA, seed(BETA), trs).stale).toBe(false);
  });

  it("a NODE ref survives edits inside it and goes stale only when the node is removed", () => {
    const P_B: DragHandleRef = { kind: "paragraph", id: "p-B" };
    let state = seed(P_B);
    expect(state.span).not.toBeNull();
    state = followGrabTarget(
      P_B,
      state,
      capture(editor, () => editor.commands.insertContentAt(state.span!.from + 2, "Q")),
    );
    expect(state.stale).toBe(false);
    expect(liveGrabRef(P_B, state, editor.state.doc)).toBe(P_B);
    const span = state.span!;
    state = followGrabTarget(
      P_B,
      state,
      capture(editor, () => editor.commands.deleteRange(span)),
    );
    expect(state.stale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) The mounted menu
// ---------------------------------------------------------------------------

const RECT = { left: 100, top: 200, right: 120, bottom: 240, width: 20, height: 40 };

function renderMenu(opts: {
  onSelect?: (a: DragHandleAction, ref?: DragHandleRef) => void;
  onClose?: () => void;
}) {
  render(
    <DragHandleMenu
      anchorRect={RECT}
      kind="selection"
      target={BETA}
      editor={editor}
      canEdit
      onSelect={opts.onSelect ?? (() => {})}
      onClose={opts.onClose ?? (() => {})}
    />,
  );
}

const rowButton = (label: string) =>
  Array.from(document.querySelectorAll('[role="menu"] button[role="menuitem"]')).find((b) =>
    (b.textContent ?? "").includes(label),
  ) as HTMLButtonElement | undefined;

const enabledLabels = () =>
  Array.from(document.querySelectorAll('[role="menu"] button[role="menuitem"]'))
    .filter((b) => !(b as HTMLButtonElement).disabled)
    .map((b) => b.textContent ?? "");

const flushFrame = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await Promise.resolve();
  });

describe("task 737 — the open menu acts on the text it was opened on", () => {
  it("Delete after a shifting edit hands the dispatcher the MAPPED range — still 'beta'", () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });
    // The document moves while the menu is up (a collaborator, an agent write).
    act(() => {
      editor.commands.insertContentAt(1, "XX");
    });
    // Click BEFORE any frame flushes — the click-time read must already be live.
    fireEvent.click(rowButton("Delete")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [action, ref] = onSelect.mock.calls[0];
    expect(action).toBe("delete");
    expect(ref).toMatchObject({ kind: "selection", from: 9, to: 13 });
    expect(text(editor, ref)).toBe("beta");
    // Removing exactly that range removes "beta" and nothing else.
    editor.commands.deleteRange(ref);
    expect(editor.state.doc.child(0).textContent).toBe("XXalpha  gamma");
  });

  it("an edit INSIDE the selected text closes the menu and the action refuses", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onSelect, onClose });
    const del = rowButton("Delete")!;
    act(() => {
      editor.commands.insertContentAt(9, "Z");
    });
    expect(onClose).toHaveBeenCalled();
    // A click racing the close refuses instead of acting on shifted text.
    fireEvent.click(del);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("task 737 — the grey-out is re-asked of the live document", () => {
  it("a row enabled at open greys once the containing block stops allowing it", async () => {
    renderMenu({});
    const before = enabledLabels();
    expect(before.some((l) => l.includes("Footnote"))).toBe(true);
    // p-A becomes a codeBlock underneath the open menu: the selected text is
    // unchanged (not stale), but footnotes cannot live in a codeBlock.
    act(() => {
      editor.chain().setTextSelection(3).setNode("codeBlock").run();
    });
    await flushFrame();
    const after = enabledLabels();
    expect(after.some((l) => l.includes("Footnote"))).toBe(false);
    expect(after).not.toEqual(before);
  });
});

describe("task 737 — the menu does not stay parked over a block it no longer points at", () => {
  const menuTop = () => {
    const el = document.querySelector('[role="menu"]') as HTMLElement | null;
    return el ? el.style.top : null;
  };

  it("scrolling re-anchors the menu to the target's live position", async () => {
    let top = 200;
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(
      () => ({ top, bottom: top + 20, left: 150, right: 160 }) as never,
    );
    renderMenu({});
    await flushFrame();
    const first = menuTop();
    expect(first).toBeTruthy();
    top = 120; // the content scrolled up by 80px
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();
    const second = menuTop();
    expect(second).toBeTruthy();
    expect(parseFloat(second!)).toBeCloseTo(parseFloat(first!) - 80, 0);
  });

  it("scrolling the target out of the viewport closes the menu", async () => {
    let top = 200;
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation(
      () => ({ top, bottom: top + 20, left: 150, right: 160 }) as never,
    );
    const onClose = vi.fn();
    renderMenu({ onClose });
    await flushFrame();
    top = -5000;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();
    expect(onClose).toHaveBeenCalled();
  });
});
