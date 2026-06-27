"use client";

import { memo, useCallback, useState, useRef, useEffect, type ReactNode } from "react";
import { Editor } from "@tiptap/react";
import type { HighlightType, MarginaliaType, DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";
import { VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";
import { type ToolbarOrientation } from "./editor-layout/floating-toolbar-shell";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
// CHIP 5a: the BlockType dropdown's heading items route through the canonical
// `headingRun` (SET + numbered:true) in the action registry — the SAME `run()`
// the `\chapter`…`\subsubsection` slash commands call. The dropdown used to
// `toggleHeading` (clicking 'Section' on an existing level-2 heading reverted it
// to a paragraph); it now always SETs. Heading is pure ProseMirror (no React
// `cardCreation`), so the dropdown calls `run()` directly — no bridge.
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type BlockActionId,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";

export { type ToolbarOrientation };

// CHIP 5c: the example creators (`buildExampleTemplate` / `insertExampleAtCursor`
// / `handleExampleMenuPick`) were RETIRED here. The single canonical example
// creator is now `exampleRun` (wrap-if-selection-else-insert; one template, the
// `exampleItemList`-wrapped `multi` shape) in
// [src/lib/actions/action-registry.ts]; the grid `ex` cell + the slash `\ex`
// command both route through it. `insertExampleAtCursor` + `handleExampleMenuPick`
// had ZERO live callers (the Format-popover dropdown that once used them is gone),
// and `buildExampleTemplate`'s `multi` shape diverged from the schema (bare
// `exampleItem`s vs the serializer-correct `exampleItemList` wrapper) — that
// dormant divergence is resolved in the canonical builder.

// Types moved to useViewPrefs (the schema home for view-level prefs).
// Re-exported here for back-compat with existing consumers.
export type { MarginaliaType, DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";

// Row labels are sourced from VIEW_PREF_REGISTRY (the single source of truth),
// not re-declared here. The ViewMenu maps the registry's `memberLabels` /
// `valueLabels` / `menu` grouping into the existing ViewToggleRow/ViewGroupRow
// JSX, keeping the prop-controlled `checked`/`onToggle` contract intact.
const DIVIDER_LEVEL_LABELS = VIEW_PREF_REGISTRY.dividerLevels.memberLabels as Record<DividerLevel, string>;
const DIVIDER_WIDTH_LABELS = VIEW_PREF_REGISTRY.dividerWidth.valueLabels as Record<DividerWidth, string>;
/** Display-group rows in render order, with each row's label + the props key
 *  that supplies its `checked`/`onToggle`. Enumerated from the registry
 *  (`menu === "display"`) so the Display block is registry-driven; the prop
 *  wiring stays explicit (the keyboard test mounts ViewMenu with a full prop
 *  bag). The id is the existing row id (kept stable for the menu registry). */
const DISPLAY_ROWS = [
  { id: "par-titles", key: "showParTitles", label: VIEW_PREF_REGISTRY.showParTitles.label },
  { id: "latex-comments", key: "showLatexComments", label: VIEW_PREF_REGISTRY.showLatexComments.label },
  { id: "heading-labels", key: "showHeadingLabels", label: VIEW_PREF_REGISTRY.showHeadingLabels.label },
  { id: "omni-dim-resting", key: "omniDimResting", label: VIEW_PREF_REGISTRY.omniDimResting.label },
] as const;
/** Marginalia per-type sub-rows (members + labels from the registry). */
const MARGINALIA_TYPE_ROWS = VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.members.map((type) => ({
  type,
  label: VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.memberLabels[type],
}));
/** Highlight per-type sub-rows (members + labels from the registry). */
const HIGHLIGHT_TYPE_ROWS = VIEW_PREF_REGISTRY.hiddenHighlightTypes.members.map((type) => ({
  type,
  label: VIEW_PREF_REGISTRY.hiddenHighlightTypes.memberLabels[type],
}));

/** Callbacks wired to every button in the Actions toolbar. Shared by the
 *  attached popover in MenuBar and the detached floating toolbar rendered
 *  at the EditorLayout level. Every entry corresponds 1:1 to a side-panel
 *  whose "+" button creates a new item; the toolbar variant operates on
 *  the live editor selection when one exists, or creates a blank card
 *  otherwise — either way, a card popup spawns near the toolbar.
 *
 *  `anchorRect` is the bounding rect of the surrounding toolbar pod (the
 *  popover or the detached floater), captured at click time so the
 *  popup can spawn just below it (flipping above when near the viewport
 *  bottom). Handlers accept `null` as a safe fallback. */
export type ActionToolbarCallback = (anchorRect: DOMRect | null) => void;

export interface ActionToolbarCallbacks {
  onAddComment?: ActionToolbarCallback;
  onAddNote?: ActionToolbarCallback;
  onAddHighlight?: ActionToolbarCallback;
  onAddTodo?: ActionToolbarCallback;
  onCutSelection?: ActionToolbarCallback;
  onArchive?: ActionToolbarCallback;
  onCreateFootnote?: ActionToolbarCallback;
  onInsertCitation?: ActionToolbarCallback;
  onCreateBibEntry?: ActionToolbarCallback;
}

interface MenuBarProps extends ActionToolbarCallbacks {
  editor: Editor | null;
  showParTitles: boolean;
  onToggleParTitles: () => void;
  showLatexComments: boolean;
  onToggleLatexComments: () => void;
  showHeadingLabels: boolean;
  onToggleHeadingLabels: () => void;
  omniDimResting: boolean;
  onToggleOmniDimResting: () => void;
  onOpenPreferences?: () => void;
  editorSplit?: boolean;
  onToggleEditorSplit?: () => void;
  activeSplitPane?: "top" | "bottom";
  showMarginalia: boolean;
  onToggleMarginalia: () => void;
  hiddenMarginaliaTypes: Set<MarginaliaType>;
  onToggleMarginaliaType: (type: MarginaliaType) => void;
  showHighlights: boolean;
  onToggleHighlights: () => void;
  hiddenHighlightTypes: Set<HighlightType>;
  onToggleHighlightType: (type: HighlightType) => void;
  availableDividerLevels: Set<DividerLevel>;
  dividerLevels: Set<DividerLevel>;
  onToggleDividerLevel: (level: DividerLevel) => void;
  dividerWidth: DividerWidth;
  onSetDividerWidth: (width: DividerWidth) => void;
  onParaNavBack?: () => void;
  onParaNavForward?: () => void;
  paraNavBackDisabled?: boolean;
  paraNavForwardDisabled?: boolean;
  /* expand/collapse-all-sections intentionally absent: the Actions toolbar
     is reserved for "create new item" operations. */
  onCloseAllPanels?: () => void;
  onOpenFontsDialog?: () => void;
  /** Enter the in-editor margin-edit mode — guides appear over the
   *  text column and Save/Cancel buttons appear in the docked toolbar. */
  onOpenMarginsMode?: () => void;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
  /** Optional collaborator-mode status pill, rendered at the start of
   *  the bar. Owned by the host (EditorLayout) so it can plug in
   *  per-doc collab state. */
  collabStatus?: ReactNode;
  /** When false, suppress edit-mutating items in the View menu (Fonts,
   *  Margins). View toggles (par titles, latex comments, dividers, etc.)
   *  remain visible. Defaults to true. EditorPane wires this from
   *  `chrome.showMenuBarEditItems`; the Library Reader's chrome sets it
   *  to false. */
  showEditItems?: boolean;
  /** When false, suppress the Formatting popover entirely. Defaults to
   *  true. EditorPane wires this from `chrome.showFormattingToolbar`. */
  showFormattingToolbar?: boolean;
}

const BLOCK_TYPES = [
  { value: "p", label: "Body text" },
  { value: "0", label: "Part" },
  { value: "1", label: "Chapter" },
  { value: "2", label: "Section" },
  { value: "3", label: "Subsection" },
  { value: "4", label: "Subsubsection" },
  { value: "5", label: "Paragraph heading" },
  { value: "6", label: "Subparagraph heading" },
];

/** The BlockType dropdown's heading levels that have a canonical registry row
 *  (CHIP 5a): \chapter(1)…\subsubsection(4). Levels 0 (Part), 5 (Paragraph
 *  heading) and 6 (Subparagraph heading) are out of the heading-alignment scope
 *  — they have no slash command + no registry row, so they keep a direct
 *  `setBlockType` (also SET + numbered, for consistency with the SET decision —
 *  never a toggle). */
const LEVEL_TO_HEADING_ACTION: Readonly<Record<string, BlockActionId>> = {
  "1": "heading-chapter",
  "2": "heading-section",
  "3": "heading-subsection",
  "4": "heading-subsubsection",
};

/**
 * Apply a heading conversion from the BlockType dropdown — always SET, never
 * toggle (CHIP 5a). Levels 1–4 route through the registry's canonical
 * `headingRun` (the SAME `run()` the slash commands call); the out-of-scope
 * levels (0/5/6) fall back to a direct SET `setBlockType` so the dropdown's
 * verb is uniformly "set" across every level.
 *
 * Pure ProseMirror — builds a minimal view-only `ActionContext` from
 * `editor.view` (the registry heading `run()` reads only `ctx.view`). No
 * bridge: heading needs no React-land `cardCreation`.
 */
function applyHeadingFromDropdown(editor: Editor, levelValue: string): void {
  // CHIP 7b: uniform collab read-only gate. `editor.isEditable` is the in-editor
  // mirror of `collab.canEditMainText` ([EditorLayout.tsx:946]) — false only when
  // the partner holds the pen, so a heading conversion refuses here too (the
  // registry `run()` ALSO guards on `ctx.canEdit`; this fail-safes the direct-set
  // fallback below). No over-gating: a non-collab editor is always editable.
  if (!editor.isEditable) return;
  const id = LEVEL_TO_HEADING_ACTION[levelValue];
  if (id) {
    const spec = VIRGIL_ACTION_REGISTRY[id];
    if (spec) {
      const view = editor.view;
      const pos = view.state.selection.head;
      const ctx: ActionContext = {
        editor,
        view,
        ref: {
          kind: "cursor",
          pos,
          paragraphId: paragraphUuidAt(view.state.doc, pos) ?? "",
        },
        surface: "lightning",
        canEdit: editor.isEditable,
      };
      void spec.run(ctx);
      return;
    }
  }
  // Out-of-scope level (0/5/6, or a misconfigured value): SET directly +
  // numbered (NOT toggle — matches the SET decision for the whole dropdown).
  const level = parseInt(levelValue) as unknown as 1 | 2 | 3 | 4 | 5 | 6;
  editor.chain().focus().setNode("heading", { level, numbered: true }).run();
}

/** Apply a BlockType row's pick — the shared verb behind a click AND an
 *  Enter activation (so keyboard + mouse take the identical path). */
function pickBlockType(editor: Editor, value: string): void {
  // CHIP 7b: uniform collab read-only gate — a block-type change
  // (incl. 'Body' → setParagraph) refuses when the partner holds
  // the pen. No over-gating: always editable in a non-collab doc.
  if (!editor.isEditable) return;
  if (value === "p") {
    // 'Body' is the explicit way OUT of heading-hood — setParagraph,
    // no toggle needed (CHIP 5a: the heading items no longer toggle
    // off, so 'Body' is the canonical return-to-paragraph).
    if (editor.isActive("heading")) editor.chain().focus().setParagraph().run();
  } else {
    // CHIP 5a: SET (never toggle). Levels 1–4 route through the
    // registry's canonical headingRun; 0/5/6 fall back to a direct
    // SET. See applyHeadingFromDropdown.
    applyHeadingFromDropdown(editor, value);
  }
}

/** One BlockType row. Registers into the `<Menu>` registry via `useMenuItem`
 *  and spreads `getItemProps()` onto its existing `<button>` so it GAINS arrow
 *  nav + the `data-active` highlight without a markup rewrite. The current
 *  block level carries the checkmark + `aria-checked`/`data-current`. */
function BlockTypeRow({
  value,
  label,
  current,
  onPick,
}: {
  value: string;
  label: string;
  current: boolean;
  onPick: () => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id: value,
    region: "list",
    role: "menuitemcheckbox",
    run: onPick,
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      aria-checked={current}
      data-current={current ? "" : undefined}
      className="w-full text-left px-3 py-1.5 text-sm text-[var(--foreground)] hover-on-light flex items-center gap-2"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span className="w-4 text-center text-xs">
        {current ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}

// The docked dropdown is positioned by `absolute` placement classes inside the
// trigger's `relative` wrapper (the toolbar stacking context — design §3.3 R4
// keeps `portal={false}`). `placements` is unused on the docked path (the
// inline branch ignores `useFloatingMenuPosition`); a satisfier list is passed
// to keep the primitive's prop contract.
const DOCKED_PLACEHOLDER_PLACEMENTS: FloatingMenuPlacement[] = [{ side: "below", align: "start" }];

// `anchorRect` is required by the provider's prop contract but UNUSED on the
// docked `portal={false}` path (the inline branch never calls
// `useFloatingMenuPosition`); positioning comes from the `absolute` placement
// classes. A static zero rect satisfies the type without reading a ref during
// render (the `react-hooks/refs` rule). Frozen so it's a stable identity.
const DOCKED_ZERO_RECT = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });

/**
 * Block-type dropdown — migrated onto the `<Menu>` primitive (Phase C, the
 * docked `portal={false}` path / design §3.3 R4 + §4 the BlockTypeDropdown
 * row). The provider owns click-outside dismissal, the Escape handler, the
 * keyboard controller, and the ARIA wiring. Each block-type row calls
 * `useMenuItem` and spreads `getItemProps()` onto its `<button>` (no markup
 * rewrite). GAINS Up/Down/Home/End arrow nav + Enter; PRESERVES the
 * current-level checkmark (now also `aria-checked`/`data-current`), the docked
 * flip-up/flip-left positioning, click-outside + Escape close, and the collab
 * read-only gate.
 *
 * Docked positioning: `portal={false}` renders the menu inline (position
 * relative) so `useFloatingMenuPosition` is bypassed; the flip logic stays a
 * tiny placement-class chooser (the old `getBoundingClientRect` math →
 * `top-full`/`bottom-full` + `left-0`/`right-0`), applied via
 * `containerClassName`. This reproduces today's docked anchoring exactly while
 * the primitive owns nav/dismissal/keyboard.
 *
 * Note: when this dropdown ALSO appears as a nested cell in the lightning grid
 * (a future sub-menu trigger), the R6 nested-key gating means only the topmost
 * provider's window keydown is live — so the grid's keys and this menu's keys
 * never double-fire. The provider stack handles that automatically.
 */
export function BlockTypeDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ v: "below" | "above"; h: "left" | "right" }>({ v: "below", h: "left" });

  const current = editor.isActive("heading", { level: 0 })
    ? "0"
    : editor.isActive("heading", { level: 1 })
      ? "1"
      : editor.isActive("heading", { level: 2 })
        ? "2"
        : editor.isActive("heading", { level: 3 })
          ? "3"
          : editor.isActive("heading", { level: 4 })
            ? "4"
            : editor.isActive("heading", { level: 5 })
              ? "5"
              : editor.isActive("heading", { level: 6 })
                ? "6"
                : "p";

  // Recompute the docked placement on open — the same flip-up/flip-left intent
  // the old `getBoundingClientRect` math had, now expressed as `absolute`
  // placement classes inside the relative wrapper. The measure + setState is
  // RAF-deferred (not synchronous in the effect body) so it reads the laid-out
  // dropdown and doesn't cascade-render (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      if (!triggerRef.current || !dropdownRef.current) return;
      const tr = triggerRef.current.getBoundingClientRect();
      const dr = dropdownRef.current.getBoundingClientRect();
      const GAP = 4;
      const v: "below" | "above" =
        tr.bottom + dr.height + GAP > window.innerHeight && tr.top > dr.height + GAP ? "above" : "below";
      const h: "left" | "right" =
        tr.left + dr.width > window.innerWidth - 4 && window.innerWidth - tr.right > dr.width ? "right" : "left";
      setPlacement((prev) => (prev.v === v && prev.h === h ? prev : { v, h }));
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // The activedescendant host: the focusable trigger button. The window-capture
  // keyboard controller fires regardless of focus, but a screen reader tracks
  // the active row via this host (NO `.focus()` on the rows).
  const getActiveDescendantHost = useCallback(() => triggerRef.current, []);
  // Stable close so the provider's dismissal effect doesn't re-subscribe its
  // capture listener every time the placement state re-renders.
  const close = useCallback(() => setOpen(false), []);

  const dropdownClassName = [
    "absolute bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[160px]",
    placement.v === "below" ? "top-full mt-1" : "bottom-full mb-1",
    placement.h === "left" ? "left-0" : "right-0",
  ].join(" ");

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        data-hint="Block type"
        aria-haspopup="menu"
        aria-expanded={open}
        className="px-1.5 py-0.5 rounded text-sm transition-colors text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body flex items-center gap-1"
      >
        <span style={{ fontSize: "15px", lineHeight: 1 }}>&#182;</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><path d="M0 0l4 5 4-5z"/></svg>
      </button>
      {open && (
        <MenuProvider
          id="block-type"
          layout="list"
          role="menu"
          portal={false}
          anchorRect={DOCKED_ZERO_RECT}
          placements={DOCKED_PLACEHOLDER_PLACEMENTS}
          getActiveDescendantHost={getActiveDescendantHost}
          onClose={close}
          ariaLabel="Block type"
          containerClassName={dropdownClassName}
        >
          <div ref={dropdownRef}>
            {BLOCK_TYPES.map((bt) => (
              <BlockTypeRow
                key={bt.value}
                value={bt.value}
                label={bt.label}
                current={current === bt.value}
                onPick={() => {
                  pickBlockType(editor, bt.value);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </MenuProvider>
      )}
    </div>
  );
}

// ── ViewMenu rows (the R5 expandable-tree case, on the <Menu> primitive) ──────
//
// The ViewMenu is an expandable tree — Display toggles, three expandable groups
// (Marginalia / Highlights / Dividers, the last with a nested Divider-prefs
// group), and trailing actions. It maps onto the FLAT `list` registry honestly:
// every visible row registers via `useMenuItem` (region "list", DOM order), so
// the registry snapshot GROWS/SHRINKS as a group expands/collapses (the children
// mount/unmount → register/unregister). Arrow Up/Down/Home/End + Enter all drive
// the primitive's roving controller; checkbox rows are `menuitemcheckbox` +
// `aria-checked`, group rows are `menuitem` + `aria-expanded`.
//
// ── R5 / Left-Right LIMITATION (reported, NOT a primitive edit) ──
// Enter (and click) expand/collapse a group via the group row's `run()`. The
// IDEAL spec also wants Right=expand / Left=collapse, but the window-source
// keyboard controller (`useMenuKeyboard.consume`) unconditionally calls
// `reg.move(dir)` for EVERY plain arrow — including Left/Right — and the window
// listener then `preventDefault()` + `stopPropagation()`s the event in the
// CAPTURE phase. So Left/Right never reach a row's React `onKeyDown`: they are
// CONSUMED by the controller (even though nav-core's vertical `list` `listMove`
// treats them as no-ops). Wiring Left/Right faithfully needs a primitive seam
// (an `onArrowHorizontal?(dir, activeId): boolean` hook on the window-source
// controller, checked before `reg.move` for left/right) — see the migration
// report. Enter-expand/Enter-collapse + click cover the behavior fully today.

/** A checkbox/toggle row. Registers into the `<Menu>` registry; `aria-checked`
 *  reflects `checked`. `closeOnToggle` mirrors today's split: the Display rows
 *  close the menu on toggle; the in-group sub-toggles keep it open. */
function ViewToggleRow({
  id,
  label,
  checked,
  indent = 0,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  /** Indent depth (0 = top level, 1 = group child, 2 = nested child). */
  indent?: 0 | 1 | 2;
  onToggle: () => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    role: "menuitemcheckbox",
    run: onToggle,
  });
  const pad = indent === 2 ? "pl-9 pr-3" : indent === 1 ? "pl-6 pr-3" : "px-3";
  return (
    <button
      {...getItemProps()}
      type="button"
      aria-checked={checked}
      className={`w-full text-left ${pad} py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3`}
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span>{label}</span>
      <span className="text-[var(--accent)]">{checked ? "✓" : ""}</span>
    </button>
  );
}

/** An expandable group header row. `aria-expanded` reflects state; Enter/click
 *  toggle it (the chevron rotates). Left/Right keyboard expand-collapse is the
 *  reported primitive gap (see the block comment above). */
function ViewGroupRow({
  id,
  label,
  expanded,
  indent = 0,
  onToggle,
}: {
  id: string;
  label: string;
  expanded: boolean;
  indent?: 0 | 1;
  onToggle: () => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    run: onToggle,
  });
  const pad = indent === 1 ? "pl-6 pr-3" : "px-3";
  return (
    <button
      {...getItemProps()}
      type="button"
      aria-expanded={expanded}
      className={`w-full text-left ${pad} py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3`}
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span>{label}</span>
      <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 1L5.5 4L2.5 7" />
      </svg>
    </button>
  );
}

/** A plain action row (Margins / Fonts / Close all). Registers as a
 *  `menuitem`; Enter/click run the action (which then closes the menu). */
function ViewActionRow({ id, label, onRun }: { id: string; label: string; onRun: () => void }) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run: onRun });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center gap-3"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span>{label}</span>
    </button>
  );
}

