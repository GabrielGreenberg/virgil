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
 *  - {@link SelectionDragHandle} (left side) for the drag-to-lift gesture.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { resolveAnchorableNode, resolveAnchorUuidAndKind } from "@/lib/anchor-uuid";
import type { TextObjectKind } from "@/text-objects/types";
import { IconZap } from "./editor-layout/panel-icons";
import { ActionsMenuPanel } from "./ActionsMenuPanel";
import { useHint } from "./Hint";
import {
  useEditorViewportCache,
  type EditorViewportCache,
} from "@/hooks/useEditorViewportCache";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { RESTING_GUTTER_TRIGGER_Z } from "@/floats/float-policy";

const VIEWPORT_MARGIN = 8;
const RIGHT_GAP = 6;
// Action-button (collapsed state) dimensions — sized to match one menu row's
// vertical rhythm so the button feels like a single seed of the menu it opens.
const BUTTON_SIZE = 28;

const INVISIBLE_PLACEMENT: Placement = {
  visible: false,
  left: 0,
  top: 0,
  anchorNodePos: null,
  range: null,
  mode: "selection",
};

interface Placement {
  visible: boolean;
  left: number;
  top: number;
  /**
   * Position of the anchorable container at the head, used as the close-on-
   * paragraph-change identity. Stable across UUID hydration (setNodeMarkup
   * doesn't shift positions), so opening the menu — which may hydrate a UUID
   * — does not collapse the menu it just opened.
   */
  anchorNodePos: number | null;
  range: { from: number; to: number } | null;
  mode: "selection" | "cursor";
}

/**
 * Single placement rule: far-right gutter at the line containing the
 * selection head. Stable under tiny selection changes because the X
 * comes from the editor box (not per-line geometry) and the Y is the
 * head line's top.
 *
 * Per-keystroke cost: one `coordsAtPos(head)` + arithmetic on cached
 * editor metrics. The `cache` object holds editorRight, scrollTop,
 * scrollBottom — values that only change on resize / layout shift.
 */
