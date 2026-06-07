"use client";

/**
 * Stable trigger for the action menu, mounted in the MenuBar's
 * paragraph-nav strip just to the left of the back/forward arrows.
 * Always visible (unlike {@link SelectionActionsMenu}'s gutter button,
 * which only appears when the cursor is in the editor). Disabled until
 * the editor has been focused at least once.
 *
 * Clicking the button mounts {@link ActionsMenuPanel} dropping down
 * just below the button. Mode mirrors what the gutter button would show:
 * "selection" if there's a non-empty selection, "cursor" otherwise.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { resolveAnchorableNode, ensureAnchorUuid } from "@/lib/anchor-uuid";
import { IconZap } from "./editor-layout/panel-icons";
import { ActionsMenuPanel } from "./ActionsMenuPanel";
import { useHint } from "./Hint";

interface Target {
  /** Position of the anchorable container — used as the enabled-state
   *  identity. UUID hydration happens at click time, not here. */
  anchorNodePos: number;
  range: { from: number; to: number };
  mode: "selection" | "cursor";
}

/** Read the cursor's anchorable container + range. Returns null if the
 *  editor isn't focused (so the strip button stays disabled until first
 *  real interaction) or the cursor isn't in an anchorable node. UUIDs
 *  are *not* required here — the button enables in any anchorable context
 *  and hydrates on click. */
function resolveTarget(editor: Editor): Target | null {
  if (!editor.isFocused) return null;
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return null;
  const anchor = resolveAnchorableNode(editor.view, sel.head);
  if (!anchor) return null;
  return {
    anchorNodePos: anchor.nodePos,
    range: { from: sel.from, to: sel.to },
    mode: sel.empty ? "cursor" : "selection",
  };
}

export function ActionsStripButton({ editor }: { editor: Editor | null }) {
  const [openState, setOpenState] = useState<{
    uuid: string;
    range: { from: number; to: number };
    mode: "selection" | "cursor";
    rect: DOMRect;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Re-render on every selection/focus change so the disabled state and
  // the target snapshot reflect the live editor state. RAF-batched so
  // a typing burst (which fires selectionUpdate per keystroke via the
  // implied caret move) produces one re-render per frame, not one
  // per character. Sub-frame precision isn't needed for a button's
  // disabled state.
  const [, bumpTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let pending = 0;
    const tick = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        bumpTick((t) => (t + 1) & 0xffff);
      });
    };
    editor.on("selectionUpdate", tick);
    editor.on("focus", tick);
    editor.on("blur", tick);
    return () => {
      editor.off("selectionUpdate", tick);
      editor.off("focus", tick);
      editor.off("blur", tick);
      if (pending) cancelAnimationFrame(pending);
    };
  }, [editor]);

  const target = editor ? resolveTarget(editor) : null;
  const disabled = !target;

  const hint = useHint({ label: "Open actions menu", keys: "Mod+/" });

  const onClick = () => {
    if (!editor || !target || !btnRef.current) return;
    const uuid = ensureAnchorUuid(editor.view, editor.state.selection.head);
    if (!uuid) return;
    setOpenState({
      uuid,
      range: target.range,
      mode: target.mode,
      rect: btnRef.current.getBoundingClientRect(),
    });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseDown={(e) => e.preventDefault()}
        disabled={disabled}
        aria-label="Open actions menu"
        {...hint}
        className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"
        style={{ width: 16, height: 20 }}
      >
        <IconZap size={14} muted />
      </button>
      {openState && editor && (
        <ActionsMenuPanel
          editor={editor}
          paragraphUuid={openState.uuid}
          range={openState.range}
          mode={openState.mode}
          triggerRect={openState.rect}
          onClose={() => setOpenState(null)}
        />
      )}
    </>
  );
}
