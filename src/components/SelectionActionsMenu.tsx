"use client";

/**
 * Action affordance on the right side of the editor. Collapsed by
 * default to a small yellow-lightning-bolt button (the "action button")
 * that expands into the full SelectionActionsMenu on click.
 *
 * Two visibility triggers:
 *  - Non-empty selection — button anchors to the menu's four-mode
 *    placement (right gutter / below / above / overlap fallback).
 *  - Cursor-in-text (no selection) — button anchors to the far-right
 *    gutter at the cursor's line. Highlight is greyed out in this mode
 *    since it needs a real range; everything else attaches at the
 *    cursor position.
 *
 * When the menu is open it renders at the button's coordinates so the
 * two states feel like one component expanding in place. Letter
 * shortcuts (H/N/F/C/Q/T/E/X/A) only fire while the menu is open.
 *
 * Counterpart to {@link SelectionDragHandle} (left side, click-to-open
 * popover). The two coexist by design — the left handle keeps its
 * drag-to-lift gesture and click-to-open DragHandleMenu; this right
 * affordance is a faster path to the same vocabulary plus inline
 * formatting.
 *
 * Action dispatch goes through the same `dispatch` exposed via
 * DragHandleMenuApi that powers the click-on-handle popover — so
 * footnote / archive / note / etc. behave identically.
 */

import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { isAnchorableNode } from "@/lib/marginalia";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import { MENU_ENTRIES } from "./DragHandleMenu";
import { BlockTypeDropdown, buildExampleTemplate } from "./MenuBar";
import { insertTexBlock } from "@/lib/tiptap/tex-block";
import { SelectionColorPopover } from "./SelectionColorPopover";
import { IconZap } from "./editor-layout/panel-icons";

const COLOR_PALETTE_KEY = "virgil:selection-menu-color-palette";
const DEFAULT_PALETTE = [
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // yellow
  "#16a34a", // green
  "#2563eb", // blue
  "#9333ea", // purple
  "#6b7280", // gray
];

/** Validate that a stored palette is an array of 7 hex strings.
 *  Returns the defaults on any mismatch so a corrupted localStorage
 *  entry never breaks the menu. */
function loadPalette(): string[] {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  try {
    const raw = window.localStorage.getItem(COLOR_PALETTE_KEY);
    if (!raw) return DEFAULT_PALETTE;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 7) return DEFAULT_PALETTE;
    if (!parsed.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))) {
      return DEFAULT_PALETTE;
    }
    return parsed as string[];
  } catch {
    return DEFAULT_PALETTE;
  }
}

