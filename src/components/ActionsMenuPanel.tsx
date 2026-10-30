"use client";

/**
 * The expanded action menu — formatting grid + card-action list (the
 * "lightning" panel behind the margin bolt + Cmd-/). Mounted by its trigger,
 * the margin button in {@link SelectionActionsMenu}. When this component is
 * mounted, the menu is open; the caller unmounts it to close.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase B2) ──
 * This is the COMPOSITE reference for the `<Menu>` primitive
 * (`src/components/menu/`, design `docs/agents/menu-system-design.md`). It now
 * renders via `<MenuProvider layout="composite" role="menu"
 * id="lightning">` with a `<MenuGrid cols={4}>` of the bespoke format-grid
 * cells ABOVE a `<MenuList>` rendering the card actions via
 * `<MenuItemsFromRegistry>`. The provider owns positioning
 * (`useFloatingMenuPosition`), the deferred click-outside dismissal, the Escape
 * handler (with the load-bearing `stopPropagation` that keeps Escape from
 * reaching tab-indent.ts's Escape→blur), and the keyboard controller.
 *
 * The grid GAINS Up/Down/Left/Right arrow nav (it had none); the card list
 * keeps its letter fast-path (H/N/F/C/T/E/X/R/D/A); the cross-region edge
 * (Down off the last grid row → the card list, Up off the list top → the grid's
 * remembered column) is automatic from the primitive (`layout="composite"`).
 * Behavior is otherwise identical to before the migration.
 *
 * Still owns (the per-open state the primitive doesn't subsume):
 *  - Color-palette state (persisted to localStorage) + the child color popover.
 *  - The formatting helpers (math wrap, example wrap, color apply).
 *  - The action dispatch into `useDragHandleMenu().dispatch`.
 *
 * The child color popover + the nested `BlockTypeDropdown` stay bespoke (Phase C
 * migrates them). The color popover portals to `document.body` separately, so it
 * is registered into the provider's `excludeRefs` (a real element ref, NOT the
 * old `querySelector('div[aria-label="Text color"]')` string) so a click into it
 * doesn't dismiss the lightning panel. The BlockTypeDropdown is a NESTED
 * `<MenuProvider>` (portaled, task 751), which registers its own container into
 * this provider's exclude set (R8), so it needs no explicit exclusion.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLiveEditorSignature } from "@/lib/tiptap/use-live-editor-signature";
import type { Editor } from "@tiptap/react";
import { trackRange, type TrackedRange } from "@/lib/tiptap/tracked-pos";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import type { DragHandleAction } from "./DragHandleMenu";
import type { TextObjectKind } from "@/text-objects/types";
import {
  applyTextColor,
  cardActionRows,
  extractInlineFromSlice,
  toggledMember,
  VIRGIL_ACTION_REGISTRY,
  verdictOf,
  type ActionContext,
  type ActionId,
  runAction as runRegistryAction,
} from "@/lib/actions/action-registry";
import { lightningContext } from "@/lib/actions/lightning-context";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";
import { useStorageKeySync } from "@/lib/cross-window-storage";
import { useCollabContext } from "@/hooks/useCollab";
import { BlockTypeDropdown } from "./MenuBar";
import { blockTypeVerdict } from "@/lib/actions/block-type";
import { IconExample } from "./editor-layout/panel-icons";
import { SelectionColorPopover } from "./SelectionColorPopover";
import { type FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import { elementAnchor, type LiveAnchor } from "./menu/live-anchor";
import { caretEditableHost } from "./menu/caret-host";
import { useCloseOnDisabledEdge } from "./menu/menu-trigger";
import { MenuGrid, MenuList } from "./menu/regions";
import {
  MenuItemsFromRegistry,
  type DecoratedMenuRow,
} from "./menu/MenuItemsFromRegistry";
import { useMenuItem } from "./menu/useMenuItem";
import { MenuSeparator } from "./menu/MenuChrome";
import { menuCellToneStyle, menuRowRovingStyle } from "./menu/row-tone";
import { actionHint } from "@/components/action-hint";

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
const FORMATTING_ROW_H = 34;
const GRID_COLS = 4;

// CHIP 3: the lightning-bolt action list renders the CARD rows straight off
// the registry (the SSOT) — replacing the deleted `MENU_ENTRIES` array. The
// lightning surface exposes the full card vocabulary on every open (the bolt
// is paragraph/selection-scoped, not per-kind). Every row is greyed at render
// by its OWN `applies()` (tasks 061 / 968 — `cardRowVerdict` below), not by a
// per-row special case. The row list is constant, so it's computed once at
// module load (a registry view; its length is the registry's, never stated
// here).
const LIGHTNING_CARD_ROWS = cardActionRows("lightning");

/**
 * THE lightning grid (task 1352) — one row per cell, in display order. A cell
 * names its registry row and its glyph, and NOTHING the row already declares:
 * its name and chord (`label` / `keybinding`, task 985), whether it is greyed
 * (its own `applies()`, task 397) and whether it is ON (`toggledMember` — the
 * row's `toggle` + `makes`) are all read off the row. Coordinates are DERIVED
 * from the index (`gridCoords`), so a new cell is one line here, never a
 * renumbering. Two cells are bespoke nested-menu triggers and carry no glyph:
 * `block-type` (¶, no action row of its own) and `text-color` (the popover).
 */
