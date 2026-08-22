"use client";

/**
 * The expanded action menu — formatting grid + 11-row action list (the
 * "lightning" panel behind the margin bolt + Cmd-/). Mounted by its trigger,
 * the margin button in {@link SelectionActionsMenu}. When this component is
 * mounted, the menu is open; the caller unmounts it to close.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase B2) ──
 * This is the COMPOSITE reference for the `<Menu>` primitive
 * (`src/components/menu/`, design `docs/agents/menu-system-design.md`). It now
 * renders via `<MenuProvider layout="composite" role="menu" portal
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
 * doesn't dismiss the lightning panel. The BlockTypeDropdown renders in-tree
 * (a DOM descendant of the menu container), so it needs no exclusion.
 */

import { useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import type { DragHandleAction } from "./DragHandleMenu";
import type { TextObjectKind } from "@/text-objects/types";
import {
  cardActionRows,
  exampleRun,
  extractInlineFromSlice,
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
} from "@/lib/actions/action-registry";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { useStorageKeySync } from "@/lib/cross-window-storage";
import { BlockTypeDropdown } from "./MenuBar";
import { IconExample } from "./editor-layout/panel-icons";
import { insertTexBlock } from "@/lib/tiptap/tex-block";
import { SelectionColorPopover } from "./SelectionColorPopover";
import { type FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import { MenuGrid, MenuList } from "./menu/regions";
import {
  MenuItemsFromRegistry,
  type DecoratedMenuRow,
} from "./menu/MenuItemsFromRegistry";
import { useMenuItem } from "./menu/useMenuItem";

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
// is paragraph/selection-scoped, not per-kind); the only run-time grey-out is
// Highlight in cursor mode, applied at render below. The row list is constant,
// so it's computed once at module load (an 11-row registry view).
const LIGHTNING_CARD_ROWS = cardActionRows("lightning");

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
  onClose: () => void;
}

const PANEL_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

/** The PM view's focused contentEditable holds the caret while the menu is
 *  open (the menu never steals focus — roving aria-activedescendant only). Use
 *  it as the activedescendant host so a screen reader tracks the active item
 *  without the caret moving; fall back to null (the provider then no-ops the
 *  attribute write) if focus isn't on an editable element. */
function getActiveDescendantHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

export function ActionsMenuPanel({
  editor,
  paragraphUuid,
  nodeKind,
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
  // The spawned color popover's live container element — registered into the
  // provider's click-outside exclude set so the lightning panel does NOT close
  // when a click lands in the color popover (it portals to document.body, so
  // it's not a DOM descendant of the menu container). This is the REAL ref that
  // replaces the brittle `querySelector('div[aria-label="Text color"]')` the
  // pre-migration click-outside effect used (design §3.2 / R8).
  const [colorPopoverEl, setColorPopoverEl] = useState<HTMLElement | null>(null);
  // Stash the selection range so the color popover can re-apply it after
  // the native color picker steals focus.
  const stashedRangeRef = useRef<{ from: number; to: number } | null>(null);

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
    // grab-handle `cardCreation` slot is intentionally absent
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

  // Task 147 (DATA-LOSS): the six block-atom INSERT cells (example /
  // display-math / `\tex` / figure / graphics / forest) grey out when the caret sits in a
  // block that can't host a block child (titleField / codeBlock / latexComment)
  // — inserting there would SPLIT the container into two `\title{}` (silent
  // data-loss on reload) or two verbatim blocks. All five share the registry's
  // container-aware `blockInsertApplies`, so one probe (the `example` row) covers
  // all six. `!canEdit` is folded in (collab gate) for a uniform render, exactly
  // like `wrappersDisabled`. inline-math / `\ref` insert INLINE atoms and are
  // gated SEPARATELY below (task 396): they are legitimate in a `titleField`
  // (`inline*`) — which is why they cannot share this probe — but they DO corrupt
  // the markless `text*` verbatim blocks, contrary to the task-147 sentence that
  // used to stand here. Computed at menu-open, never per keystroke.
  const blockAtomsDisabled =
    !canEdit ||
    VIRGIL_ACTION_REGISTRY["example"]!.applies({
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

  // Task 396 — the two INLINE-atom cells (`$x$`, `Cross-ref`). Deliberately NOT
  // a second SHARED probe: the two rows pass DIFFERENT schema node names
  // (`inlineMath` / `labelRef`) to `inlineAtomInsertApplies`, so one probe would
  // be asserting that the schema answers identically for both — the shared-probe
  // substitution this grid is already filed for. Each cell asks its OWN row.
  // `!canEdit` folds in for a uniform render, as above. Computed at menu-open,
  // never per keystroke.
  const rowDisabled = (id: ActionId): boolean =>
    !canEdit ||
    VIRGIL_ACTION_REGISTRY[id]!.applies({
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

  // The 11 card-action rows, decorated with their per-open disabled state, fed
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
  const cardRows: DecoratedMenuRow[] = LIGHTNING_CARD_ROWS.map((entry) => {
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
    const disabled =
      entry.applies({ ref: applyRef, canEdit, view: editor.view } as ActionContext) === "disabled";
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
      run: () => runAction(entry.id as DragHandleAction),
    };
  });

  return (
    <>
      <MenuProvider
        id="lightning"
        layout="composite"
        role="menu"
        portal
        anchorRect={triggerRect}
        placements={PANEL_PLACEMENTS}
        gap={4}
        letterShortcuts
        getActiveDescendantHost={getActiveDescendantHost}
        // Preserve the load-bearing `e.stopPropagation()` on Escape (was
        // ActionsMenuPanel.tsx:338): keeps Escape from reaching tab-indent.ts's
        // Escape→blur handler, so closing the menu doesn't drop the editor's
        // cursor/selection. Default is already true for editor-anchored menus;
        // declared explicitly here so the seam is visible.
        dismissOn={{ escape: { stopPropagation: true } }}
        // The spawned color popover portals to document.body, so a click into it
        // would otherwise land "outside" and dismiss the panel. Register its
        // live element so the click-outside treats it as "inside" (R8).
        excludeRefs={[colorPopoverEl]}
        onClose={onClose}
        ariaLabel="Selection actions"
        containerClassName="selection-actions-menu"
        containerStyle={{
          width: MENU_W,
          padding: `${MENU_PAD_Y}px 0`,
        }}
      >
        {/* ── Formatting icon grid (4 cols × 5 rows) ─────────────── */}
        <MenuGrid
          cols={GRID_COLS}
          style={{ gap: 2, padding: "0 4px" }}
        >
          {/* Row 0 */}
          <FmtBtn
            id="bold"
            row={0}
            col={0}
            title="Bold (⌘B)"
            active={isActive("bold")}
            disabled={!canEdit}
            run={() => runGridAction("bold")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z" />
            </svg>
          </FmtBtn>
          <FmtBtn
            id="italic"
            row={0}
            col={1}
            title="Italic (⌘I)"
            active={isActive("italic")}
            disabled={!canEdit}
            run={() => runGridAction("italic")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" />
            </svg>
          </FmtBtn>
          <FmtBtn
            id="strike"
            row={0}
            col={2}
            title="Strikethrough"
            active={isActive("strike")}
            disabled={!canEdit}
            run={() => runGridAction("strike")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="2.5" y1="8" x2="13.5" y2="8" />
              <path d="M11 4.5c-.5-1.2-1.7-2-3-2-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.1M5 11.5c.5 1.2 1.7 2 3 2 1.8 0 3-1 3-2.4 0-.6-.2-1.1-.6-1.5" />
            </svg>
          </FmtBtn>
          <FmtBtn
            id="code"
            row={0}
            col={3}
            title="Inline code"
            active={isActive("code")}
            disabled={!canEdit}
            run={() => runGridAction("code")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="5,4 1.5,8 5,12" />
              <polyline points="11,4 14.5,8 11,12" />
            </svg>
          </FmtBtn>

          {/* Row 1 — the BlockTypeDropdown is a nested-menu trigger (kept bespoke
              for Phase C). It registers as a grid cell so arrows can land on it;
              Enter/Space + click open its dropdown via the cell wrapper. */}
          <BlockTypeGridCell
            row={1}
            col={0}
            editor={editor}
          />
          <FmtBtn
            id="bullet-list"
            row={1}
            col={1}
            title="Bullet list"
            active={isActive("bulletList")}
            disabled={wrappersDisabled}
            run={() => runGridAction("bullet-list")}
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
            id="ordered-list"
            row={1}
            col={2}
            title="Numbered list"
            active={isActive("orderedList")}
            disabled={wrappersDisabled}
            run={() => runGridAction("ordered-list")}
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
            id="blockquote"
            row={1}
            col={3}
            title="Blockquote"
            active={isActive("blockquote")}
            disabled={wrappersDisabled}
            run={() => runGridAction("blockquote")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
              <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)" />
            </svg>
          </FmtBtn>

          {/* Row 2 */}
          <FmtBtn
            id="example"
            row={2}
            col={0}
            title="Wrap selection in example block"
            disabled={blockAtomsDisabled}
            run={() => wrapSelectionInExample()}
          >
            <IconExample size={16} />
          </FmtBtn>
          <FmtBtn
            id="inline-math"
            row={2}
            col={1}
            title="Wrap selection in inline math"
            disabled={rowDisabled("inline-math")}
            run={() => runGridAction("inline-math")}
          >
            <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13 }}>
              $x$
            </span>
          </FmtBtn>
          <FmtBtn
            id="display-math"
            row={2}
            col={2}
            title="Wrap selection in display math"
            disabled={blockAtomsDisabled}
            run={() => runGridAction("display-math")}
          >
            <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13, letterSpacing: -0.5 }}>
              $$
            </span>
          </FmtBtn>
          {/* text-color — a nested-menu trigger (opens the SelectionColorPopover).
              Kept bespoke; registers as a grid cell so arrows reach it. */}
          <ColorGridCell
            row={2}
            col={3}
            disabled={!canEdit}
            lastAppliedColor={lastAppliedColor}
            run={(rect) => runGridAction("text-color", { anchorRect: rect })}
          />

          {/* Row 3 */}
          <FmtBtn
            id="tex"
            row={3}
            col={0}
            title="Insert raw LaTeX block"
            disabled={blockAtomsDisabled}
            run={() => insertTexBlock(editor)}
          >
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
              \tex
            </span>
          </FmtBtn>
          <FmtBtn
            id="figure"
            row={3}
            col={1}
            title="Insert figure block"
            disabled={blockAtomsDisabled}
            run={() => runGridAction("figure")}
          >
            <span style={{ fontFamily: "var(--font-serif, serif)", fontStyle: "italic", fontSize: 12 }}>
              fig.
            </span>
          </FmtBtn>
          <FmtBtn
            id="graphics"
            row={3}
            col={2}
            title="Insert image"
            disabled={blockAtomsDisabled}
            run={() => runGridAction("graphics")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
              <circle cx="11" cy="6" r="1.25" fill="currentColor" stroke="none" />
              <path d="M2.5 12.5 L6 9 L9 11 L11 9.5 L13.5 12" />
            </svg>
          </FmtBtn>
          {/* The 'Cross-ref' cell — the lightning surface for `\ref`. Routes
              through `runGridAction("ref")` → the registry's `refRun` →
              `ctx.openAtomCreate("ref")`, opening the shared create popover at
              the caret (the SAME `run()` the slash `\ref` reaches). */}
          <FmtBtn
            id="ref"
            row={3}
            col={3}
            title="Insert cross-reference (\ref)"
            disabled={rowDisabled("ref")}
            run={() => runGridAction("ref")}
          >
            <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
              \ref
            </span>
          </FmtBtn>

          {/* Row 4 — the `forest` syntax-tree block (task 385). Routed through
              the SHARED `runGridAction` dispatch, NOT a private ctx-builder: the
              `\tex` cell beside it still calls `insertTexBlock(editor)` directly
              and so builds an ActionContext with no `canEdit` (the known task-228
              member-5 trap). A new cell must never copy that. The tree glyph is
              a two-child syntax tree — the same shape the starter template
              inserts. */}
          <FmtBtn
            id="forest"
            row={4}
            col={0}
            title="Insert syntax tree (forest)"
            disabled={blockAtomsDisabled}
            run={() => runGridAction("forest")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
              <path d="M8 3.5 L4 8.5 M8 3.5 L12 8.5" />
              <circle cx="8" cy="2.75" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="4" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="12" cy="9.5" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </FmtBtn>
        </MenuGrid>

        <div
          aria-hidden
          style={{
            height: 1,
            margin: "6px 8px",
            background: "var(--edge-hover)",
            opacity: 0.5,
          }}
        />

        {/* ── Card action list (11 rows) ─────────────────────────── */}
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
            editor={editor}
            anchorRect={colorPopoverAnchor}
            palette={palette}
            onApply={applyColor}
            onClear={clearColor}
            onPickCustom={applyColor}
            onContainerRef={setColorPopoverEl}
            onClose={() => {
              setColorPopoverAnchor(null);
              setColorPopoverEl(null);
              stashedRangeRef.current = null;
            }}
          />
        )}
      </MenuProvider>
    </>
  );
}

/**
 * Shared shell for the lightning grid's two `<button>`-based cells (`FmtBtn`
 * and `ColorGridCell`). It owns the axes on which those two primitives must
 * NOT drift: the fixed row height, the borderless surface, and — the axis that
 * DID drift (task 294) — the **disabled affordance** (`not-allowed` cursor +
 * 0.4 opacity). Both cells hand-rolled these inline and diverged: the color
 * cell's disabled cursor was a `pointer ? "pointer" : "pointer"` tautology
 * while `FmtBtn` correctly painted `not-allowed`. Routing both through one
 * helper makes that class of drift unrepresentable.
 *
 * `background` stays caller-owned — `FmtBtn` paints a third format-applied
 * state (`active`) the color cell lacks, so the cells compute their own
 * background and pass it in. `BlockTypeGridCell` is deliberately NOT a consumer:
 * it's a `<div>`-wrapped nested-dropdown trigger with no `disabled` prop (a
 * structurally different shape), so it stays bespoke.
 */
function gridCellShellStyle({
  disabled,
  background,
}: {
  disabled?: boolean;
  background: string;
}): React.CSSProperties {
  return {
    height: FORMATTING_ROW_H,
    background,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
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
 * rewrite. `run` = the cell's existing action; `active` = the format-is-applied
 * state (bold-is-on), painted distinctly from the roving-active highlight.
 *
 * The `data-hint` + `aria-label` carry the title (the registry-render test reads
 * grid cells via `data-hint`).
 */
function FmtBtn({
  id,
  row,
  col,
  children,
  run,
  title,
  active,
  disabled,
}: {
  id: string;
  row: number;
  col: number;
  children: React.ReactNode;
  run: () => void;
  title: string;
  active?: boolean;
  /** CHIP 7b: collab read-only greys the cell + inerts the click. */
  disabled?: boolean;
}) {
  const { active: roving, getItemProps } = useMenuItem({
    id,
    region: "grid",
    coords: { row, col },
    disabled,
    run,
  });
  const itemProps = getItemProps();
  return (
    <button
      {...itemProps}
      type="button"
      data-hint={title}
      disabled={disabled}
      className={gridCellClassName(disabled)}
      style={{
        ...gridCellShellStyle({
          disabled,
          // The roving (keyboard-cursor) cell paints the blue-tinted selection
          // highlight and WINS over the format-is-applied state, so the arrow
          // cursor stays unambiguous even when it lands on an applied format;
          // an applied-but-not-roving cell keeps the stronger muted surface.
          background: roving && !disabled
            ? "var(--menu-roving-bg)"
            : active
              ? "var(--surface-muted-strong, rgba(0,0,0,0.08))"
              : "transparent",
        }),
        color: active ? "var(--ink-strong)" : "var(--ink-muted)",
      }}
      aria-label={title}
    >
      {children}
    </button>
  );
}

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
  run,
}: {
  row: number;
  col: number;
  disabled: boolean;
  lastAppliedColor: string;
  run: (rect: DOMRect) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
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
        itemProps.ref(el);
      }}
      type="button"
      data-hint="Text color"
      disabled={disabled}
      onClick={
        disabled
          ? itemProps.onClick
          : (e) => run(e.currentTarget.getBoundingClientRect())
      }
      className={gridCellClassName(disabled, "flex-col")}
      style={{
        ...gridCellShellStyle({
          disabled,
          background:
            roving && !disabled ? "var(--menu-roving-bg)" : "transparent",
        }),
        color: "var(--ink-strong)",
        padding: 0,
        lineHeight: 1,
      }}
      aria-label="Text color"
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
 * Phase C). The `BlockTypeDropdown` owns its own button + open state + in-tree
 * dropdown (a DOM descendant of the menu container, so click-outside needs no
 * exclusion for it). We wrap it in a registered grid cell so arrows can land on
 * it; Enter/Space (and click) open the dropdown by clicking the inner trigger.
 */
function BlockTypeGridCell({
  row,
  col,
  editor,
}: {
  row: number;
  col: number;
  editor: Editor;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const { active: roving, getItemProps } = useMenuItem({
    id: "block-type",
    region: "grid",
    coords: { row, col },
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
      className="flex items-center justify-center"
      style={{
        height: FORMATTING_ROW_H,
        borderRadius: "var(--radius-sm)",
        background: roving ? "var(--menu-roving-bg)" : "transparent",
      }}
    >
      <BlockTypeDropdown editor={editor} />
    </div>
  );
}
