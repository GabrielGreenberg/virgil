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
import { isAnchorableNode } from "@/lib/marginalia";
import { IconZap } from "./editor-layout/panel-icons";
import { ActionsMenuPanel } from "./ActionsMenuPanel";

interface Target {
  paragraphUuid: string;
  range: { from: number; to: number };
  mode: "selection" | "cursor";
}

/** Read the cursor's anchorable paragraph + range. Returns null if the
 *  editor isn't focused (so the strip button stays disabled until first
 *  real interaction) or the cursor isn't in an anchorable node. */
function resolveTarget(editor: Editor): Target | null {
  if (!editor.isFocused) return null;
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection) return null;
  const $head = editor.state.doc.resolve(sel.head);
  let paragraphUuid: string | null = null;
  for (let depth = $head.depth; depth >= 0; depth--) {
    const node = $head.node(depth);
    if (isAnchorableNode(node.type)) {
      paragraphUuid = (node.attrs?.uuid as string | null) ?? null;
      break;
    }
  }
  if (!paragraphUuid) return null;
  return {
    paragraphUuid,
    range: { from: sel.from, to: sel.to },
    mode: sel.empty ? "cursor" : "selection",
  };
}

export function ActionsStripButton({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
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

  const onClick = () => {
    if (disabled || !btnRef.current) return;
    setAnchorRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseDown={(e) => e.preventDefault()}
        disabled={disabled}
        title="Actions"
        aria-label="Open actions menu"
        data-helper="Actions"
        className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"
        style={{ width: 16, height: 20 }}
      >
        <IconZap size={14} muted />
      </button>
      {open && editor && target && anchorRect && (
        <ActionsMenuPanel
          editor={editor}
          paragraphUuid={target.paragraphUuid}
          range={target.range}
          mode={target.mode}
          anchorLeft={anchorRect.left}
          anchorTop={anchorRect.bottom + 4}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