interface LightningGridCell {
  id: ActionId | "block-type";
  glyph?: React.ReactNode;
}

export const LIGHTNING_GRID: readonly LightningGridCell[] = [
  { id: "bold", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z" />
    </svg>
  ) },
  { id: "italic", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" />
    </svg>
  ) },
  { id: "strike", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
      <path d="M11 4.5c-.5-1.2-1.7-2-3-2-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.1M5 11.5c.5 1.2 1.7 2 3 2 1.8 0 3-1 3-2.4 0-.6-.2-1.1-.6-1.5" />
    </svg>
  ) },
  { id: "code", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,4 1.5,8 5,12" />
      <polyline points="11,4 14.5,8 11,12" />
    </svg>
  ) },
  // ¶ — a nested-menu trigger with no action row of its own (BlockTypeGridCell).
  { id: "block-type" },
  { id: "bullet-list", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="3.5" cy="4" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6.5" y1="4" x2="13" y2="4" />
      <line x1="6.5" y1="8" x2="13" y2="8" />
      <line x1="6.5" y1="12" x2="13" y2="12" />
    </svg>
  ) },
  { id: "ordered-list", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <text x="2" y="5.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">1</text>
      <text x="2" y="9.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">2</text>
      <text x="2" y="13.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">3</text>
      <line x1="6.5" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="6.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="6.5" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ) },
  { id: "blockquote", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)" />
    </svg>
  ) },
  { id: "example", glyph: <IconExample size={16} /> },
  { id: "inline-math", glyph: (
    <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13 }}>
      $x$
    </span>
  ) },
  { id: "display-math", glyph: (
    <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13, letterSpacing: -0.5 }}>
      $$
    </span>
  ) },
  // A nested-menu trigger (opens the SelectionColorPopover) — ColorGridCell.
  { id: "text-color" },
  { id: "tex", glyph: (
    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
      \tex
    </span>
  ) },
  { id: "figure", glyph: (
    <span style={{ fontFamily: "var(--font-serif, serif)", fontStyle: "italic", fontSize: 12 }}>
      fig.
    </span>
  ) },
  { id: "graphics", glyph: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
      <circle cx="11" cy="6" r="1.25" fill="currentColor" stroke="none" />
      <path d="M2.5 12.5 L6 9 L9 11 L11 9.5 L13.5 12" />
    </svg>
  ) },
  // `\ref` — the registry's `refRun` → `ctx.openAtomCreate("ref")`, the SAME
  // create popover the slash `\ref` opens.
  { id: "ref", glyph: (
    <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
      \ref
    </span>
  ) },
  // The `forest` syntax-tree block (task 385): a two-child tree, the shape the
  // starter template inserts.
  { id: "forest", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M8 3.5 L4 8.5 M8 3.5 L12 8.5" />
      <circle cx="8" cy="2.75" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ) },
  // Small caps (task 808) — `\textsc{…}`, a mark toggle like row 0's.
  { id: "small-caps", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12.5 L4.5 3.5 L7.5 12.5 M2.6 9.5 H6.4" />
      <path d="M9 12.5 L11.25 6.5 L13.5 12.5 M9.8 10.4 H12.7" />
    </svg>
  ) },
  // Horizontal rule (task 1176) — `\hrulefill` through the registry's guarded
  // `horizontalRuleRun`, never TipTap's unguarded `setHorizontalRule()`.
  { id: "horizontal-rule", glyph: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 8 H14" />
    </svg>
  ) },
];

/** A cell's arrow-nav coordinates, from its place in `LIGHTNING_GRID`. */
function gridCoords(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GRID_COLS), col: index % GRID_COLS };
}

// Task 738: what the grid PAINTS from the live editor — every on-state and
// every grey the render asks. The live signature re-asks exactly these after
// each transaction while the panel is open, so the painted state follows the
// document instead of freezing at the panel's last render. Both lists are
// DERIVED from `LIGHTNING_GRID` (task 1352), so a new cell is in them by
// construction — before, they were hand mirrors that a census pinned to the
// call sites.
export const LIGHTNING_GRID_CELL_IDS: readonly ActionId[] = LIGHTNING_GRID.flatMap(
  (cell) => (cell.id === "block-type" ? [] : [cell.id]),
);
export const LIGHTNING_ACTIVE_MARKS: readonly string[] = LIGHTNING_GRID_CELL_IDS.flatMap((id) => {
  const on = toggledMember(VIRGIL_ACTION_REGISTRY[id]);
  return on === null ? [] : [on];
});

