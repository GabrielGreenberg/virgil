"use client";

/**
 * The expanded action menu — formatting grid + 9-row action list.
 * Mounted by its trigger, the gutter button in
 * {@link SelectionActionsMenu}. When this component is mounted, the
 * menu is open; the caller unmounts it to close.
 *
 * Owns:
 *  - Letter-key shortcuts (H/N/F/C/Q/T/E/X/A) + Escape.
 *  - Click-outside dismissal.
 *  - Color-palette state (persisted to localStorage) + the popover.
 *  - The formatting helpers (math wrap, example wrap, color apply).
 *  - The action dispatch into `useDragHandleMenu().dispatch`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import type { DragHandleAction } from "./DragHandleMenu";
import {
  cardActionRows,
  exampleRun,
  extractInlineFromSlice,
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
} from "@/lib/actions/action-registry";
import { BlockTypeDropdown } from "./MenuBar";
import { IconExample } from "./editor-layout/panel-icons";
import { insertTexBlock } from "@/lib/tiptap/tex-block";
import { SelectionColorPopover } from "./SelectionColorPopover";
import {
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";

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

/**
 * Extract ONLY inline content (as ProseMirror JSON) from a selection slice,
 * suitable for dropping into an `inline*` slot (e.g. the paragraph inside a
 * freshly-built example template).
 *
 * CHIP 5c: this is now a THIN re-export of the canonical `extractInlineFromSlice`
 * in the action registry — the SAME harvest `exampleRun` (grid + slash) uses, so
 * the grid's wrap and the slash's wrap can never diverge. The full DA-1 rationale
 * lives on `extractInlineFromSlice`. Kept here under the old name so the DA-1 lock
 * test (`wrap-selection-in-example.test.ts`) keeps importing from this module.
 */
export const extractInlineJSON = extractInlineFromSlice;

const MENU_W = 170;
const MENU_PAD_Y = 6;
const ITEM_H = 28;
const FORMATTING_ROW_H = 34;

// CHIP 3: the lightning-bolt action list renders the CARD rows straight off
// the registry (the SSOT) — replacing the deleted `MENU_ENTRIES` array. The
// lightning surface exposes the full card vocabulary on every open (the bolt
// is paragraph/selection-scoped, not per-kind); the only run-time grey-out is
// Highlight in cursor mode, applied at render below. The row list is constant,
// so it's computed once at module load (an 11-row registry view).
const LIGHTNING_CARD_ROWS = cardActionRows("lightning");

