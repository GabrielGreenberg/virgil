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
        setCoords({ left: c.left, top: c.top, bottom: c.bottom });
      } catch {
        setCoords(null);
      }
    };
    // RAF-coalesce: scroll/resize fire per-tick; only one recompute per
    // frame is actually useful. Previously every scroll tick called
    // `coordsAtPos` + `setCoords` synchronously.
    const scheduleUpdate = () => {
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
  }, [state.open, state.open ? state.slashPos : -1, editorRef]);

  if (!state.open || !coords) return null;

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
        zIndex: 1000,
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