export interface ActionsMenuPanelProps {
  editor: Editor;
  /** Target paragraph for action dispatch. */
  paragraphUuid: string;
  /**
   * The REAL anchorable node kind at the caret (heading / listItem /
   * blockquote / codeBlock / … else "paragraph"), resolved ONCE at menu-open by
   * `resolveAnchorUuidAndKind` and carried on the same `menuTarget` as `uuid`.
   * In cursor mode `runAction` emits the dispatch ref with THIS kind (not a
   * flattened "paragraph") so `resolveRefRange` lands a non-null range for
   * non-paragraph carets — the BUG2 fix (see
   * docs/memos/action-menu-anchor-bugs/). The grey-out probe intentionally stays
   * a `{kind:"cursor"}` ref (see `cardRows` below); both derive from one source.
   */
  nodeKind: TextObjectKind;
  /** Live selection range; used for `kind: "selection"` dispatch. */
  range: { from: number; to: number };
  /** "selection" → dispatch with `kind: "selection"` + range.
   *  "cursor" → dispatch with `kind: nodeKind` (the real node kind) and grey
   *  out Highlight. */
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
  /** The LIVE bolt rect (task 1200): re-read by the provider at most once per
   *  frame on scroll/resize, so the open menu travels with its line. The
   *  static `triggerRect` alone is NOT live during a scroll — the parent's
   *  placement pass is suppressed for the whole gesture to keep the RESTING
   *  bolt from jittering, so the rect it hands down is frozen until scroll-idle.
   *  Null (anchor off-screen) falls back to `triggerRect` until the parent's
   *  settled off-screen close lands. */
  trackAnchor?: LiveAnchor;
  /** The element that opened this menu (the ⚡ bolt), exempted from
   *  click-outside so a press on it reaches its own toggle instead of closing
   *  the menu for the click to re-open (task 992). */
  triggerEl?: HTMLElement | null;
  onClose: () => void;
  /** The document's `\documentclass` (null = unknown), for the ¶ block-type
   *  dropdown's per-class heading rows (task 752). */
  documentClass?: string | null;
}

const PANEL_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

