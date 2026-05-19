"use client";

/**
 * Auto-popping action menu on the right side of any non-empty text
 * selection. Notion-style: appears the moment a selection is made,
 * hides as soon as the selection collapses. Anchors to the right edge
 * of the editor's text column (overlapping into the right gutter /
 * margin) at the top line of the selection.
 *
 * Counterpart to {@link SelectionDragHandle} (left side, click-to-open
 * popover). The two coexist by design — the left handle keeps its
 * drag-to-lift gesture and click-to-open DragHandleMenu; this right
 * menu is a faster path to the same vocabulary plus inline formatting.
 *
 * Two sections:
 *  - Top: compressed icon grid of inline-formatting commands.
 *  - Bottom: vertical list of passage actions (reuses MENU_ENTRIES
 *    from DragHandleMenu so the two menus stay in lockstep).
 *
 * Action dispatch goes through the same `dispatch` exposed via
 * DragHandleMenuApi that powers the click-on-handle popover — so
 * footnote / archive / note / etc. behave identically.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { isAnchorableNode } from "@/lib/marginalia";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import { MENU_ENTRIES } from "./DragHandleMenu";
import { BlockTypeDropdown, buildExampleTemplate } from "./MenuBar";
import { SelectionColorPopover } from "./SelectionColorPopover";

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
const SEPARATOR_H = 9;
const VIEWPORT_MARGIN = 8;
const RIGHT_GAP = 6;
// Selection-right within this many px of the text-column right counts
// as "reaches the right edge" → Mode 1 (right placement in the gutter).
const REACH_RIGHT_THRESHOLD = 24;
// Vertical gaps for below / above placement modes.
const BELOW_GAP = 6;
const ABOVE_GAP = 6;
const FORMATTING_ROW_H = 34;
// 3 rows + small inter-row gap accumulated by `gap: 2`.
const FORMATTING_SECTION_H = FORMATTING_ROW_H * 3 + 4;

const INVISIBLE_PLACEMENT: Placement = {
  visible: false,
  left: 0,
  top: 0,
  paragraphUuid: null,
  range: null,
};

interface Placement {
  visible: boolean;
  left: number;
  top: number;
  paragraphUuid: string | null;
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

function computePlacement(editor: Editor, menuHeight: number): Placement {
  const sel = editor.state.selection;
  if (sel.empty || sel instanceof NodeSelection) {
    return { visible: false, left: 0, top: 0, paragraphUuid: null, range: null };
  }
  const { from, to } = sel;
  const $from = editor.state.doc.resolve(from);
  let blockUuid: string | null = null;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (isAnchorableNode(node.type)) {
      blockUuid = (node.attrs?.uuid as string | null) ?? null;
      break;
    }
  }
  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
  } catch {
    return { visible: false, left: 0, top: 0, paragraphUuid: null, range: null };
  }
  const scrollParent = findScrollParent(editor.view.dom as HTMLElement);
  const scrollRect = scrollParent?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
    left: 0,
    right: window.innerWidth,
  };
  if (toCoords.bottom < scrollRect.top) {
    return { visible: false, left: 0, top: 0, paragraphUuid: blockUuid, range: { from, to } };
  }
  if (fromCoords.top > scrollRect.bottom) {
    return { visible: false, left: 0, top: 0, paragraphUuid: blockUuid, range: { from, to } };
  }
  const editorEl = editor.view.dom as HTMLElement;
  const editorRect = editorEl.getBoundingClientRect();
  const padRight = parseFloat(window.getComputedStyle(editorEl).paddingRight) || 0;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const textRight = editorRect.right - padRight;
  // The visual selection rect — used both for deciding which placement
  // mode wins and for the X/Y anchors of the below/above modes.
  let selectionRect = {
    left: fromCoords.left,
    right: textRight,
    top: fromCoords.top,
    bottom: toCoords.bottom,
  };
  try {
    const dFrom = editor.view.domAtPos(from);
    const dTo = editor.view.domAtPos(to);
    const r = document.createRange();
    r.setStart(dFrom.node, dFrom.offset);
    r.setEnd(dTo.node, dTo.offset);
    const rr = r.getBoundingClientRect();
    selectionRect = {
      left: rr.left,
      right: rr.right,
      top: rr.top,
      bottom: rr.bottom,
    };
  } catch {
    /* fall through with the coord-derived rect */
  }

  // Clamp an X candidate to fit horizontally within the viewport.
  const clampX = (x: number) =>
    Math.max(
      VIEWPORT_MARGIN,
      Math.min(x, vw - MENU_W - VIEWPORT_MARGIN),
    );
  const visibleBottom = Math.min(vh, scrollRect.bottom);
  const visibleTop = Math.max(0, scrollRect.top);

  let left: number;
  let top: number;
  const reachesRight =
    selectionRect.right >= textRight - REACH_RIGHT_THRESHOLD;

  if (reachesRight) {
    // ── Mode 1: right placement in the gutter (existing behavior). ──
    left = textRight + RIGHT_GAP;
    if (left + MENU_W > vw - VIEWPORT_MARGIN) {
      // Narrow viewport — flip to left of the selection.
      const flipLeft = fromCoords.left - MENU_W - RIGHT_GAP;
      left = flipLeft >= VIEWPORT_MARGIN ? flipLeft : clampX(left);
    }
    // Sticky-to-visible-top.
    top = Math.max(selectionRect.top, scrollRect.top);
    if (top + menuHeight > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, vh - menuHeight - VIEWPORT_MARGIN);
    }
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
  } else {
    // Selection doesn't reach the right edge — would overlap trailing
    // prose if placed right. Prefer below the line, then above, then
    // fall back to right-with-overlap as a last resort.
    const belowY = selectionRect.bottom + BELOW_GAP;
    const aboveY = selectionRect.top - menuHeight - ABOVE_GAP;
    const fitsBelow =
      belowY + menuHeight <= visibleBottom - VIEWPORT_MARGIN;
    const fitsAbove = aboveY >= visibleTop + VIEWPORT_MARGIN;
    if (fitsBelow) {
      // ── Mode 2: below the selection. ──
      // Shift right of the selection's right edge so the menu has a
      // consistent "off-to-the-right" feel matching Mode 1, rather than
      // landing under the left of the selection.
      left = clampX(selectionRect.right + RIGHT_GAP);
      top = belowY;
    } else if (fitsAbove) {
      // ── Mode 3: above the selection. ──
      left = clampX(selectionRect.right + RIGHT_GAP);
      top = aboveY;
    } else {
      // ── Mode 4: fall back to right-of-selection (may overlap). ──
      left = selectionRect.right + RIGHT_GAP;
      if (left + MENU_W > vw - VIEWPORT_MARGIN) {
        const flipLeft = selectionRect.left - MENU_W - RIGHT_GAP;
        left = flipLeft >= VIEWPORT_MARGIN ? flipLeft : clampX(left);
      }
      top = Math.max(selectionRect.top, scrollRect.top);
      if (top + menuHeight > vh - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, vh - menuHeight - VIEWPORT_MARGIN);
      }
      if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    }
  }
  return {
    visible: true,
    left,
    top,
    paragraphUuid: blockUuid,
    range: { from, to },
  };
}