/** Viewport-aware dropdown — anchors to the right edge of its trigger and
 *  flips above when it would overflow the bottom of the viewport.
 *
 *  ── MENU-PRIMITIVE MIGRATION (Phase C, the R5 expandable-tree case) ──
 *  Migrated onto the `<Menu>` primitive (`portal={false}` docked, design §3.3
 *  R4 + §4 the ViewMenu row + §6 R5). The provider owns click-outside
 *  dismissal, the Escape handler, the keyboard controller, and the ARIA wiring;
 *  every visible row registers via `useMenuItem` so the snapshot grows/shrinks
 *  as groups expand. GAINS Up/Down/Home/End + Enter nav (none today). All
 *  toggles + expand/collapse + the docked flip positioning are preserved. See
 *  the ViewMenu-rows block comment for the Left/Right keyboard limitation.
 *
 *  Exported (named) so the migration test can mount it directly with
 *  controlled props; the default-export `MenuBar` is the only production
 *  consumer (via `MenuBarContent`). */
export function ViewMenu({
  showParTitles,
  onToggleParTitles,
  showLatexComments,
  onToggleLatexComments,
  showHeadingLabels,
  onToggleHeadingLabels,
  omniDimResting,
  onToggleOmniDimResting,
  onOpenPreferences,
  showMarginalia,
  onToggleMarginalia,
  hiddenMarginaliaTypes,
  onToggleMarginaliaType,
  showHighlights,
  onToggleHighlights,
  hiddenHighlightTypes,
  onToggleHighlightType,
  availableDividerLevels,
  dividerLevels,
  onToggleDividerLevel,
  dividerWidth,
  onSetDividerWidth,
  orientation,
  onSetOrientation,
  onCloseAllPanels,
  onOpenFontsDialog,
  onOpenMarginsMode,
}: Pick<MenuBarProps,
  | "showParTitles" | "onToggleParTitles"
  | "showLatexComments" | "onToggleLatexComments"
  | "showHeadingLabels" | "onToggleHeadingLabels"
  | "omniDimResting" | "onToggleOmniDimResting"
  | "onOpenPreferences"
  | "showMarginalia" | "onToggleMarginalia"
  | "hiddenMarginaliaTypes" | "onToggleMarginaliaType"
  | "showHighlights" | "onToggleHighlights"
  | "hiddenHighlightTypes" | "onToggleHighlightType"
  | "availableDividerLevels" | "dividerLevels" | "onToggleDividerLevel"
  | "dividerWidth" | "onSetDividerWidth"
  | "orientation" | "onSetOrientation"
  | "onCloseAllPanels"
  | "onOpenFontsDialog"
  | "onOpenMarginsMode"
>) {
  const [open, setOpen] = useState(false);
  const [marginaliaExpanded, setMarginaliaExpanded] = useState(false);
  const [highlightsExpanded, setHighlightsExpanded] = useState(false);
  const [dividersExpanded, setDividersExpanded] = useState(false);
  const [dividerPrefsExpanded, setDividerPrefsExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ v: "below" | "above"; h: "right" | "left" }>({ v: "below", h: "right" });

  // Docked flip placement — unchanged from the pre-migration positioner; the
  // provider's `portal={false}` inline render bypasses `useFloatingMenuPosition`
  // so the flip stays a placement-class chooser (re-run when a group expands and
  // changes the dropdown height). The measure + setState is RAF-deferred (not
  // synchronous in the effect body) so it reads the laid-out dropdown and
  // doesn't cascade-render (react-hooks/set-state-in-effect). Click-outside
  // dismissal + Escape are now owned by the provider (the old `mousedown`
  // effect is removed).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      if (!triggerRef.current || !dropdownRef.current) return;
      const tr = triggerRef.current.getBoundingClientRect();
      const pr = dropdownRef.current.getBoundingClientRect();
      const GAP = 6;
      const v: "below" | "above" = tr.bottom + pr.height + GAP > window.innerHeight && tr.top > pr.height + GAP ? "above" : "below";
      const h: "right" | "left" = tr.right - pr.width < 4 && window.innerWidth - tr.left > pr.width ? "left" : "right";
      setPlacement((prev) => (prev.v === v && prev.h === h ? prev : { v, h }));
    });
    return () => cancelAnimationFrame(raf);
  }, [open, marginaliaExpanded, highlightsExpanded, dividersExpanded, dividerPrefsExpanded]);

  // Stable close so the provider's dismissal effect doesn't re-subscribe its
  // capture listener every time the placement/expand state re-renders.
  const close = useCallback(() => setOpen(false), []);

  // The activedescendant host: the focusable trigger button (the window-capture
  // controller fires regardless of focus; this hosts the attribute for a screen
  // reader — NO `.focus()` on the rows).
  const getActiveDescendantHost = useCallback(() => triggerRef.current, []);

  const dropdownClass = [
    "bg-surface border border-[var(--border)] rounded-lg shadow-lg w-52 py-1",
    placement.v === "below" ? "top-full mt-1.5" : "bottom-full mb-1.5",
    placement.h === "right" ? "right-0" : "left-0",
  ].join(" ");

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${open ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
        data-hint="View options"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          width="3.69"
          height="16"
          viewBox="5.75 -1.75 4.5 19.5"
          fill="currentColor"
          style={orientation === "vertical" ? { transform: "rotate(90deg)" } : undefined}
        >
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <MenuProvider
          id="view-menu"
          layout="list"
          role="menu"
          // Right expands the active group row; Left collapses it (the tree
          // affordance) — Enter/click still toggle. A non-group active row is a
          // no-op. The primitive hands Left/Right here only for a vertical list
          // (otherwise inert), so this can't shadow real nav.
          onArrowHorizontal={(dir, activeId) => {
            const groups: Record<
              string,
              [boolean, React.Dispatch<React.SetStateAction<boolean>>]
            > = {
              "marginalia-group": [marginaliaExpanded, setMarginaliaExpanded],
              "highlights-group": [highlightsExpanded, setHighlightsExpanded],
              "dividers-group": [dividersExpanded, setDividersExpanded],
              "divider-prefs-group": [dividerPrefsExpanded, setDividerPrefsExpanded],
            };
            const g = activeId ? groups[activeId] : undefined;
            if (!g) return;
            const [expanded, setExpanded] = g;
            if (dir === "right" && !expanded) setExpanded(true);
            else if (dir === "left" && expanded) setExpanded(false);
          }}
          portal={false}
          anchorRect={DOCKED_ZERO_RECT}
          placements={DOCKED_PLACEHOLDER_PLACEMENTS}
          getActiveDescendantHost={getActiveDescendantHost}
          onClose={close}
          ariaLabel="View options"
          containerClassName={dropdownClass}
          containerStyle={{ position: "absolute" }}
        >
        <div ref={dropdownRef}>
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">Display</div>
          {/* The Display rows are enumerated from VIEW_PREF_REGISTRY (id + label
              + membership). `checked`/`onToggle` stay PROP-controlled — the
              keyboard test mounts ViewMenu with a full prop bag — so these two
              small maps bridge the registry key to the existing per-row props. */}
          {(() => {
            const displayChecked: Record<(typeof DISPLAY_ROWS)[number]["key"], boolean> = {
              showParTitles,
              showLatexComments,
              showHeadingLabels,
              omniDimResting,
            };
            const displayToggle: Record<(typeof DISPLAY_ROWS)[number]["key"], () => void> = {
              showParTitles: onToggleParTitles,
              showLatexComments: onToggleLatexComments,
              showHeadingLabels: onToggleHeadingLabels,
              omniDimResting: onToggleOmniDimResting,
            };
            return DISPLAY_ROWS.map((row) => (
              <ViewToggleRow
                key={row.id}
                id={row.id}
                label={row.label}
                checked={displayChecked[row.key]}
                onToggle={() => { displayToggle[row.key](); setOpen(false); }}
              />
            ));
          })()}
          <div className="my-1 border-t border-edge-subtle" />
          <ViewGroupRow id="marginalia-group" label="Marginalia" expanded={marginaliaExpanded} onToggle={() => setMarginaliaExpanded((p) => !p)} />
          {marginaliaExpanded && (
            <>
              <ViewToggleRow id="marginalia-show" label={VIEW_PREF_REGISTRY.showMarginalia.label} checked={showMarginalia} indent={1} onToggle={() => onToggleMarginalia()} />
              {showMarginalia && MARGINALIA_TYPE_ROWS.map(({ type, label }) => (
                <ViewToggleRow
                  key={type}
                  id={`marginalia-type-${type}`}
                  label={label}
                  checked={!hiddenMarginaliaTypes.has(type)}
                  indent={1}
                  onToggle={() => onToggleMarginaliaType(type)}
                />
              ))}
            </>
          )}
          <ViewGroupRow id="highlights-group" label="Highlights" expanded={highlightsExpanded} onToggle={() => setHighlightsExpanded((p) => !p)} />
          {highlightsExpanded && (
            <>
              <ViewToggleRow id="highlights-show" label={VIEW_PREF_REGISTRY.showHighlights.label} checked={showHighlights} indent={1} onToggle={onToggleHighlights} />
              {showHighlights && HIGHLIGHT_TYPE_ROWS.map(({ type, label }) => (
                <ViewToggleRow
                  key={type}
                  id={`highlights-type-${type}`}
                  label={label}
                  checked={!hiddenHighlightTypes.has(type)}
                  indent={1}
                  onToggle={() => onToggleHighlightType(type)}
                />
              ))}
            </>
          )}
          {availableDividerLevels.size > 0 && (
            <>
              <ViewGroupRow id="dividers-group" label={VIEW_PREF_REGISTRY.dividerLevels.label} expanded={dividersExpanded} onToggle={() => setDividersExpanded((p) => !p)} />
              {dividersExpanded && (
                <>
                  {VIEW_PREF_REGISTRY.dividerLevels.members.filter((lvl) => availableDividerLevels.has(lvl)).map((lvl) => (
                    <ViewToggleRow
                      key={lvl}
                      id={`divider-level-${lvl}`}
                      label={DIVIDER_LEVEL_LABELS[lvl]}
                      checked={dividerLevels.has(lvl)}
                      indent={1}
                      onToggle={() => onToggleDividerLevel(lvl)}
                    />
                  ))}
                  <ViewGroupRow id="divider-prefs-group" label={VIEW_PREF_REGISTRY.dividerWidth.label} expanded={dividerPrefsExpanded} indent={1} onToggle={() => setDividerPrefsExpanded((p) => !p)} />
                  {dividerPrefsExpanded && VIEW_PREF_REGISTRY.dividerWidth.values.map((w) => (
                    <ViewToggleRow
                      key={w}
                      id={`divider-width-${w}`}
                      label={DIVIDER_WIDTH_LABELS[w]}
                      checked={dividerWidth === w}
                      indent={2}
                      onToggle={() => onSetDividerWidth(w)}
                    />
                  ))}
                </>
              )}
            </>
          )}
          {/* Margins editor entry — opens an in-text drag mode with
              save/cancel buttons in the docked toolbar band. Sits in
              the same trailing block as Fonts… */}
          {onOpenMarginsMode ? (
            <>
              <div className="my-1 border-t border-edge-subtle" />
              <ViewActionRow id="margins" label="Margins…" onRun={() => { onOpenMarginsMode(); setOpen(false); }} />
            </>
          ) : null}
          {/* Fonts dialog launcher — sits above the close-all action. */}
          {onOpenFontsDialog ? (
            <>
              {!onOpenMarginsMode && <div className="my-1 border-t border-edge-subtle" />}
              <ViewActionRow id="fonts" label="Fonts…" onRun={() => { onOpenFontsDialog(); setOpen(false); }} />
            </>
          ) : null}
          {onCloseAllPanels && (
            <>
              <div className="my-1 border-t border-edge-subtle" />
              <ViewActionRow id="close-all" label="Close all panels" onRun={() => { onCloseAllPanels(); setOpen(false); }} />
            </>
          )}
        </div>
        </MenuProvider>
      )}
    </div>
  );
}