export function ActionsMenuPanel({
  editor,
  paragraphUuid,
  nodeKind,
  range,
  mode,
  triggerRect,
  trackAnchor,
  triggerEl = null,
  onClose,
  documentClass = null,
}: ActionsMenuPanelProps) {
  const dragHandleMenu = useDragHandleMenu();
  // CHIP 7b: the UNIFORM collab read-only signal for the lightning surface,
  // threaded into every ctx the grid builds + the card-row grey-out below.
  //
  // Task 638 — REACTIVE, not a snapshot. This read `editor.isEditable` alone:
  // the in-editor mirror is correct, but `editor` is not React state, so nothing
  // re-rendered this panel when the pen changed hands. A hand-off while the
  // lightning menu was open left every row lit and dispatchable, with a stale
  // flag as its only gate — the `DragHandleMenu` twin has taken `canEdit` as a
  // reactive PROP from `collab.canEditMainText` since CHIP 7b, and this is the
  // same signal reached through the same SSOT, via the `CollabProvider` that
  // already wraps this subtree (the established door for deep components —
  // `panel-primitives`, `CollabStatusPill`).
  //
  // The CONJUNCTION with `editor.isEditable` is deliberate: `canEditMainText` is
  // the pen, `isEditable` is any other surface-level read-only state, and either
  // one false means no mutation. It also keeps the greying honest in the frame
  // between the two mirrors flipping (they are driven by the same effect, one
  // render apart) — it greys on the FIRST of them, never the second.
  //
  // No over-gating: `COLLAB_INERT.canEditMainText` is `true`, so a non-collab
  // doc — and a panel mounted outside any provider — is un-gated.
  // TASK 733 — the second conjunct is now the DOOR, not `editor.isEditable`.
  // That property is `view.editable`, which MAIN pins `true` for the view's
  // entire lifetime, so the conjunction below was the pen alone on the surface
  // this panel serves. `surfaceEditableNow` adds the HOST axis (the React
  // `editable` prop a Library Reader pane sets false, mirrored in `editableRef`
  // and published by `readOnlyEnforcer`'s storage) — and is byte-identical on a
  // card body / float, which mounts no enforcer and is honestly answered by
  // `view.editable` alone.
  const canEdit = useCollabContext().canEditMainText && surfaceEditableNow(editor);

  // Color palette state (MRU-first, 7 slots).
  const [palette, setPalette] = useState<string[]>(() => loadPalette());
  // Cross-window re-sync (task 179, following 177). The palette is hydrated
  // once per mount and `persistPalette` writes all 7 slots, so a second window
  // would keep its load-time MRU order and its next color pick would rewrite
  // the whole array over the peer's. Re-read through the SAME `loadPalette`
  // validation; the write lives in `persistPalette`, never in a state-watching
  // effect, so a sync can't echo back out as a write.
  useStorageKeySync(COLOR_PALETTE_KEY, () => setPalette(loadPalette()));
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
  // The color cell's element, so the popover re-anchors on scroll (task 747).
  const colorCellRef = useRef<HTMLButtonElement | null>(null);
  const colorCellAnchor = useCallback(() => elementAnchor(colorCellRef.current)(), []);
  // The spawned color popover's live container element — registered into the
  // provider's click-outside exclude set so the lightning panel does NOT close
  // when a click lands in the color popover (it portals to document.body, so
  // it's not a DOM descendant of the menu container). This is the REAL ref that
  // replaces the brittle `querySelector('div[aria-label="Text color"]')` the
  // pre-migration click-outside effect used (design §3.2 / R8).
  const [colorPopoverEl, setColorPopoverEl] = useState<HTMLElement | null>(null);
  // Stash the selection range so the color popover can re-apply it after
  // the native color picker steals focus. TRACKED (task 1314): the range
  // follows edits landing while the popover is open, so the pick colours the
  // text that was selected, not whatever shifted into its offsets. The tracker
  // lives exactly as long as the popover — released on pick, close, re-open
  // and unmount.
  const stashedRangeRef = useRef<TrackedRange | null>(null);
  const releaseStash = () => {
    stashedRangeRef.current?.dispose();
    stashedRangeRef.current = null;
  };
  useEffect(() => {
    if (colorPopoverAnchor) return;
    stashedRangeRef.current?.dispose();
    stashedRangeRef.current = null;
  }, [colorPopoverAnchor]);
  useEffect(
    () => () => {
      stashedRangeRef.current?.dispose();
      stashedRangeRef.current = null;
    },
    [],
  );

  const runAction = (action: DragHandleAction) => {
    if (!dragHandleMenu) return;
    // BUG2 (Path A): in cursor mode dispatch the REAL anchorable node kind
    // (`nodeKind`) — NOT a flattened "paragraph". A heading/listItem caret used
    // to emit `{kind:"paragraph", id:<headingUuid>}`, which `resolveRefRange`
    // could never match (no paragraph carries a heading uuid) → null → silent
    // annotation bail. With the real kind it resolves the heading line / list
    // item content range and the card lands. The grey-out probe below stays a
    // `{kind:"cursor"}` ref ON PURPOSE — see the `cardRows` comment; both derive
    // from the ONE `menuTarget` (uuid + kind), so probe and dispatch can never
    // diverge on identity.
    const ref =
      mode === "cursor"
        ? { kind: nodeKind, id: paragraphUuid }
        : {
            kind: "selection" as const,
            paragraphId: paragraphUuid,
            from: range.from,
            to: range.to,
          };
    // Never rejects — the dispatcher reports its own failures (task 735).
    void dragHandleMenu.dispatch(action, ref);
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
    const ctx: ActionContext = {
      // The lightning panel's one ctx constructor (task 1199), carrying the
      // uniform collab gate (CHIP 7b): when the partner holds the pen the row's
      // `run()` no-ops (and the cell is greyed below).
      ...lightningContext(editor, canEdit),
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
        // Rewritten on EVERY open (task 1168): a collapsed caret clears it, so a
        // popover dismissed without a pick can never leave a stale range behind.
        releaseStash();
        stashedRangeRef.current = from !== to ? trackRange(editor, from, to) : null;
        setColorPopoverAnchor(rect);
      },
      // The SHARED create-popover seam (citation + `\ref`). The 'Cross-ref' grid
      // cell's `run()` (`refRun`) calls this with kind "ref" to open the create
      // popover at the caret (the popover is the creator). Like `openFigurePopover`,
      // the grid is a React subtree separate from EditorLayout's popover state, so
      // we compute the caret rect + captured pos and hop the
      // `virgil-atom-create-popover` event EditorLayout consumes. SAME event the
      // slash surface's bridge dispatches, so the two surfaces converge on ONE
      // controller. (The grid only exposes `ref` today; citation routes through
      // the dispatcher, which dispatches the same event at the passage end.)
      openAtomCreate: (kind, opts) => {
        if (typeof window === "undefined") return;
        const pos = opts?.pos ?? editor.state.selection.from;
        const coords = editor.view.coordsAtPos(pos);
        const rect = new DOMRect(
          coords.left,
          coords.top,
          0,
          coords.bottom - coords.top,
        );
        // Carry the OWNING editor into the event detail (CHIP 5). This panel's
        // `editor` prop is `overrideEditor ?? mainEditor` (EditorPane wires the
        // MenuBar/lightning grid that way), so when a footnote/note RichTextField
        // is focused `editor` IS that nested editor — and the captured `pos` is
        // in ITS pos-space. Threading it through lets the commit insert the
        // `\cite`/`\ref` atom into the focused footnote body, not blindly into
        // MAIN (mirrors `activeMath.editor` / `activeFigure.editor`).
        window.dispatchEvent(
          new CustomEvent(ATOM_CREATE_POPOVER_EVENT, {
            detail: { kind, rect, pos, refCommand: opts?.refCommand, editor },
          }),
        );
      },
    };
    // Task 1299: the commit RE-ASKS the cell's question through the registry's
    // ONE run door (the render-time `disabled=` is only as fresh as the last
    // render). Focus the doc first (the grid cell is a toolbar button — focus
    // may be on the button, not the doc); the format/math `run()`s re-focus
    // too, but figure/graphics read the live selection before inserting, so we
    // focus up-front — as `beforeRun`, so a REFUSED commit moves no focus.
    runRegistryAction(row, ctx, { beforeRun: () => editor.chain().focus().run() });
    // NOTE: like the prior format cells (and the prior `wrapSelectionInMath` /
    // `insertFigureBlock` direct calls), we do NOT auto-close the menu here —
    // it dismisses on click-outside. Faithful to pre-6a/6b behavior.
  };

  // The popover's three commits (swatch, custom pick, Clear) cross the
  // `text-color` row's ONE commit door (task 1168), which re-asks the row's own
  // `applies()` and the LIVE pen ∧ host gate against a ctx built NOW — not the
  // open-time verdict. A refused commit writes nothing and bumps no MRU slot;
  // either way the popover closes (it has nothing left to offer).
  const commitColor = (color: string | null) => {
    const tracked = stashedRangeRef.current;
    // A stash whose text was removed meanwhile resolves `null`; colouring the
    // live selection instead would paint text the user never picked — refuse.
    const stashed = tracked ? tracked.get() : null;
    const landed = tracked && !stashed ? false : applyTextColor(gridCellCtx(stashed), color);
    if (landed && color !== null) bumpColorToFront(color);
    setColorPopoverAnchor(null);
    releaseStash();
  };
  const applyColor = (color: string) => commitColor(color);
  const clearColor = () => commitColor(null);

  // ───────────────────────────────────────────────────────────────────────
  // THE grid's one applicability door (task 397). Every cell asks ITS OWN row.
  //
  // Until 397 the panel carried two SHARED probes — one `blockAtomsDisabled`
  // computed from the `example` row and fed to SIX block-atom cells, and one
  // `wrappersDisabled` computed from the `bullet-list` row and fed to all THREE
  // wrapper cells — on the stated ground that the rows behind each group "share
  // one `applies()`". They do not: `blockInsertApplies` is deliberately a
  // per-NodeType FACTORY (its own docstring says so) and `wrapperApplies` became
  // one in 397, so a shared probe is an assertion that the SCHEMA answers
  // identically for every type in the group. Inside an expex example it does not
  // — `exampleBlock` hosts `displayMath` and `graphicsBlock` and nothing else of
  // the six, so **Display math** and **Image** greyed out although each row said
  // `ok`, the schema hosted them and the run worked (Feature A2, unreachable from
  // the grid) — while inside an example ITEM the two list cells stayed lit over a
  // toggle that DESTROYS the item's `\vxid` identity and renumbers the example.
  //
  // The GRAB menu had this right from the start (`DragHandleMenu`:
  // `disabled: row.applies(ctx) === "disabled"`, one call per row), which is the
  // precedent this restores. The census in `grid-row-applies.test.ts` is what
  // keeps it: no `disabled=` on a grid cell may read anything but this door,
  // called with the cell's own id.
  //
  // `!canEdit` folds in (the collab gate is inside `applies()` too, but the
  // uniform OR keeps every cell rendering the same way). One ctx per call;
  // computed at menu-open, never per keystroke — keystroke sanctity.
  // ───────────────────────────────────────────────────────────────────────
  // `range` overrides the live selection — the colour commit passes its stashed
  // range (task 1168), the grid cells pass nothing.
  const gridCellCtx = (range?: { from: number; to: number } | null): ActionContext =>
    lightningContext(editor, canEdit, range);
  const gridCellDisabled = (id: ActionId): boolean =>
    !canEdit || VIRGIL_ACTION_REGISTRY[id]!.applies(gridCellCtx()) === "disabled";
  // Task 968: WHY a cell is grey — the same row, the same ctx, through
  // `verdictOf`. Read by each cell off `GridCellReasonContext` with its OWN id,
  // so the grid's one `disabled=` door stays per cell and no cell can explain
  // itself with another cell's reason. Asked only for a
  // cell that IS disabled (render-time, gesture rate).
  const gridCellReason = (id: ActionId): string | null =>
    verdictOf(VIRGIL_ACTION_REGISTRY[id]!, gridCellCtx()).reason;
  // Task 1199: the ¶ cell dispatches no row of its own, so it asks the
  // block-type verdict — read-only, or no heading level applies here and there
  // is no heading for "Body text" to demote (a footnote body, a list-item
  // caret, a protected block). The SAME `headingLevelVerdict` its rows grey on.
  const blockTypeCell = blockTypeVerdict(editor, documentClass, canEdit);

  // Task 1168: an ALREADY-OPEN colour popover closes when its cell greys (the
  // pen changes hands while the user is picking). The commit door refuses on its
  // own; this is the affordance half — no live swatch over a surface that can no
  // longer take one. Adjusted on the boolean EDGE during render (React's
  // "storing information from previous renders" pattern, not an effect): the
  // panel re-renders on `canEdit`, never on a keystroke. The stash needs no
  // reset here — `openColorPopover` rewrites it on every open. The edge rule is
  // the menu primitives' ONE `useCloseOnDisabledEdge` (task 1369), shared with
  // the ¶ cell's `BlockTypeDropdown`.
  useCloseOnDisabledEdge(gridCellDisabled("text-color"), () => {
    setColorPopoverAnchor(null);
    setColorPopoverEl(null);
  });

  // The card-action rows, decorated with their per-open disabled state, fed
  // to `<MenuItemsFromRegistry>` (the same mapper the grab menu uses). CHIP 7b:
  // the card-row grey-out runs through the row's OWN `applies()` (the DA-5
  // taxonomy + the uniform collab gate). The ref mirrors the action's actual
  // state: cursor mode → a collapsed-caret `cursor` ref (no live range, so
  // `highlight` — selection-`"required"` — greys); selection mode → the live
  // range. `canEdit` greys EVERY row when the partner holds the pen.
  //
  // BUG2 / Path A — INTENTIONAL probe↔dispatch asymmetry: this applicability
  // PROBE uses a `{kind:"cursor"}` ref while `runAction`'s DISPATCH uses the
  // real `{kind: nodeKind}` ref. The probe MUST stay `cursor` so
  // `refHasLiveRange`/`kindAllowsCardAction` correctly grey `highlight` at a
  // caret (a cursor has no live range). The dispatch must carry the real node
  // kind so `resolveRefRange` lands a non-null range (the heading line / list
  // item content). The asymmetry is by design, not a bug to "fix" — and since
  // BOTH derive from the ONE `menuTarget` (same `paragraphUuid`, same
  // `nodeKind`/`range`), they cannot diverge on anchor identity.
  const cardRowVerdict = (entry: (typeof LIGHTNING_CARD_ROWS)[number]) => {
    const applyRef =
      mode === "cursor"
        ? { kind: "cursor" as const, pos: range.from, paragraphId: paragraphUuid }
        : {
            kind: "selection" as const,
            from: range.from,
            to: range.to,
            paragraphId: paragraphUuid,
          };
    // Task 061: thread the live `view` so the card rows' `applies()` can
    // resolve the caret's CONTAINING block kind for this gesture ref (a
    // `cursor`/`selection` has no TextObject kind of its own). Before this, the
    // gesture ref short-circuited to "allow", so the lightning bolt let you add
    // a citation to a `titleField` / footnote to a codeBlock — the SAME
    // corruption the grab-bar already greyed out. Now all four surfaces agree.
    // Task 968: `verdictOf` — the row's own `applies()` state plus WHY.
    return verdictOf(entry, { ref: applyRef, canEdit, view: editor.view } as ActionContext);
  };
  const cardRows: DecoratedMenuRow[] = LIGHTNING_CARD_ROWS.map((entry) => {
    const verdict = cardRowVerdict(entry);
    const disabled = verdict.state === "disabled";
    return {
      id: entry.id,
      label: entry.label,
      // The lightning panel's letter fast-path is preserved (H/N/F/C/T/E/X/R/D/A).
      // The delete row's display glyph "⌫" is NOT a typeable key, so — matching
      // the pre-migration behavior — delete has no working letter shortcut here
      // (no Backspace/Delete alias, unlike the grab menu which adds one).
      letter: entry.letter,
      icon: entry.icon,
      separator: entry.separator,
      destructive: entry.destructive,
      disabled,
      disabledReason: verdict.reason,
      run: () => runAction(entry.id as DragHandleAction),
    };
  });

  // Task 738 — the painted state FOLLOWS the live editor while the panel is
  // open. A format click deliberately keeps the menu open (see `runGridAction`)
  // and sets no React state, and nothing above re-renders on a mark toggle
  // (the parent's placement bails on an unchanged rect), so every cell's
  // `active` and `disabled`, and the card rows' grey-out, were a snapshot of the
  // last render: click B, the word turns bold, the cell stays unlit. The
  // signature re-asks the SAME reads the render makes, ≤1/frame, and
  // re-renders only when one of them changed. The subscription lives exactly as
  // long as this panel, which exists only while the menu is open.
  useLiveEditorSignature(editor, () =>
    [
      canEdit ? "e" : "r",
      LIGHTNING_ACTIVE_MARKS.map((n) => (editor.isActive(n) ? 1 : 0)).join(""),
      // Task 968: a greyed cell / row contributes its REASON, so a caret move
      // that keeps a row grey but changes why (out of a title, into code)
      // re-renders the hint too.
      LIGHTNING_GRID_CELL_IDS.map((id) => (gridCellDisabled(id) ? gridCellReason(id) ?? 1 : 0)).join(","),
      blockTypeCell.disabled ? blockTypeCell.reason ?? 1 : 0,
      LIGHTNING_CARD_ROWS.map((entry) => {
        const v = cardRowVerdict(entry);
        return v.state === "disabled" ? v.reason ?? 1 : 0;
      }).join(","),
    ].join("|"),
  );

  if (typeof document === "undefined") return null;

  return (
    <>
      <MenuProvider
        id="lightning"
        layout="composite"
        role="menu"
        anchorRect={triggerRect}
        trackAnchor={trackAnchor}
        placements={PANEL_PLACEMENTS}
        gap={4}
        letterShortcuts
        getActiveDescendantHost={caretEditableHost}
        // Preserve the load-bearing `e.stopPropagation()` on Escape (was
        // ActionsMenuPanel.tsx:338): keeps Escape from reaching tab-indent.ts's
        // Escape→blur handler, so closing the menu doesn't drop the editor's
        // cursor/selection. Default is already true for editor-anchored menus;
        // declared explicitly here so the seam is visible.
        dismissOn={{ escape: { stopPropagation: true } }}
        // The spawned color popover portals to document.body, so a click into it
        // would otherwise land "outside" and dismiss the panel. Register its
        // live element so the click-outside treats it as "inside" (R8). The
        // trigger rides the same list, so re-pressing it toggles (task 992).
        excludeRefs={[triggerEl, colorPopoverEl]}
        onClose={onClose}
        ariaLabel="Selection actions"
        containerClassName="selection-actions-menu"
        containerStyle={{
          width: MENU_W,
          padding: `${MENU_PAD_Y}px 0`,
        }}
      >
        {/* ── Formatting icon grid — LIGHTNING_GRID, GRID_COLS wide ── */}
        <GridCellReasonContext.Provider value={gridCellReason}>
        <MenuGrid
          cols={GRID_COLS}
          style={{ gap: 2, padding: "0 4px" }}
        >
          {LIGHTNING_GRID.map((cell, i) => {
            const { row, col } = gridCoords(i);
            if (cell.id === "block-type") {
              return (
                <BlockTypeGridCell
                  key={cell.id}
                  row={row}
                  col={col}
                  editor={editor}
                  documentClass={documentClass}
                  disabled={blockTypeCell.disabled}
                  reason={blockTypeCell.reason}
                />
              );
            }
            if (cell.id === "text-color") {
              return (
                <ColorGridCell
                  key={cell.id}
                  row={row}
                  col={col}
                  disabled={gridCellDisabled("text-color")}
                  lastAppliedColor={lastAppliedColor}
                  cellRef={colorCellRef}
                  run={(rect) => runGridAction("text-color", { anchorRect: rect })}
                />
              );
            }
            // A TOGGLE row paints its on-state off its own `makes` (task 1352);
            // every other row is a plain command with no checked state.
            const id: ActionId = cell.id;
            const on = toggledMember(VIRGIL_ACTION_REGISTRY[id]);
            return (
              <FmtBtn
                key={id}
                id={id}
                row={row}
                col={col}
                checked={on === null ? undefined : editor.isActive(on)}
                disabled={gridCellDisabled(id)}
                run={() => runGridAction(id)}
              >
                {cell.glyph}
              </FmtBtn>
            );
          })}
        </MenuGrid>
        </GridCellReasonContext.Provider>

        <MenuSeparator />

        {/* ── Card action list (the registry's lightning rows) ──── */}
        <MenuList className="lightning-card-list">
          <MenuItemsFromRegistry rows={cardRows} />
        </MenuList>

        {/* Task 151 — the color popover is a STACK PARTICIPANT, not a portaled
            sibling. It renders as a React DESCENDANT of the lightning provider
            (it still `portal`s to document.body, so DOM/stacking is unchanged),
            so `MenuStackContext` flows through the `createPortal` boundary → the
            popover inherits the SAME `MenuStackController` → depth+1 → becomes
            the stack top while open. The lightning menu's window-capture keydown
            + Escape then correctly STAND DOWN: one Arrow moves only the swatch
            cursor, one Enter applies only the swatch, one Escape pops just the
            popover (matching the nested-descendant contract in
            nested-provider-stack.test.tsx). As a sibling (the pre-151 topology,
            rendered after `</MenuProvider>`) it read the root sentinel and built
            its OWN controller, so BOTH menus declared themselves `isTop` and
            both fired on every keypress — the double-move / double-activate /
            double-close bug. The `excludeRefs` click-outside coupling above is
            orthogonal to stack membership and still applies; a nested provider
            ALSO auto-registers its container into the parent's exclude set
            (MenuProvider :289–301), so it is now belt-and-suspenders — retained
            deliberately (removing it would drop the coupling during the one
            setTimeout(0) tick before the auto-register lands). */}
        {colorPopoverAnchor && (
          <SelectionColorPopover
            anchorRect={colorPopoverAnchor}
            trackAnchor={colorCellAnchor}
            palette={palette}
            onApply={applyColor}
            onClear={clearColor}
            onPickCustom={applyColor}
            onContainerRef={setColorPopoverEl}
            onClose={() => {
              setColorPopoverAnchor(null);
              setColorPopoverEl(null);
              releaseStash();
            }}
          />
        )}
      </MenuProvider>
    </>
  );
}