export interface ActionsMenuPanelProps {
  editor: Editor;
  /** Target paragraph for action dispatch. */
  paragraphUuid: string;
  /** Live selection range; used for `kind: "selection"` dispatch. */
  range: { from: number; to: number };
  /** "selection" → dispatch with `kind: "selection"` + range.
   *  "cursor" → dispatch with `kind: "paragraph"` and grey out Highlight. */
  mode: "selection" | "cursor";
  /** The trigger element's bounding rect — the panel computes its own
   *  placement (below / above flip + viewport clamp) from this. */
  triggerRect: DOMRect | {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  onClose: () => void;
}

const PANEL_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

export function ActionsMenuPanel({
  editor,
  paragraphUuid,
  range,
  mode,
  triggerRect,
  onClose,
}: ActionsMenuPanelProps) {
  const dragHandleMenu = useDragHandleMenu();
  // CHIP 7b: the UNIFORM collab read-only signal for the lightning surface. The
  // main editor is mounted `editable: true` always and flipped via
  // `setEditable(collab.canEditMainText)` ([EditorLayout.tsx:946]) when the
  // partner holds the pen, so `editor.isEditable` IS the in-editor mirror of the
  // collab pen state (the `ActionContext.canEdit` SSOT). Threaded into every
  // ctx the grid builds + the card-row grey-out below. `true` for a non-collab
  // doc (editor always editable) → no over-gating.
  const canEdit = editor.isEditable;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect: triggerRect,
    placements: PANEL_PLACEMENTS,
    gap: 4,
  });
  const setMenuRef = (el: HTMLDivElement | null) => {
    menuRef.current = el;
    positionRef(el);
  };

  // Color palette state (MRU-first, 7 slots).
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
    const next = palette.includes(color)
      ? [color, ...without]
      : [color, ...without.slice(0, 6)];
    persistPalette(next.slice(0, 7));
  };
  const [colorPopoverAnchor, setColorPopoverAnchor] = useState<DOMRect | null>(null);
  // Stash the selection range so the color popover can re-apply it after
  // the native color picker steals focus.
  const stashedRangeRef = useRef<{ from: number; to: number } | null>(null);

  const runAction = (action: DragHandleAction) => {
    if (!dragHandleMenu) return;
    const ref =
      mode === "cursor"
        ? { kind: "paragraph" as const, id: paragraphUuid }
        : {
            kind: "selection" as const,
            paragraphId: paragraphUuid,
            from: range.from,
            to: range.to,
          };
    dragHandleMenu.dispatch(action, ref);
    onClose();
  };

  // CHIP 6a + 6b: the WHOLE formatting grid (block-atom cells AND the format
  // mark/list/quote/text-color cells) renders from the action registry —
  // `runGridAction(id, payload?)` builds a view-only `ActionContext` off the
  // live selection and invokes the registry row's `run()`, the SAME SSOT a
  // future slash/keyboard surface would reach.
  //
  //   - FORMAT toggles (bold/italic/strike/code, bullet-/ordered-list,
  //     blockquote) — `run()` is a pure `editor.chain().focus().toggleX().run()`
  //     (`backbone: "tiptap-chain"`).
  //   - math (inline/display) — `run()` WRAPS the selection into the atom's
  //     `latex`; figure/graphics — `run()` INSERTs via `smartInsertBlock` then
  //     opens the SOURCE popover via the `openFigurePopover` callback below
  //     (REPLACING the insert-time `virgil-figure-click` emit the low-level
  //     creator used to do; the EDIT-existing-figure listener is untouched).
  //   - text-color — `run()` opens the `SelectionColorPopover` via the
  //     `openColorPopover` callback below (the popover state + selection-stash +
  //     MRU palette stay in this component); the cell passes its bounding rect in
  //     `payload.anchorRect`.
  const runGridAction = (id: ActionId, payload?: Record<string, unknown>) => {
    const row = VIRGIL_ACTION_REGISTRY[id];
    if (!row) return;
    // Focus the doc first (the grid cell is a toolbar button — focus may be on
    // the button, not the doc); the format/math `run()`s re-focus too, but
    // figure/graphics read the live selection before inserting, so we focus
    // up-front.
    editor.chain().focus().run();
    const ctx: ActionContext = {
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      // CHIP 7b: the uniform collab gate. When the partner holds the pen the
      // row's `run()` no-ops (and the cell is greyed below).
      canEdit,
      payload,
      // The INSERT-time popover seam (figure/graphics). The grid is a React
      // subtree separate from EditorLayout's `activeFigure` state, so this
      // callback hops the same `virgil-figure-click` event the EDIT path uses
      // — but the DECISION to open now lives in the React surface, not in the
      // pure `figure-block.ts` creator (which no longer emits on insert). The
      // EDIT listener (marker-clicks.ts) consumes the same event, unchanged.
      openFigurePopover: (figure) => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent("virgil-figure-click", { detail: figure }),
        );
      },
      // The text-color popover seam (CHIP 6b). The `text-color` row's `run()`
      // calls this with the cell's bounding rect; we stash the live selection
      // (so the native color picker's focus theft can't lose it) and open the
      // popover by setting its anchor — the SAME behavior the former inline
      // `openColorPopover` click handler had.
      openColorPopover: (rect) => {
        const { from, to } = editor.state.selection;
        if (from !== to) stashedRangeRef.current = { from, to };
        setColorPopoverAnchor(rect);
      },
      // The `\ref` create-mode popover seam (CHIP 7a). The 'Cross-ref' grid cell's
      // `run()` (`refRun`) calls this to open the `LabelRef` popover at the caret
      // (the popover is the creator). Like `openFigurePopover`, the grid is a
      // React subtree separate from EditorLayout's ref-popover state, so we
      // compute the caret rect and hop the `virgil-ref-create-popover` CustomEvent
      // the marker-clicks listener consumes to open create mode. SAME event the
      // slash surface's bridge dispatches, so the two surfaces converge.
      openRefPopover: () => {
        if (typeof window === "undefined") return;
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const rect = new DOMRect(
          coords.left,
          coords.top,
          0,
          coords.bottom - coords.top,
        );
        window.dispatchEvent(
          new CustomEvent("virgil-ref-create-popover", { detail: { rect } }),
        );
      },
    };
    void row.run(ctx);
    // NOTE: like the prior format cells (and the prior `wrapSelectionInMath` /
    // `insertFigureBlock` direct calls), we do NOT auto-close the menu here —
    // it dismisses on click-outside. Faithful to pre-6a/6b behavior.
  };

  const wrapSelectionInExample = () => {
    // CHIP 5c: the grid `ex` cell is now a THIN delegation to the canonical
    // `exampleRun` in the action registry — the SAME implementation the slash
    // `\ex` command calls — so the two surfaces share ONE creator
    // (wrap-if-selection-else-insert; one template). The grid previously
    // hand-rolled the wrap here (`extractInlineJSON` → splice into
    // `buildExampleTemplate("single")` → deleteSelection().insertContent); that
    // logic moved INTO `exampleRun` (with the SAME CHIP 0 DA-1 inline-only
    // safety: only inline nodes ever reach the `inline*` item paragraph). The
    // dual creators (grid here + slash `insertExample`) collapsed to one.
    //
    // `exampleRun` is pure ProseMirror (operates on `ctx.view`): it reads the
    // live selection off `ctx.view.state` and dispatches there, so the
    // grab-handle `cardCreation`/`cardLifecycle` slots are intentionally absent
    // (a pure insert needs none) and `panelRouting` is omitted (the grid inserts
    // inline without a panel hop — matching the grid's prior no-panel-select
    // behavior). We `focus()` first so the doc is focused before the insert (the
    // grid cell is a toolbar button — focus may be on the button, not the doc).
    editor.chain().focus().run();
    exampleRun({
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      // CHIP 7b: uniform collab gate — `exampleRun` no-ops when read-only.
      canEdit,
    });
  };

  const applyColor = (color: string) => {
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.setTextColor(color).run();
    bumpColorToFront(color);
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  const clearColor = () => {
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.unsetTextColor().run();
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  // Letter-key shortcuts. Escape closes the panel. Capture-phase +
  // preventDefault + stopPropagation keeps the letter from also typing
  // into the prose if focus is in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Keep Esc from also reaching tab-indent.ts's Escape→blur handler, so
        // closing the menu doesn't drop the editor's cursor/selection. This
        // capture-phase listener runs before the editor's PM keydown handler.
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = LIGHTNING_CARD_ROWS.find((m) => m.letter === letter);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (hit.id === "highlight" && mode === "cursor") return;
      runAction(hit.id as DragHandleAction);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // runAction reads props/refs at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Click-outside dismissal. Deferred one tick so the mousedown that
  // opened the panel (the trigger button click) doesn't immediately close
  // it. The color popover handles its own dismissal.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      const colorPopover = document.querySelector('div[aria-label="Text color"]');
      if (colorPopover?.contains(target)) return;
      onClose();
    };
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  // Bug #1 (DATA-LOSS): the three structural WRAPPER cells (bullet-list /
  // ordered-list / blockquote) grey out when the caret/selection sits on a block
  // a list/quote wrapper would DESTROY (titleField / heading / atom blocks) — the
  // registry's `wrapperApplies` decides this off the live selection. The three
  // share one `applies()` (only `view` + `ref` + `canEdit` matter), so one probe
  // covers all three. `!canEdit` still disables them (collab gate is folded into
  // `applies()` too, but the other cells use the bare `!canEdit`, so we OR it for
  // a uniform render). Computed at render (menu-open), never per keystroke.
  const wrappersDisabled =
    !canEdit ||
    VIRGIL_ACTION_REGISTRY["bullet-list"]!.applies({
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      canEdit,
    } as ActionContext) === "disabled";

  const menuPortal = createPortal(
    <div
      ref={setMenuRef}
      role="menu"
      aria-label="Selection actions"
      className="selection-actions-menu"
      style={{
        ...positionStyle,
        width: MENU_W,
        zIndex: 2000,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: `${MENU_PAD_Y}px 0`,
      }}
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
        <FmtBtn
          title="Bold (⌘B)"
          active={isActive("bold")}
          disabled={!canEdit}
          onClick={() => runGridAction("bold")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Italic (⌘I)"
          active={isActive("italic")}
          disabled={!canEdit}
          onClick={() => runGridAction("italic")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Strikethrough"
          active={isActive("strike")}
          disabled={!canEdit}
          onClick={() => runGridAction("strike")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <path d="M11 4.5c-.5-1.2-1.7-2-3-2-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.1M5 11.5c.5 1.2 1.7 2 3 2 1.8 0 3-1 3-2.4 0-.6-.2-1.1-.6-1.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Inline code"
          active={isActive("code")}
          disabled={!canEdit}
          onClick={() => runGridAction("code")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5,4 1.5,8 5,12" />
            <polyline points="11,4 14.5,8 11,12" />
          </svg>
        </FmtBtn>

        <div
          className="flex items-center justify-center"
          style={{ height: FORMATTING_ROW_H }}
        >
          <BlockTypeDropdown editor={editor} />
        </div>
        <FmtBtn
          title="Bullet list"
          active={isActive("bulletList")}
          disabled={wrappersDisabled}
          onClick={() => runGridAction("bullet-list")}
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
          disabled={wrappersDisabled}
          onClick={() => runGridAction("ordered-list")}
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
          disabled={wrappersDisabled}
          onClick={() => runGridAction("blockquote")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)" />
          </svg>
        </FmtBtn>

        <FmtBtn
          title="Wrap selection in example block"
          disabled={!canEdit}
          onClick={() => wrapSelectionInExample()}
        >
          <IconExample size={16} />
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in inline math"
          disabled={!canEdit}
          onClick={() => runGridAction("inline-math")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13 }}>
            $x$
          </span>
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in display math"
          disabled={!canEdit}
          onClick={() => runGridAction("display-math")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13, letterSpacing: -0.5 }}>
            $$
          </span>
        </FmtBtn>
        <button
          type="button"
          data-hint="Text color"
          disabled={!canEdit}
          onClick={
            canEdit
              ? (e) =>
                  runGridAction("text-color", {
                    anchorRect: e.currentTarget.getBoundingClientRect(),
                  })
              : undefined
          }
          className={`flex flex-col items-center justify-center rounded transition-colors ${canEdit ? "hover-on-light" : ""}`}
          style={{
            height: FORMATTING_ROW_H,
            background: "transparent",
            color: "var(--ink-strong)",
            border: "none",
            cursor: canEdit ? "pointer" : "not-allowed",
            opacity: canEdit ? 1 : 0.4,
            padding: 0,
            lineHeight: 1,
          }} aria-label="Text color"
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

        <FmtBtn
          title="Insert raw LaTeX block"
          disabled={!canEdit}
          onClick={() => insertTexBlock(editor)}
        >
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
            \tex
          </span>
        </FmtBtn>
        <FmtBtn
          title="Insert figure block"
          disabled={!canEdit}
          onClick={() => runGridAction("figure")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontStyle: "italic", fontSize: 12 }}>
            fig.
          </span>
        </FmtBtn>
        <FmtBtn
          title="Insert image"
          disabled={!canEdit}
          onClick={() => runGridAction("graphics")}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
            <circle cx="11" cy="6" r="1.25" fill="currentColor" stroke="none" />
            <path d="M2.5 12.5 L6 9 L9 11 L11 9.5 L13.5 12" />
          </svg>
        </FmtBtn>
        {/* CHIP 7a: the NEW 'Cross-ref' cell — the lightning surface for `\ref`.
            Routes through `runGridAction("ref")` → the registry's `refRun` →
            `ctx.openRefPopover()`, opening the LabelRef create-mode popover at
            the caret (the SAME `run()` the slash `\ref` reaches). */}
        <FmtBtn
          title="Insert cross-reference (\ref)"
          disabled={!canEdit}
          onClick={() => runGridAction("ref")}
        >
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
            \ref
          </span>
        </FmtBtn>
      </div>

      <div
        aria-hidden
        style={{
          height: 1,
          margin: "6px 8px",
          background: "var(--edge-hover)",
          opacity: 0.5,
        }}
      />

      {LIGHTNING_CARD_ROWS.map((entry) => {
        // CHIP 7b: the card-row grey-out now runs through the row's OWN
        // `applies()` (the DA-5 taxonomy + the uniform collab gate), replacing
        // the hand-rolled `mode === "cursor" && highlight` special-case. The ref
        // mirrors the action's actual state: cursor mode → a collapsed-caret
        // `cursor` ref (no live range, so `highlight` — selection-`"required"` —
        // greys); selection mode → the live range. `canEdit` greys EVERY row when
        // the partner holds the pen.
        const applyRef =
          mode === "cursor"
            ? { kind: "cursor" as const, pos: range.from, paragraphId: paragraphUuid }
            : {
                kind: "selection" as const,
                from: range.from,
                to: range.to,
                paragraphId: paragraphUuid,
              };
        const disabled =
          entry.applies({
            ref: applyRef,
            canEdit,
          } as ActionContext) === "disabled";
        return (
          <div key={entry.id}>
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
                runAction(entry.id as DragHandleAction);
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

  return (
    <>
      {menuPortal}
      {colorPopoverAnchor && (
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
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  /** CHIP 7b: collab read-only greys the cell + inerts the click. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-hint={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`flex items-center justify-center rounded transition-colors ${disabled ? "" : "hover-on-light"}`}
      style={{
        height: FORMATTING_ROW_H,
        background: active ? "var(--surface-muted-strong, rgba(0,0,0,0.08))" : "transparent",
        color: active ? "var(--ink-strong)" : "var(--ink-muted)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }} aria-label={title}
    >
      {children}
    </button>
  );
}