const MENU_W = 170;
const MENU_PAD_Y = 6;
const ITEM_H = 28;
const VIEWPORT_MARGIN = 8;
const RIGHT_GAP = 6;
// Action-button (collapsed state) dimensions — sized to match one menu row's
// vertical rhythm so the button feels like a single seed of the menu it opens.
const BUTTON_SIZE = 28;
const FORMATTING_ROW_H = 34;

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
  /** "cursor" when there's no text selection (button lives in the far-right
   *  gutter at the cursor's line); "selection" for any non-empty selection
   *  (uses the four-mode placement logic). */
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
 * selection head (= cursor position for cursor mode, = drag endpoint for
 * selection mode). One `coordsAtPos(head)`, one editor rect read, one
 * scroll-parent rect read. Stable under tiny selection changes because
 * the X coordinate is derived from the editor box, not from per-line
 * geometry, and the Y is the head line's top.
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
  const scrollTop = scrollParent ? scrollParent.getBoundingClientRect().top : 0;
  const scrollBottom = scrollParent
    ? scrollParent.getBoundingClientRect().bottom
    : window.innerHeight;

  // Off-screen relative to the scroll viewport → hide.
  if (headCoords.bottom < scrollTop || headCoords.top > scrollBottom) {
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
  let top = Math.max(headCoords.top, scrollTop, VIEWPORT_MARGIN);
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
  const dragHandleMenu = useDragHandleMenu();
  const [placement, setPlacement] = useState<Placement>(INVISIBLE_PLACEMENT);
  // The collapsed-by-default action button expands into the full menu on
  // click. Letter-key shortcuts and the menu content only render while
  // `menuOpen === true`. Any logical change (selection moved, cursor moved
  // to a new paragraph, focus dropped) closes the menu via the reset
  // effect below; scroll-only repositioning does not close it.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Display-color palette: 7 slots stored MRU-first (index 0 = most
  // recently used). Custom-picker picks evict the tail (LRU).
  const [palette, setPalette] = useState<string[]>(() => loadPalette());
  const lastAppliedColor = palette[0] ?? DEFAULT_PALETTE[0];
  const persistPalette = (next: string[]) => {
    setPalette(next);
    try {
      window.localStorage.setItem(COLOR_PALETTE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode errors */
    }
  };
  const bumpColorToFront = (color: string) => {
    const without = palette.filter((c) => c !== color);
    // If the color is already in the palette, just move it to front.
    // Otherwise replace the LRU (last) slot with the new color.
    const next =
      palette.includes(color)
        ? [color, ...without]
        : [color, ...without.slice(0, 6)];
    persistPalette(next.slice(0, 7));
  };
  const [colorPopoverAnchor, setColorPopoverAnchor] = useState<DOMRect | null>(null);
  // Stash the live selection range when the popover opens — focus can
  // bounce inside the native `<input type="color">` and PM's selection
  // may have moved by the time the picker returns a color.
  const stashedRangeRef = useRef<{ from: number; to: number } | null>(null);

  // Single update pipeline: one RAF-coalesced compute on every event that
  // could move or hide the button. No candidate/applyVisibility/freeze
  // indirection — the button is small and tracks the cursor's head line
  // smoothly without flicker even during drag-select.
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
      // Cursor-only mode is focus-gated, so focus/blur must retrigger.
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
    // The parent passes editorRef as a ref object; the actual Editor
    // instance lands a tick later. Poll via RAF (not setTimeout) so we
    // pick it up on the very next frame and clean up cleanly on unmount.
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
  // changed, mode flipped, visibility dropped. `left/top` are intentionally
  // excluded so scroll re-positions the open menu instead of collapsing it.
  useEffect(() => {
    setMenuOpen(false);
  }, [
    placement.range?.from,
    placement.range?.to,
    placement.paragraphUuid,
    placement.mode,
    placement.visible,
  ]);

  // Letter-key shortcuts only fire while the menu is open. Escape closes
  // the menu (without collapsing the selection) so the user can dismiss
  // the expanded state without losing what they had selected.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = MENU_ENTRIES.find((m) => m.letter === letter);
      if (!hit) return;
      // The menu is only open because the user explicitly clicked the
      // action button, so letter shortcuts always fire — even when focus
      // is in the editor. Capture-phase + preventDefault + stopPropagation
      // keeps the letter from also typing into the prose.
      e.preventDefault();
      e.stopPropagation();
      // Highlight requires a real range — skip when the menu was opened
      // from cursor-only mode so the row's disabled state agrees with
      // its keyboard shortcut.
      if (hit.action === "highlight" && placement.mode === "cursor") return;
      runAction(hit.action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // runAction is stable enough — it reads refs at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, placement.mode]);

  // Click-outside-while-menu-is-open closes the menu. We never collapse
  // the selection here — that would silently undo the user's selection
  // and was the source of the prior popup's "modal-feel" frustration.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      // The color popover handles its own dismissal — let it.
      const colorPopover = document.querySelector('div[aria-label="Text color"]');
      if (colorPopover?.contains(target)) return;
      setMenuOpen(false);
    };
    // Defer one tick so the mousedown that opened the menu (the button
    // click) doesn't immediately close it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [menuOpen]);

  const runAction = (action: (typeof MENU_ENTRIES)[number]["action"]) => {
    if (!dragHandleMenu || !placement.range || !placement.paragraphUuid) return;
    // In cursor mode the range is zero-width, which the dispatcher's
    // resolvePassageRange rejects. Route through "paragraph" instead so
    // the action anchors to the cursor's paragraph — same payload shape
    // the left-side DragHandleMenu uses.
    const passage =
      placement.mode === "cursor"
        ? { kind: "paragraph" as const, paragraphId: placement.paragraphUuid }
        : {
            kind: "selection" as const,
            paragraphId: placement.paragraphUuid,
            from: placement.range.from,
            to: placement.range.to,
          };
    dragHandleMenu.dispatch(action, passage);
    setMenuOpen(false);
  };

  const runFormat = (cmd: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
    const editor = editorRef.current;
    if (!editor) return;
    cmd(editor.chain().focus()).run();
  };

  // Replace the current selection with an inline-math or display-math
  // atom whose latex content is the selected text. Falls back to a
  // placeholder if the selection is somehow empty (defensive — the menu
  // shouldn't be visible in that case).
  const wrapSelectionInMath = (kind: "inline" | "display") => {
    const editor = editorRef.current;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ");
    const latex = text || (kind === "inline" ? "x" : "\\int f(x)\\,dx");
    const type = kind === "inline" ? "inlineMath" : "displayMath";
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent({ type, attrs: { latex } })
      .run();
  };

  // Replace the current selection with an example block whose first
  // paragraph contains the selected slice's inline content. Reuses the
  // existing `buildExampleTemplate` to keep the example node shape in
  // lockstep with the menu-bar insertion path.
  const wrapSelectionInExample = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    let inlineContent: unknown[] = [];
    try {
      const slice = editor.state.doc.slice(from, to);
      inlineContent = slice.content.toJSON() as unknown[];
    } catch {
      /* fall through with empty content */
    }
    const existing = new Set<string>();
    editor.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock" && n.attrs.uuid) {
        existing.add(n.attrs.uuid as string);
      }
      return true;
    });
    const { node } = buildExampleTemplate("single", existing);
    // node.content = [{ type: "paragraph" }]; swap in the selection's
    // inline content so the example block opens with the captured text.
    const content = node.content as Array<{ type: string; content?: unknown[] }>;
    if (content[0] && content[0].type === "paragraph" && inlineContent.length) {
      content[0].content = inlineContent;
    }
    editor.chain().focus().deleteSelection().insertContent(node).run();
  };

  // Apply the display-color mark to the live (or stashed) selection.
  const applyColor = (color: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.setTextColor(color).run();
    bumpColorToFront(color);
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  const clearColor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.unsetTextColor().run();
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  const openColorPopover = (e: React.MouseEvent<HTMLButtonElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    // Stash the live selection so the popover can re-apply it after the
    // native color picker steals focus.
    const { from, to } = editor.state.selection;
    if (from !== to) stashedRangeRef.current = { from, to };
    setColorPopoverAnchor(e.currentTarget.getBoundingClientRect());
  };

  if (!placement.visible) return null;
  if (typeof document === "undefined") return null;

  const editor = editorRef.current;
  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    !!editor && editor.isActive(name, attrs);

  const menuPortal = createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Selection actions"
      className="selection-actions-menu"
      style={{
        position: "fixed",
        left: placement.left,
        top: placement.top,
        width: MENU_W,
        zIndex: 2000,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: `${MENU_PAD_Y}px 0`,
      }}
      // Prevent click-to-collapse: any mousedown inside the menu must
      // not blur the editor or clear the selection.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Formatting icon grid (4 cols × 4 rows) ─────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 2,
          padding: "0 4px",
        }}
      >
        {/* Row 1: inline marks */}
        <FmtBtn
          title="Bold (⌘B)"
          active={isActive("bold")}
          onClick={() => runFormat((c) => c.toggleBold())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Italic (⌘I)"
          active={isActive("italic")}
          onClick={() => runFormat((c) => c.toggleItalic())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Strikethrough"
          active={isActive("strike")}
          onClick={() => runFormat((c) => c.toggleStrike())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <path d="M11 4.5c-.5-1.2-1.7-2-3-2-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.1M5 11.5c.5 1.2 1.7 2 3 2 1.8 0 3-1 3-2.4 0-.6-.2-1.1-.6-1.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Inline code"
          active={isActive("code")}
          onClick={() => runFormat((c) => c.toggleCode())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5,4 1.5,8 5,12" />
            <polyline points="11,4 14.5,8 11,12" />
          </svg>
        </FmtBtn>

        {/* Row 2: block-type dropdown + lists + blockquote.
            BlockTypeDropdown brings its own button styling — wrap it in
            a flex centerer to align with the surrounding FmtBtn cells. */}
        {editor && (
          <div
            className="flex items-center justify-center"
            style={{ height: FORMATTING_ROW_H }}
          >
            <BlockTypeDropdown editor={editor} />
          </div>
        )}
        <FmtBtn
          title="Bullet list"
          active={isActive("bulletList")}
          onClick={() => runFormat((c) => c.toggleBulletList())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="3.5" cy="4" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <line x1="6.5" y1="4" x2="13" y2="4" />
            <line x1="6.5" y1="8" x2="13" y2="8" />
            <line x1="6.5" y1="12" x2="13" y2="12" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Numbered list"
          active={isActive("orderedList")}
          onClick={() => runFormat((c) => c.toggleOrderedList())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <text x="2" y="5.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">1</text>
            <text x="2" y="9.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">2</text>
            <text x="2" y="13.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">3</text>
            <line x1="6.5" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="6.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="6.5" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Blockquote"
          active={isActive("blockquote")}
          onClick={() => runFormat((c) => c.toggleBlockquote())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)" />
          </svg>
        </FmtBtn>

        {/* Row 3: example + math + color */}
        <FmtBtn
          title="Wrap selection in example block"
          onClick={() => wrapSelectionInExample()}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>ex</span>
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in inline math"
          onClick={() => wrapSelectionInMath("inline")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13 }}>
            $x$
          </span>
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in display math"
          onClick={() => wrapSelectionInMath("display")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13, letterSpacing: -0.5 }}>
            $$
          </span>
        </FmtBtn>
        <button
          type="button"
          title="Text color"
          onClick={openColorPopover}
          className="flex flex-col items-center justify-center rounded transition-colors hover-on-light"
          style={{
            height: FORMATTING_ROW_H,
            background: "transparent",
            color: "var(--ink-strong)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontWeight: 600, fontSize: 14 }}>
            A
          </span>
          <span
            aria-hidden
            style={{
              display: "block",
              width: 14,
              height: 3,
              marginTop: 1,
              background: lastAppliedColor,
              borderRadius: 1,
            }}
          />
        </button>

        {/* Row 4: \tex insert (3 cells reserved for future expansion) */}
        <FmtBtn
          title="Insert raw LaTeX block"
          onClick={() => {
            if (!editor) return;
            insertTexBlock(editor);
          }}
        >
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
            \tex
          </span>
        </FmtBtn>
        <div />
        <div />
        <div />
      </div>

      {/* ── Divider ────────────────────────────────────────────── */}
      <div
        aria-hidden
        style={{
          height: 1,
          margin: "6px 8px",
          background: "var(--edge-hover)",
          opacity: 0.5,
        }}
      />

      {/* ── Action list ────────────────────────────────────────── */}
      {MENU_ENTRIES.map((entry) => {
        // Highlight needs a real text range; greyed-out (not hidden) in
        // cursor-only mode so the menu's vocabulary stays predictable.
        const disabled = placement.mode === "cursor" && entry.action === "highlight";
        return (
          <div key={entry.action}>
            {entry.separator && (
              <div
                aria-hidden
                style={{
                  height: 1,
                  margin: "4px 8px",
                  background: "var(--edge-hover)",
                  opacity: 0.5,
                }}
              />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                runAction(entry.action);
              }}
              className={`w-full flex items-center gap-2 px-2.5 text-left ${disabled ? "" : "hover-on-light"}`}
              style={{
                height: ITEM_H,
                fontSize: 13,
                color: entry.destructive ? "var(--danger, #b45757)" : "var(--ink-strong)",
                background: "transparent",
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 16, height: 16 }}
              >
                {entry.icon}
              </span>
              <span className="flex-1">{entry.label}</span>
              <span className="tabular-nums" style={{ fontSize: 11, color: "var(--ink-subtle)" }}>
                {entry.letter}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );

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

  return (
    <>
      {menuOpen ? menuPortal : buttonPortal}
      {colorPopoverAnchor && editor && (
        <SelectionColorPopover
          editor={editor}
          anchorRect={colorPopoverAnchor}
          palette={palette}
          onApply={applyColor}
          onClear={clearColor}
          onPickCustom={applyColor}
          onClose={() => {
            setColorPopoverAnchor(null);
            stashedRangeRef.current = null;
          }}
        />
      )}
    </>
  );
}

function FmtBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center justify-center rounded transition-colors hover-on-light"
      style={{
        height: FORMATTING_ROW_H,
        background: active ? "var(--surface-muted-strong, rgba(0,0,0,0.08))" : "transparent",
        color: active ? "var(--ink-strong)" : "var(--ink-muted)",
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