/**
 * Shared shell for the lightning grid's two `<button>`-based cells (`FmtBtn`
 * and `ColorGridCell`): the fixed row height and the borderless surface. The
 * STATE look — roving fill, format-applied surface, disabled ink + cursor — is
 * the menu's, not the grid's (task 986): `menuCellToneStyle` in
 * `menu/row-tone.ts`, so a greyed cell is the same grey as a greyed card row
 * in the list below it (the cell used to dim to `0.4` over `--ink-muted`).
 */
function gridCellShellStyle(): React.CSSProperties {
  return { height: FORMATTING_ROW_H, border: "none" };
}

/**
 * Shared className for the two button grid cells: the flex/rounded/transition
 * base, with `hover-on-light` gated off when disabled. `extra` appends
 * cell-specific classes (the color cell's `flex-col`).
 */
function gridCellClassName(disabled?: boolean, extra?: string): string {
  return `flex items-center justify-center rounded transition-colors ${
    disabled ? "" : "hover-on-light"
  }${extra ? ` ${extra}` : ""}`;
}

/**
 * One bespoke format-grid cell, registered into the lightning menu's grid
 * region. Spreads `useMenuItem` getters onto the existing `<button>` so the
 * cell GAINS arrow nav + the roving `data-active` highlight without a markup
 * rewrite. `run` = the cell's existing action; `checked` = a toggle row's
 * on-state (bold-is-on) — announced as `aria-checked` on a `menuitemcheckbox`
 * and painted with the `--control-selected*` tint, distinct from the roving
 * highlight (task 1352).
 *
 * The `data-hint` + `aria-label` carry the row's label (the registry-render test
 * reads grid cells via `data-hint`).
 */
