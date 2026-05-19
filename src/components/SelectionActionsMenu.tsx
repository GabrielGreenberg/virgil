"use client";

/**
 * The contextual gutter trigger for the action menu. Renders a small
 * yellow-lightning-bolt button anchored in the far-right gutter at the
 * head line of the current selection (or cursor, when no selection).
 * Clicking it mounts {@link ActionsMenuPanel} at the button's position.
 *
 * Single placement rule: `textRight + RIGHT_GAP` at the head line.
 * RAF-batched updates on PM `selectionUpdate` / `update` / `focus` /
 * `blur` plus window `scroll` / `resize`.
 *
 * Counterpart triggers:
 *  - {@link ActionsStripButton} mounted in the MenuBar para-nav group
 *    (stable, always visible above the editor).
 *  - {@link SelectionDragHandle} (left side) for the drag-to-lift gesture.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { isAnchorableNode } from "@/lib/marginalia";
import { IconZap } from "./editor-layout/panel-icons";
import { ActionsMenuPanel } from "./ActionsMenuPanel";

const VIEWPORT_MARGIN = 8;
const RIGHT_GAP = 6;
// Action-button (collapsed state) dimensions — sized to match one menu row's
// vertical rhythm so the button feels like a single seed of the menu it opens.
const BUTTON_SIZE = 28;

const INVISIBLE_PLACEMENT: Placement = {
  visible: false,
  left: 0,
  top: 0,
  paragraphUuid: null,
  range: null,
  mode: "selection",
};

interface Placement {
  visible: boolean;
  left: number;
  top: number;
  paragraphUuid: string | null;
  range: { from: number; to: number } | null;
  mode: "selection" | "cursor";
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const cs = window.getComputedStyle(cur);
    const ov = cs.overflowY;
    if ((ov === "auto" || ov === "scroll") && cur.scrollHeight > cur.clientHeight) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Single placement rule: far-right gutter at the line containing the
 * selection head. Stable under tiny selection changes because the X
 * comes from the editor box (not per-line geometry) and the Y is the
 * head line's top.
 */
function computePlacement(editor: Editor): Placement {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return INVISIBLE_PLACEMENT;
  // Cursor-only mode is gated on focus so the button doesn't materialize
  // at the document's default cursor position on first paint, before the
  // user has ever clicked into the prose.
  if (sel.empty && !editor.isFocused) return INVISIBLE_PLACEMENT;

  const { from, to, head } = sel;
  let paragraphUuid: string | null = null;
  const $head = editor.state.doc.resolve(head);
  for (let depth = $head.depth; depth >= 0; depth--) {
    const node = $head.node(depth);
    if (isAnchorableNode(node.type)) {
      paragraphUuid = (node.attrs?.uuid as string | null) ?? null;
      break;
    }
  }

  let headCoords: { left: number; top: number; bottom: number };
  try {
    headCoords = editor.view.coordsAtPos(head);
  } catch {
    return INVISIBLE_PLACEMENT;
  }

  const editorEl = editor.view.dom as HTMLElement;
  const editorRect = editorEl.getBoundingClientRect();
  const padRight = parseFloat(window.getComputedStyle(editorEl).paddingRight) || 0;
  const textRight = editorRect.right - padRight;
  const scrollParent = findScrollParent(editorEl);
  const scrollRect = scrollParent
    ? scrollParent.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };

  if (headCoords.bottom < scrollRect.top || headCoords.top > scrollRect.bottom) {
    return {
      visible: false,
      left: 0,
      top: 0,
      paragraphUuid,
      range: { from, to },
      mode: sel.empty ? "cursor" : "selection",
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = textRight + RIGHT_GAP;
  if (left + BUTTON_SIZE > vw - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, vw - BUTTON_SIZE - VIEWPORT_MARGIN);
  }
  let top = Math.max(headCoords.top, scrollRect.top, VIEWPORT_MARGIN);
  if (top + BUTTON_SIZE > vh - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, vh - BUTTON_SIZE - VIEWPORT_MARGIN);
  }

  return {
    visible: true,
    left,
    top,
    paragraphUuid,
    range: { from, to },
    mode: sel.empty ? "cursor" : "selection",
  };
}

export function SelectionActionsMenu({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const [placement, setPlacement] = useState<Placement>(INVISIBLE_PLACEMENT);
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Single RAF-coalesced compute on every event that could move or hide
  // the button. No candidate/applyVisibility/freeze indirection — the
  // button is small and tracks the cursor's head line smoothly.
  useEffect(() => {
    let rafId = 0;
    let readyRaf = 0;
    let subscribed: Editor | null = null;
    const run = () => {
      const ed = editorRef.current;
      setPlacement(ed && !ed.isDestroyed ? computePlacement(ed) : INVISIBLE_PLACEMENT);
    };
    const update = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        run();
      });
    };
    const subscribe = (ed: Editor) => {
      subscribed = ed;
      ed.on("selectionUpdate", update);
      ed.on("update", update);
      ed.on("focus", update);
      ed.on("blur", update);
    };
    const unsubscribe = () => {
      if (!subscribed) return;
      subscribed.off("selectionUpdate", update);
      subscribed.off("update", update);
      subscribed.off("focus", update);
      subscribed.off("blur", update);
      subscribed = null;
    };
    const waitForEditor = () => {
      const ed = editorRef.current;
      if (ed) {
        subscribe(ed);
        run();
        return;
      }
      readyRaf = requestAnimationFrame(waitForEditor);
    };
    waitForEditor();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (readyRaf) cancelAnimationFrame(readyRaf);
      unsubscribe();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editorRef]);

  // Close the menu on logical changes only — selection moved, paragraph
  // changed, mode flipped, visibility dropped. `left/top` excluded so
  // scroll re-positions the open menu instead of collapsing it.
  useEffect(() => {
    setMenuOpen(false);
  }, [
    placement.range?.from,
    placement.range?.to,
    placement.paragraphUuid,
    placement.mode,
    placement.visible,
  ]);

  if (!placement.visible) return null;
  if (typeof document === "undefined") return null;

  const editor = editorRef.current;
  if (!editor) return null;

  // Collapsed-state action button. Same chrome variables as the menu so
  // the two states feel like one component: the menu expands out of the
  // button, anchored at the same `left/top`.
  const buttonPortal = createPortal(
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open actions menu"
      title="Actions"
      // Prevent the mousedown from blurring the editor / clearing the
      // selection before the click registers.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setMenuOpen(true)}
      className="flex items-center justify-center hover-on-light"
      style={{
        position: "fixed",
        left: placement.left,
        top: placement.top,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        zIndex: 2000,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: 0,
        cursor: "pointer",
      }}
    >
      <IconZap size={16} />
    </button>,
    document.body,
  );

  if (!menuOpen) return buttonPortal;
  if (!placement.paragraphUuid || !placement.range) return buttonPortal;

  return (
    <ActionsMenuPanel
      editor={editor}
      paragraphUuid={placement.paragraphUuid}
      range={placement.range}
      mode={placement.mode}
      anchorLeft={placement.left}
      anchorTop={placement.top}
      onClose={() => setMenuOpen(false)}
    />
  );
}