function computePlacement(editor: Editor, cache: EditorViewportCache): Placement {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return INVISIBLE_PLACEMENT;
  // Cursor-only mode is gated on focus so the button doesn't materialize
  // at the document's default cursor position on first paint, before the
  // user has ever clicked into the prose.
  if (sel.empty && !editor.isFocused) return INVISIBLE_PLACEMENT;
  if (!cache.editorEl) return INVISIBLE_PLACEMENT;

  const { from, to, head } = sel;
  const anchor = resolveAnchorableNode(editor.view, head);
  const anchorNodePos = anchor?.nodePos ?? null;

  let headCoords: { left: number; top: number; bottom: number };
  try {
    headCoords = editor.view.coordsAtPos(head);
  } catch {
    return INVISIBLE_PLACEMENT;
  }

  const textRight = cache.editorRight;
  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;

  if (headCoords.bottom < scrollTop || headCoords.top > scrollBottom) {
    return {
      visible: false,
      left: 0,
      top: 0,
      anchorNodePos,
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
  let top = Math.max(headCoords.top, scrollTop, VIEWPORT_MARGIN);
  if (top + BUTTON_SIZE > vh - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, vh - BUTTON_SIZE - VIEWPORT_MARGIN);
  }

  return {
    visible: true,
    left,
    top,
    anchorNodePos,
    range: { from, to },
    mode: sel.empty ? "cursor" : "selection",
  };
}

function placementsEqual(a: Placement, b: Placement): boolean {
  return (
    a.visible === b.visible &&
    a.left === b.left &&
    a.top === b.top &&
    a.anchorNodePos === b.anchorNodePos &&
    a.mode === b.mode &&
    (a.range?.from ?? null) === (b.range?.from ?? null) &&
    (a.range?.to ?? null) === (b.range?.to ?? null)
  );
}

export function SelectionActionsMenu({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const [placement, setPlacement] = useState<Placement>(INVISIBLE_PLACEMENT);
  const [menuTarget, setMenuTarget] = useState<{
    uuid: string;
    // The REAL anchorable node kind at the caret/head (heading, listItem, …,
    // else "paragraph"). Threaded into ActionsMenuPanel so the cursor-mode
    // dispatch ref carries the real kind instead of a flattened "paragraph"
    // (the BUG2 fix). Both the dispatch ref and the grey-out probe derive from
    // this ONE field, so they cannot diverge on identity.
    kind: TextObjectKind;
    range: { from: number; to: number };
    mode: "selection" | "cursor";
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Shared viewport-metrics cache. editorRight, scrollTop, scrollBottom
  // are read here per placement compute instead of being re-measured per
  // RAF. The cache refreshes only on resize / ResizeObserver-detected
  // layout changes. `version` participates in the effect deps so the
  // compute re-runs when the cache changes (e.g., sidebar toggle).
  const { cacheRef, version: cacheVersion } = useEditorViewportCache(
    editorRef.current,
  );

  // Single RAF-coalesced compute on every event that could move or hide
  // the button. The button is small and tracks the cursor's head line
  // smoothly.
  //
  // Suppression: while the user is mid-drag (left mousedown started inside
  // the editor prose) or actively scrolling, the placement math is gated
  // off entirely. PM `selectionUpdate` etc. still fire, but they hit
  // `isSuppressed()` and return before scheduling RAF — no `coordsAtPos`,
  // no setState. This keeps the button from flickering frame-by-frame
  // while the head line is in motion.
  //
  // Equality: `setPlacement` short-circuits via `placementsEqual` when
  // the new placement is structurally identical to the old. Typing
  // within a single visual line keeps headCoords.top constant, so most
  // keystrokes hit the bail-out and don't trigger a React re-render of
  // the portaled button.
  useEffect(() => {
    let rafId = 0;
    let readyRaf = 0;
    let subscribed: Editor | null = null;
    let mouseDownInEditor = false;
    let scrollIdleTimer: number | null = null;
    const SCROLL_IDLE_MS = 120;
    const isSuppressed = () => mouseDownInEditor || scrollIdleTimer !== null;
    const run = () => {
      const ed = editorRef.current;
      const next = ed && !ed.isDestroyed
        ? computePlacement(ed, cacheRef.current)
        : INVISIBLE_PLACEMENT;
      setPlacement((prev) => (placementsEqual(prev, next) ? prev : next));
    };
    const update = () => {
      if (isSuppressed()) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        run();
      });
    };
    const suppress = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setPlacement(INVISIBLE_PLACEMENT);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const ed = editorRef.current;
      if (!ed) return;
      const t = e.target as Node | null;
      if (t && ed.view.dom.contains(t)) {
        mouseDownInEditor = true;
        suppress();
      }
    };
    const onMouseUp = () => {
      if (!mouseDownInEditor) return;
      mouseDownInEditor = false;
      if (!isSuppressed()) update();
    };
    const onScroll = () => {
      if (scrollIdleTimer === null) {
        suppress();
      } else {
        window.clearTimeout(scrollIdleTimer);
      }
      scrollIdleTimer = window.setTimeout(() => {
        scrollIdleTimer = null;
        if (!isSuppressed()) update();
      }, SCROLL_IDLE_MS);
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
    // Mousedown/mouseup at window scope: the drag may originate inside
    // the editor and complete outside, so we need both ends. Captured
    // phase to beat React's bubbling cleanup.
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    // Scroll: the editor's scroll parent only. Window-scope previously
    // fired this handler for every panel/list scroll in the app even
    // though the menu only tracks the editor's vertical scroll.
    const scrollParent = findEditorScrollFor(
      editorRef.current?.view.dom ?? null,
    );
    scrollParent?.addEventListener("scroll", onScroll, { passive: true });
    // Resize is a genuinely global event.
    window.addEventListener("resize", update);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (readyRaf) cancelAnimationFrame(readyRaf);
      if (scrollIdleTimer !== null) window.clearTimeout(scrollIdleTimer);
      unsubscribe();
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      scrollParent?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
    };
    // cacheVersion re-runs the effect when the cache changes (e.g.,
    // sidebar toggle changes editorRight). cacheRef itself is stable.
  }, [editorRef, cacheRef, cacheVersion]);

  // Close the menu on logical changes only — selection moved, paragraph
  // changed, mode flipped, visibility dropped. `left/top` excluded so
  // scroll re-positions the open menu instead of collapsing it.
  // `anchorNodePos` (not UUID) is the identity key: it's stable across the
  // `ensureAnchorUuid` setNodeMarkup that fires when the menu opens.
  useEffect(() => {
    setMenuTarget(null);
  }, [
    placement.range?.from,
    placement.range?.to,
    placement.anchorNodePos,
    placement.mode,
    placement.visible,
  ]);

  // Keep the latest open-state reachable from the mount-once Cmd+/ handler
  // without re-subscribing the listener on every selection change.
  const menuOpenRef = useRef(false);
  useEffect(() => {
    menuOpenRef.current = menuTarget !== null;
  }, [menuTarget]);

  // Cmd+/ opens the menu at the live cursor/selection — the keyboard twin of
  // clicking the gutter ⚡. O(1) bail; window-level (not an editor.on
  // subscriber), so it costs nothing per keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      // Already open → toggle it closed (cursor stays; editor kept focus).
      if (menuOpenRef.current) {
        e.preventDefault();
        setMenuTarget(null);
        return;
      }
      if (!ed.isFocused) return;
      const sel = ed.state.selection;
      if (sel instanceof NodeSelection) return;
      const resolved = resolveAnchorUuidAndKind(ed.view, sel.head);
      if (!resolved) return;
      e.preventDefault();
      setMenuTarget({
        uuid: resolved.uuid,
        kind: resolved.kind,
        range: { from: sel.from, to: sel.to },
        mode: sel.empty ? "cursor" : "selection",
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editorRef]);

  const hint = useHint({ keys: "Mod+/" });

  if (!placement.visible) return null;
  if (typeof document === "undefined") return null;

  const editor = editorRef.current;
  if (!editor) return null;

  const openMenu = () => {
    if (!placement.range) return;
    const resolved = resolveAnchorUuidAndKind(
      editor.view,
      editor.state.selection.head,
    );
    if (!resolved) return;
    setMenuTarget({
      uuid: resolved.uuid,
      kind: resolved.kind,
      range: placement.range,
      mode: placement.mode,
    });
  };

  // Collapsed-state action button. Same chrome variables as the menu so
  // the two states feel like one component: the menu expands out of the
  // button, anchored at the same `left/top`.
  //
  // z-index: the RESTING bolt sits at `RESTING_GUTTER_TRIGGER_Z`
  // (= FLOAT_Z_BASE − 1, see src/floats/float-policy.ts tier map) — above
  // editor content + the docked-panel band so it's clickable when nothing
  // overlaps, but strictly BELOW the float layer (1200) so a popout / popped
  // card / lifted-text overlay dropped over this paragraph OCCLUDES the bolt
  // (BUG #50). This is the RESTING tier ONLY: clicking it opens the
  // `ActionsMenuPanel` below, which rides the `<Menu>` primitive's CHROME_Z
  // (2000, = OPEN_CHROME_MENU_Z) and therefore stays on top of EVERYTHING,
  // floats included. Never demote the open menu — only the resting trigger.
  const buttonPortal = createPortal(
    <button
      ref={buttonRef}
      type="button"
      aria-label="Open actions menu"
      {...hint}
      // Prevent the mousedown from blurring the editor / clearing the
      // selection before the click registers.
      onMouseDown={(e) => e.preventDefault()}
      onClick={openMenu}
      className="flex items-center justify-center hover-on-light"
      style={{
        position: "fixed",
        left: placement.left,
        top: placement.top,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        zIndex: RESTING_GUTTER_TRIGGER_Z,
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

  if (!menuTarget) return buttonPortal;

  return (
    <>
      {buttonPortal}
      <ActionsMenuPanel
        editor={editor}
        paragraphUuid={menuTarget.uuid}
        nodeKind={menuTarget.kind}
        range={menuTarget.range}
        mode={menuTarget.mode}
        triggerRect={{
          left: placement.left,
          top: placement.top,
          right: placement.left + BUTTON_SIZE,
          bottom: placement.top + BUTTON_SIZE,
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
        }}
        onClose={() => setMenuTarget(null)}
      />
    </>
  );
}