function FmtBtn({
  id,
  row,
  col,
  children,
  run,
  checked,
  disabled,
}: {
  /** The registry row this cell runs — its NAME is the row's `label` and its
   *  advertised chord the row's `keybinding` (task 985), so the grid carries
   *  no second vocabulary beside the slash popup and the grab menu. */
  id: ActionId;
  row: number;
  col: number;
  children: React.ReactNode;
  run: () => void;
  /** A TOGGLE cell's on-state (bold-is-on), read off its row (task 1352);
   *  `undefined` for a plain command cell, which has no checked state. */
  checked?: boolean;
  /** CHIP 7b: collab read-only greys the cell + inerts the click. */
  disabled?: boolean;
}) {
  const toggle = checked !== undefined;
  const { active: roving, getItemProps } = useMenuItem({
    id,
    region: "grid",
    coords: { row, col },
    disabled,
    run,
    // A toggle ANNOUNCES its state (task 1352): `menuitemcheckbox` +
    // `aria-checked`, the vocabulary `MenuToggleRow` speaks in the list menus.
    ...(toggle ? { role: "menuitemcheckbox" as const } : {}),
  });
  const itemProps = getItemProps();
  const reason = useContext(GridCellReasonContext);
  const why = disabled ? reason(id) : null;
  const spec = VIRGIL_ACTION_REGISTRY[id];
  return (
    <button
      {...itemProps}
      type="button"
      {...actionHint(spec, why)}
      disabled={disabled}
      aria-checked={toggle ? checked : undefined}
      className={gridCellClassName(disabled)}
      style={{
        ...gridCellShellStyle(),
        // Roving WINS over format-applied (the arrow cursor stays unambiguous
        // on an applied format); disabled greys the ink — one rule, the menu's.
        ...menuCellToneStyle({ roving, disabled, applied: checked }),
      }}
    >
      {children}
    </button>
  );
}

