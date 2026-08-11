"use client";

/**
 * Inline popup that floats from the cursor's text line when the user
 * types `\` at a fresh position in a paragraph. The popup lists the
 * Virgil LaTeX commands ({@link VIRGIL_COMMAND_NAMES}); arrow keys +
 * Enter / Tab pick one and immediately run its action. Backspace,
 * Escape, or typing past any prefix match dismisses.
 *
 * The ProseMirror plugin in {@link SlashPopupExtension} owns the
 * canonical state and mirrors it to {@link slashPopupStore}; this
 * component subscribes via {@link useSlashPopupState}.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useSlashPopupState } from "@/lib/slash-popup-store";
import { executeSlashSelectionAt } from "@/lib/tiptap/slash-popup";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import {
  recordScrollPlacement,
  SCROLL_PORTAL_SLASH_POPUP,
} from "@/lib/scroll-reposition-probe";
import {
  isLayoutGestureActive,
  useLayoutGestureActive,
} from "@/lib/pane-resize";

const POPUP_WIDTH = 180;
const VIEWPORT_MARGIN = 8;
const GAP = 4;
const ROW_HEIGHT = 24;
const POPUP_PAD_Y = 4;

interface Coords {
  left: number;
  top: number;
  bottom: number;
}

export function SlashCommandPopup({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const state = useSlashPopupState();
  const [coords, setCoords] = useState<Coords | null>(null);

  const rafRef = useRef<number>(0);
  // Hidden for the duration of a pane-divider drag / OS window resize. The
  // placement effect below re-runs on the end edge (the flag is a dep), which
  // is the settle.
  const gestureActive = useLayoutGestureActive();
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!state.open) {
      setCoords(null);
      return;
    }
    const view = editor.view;
    const update = () => {
      try {
        const c = view.coordsAtPos(state.slashPos);
        // Scroll-anchor stability probe (task 042): one record per coalesced frame.
        recordScrollPlacement(SCROLL_PORTAL_SLASH_POPUP, c.top);
        // Equality bail (task 317): `coordsAtPos` returns fresh numbers in a
        // fresh object, so an unconditional set re-rendered the popup on every
        // coalesced frame even when the caret hadn't moved a pixel.
        setCoords((prev) =>
          prev &&
          prev.left === c.left &&
          prev.top === c.top &&
          prev.bottom === c.bottom
            ? prev
            : { left: c.left, top: c.top, bottom: c.bottom },
        );
      } catch {
        setCoords(null);
      }
    };
    // RAF-coalesce: scroll/resize fire per-tick; only one recompute per
    // frame is actually useful. Previously every scroll tick called
    // `coordsAtPos` + `setCoords` synchronously.
    const scheduleUpdate = () => {
      // SUPPRESSED during a continuous layout gesture (task 317): the popup is
      // a caret-anchored fixed portal, so it hides for the gesture (the render
      // gate below) rather than parking half-detached from its slash.
      if (isLayoutGestureActive()) return;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        update();
      });
    };
    update();
    const onTr = () => scheduleUpdate();
    editor.on("transaction", onTr);
    // Scroll: the editor's actual scroll container, not window — the
    // editor's column scrolls via the unified row scroll, and a window-
    // scope listener picks up unrelated scroll events from panels.
    const scrollParent = findEditorScrollFor(view.dom);
    scrollParent?.addEventListener("scroll", scheduleUpdate, { passive: true });
    // Resize is genuinely window-scoped (viewport change).
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      editor.off("transaction", onTr);
      scrollParent?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [state.open, state.open ? state.slashPos : -1, editorRef, gestureActive]);

  if (!state.open || !coords || gestureActive) return null;

  const popupHeight = state.filtered.length * ROW_HEIGHT + POPUP_PAD_Y * 2;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  let left = coords.left;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - POPUP_WIDTH - VIEWPORT_MARGIN));
  let top = coords.bottom + GAP;
  if (top + popupHeight > vh - VIEWPORT_MARGIN) {
    top = coords.top - popupHeight - GAP;
  }

  return createPortal(
    <div
      className="slash-command-popup bg-surface border border-edge-subtle rounded shadow-md py-1"
      style={{
        position: "fixed",
        left,
        top,
        width: POPUP_WIDTH,
        // Caret popup rides the open-chrome-menu tier (task 033), promoted off
        // the old ad-hoc `1000` so a popped card / lifted overlay can't occlude
        // it — matches NodeEditPopover + the <Menu> primitive.
        zIndex: OPEN_CHROME_MENU_Z,
      }}
      onMouseDown={(e) => {
        // Prevent the editor from losing focus when clicking a row.
        e.preventDefault();
      }}
    >
      {state.filtered.map((name, i) => {
        const selected = i === state.selectedIndex;
        return (
          <button
            key={name}
            type="button"
            onClick={() => {
              const editor = editorRef.current;
              if (!editor) return;
              executeSlashSelectionAt(editor.view, i);
              editor.commands.focus();
            }}
            className={`block w-full text-left px-3 font-mono text-xs text-ink-body ${
              selected ? "bg-edge-subtle" : "hover-on-light"
            }`}
            style={{ height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
          >
            {`\\${name}`}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
