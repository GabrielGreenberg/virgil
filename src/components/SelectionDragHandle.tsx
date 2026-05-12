"use client";

/**
 * Floating drag handle for arbitrary text selections.
 *
 * Mirrors the paragraph drag handle (6-dot grip, same visuals, same lift
 * gesture) but anchored to whatever text the user has selected. The
 * handle:
 *  - Appears when the editor has a non-empty selection.
 *  - Pins to the left edge of the paragraph at the selection's `from`,
 *    aligned to the first visible line of the selection (sticky to the
 *    editor scroll container's top when the selection's top is scrolled
 *    above the viewport).
 *  - Suppresses the paragraph drag handle on the source paragraph when
 *    the selection starts on that paragraph's first visual line
 *    (toggles `.is-superseded` on the matching `.par-drag-handle`).
 *  - On grab + drag past the lift threshold, captures the selection
 *    content/range and spawns a `SelectionFloat` via the shared
 *    card-lift handoff protocol.
 *
 * Rendered as a child of the editor wrapper; portals to `document.body`
 * with `position: fixed` so it isn't clipped by editor overflow.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftHandoff } from "./card-lift";
import { registerSelectionFloat } from "./selection-floats";
import { generateShortId } from "@/lib/uuid";
import { isAnchorableNode } from "@/lib/marginalia";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";

const LIFT_THRESHOLD = 5;
const FLOAT_W = 360;
const FLOAT_H = 280;
const HANDLE_OFFSET_LEFT = 18;
const FIRST_LINE_EPSILON = 2;

interface Placement {
  visible: boolean;
  left: number;
  top: number;
  paragraphUuid: string | null;
  superseded: boolean;
  range: { from: number; to: number } | null;
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

function computePlacement(editor: Editor): Placement {
  const { from, to } = editor.state.selection;
  if (from === to) {
    return {
      visible: false,
      left: 0,
      top: 0,
      paragraphUuid: null,
      superseded: false,
      range: null,
    };
  }
  // Resolve the first containing block (paragraph, heading, list item, …).
  const $from = editor.state.doc.resolve(from);
  let blockStartPos = -1;
  let blockUuid: string | null = null;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (isAnchorableNode(node.type)) {
      blockStartPos = $from.start(depth);
      blockUuid = (node.attrs?.uuid as string | null) ?? null;
      break;
    }
  }
  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  let blockStartCoords: { left: number; top: number } | null = null;
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
    if (blockStartPos >= 0) {
      blockStartCoords = editor.view.coordsAtPos(blockStartPos);
    }
  } catch {
    return {
      visible: false,
      left: 0,
      top: 0,
      paragraphUuid: null,
      superseded: false,
      range: null,
    };
  }
  const scrollParent = findScrollParent(editor.view.dom as HTMLElement);
  const scrollRect = scrollParent?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
  };
  // Hide entirely if selection is fully above the visible editor pane.
  if (toCoords.bottom < scrollRect.top) {
    return {
      visible: false,
      left: 0,
      top: 0,
      paragraphUuid: blockUuid,
      superseded: false,
      range: { from, to },
    };
  }
  // Hide if entirely below the visible pane.
  if (fromCoords.top > scrollRect.bottom) {
    return {
      visible: false,
      left: 0,
      top: 0,
      paragraphUuid: blockUuid,
      superseded: false,
      range: { from, to },
    };
  }
  // Horizontal: align to the source paragraph's text-edge.
  const baseLeft = blockStartCoords?.left ?? fromCoords.left;
  const left = baseLeft - HANDLE_OFFSET_LEFT;
  // Vertical: pin to the topmost visible position. If the selection's
  // top is above the editor pane, stick at the pane's top.
  const top = Math.max(fromCoords.top, scrollRect.top);
  // First-line supersession: only when the selection's top is still on
  // its source paragraph's first visual line.
  let superseded = false;
  if (
    blockUuid &&
    blockStartCoords &&
    Math.abs(fromCoords.top - blockStartCoords.top) < FIRST_LINE_EPSILON &&
    fromCoords.top >= scrollRect.top - FIRST_LINE_EPSILON
  ) {
    superseded = true;
  }
  return {
    visible: true,
    left,
    top,
    paragraphUuid: blockUuid,
    superseded,
    range: { from, to },
  };
}

export function SelectionDragHandle({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const popped = usePoppedCards();
  const [placement, setPlacement] = useState<Placement>({
    visible: false,
    left: 0,
    top: 0,
    paragraphUuid: null,
    superseded: false,
    range: null,
  });
  const handleElRef = useRef<HTMLDivElement | null>(null);
  // Track which paragraph handle (by uuid) is currently superseded so we
  // can reliably restore it when the selection changes.
  const supersededUuidRef = useRef<string | null>(null);
  // Track the editor instance currently subscribed-to so we don't double-
  // subscribe across re-renders.
  const subscribedEditorRef = useRef<Editor | null>(null);
  // Last-known non-empty selection range. Stashed on every selectionUpdate
  // so the lift gesture can read it even after the editor has lost focus
  // (e.g. when mousedown lands on the portaled handle outside the editor's
  // contentEditable, which can collapse the live selection in some
  // browsers).
  const lastRangeRef = useRef<{ from: number; to: number } | null>(null);
  // Mirror placement.paragraphUuid so the lift gesture can read the source
  // paragraph id without re-resolving from a possibly-stale selection.
  const lastParagraphIdRef = useRef<string | null>(null);

  useEffect(() => {
    let prevEditor: Editor | null = null;
    const cleanupListeners = () => {
      if (prevEditor) {
        prevEditor.off("selectionUpdate", schedule);
        prevEditor.off("update", schedule);
      }
    };
    const schedule = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        lastRangeRef.current = null;
        lastParagraphIdRef.current = null;
        setPlacement((p) =>
          p.visible
            ? { visible: false, left: 0, top: 0, paragraphUuid: null, superseded: false, range: null }
            : p,
        );
        return;
      }
      const next = computePlacement(editor);
      if (next.visible && next.range) {
        lastRangeRef.current = next.range;
        lastParagraphIdRef.current = next.paragraphUuid;
      } else {
        lastRangeRef.current = null;
        lastParagraphIdRef.current = null;
      }
      setPlacement(next);
    };
    const ensureSubscribed = () => {
      const editor = editorRef.current;
      if (editor === subscribedEditorRef.current) return;
      cleanupListeners();
      subscribedEditorRef.current = editor;
      prevEditor = editor;
      if (editor) {
        editor.on("selectionUpdate", schedule);
        editor.on("update", schedule);
      }
    };
    // Poll briefly until the editor instance is available (it's created
    // asynchronously by useEditor in the parent).
    let pollAttempts = 0;
    const poll = () => {
      ensureSubscribed();
      schedule();
      if (!editorRef.current && pollAttempts < 30) {
        pollAttempts += 1;
        window.setTimeout(poll, 50);
      }
    };
    poll();
    const onScroll = () => schedule();
    const onResize = () => schedule();
    // Force PM's `state.selection` to mirror the live DOM selection so
    // `SelectionDragHandle` (and downstream consumers like the lift
    // gesture) always have a PM range to work with. The main editor
    // relies on PM's internal domobserver to sync, but the Reader mounts
    // with `contenteditable="true"` despite being read-only (so native
    // drag-to-select works), and in some browsers PM's selectionchange
    // path skips the sync when the view never receives focus during the
    // drag — leaving `state.selection` empty even though the DOM shows
    // a highlighted range. This listener closes that gap: on any
    // document selection change, if the DOM range is non-empty and
    // entirely inside the editor, dispatch the equivalent `TextSelection`
    // so PM stays current. Harmless in the main editor (the dispatched
    // range matches PM's existing one, so no-op via the equality check).
    const onDocSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      const view = editor.view;
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) {
        schedule();
        return;
      }
      const range = domSel.getRangeAt(0);
      if (range.collapsed) {
        schedule();
        return;
      }
      const dom = view.dom as Node;
      if (!dom.contains(range.startContainer) || !dom.contains(range.endContainer)) {
        return;
      }
      try {
        const a = view.posAtDOM(range.startContainer, range.startOffset, 1);
        const b = view.posAtDOM(range.endContainer, range.endOffset, -1);
        if (a < 0 || b < 0) return;
        const pmFrom = Math.min(a, b);
        const pmTo = Math.max(a, b);
        if (pmFrom === pmTo) return;
        const cur = view.state.selection;
        if (cur.from === pmFrom && cur.to === pmTo) {
          schedule();
          return;
        }
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pmFrom, pmTo),
        );
        view.dispatch(tr);
      } catch {
        /* posAtDOM throws when the DOM position can't be resolved (e.g.
         * selection inside a node-view's chrome). Fall back to scheduling
         * a re-read from whatever PM does have. */
        schedule();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("selectionchange", onDocSelectionChange);
    return () => {
      cleanupListeners();
      // Reset on cleanup so the next effect run (HMR remount or strict-
      // mode double-invocation) re-subscribes instead of seeing
      // editor === subscribedEditorRef.current and skipping.
      subscribedEditorRef.current = null;
      prevEditor = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("selectionchange", onDocSelectionChange);
    };
  }, [editorRef]);

  // Drive the `.is-superseded` class on the matching paragraph drag handle.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    const root = editor?.view.dom as HTMLElement | undefined;
    const prev = supersededUuidRef.current;
    const nextUuid =
      placement.visible && placement.superseded ? placement.paragraphUuid : null;
    if (prev && prev !== nextUuid && root) {
      const el = root.querySelector(
        `.par-drag-handle[data-par-uuid="${prev}"]`,
      );
      if (el) el.classList.remove("is-superseded");
    }
    if (nextUuid && root) {
      const el = root.querySelector(
        `.par-drag-handle[data-par-uuid="${nextUuid}"]`,
      );
      if (el) el.classList.add("is-superseded");
    }
    supersededUuidRef.current = nextUuid;
  }, [editorRef, placement.visible, placement.superseded, placement.paragraphUuid]);

  // Clear supersession on unmount so a leftover `.is-superseded` doesn't
  // permanently hide a paragraph handle if this component remounts.
  // Capture the supersededUuidRef in a local so the cleanup function
  // reads the same Set instance that was active when the effect ran.
  useEffect(() => {
    const editor = editorRef.current;
    const root = editor?.view.dom as HTMLElement | undefined;
    const supersededRef = supersededUuidRef;
    return () => {
      const prev = supersededRef.current;
      if (prev && root) {
        const el = root.querySelector(
          `.par-drag-handle[data-par-uuid="${prev}"]`,
        );
        if (el) el.classList.remove("is-superseded");
      }
      supersededRef.current = null;
    };
  }, [editorRef]);

  // Bind the lift gesture as a NATIVE (non-delegated) mousedown listener so
  // that `preventDefault()` runs in the direct dispatch phase, before the
  // browser updates focus / clears the editor's text selection. React's
  // synthetic-event delegation fires too late for that.
  const poppedRef = useRef(popped);
  useEffect(() => {
    poppedRef.current = popped;
  }, [popped]);
  const dragHandleMenu = useDragHandleMenu();
  const dragHandleMenuRef = useRef(dragHandleMenu);
  useEffect(() => {
    dragHandleMenuRef.current = dragHandleMenu;
  }, [dragHandleMenu]);
  useEffect(() => {
    const handleEl = handleElRef.current;
    if (!handleEl) return;
    const onMouseDown = (downEv: MouseEvent) => {
      if (downEv.button !== 0) return;
      downEv.preventDefault();
      downEv.stopPropagation();
      const editor = editorRef.current;
      if (!editor) return;
      handleEl.classList.add("is-pressed");
      const startX = downEv.clientX;
      const startY = downEv.clientY;
      let triggered = false;
      const onMove = (mv: MouseEvent) => {
        if (triggered) return;
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        if (dx * dx + dy * dy < LIFT_THRESHOLD * LIFT_THRESHOLD) return;
        triggered = true;
        // Use the last-known range stashed when the handle was rendered.
        // The live editor selection may have collapsed if the browser
        // moved focus despite preventDefault.
        const stashedRange = lastRangeRef.current;
        const live = editor.state.selection;
        const range = stashedRange ?? (live.from === live.to ? null : { from: live.from, to: live.to });
        if (!range) {
          cleanup();
          return;
        }
        const { from, to } = range;
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.max(0, Math.min(from, docSize));
        const safeTo = Math.max(0, Math.min(to, docSize));
        if (safeFrom >= safeTo) {
          cleanup();
          return;
        }
        const slice = editor.state.doc.slice(safeFrom, safeTo);
        const contentJson = {
          type: "doc",
          content: [
            { type: "paragraph", content: slice.content.toJSON() },
          ],
        };
        let paragraphId = lastParagraphIdRef.current;
        if (!paragraphId) {
          const $from = editor.state.doc.resolve(safeFrom);
          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth);
            if (isAnchorableNode(node.type)) {
              paragraphId = (node.attrs?.uuid as string | null) ?? null;
              break;
            }
          }
        }
        const text = editor.state.doc.textBetween(safeFrom, safeTo, " ");
        const id = generateShortId();
        registerSelectionFloat(id, {
          range: { from: safeFrom, to: safeTo },
          contentJson,
          paragraphId,
          text,
        });
        const cardKey = `selection:${id}`;
        const spawn = {
          x: Math.round(mv.clientX - FLOAT_W / 2),
          y: Math.round(mv.clientY - 16),
          width: FLOAT_W,
          height: FLOAT_H,
        };
        setCardLiftHandoff({
          cardKey,
          clientX: mv.clientX,
          clientY: mv.clientY,
          width: FLOAT_W,
          height: FLOAT_H,
        });
        poppedRef.current?.popOutAtRect(cardKey, spawn);
        cleanup();
      };
      const onUp = () => {
        // No lift — treat as a click and open the passage-action menu
        // anchored to the live-selection handle, scoped to the current
        // selection range.
        if (!triggered) {
          const open = dragHandleMenuRef.current?.open;
          const range = lastRangeRef.current;
          const paragraphId = lastParagraphIdRef.current;
          if (open && range && paragraphId) {
            const rect = handleEl.getBoundingClientRect();
            open(
              {
                kind: "selection",
                paragraphId,
                from: range.from,
                to: range.to,
              },
              rect,
            );
          }
        }
        cleanup();
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        handleEl.classList.remove("is-pressed");
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    handleEl.addEventListener("mousedown", onMouseDown);
    return () => {
      handleEl.removeEventListener("mousedown", onMouseDown);
    };
    // Re-bind whenever the rendered handle changes (visibility toggle).
  }, [editorRef, placement.visible]);

  if (!placement.visible) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={handleElRef}
      className="selection-drag-handle"
      style={{ left: placement.left, top: placement.top }}
      title="Drag selection"
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>,
    document.body,
  );
}