/**
 * WHY a grid cell is greyed (task 968), keyed by the cell's own action id. The
 * panel provides `gridCellReason`; the default answers nothing, so a cell
 * rendered outside the panel (a test harness) is simply unexplained, never
 * mis-explained.
 */
const GridCellReasonContext = createContext<(id: ActionId) => string | null>(() => null);

/**
 * The text-color grid cell — a nested-menu trigger (opens the
 * SelectionColorPopover). Kept bespoke for Phase C, but registered as a grid
 * cell so arrows reach it. Its `run(rect)` opens the popover anchored to the
 * cell; for keyboard activation (no mouse rect) it falls back to the cell's own
 * bounding rect.
 */
function ColorGridCell({
  row,
  col,
  disabled,
  lastAppliedColor,
  cellRef,
  run,
}: {
  row: number;
  col: number;
  disabled: boolean;
  lastAppliedColor: string;
  /** Mirrors the cell element out for the popover's live anchor (task 747). */
  cellRef?: { current: HTMLButtonElement | null };
  run: (rect: DOMRect) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const reason = useContext(GridCellReasonContext);
  const why = disabled ? reason("text-color") : null;
  const { active: roving, getItemProps } = useMenuItem({
    id: "text-color",
    region: "grid",
    coords: { row, col },
    disabled,
    // Keyboard activation (Enter/Space) has no mouse rect → anchor on the cell.
    run: () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) run(rect);
    },
  });
  const itemProps = getItemProps();
  return (
    <button
      {...itemProps}
      ref={(el) => {
        btnRef.current = el;
        if (cellRef) cellRef.current = el;
        itemProps.ref(el);
      }}
      type="button"
      {...actionHint(VIRGIL_ACTION_REGISTRY["text-color"], why)}
      disabled={disabled}
      onClick={
        disabled
          ? itemProps.onClick
          : (e) => run(e.currentTarget.getBoundingClientRect())
      }
      className={gridCellClassName(disabled, "flex-col")}
      style={{
        ...gridCellShellStyle(),
        ...menuCellToneStyle({ roving, disabled, ink: "var(--ink-strong)" }),
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
  );
}

/**
 * The BlockType dropdown grid cell — a nested-menu trigger (kept bespoke for
 * Phase C). The `BlockTypeDropdown` owns its own button + open state + its
 * nested, portaled dropdown (which auto-registers into this menu's click-outside
 * excludes, R8). We wrap it in a registered grid cell so arrows can land on
 * it; Enter/Space (and click) open the dropdown by clicking the inner trigger.
 */
function BlockTypeGridCell({
  row,
  col,
  editor,
  documentClass,
  disabled,
  reason,
}: {
  row: number;
  col: number;
  editor: Editor;
  documentClass: string | null;
  /** `blockTypeVerdict` (task 1199): read-only (task 1017), or no row would
   *  do anything here — so ¶ cannot offer rows `pickBlockType` would drop. */
  disabled: boolean;
  /** WHY it is grey — the same verdict's reason. */
  reason: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const why = disabled ? reason : null;
  const { active: roving, getItemProps } = useMenuItem({
    id: "block-type",
    region: "grid",
    coords: { row, col },
    disabled,
    // Keyboard activation: click the BlockTypeDropdown's own trigger button.
    run: () => {
      wrapRef.current?.querySelector("button")?.click();
    },
  });
  const itemProps = getItemProps();
  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        itemProps.ref(el);
      }}
      role={itemProps.role}
      id={itemProps.id}
      data-active={itemProps["data-active"]}
      onMouseEnter={itemProps.onMouseEnter}
      onMouseMove={itemProps.onMouseMove}
      className="flex items-center justify-center"
      style={{
        height: FORMATTING_ROW_H,
        borderRadius: "var(--radius-sm)",
        ...menuRowRovingStyle(roving, disabled),
      }}
    >
      <BlockTypeDropdown
        editor={editor}
        documentClass={documentClass}
        disabled={disabled}
        disabledReason={why}
      />
    </div>
  );
}