export function SelectionActionsMenu({
  editorRef,
}: {
  editorRef: RefObject<Editor | null>;
}) {
  const dragHandleMenu = useDragHandleMenu();
  const [placement, setPlacement] = useState<Placement>({
    visible: false,
    left: 0,
    top: 0,
    paragraphUuid: null,
    range: null,
  });
  // Force a re-render on every editor transaction so `editor.isActive(...)`
  // checks in the formatting row reflect the current marks at the
  // selection. We piggyback the same selectionUpdate/update subscription
  // already used for placement.
  const [, setActiveTick] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const subscribedEditorRef = useRef<Editor | null>(null);
  // Candidate placement is computed continuously from the live
  // selection; `mouseDownRef` freezes the rendered placement while the
  // user is mid-drag so the menu doesn't flicker across a drag-select.
  // See applyVisibility() below for the transition table.
  const candidateRef = useRef<Placement>(INVISIBLE_PLACEMENT);
  const mouseDownRef = useRef(false);
  const placementRef = useRef<Placement>(placement);
  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

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

  const menuHeight = useMemo(() => {
    const base = MENU_PAD_Y * 2 + FORMATTING_SECTION_H + 9; // 9 for divider
    let h = 0;
    for (const entry of MENU_ENTRIES) {
      if (entry.separator) h += SEPARATOR_H;
      h += ITEM_H;
    }
    return base + h;
  }, []);

  useEffect(() => {
    let prevEditor: Editor | null = null;
    const cleanupListeners = () => {
      if (prevEditor) {
        prevEditor.off("selectionUpdate", schedule);
        prevEditor.off("update", schedule);
      }
    };
    const applyVisibility = () => {
      const next = candidateRef.current;
      const current = placementRef.current;
      // Selection collapsed or otherwise hidden → hide immediately.
      if (!next.visible) {
        if (current.visible) setPlacement(next);
        return;
      }
      // Mouse is down — freeze. Don't change the rendered placement;
      // either it's hidden (drag-selecting from scratch) or visible
      // (shift-drag-extending an existing selection), and we want to
      // keep that state until mouse-up.
      if (mouseDownRef.current) return;
      // Mouse is up — show / update placement immediately.
      setPlacement(next);
    };
    const schedule = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        candidateRef.current = INVISIBLE_PLACEMENT;
        applyVisibility();
        return;
      }
      candidateRef.current = computePlacement(editor, menuHeight);
      applyVisibility();
      setActiveTick((t) => (t + 1) & 0xffff);
    };
    const onMouseDown = () => {
      mouseDownRef.current = true;
      applyVisibility();
    };
    const onMouseUp = () => {
      mouseDownRef.current = false;
      applyVisibility();
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
    // Mirror SelectionDragHandle's safety net: when the DOM selection
    // changes but PM's view.state.selection lags behind, dispatch the
    // equivalent TextSelection so the menu sees the live range.
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
      if (!dom.contains(range.startContainer) || !dom.contains(range.endContainer)) return;
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
        schedule();
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("selectionchange", onDocSelectionChange);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    return () => {
      cleanupListeners();
      subscribedEditorRef.current = null;
      prevEditor = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("selectionchange", onDocSelectionChange);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [editorRef, menuHeight]);

  // Escape dismisses by collapsing the selection (which then naturally
  // hides the menu via the selectionUpdate path). We also fire bare
  // letter keys to match DragHandleMenu's keyboard hint behavior.
  useEffect(() => {
    if (!placement.visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const editor = editorRef.current;
        if (editor) {
          // Collapse to the end of the selection so the menu hides.
          try {
            editor.chain().focus().setTextSelection(editor.state.selection.to).run();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Only trigger letter shortcuts when focus isn't in an editable
      // field — otherwise typing into the selection would trigger
      // actions, which is the wrong behavior since the user expects
      // to overwrite the selection by typing.
      const target = e.target as HTMLElement | null;
      const inEditable =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA");
      if (inEditable) return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = MENU_ENTRIES.find((m) => m.letter === letter);
      if (hit) {
        e.preventDefault();
        runAction(hit.action);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // runAction is stable enough — it reads refs at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement.visible]);

  // Dismiss-on-outside-click. PM collapses the selection on its own when
  // the user clicks back into prose, but clicks that land outside both
  // the editor and the menu (gutter, panel chrome, page background)
  // leave the selection alive, so the menu lingers. Collapse it
  // explicitly in that case to give the popup the same modal-feel
  // dismissal users expect.
  useEffect(() => {
    if (!placement.visible) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      // The color popover handles its own dismissal — let it.
      const colorPopover = document.querySelector('div[aria-label="Text color"]');
      if (colorPopover?.contains(target)) return;
      const editor = editorRef.current;
      const editorDom = editor?.view.dom as Node | undefined;
      if (editorDom?.contains(target)) return;
      // Target is truly outside — collapse the selection so the menu
      // hides via its normal selectionUpdate path.
      if (editor) {
        try {
          editor.chain().setTextSelection(editor.state.selection.to).run();
        } catch {
          /* ignore */
        }
      }
    };
    // Defer so the mousedown that opened a selection-driven menu (rare,
    // but possible if the user clicks into existing colored text) doesn't
    // immediately collapse it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [placement.visible, editorRef]);

  const runAction = (action: (typeof MENU_ENTRIES)[number]["action"]) => {
    if (!dragHandleMenu || !placement.range || !placement.paragraphUuid) return;
    dragHandleMenu.dispatch(action, {
      kind: "selection",
      paragraphId: placement.paragraphUuid,
      from: placement.range.from,
      to: placement.range.to,
    });
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
      {/* ── Formatting icon grid (4 cols × 3 rows) ─────────────── */}
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

        {/* Row 3: example + math (1 blank cell) */}
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
      {MENU_ENTRIES.map((entry) => (
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
            onClick={() => runAction(entry.action)}
            className="w-full flex items-center gap-2 px-2.5 text-left hover-on-light"
            style={{
              height: ITEM_H,
              fontSize: 13,
              color: entry.destructive ? "var(--danger, #b45757)" : "var(--ink-strong)",
              background: "transparent",
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
      ))}
    </div>,
    document.body,
  );

  return (
    <>
      {menuPortal}
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