/** Shared button row used by both the at-home MenuBar and the
 *  detached floating copies. Renders View menu + Format popover +
 *  Actions popover + paragraph nav + split. Orientation
 *  drives only the nav-button pair stacking; the popovers and single
 *  buttons are layout-agnostic. */
function MenuBarContent({
  editor,
  orientation,
  onAddComment, onArchive, onCreateFootnote, onAddNote, onAddHighlight, onAddTodo, onCutSelection, onInsertCitation,
  showParTitles, onToggleParTitles,
  showLatexComments, onToggleLatexComments,
  showHeadingLabels, onToggleHeadingLabels,
  omniDimResting, onToggleOmniDimResting,
  onOpenPreferences,
  editorSplit, onToggleEditorSplit, activeSplitPane,
  showMarginalia, onToggleMarginalia,
  hiddenMarginaliaTypes, onToggleMarginaliaType,
  showHighlights, onToggleHighlights,
  hiddenHighlightTypes, onToggleHighlightType,
  availableDividerLevels, dividerLevels, onToggleDividerLevel,
  dividerWidth, onSetDividerWidth,
  onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled,
  onCloseAllPanels,
  onSetOrientation,
  onOpenFontsDialog,
  onOpenMarginsMode,
  showEditItems = true,
  showFormattingToolbar = true,
  kebabAtEnd = false,
  collabStatus,
}: {
  editor: Editor;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
  /** When true, render the kebab/View menu after every other control
   *  instead of before. Used by the docked MenuBar above the editor. */
  kebabAtEnd?: boolean;
} & Omit<MenuBarProps, "editor" | "orientation" | "onSetOrientation">) {
  const isVert = orientation === "vertical";
  const viewMenu = (
    <ViewMenu
      showParTitles={showParTitles}
      onToggleParTitles={onToggleParTitles}
      showLatexComments={showLatexComments}
      onToggleLatexComments={onToggleLatexComments}
      showHeadingLabels={showHeadingLabels}
      onToggleHeadingLabels={onToggleHeadingLabels}
      omniDimResting={omniDimResting}
      onToggleOmniDimResting={onToggleOmniDimResting}
      onOpenPreferences={onOpenPreferences}
      showMarginalia={showMarginalia}
      onToggleMarginalia={onToggleMarginalia}
      hiddenMarginaliaTypes={hiddenMarginaliaTypes}
      onToggleMarginaliaType={onToggleMarginaliaType}
      showHighlights={showHighlights}
      onToggleHighlights={onToggleHighlights}
      hiddenHighlightTypes={hiddenHighlightTypes}
      onToggleHighlightType={onToggleHighlightType}
      availableDividerLevels={availableDividerLevels}
      dividerLevels={dividerLevels}
      onToggleDividerLevel={onToggleDividerLevel}
      dividerWidth={dividerWidth}
      onSetDividerWidth={onSetDividerWidth}
      orientation={orientation}
      onSetOrientation={onSetOrientation}
      onCloseAllPanels={onCloseAllPanels}
      onOpenFontsDialog={showEditItems ? onOpenFontsDialog : undefined}
      onOpenMarginsMode={showEditItems ? onOpenMarginsMode : undefined}
    />
  );
  return (
    <>
      {!kebabAtEnd && viewMenu}

      {/* Collaborator-mode status pill — at the bar's leading edge. */}
      {collabStatus}

      {/* Paragraph navigation — back/forward stacked along the main axis.
          The action menu is reached from the margin SelectionActionsMenu
          trigger; no redundant strip copy lives here. */}
      {(onParaNavBack || onParaNavForward) && (
        <div className={`flex items-stretch gap-1 ${isVert ? "flex-col" : "flex-row"}`}>
          {onParaNavBack && (
            <button
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              data-hint="Go back"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 20, height: 16 } : { width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              data-hint="Go forward"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 20, height: 16 } : { width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Split toggle */}
      {onToggleEditorSplit && (
        <button
          onClick={onToggleEditorSplit}
          className={`p-1 rounded transition-colors ${editorSplit ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
          data-hint="Split editor"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {editorSplit && activeSplitPane === "top" && (
              <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
            )}
            {editorSplit && activeSplitPane === "bottom" && (
              <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
            )}
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </button>
      )}

      {kebabAtEnd && viewMenu}
    </>
  );
}

/** Main MenuBar — docked at the top of the document, centered over
 *  the text window. Icons sit directly on the canvas background with
 *  no enclosing pod, mirroring the left tool strip's loose buttons.
 *  No grab handle, no tear-off; the kebab/View menu sits at the end. */
function MenuBar({ orientation: _o, onSetOrientation: _so, ...rest }: MenuBarProps) {
  if (!rest.editor) return null;
  return (
    <div className="flex flex-row items-center gap-0.5 h-[24px]">
      <MenuBarContent
        {...rest}
        editor={rest.editor}
        orientation="horizontal"
        onSetOrientation={() => {}}
        kebabAtEnd
      />
    </div>
  );
}

export default memo(MenuBar);
