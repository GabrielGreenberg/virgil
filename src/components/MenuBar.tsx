"use client";

import { memo, useCallback, useState, useRef, type ReactNode } from "react";
import { Editor } from "@tiptap/react";
import type { DividerLevel } from "@/hooks/useViewPrefs";
import {
  VIEW_MENU_GROUPS,
  VIEW_MENU_GROUP_ORDER,
  menuEntriesInGroup,
  isMemberChecked,
  enumOptions,
  type RegistryPrefs,
  type ViewMenuEntry,
  type ViewPrefMenuGroup,
  type ViewPrefKey,
  type SetViewPrefKey,
  type ViewPrefMember,
} from "@/lib/view-prefs/registry";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";
import { menuRowRovingStyle, menuRowToneClass } from "./menu/row-tone";
import { MenuToggleRow } from "./menu/MenuToggleRow";
import { MenuRadioGroup } from "./menu/MenuRadioGroup";
import { MenuSeparator, MenuSectionLabel } from "./menu/MenuChrome";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { elementAnchor } from "./menu/live-anchor";
// CHIP 5a: the BlockType dropdown's heading items route through the canonical
// `headingRun` (SET + numbered:true) in the action registry — the SAME `run()`
// the `\chapter`…`\subsubsection` slash commands call. The dropdown used to
// `toggleHeading` (clicking 'Section' on an existing level-2 heading reverted it
// to a paragraph); it now always SETs. Heading is pure ProseMirror (no React
// `cardCreation`), so no bridge. Task 1199: every level (0–6) is asked and
// committed through `headingLevelVerdict` / `runHeadingLevel`.
import {
  headingLevelVerdict,
  runHeadingLevel,
  type ActionContext,
} from "@/lib/actions/action-registry";
import { lightningContext } from "@/lib/actions/lightning-context";
import {
  BODY_TEXT_VALUE,
  blockTypeOptions,
  selectionHoldsHeading,
} from "@/lib/actions/block-type";
import { setParagraphInRange } from "@/lib/tiptap/heading-level";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";
import { classAllowsHeadingLevel } from "@/lib/document-class";
import { HEADING_TYPES } from "@/lib/heading-types";
import { iconHint } from "@/components/Hint";
import { useSpellDictionaries } from "@/lib/spell/spellcheck-context";
import { menuTriggerAria } from "@/components/menu/menu-trigger";

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
export type { DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";

// Row labels, member/value vocabularies AND stable row ids are all sourced from
// VIEW_PREF_REGISTRY (the single source of truth), never re-declared here. Since
// task 274 the VALUES and the WRITES travel by registry key too — every row
// reads `viewPrefs[key]` and calls one of the three registry-driven writers —
// and since task 1317 every GROUP (not only Display) renders off
// `menuEntriesInGroup`, with its header + expander id from `VIEW_MENU_GROUPS`
// and every set row's checkmark from `isMemberChecked` (the one reader of a
// set's `polarity`). So the ViewMenu holds no per-pref knowledge at all: a new
// row in ANY group is one registry entry and zero edits here.
/** Each group's entries, in registry declaration order. */
const VIEW_MENU_ENTRIES: ReadonlyArray<{
  group: ViewPrefMenuGroup;
  entries: ReadonlyArray<ViewMenuEntry>;
}> = VIEW_MENU_GROUP_ORDER.map((group) => ({ group, entries: menuEntriesInGroup(group) }));
/** Every expander row the menu can render — the collapsible groups, each
 *  menu enum's subgroup, and the spelling dictionary. Right/Left arrows
 *  expand/collapse exactly these. */
const SPELL_DICTIONARY_GROUP_ID = "spell-dictionary-group";
const EXPANDABLE_ROW_IDS: ReadonlySet<string> = new Set([
  SPELL_DICTIONARY_GROUP_ID,
  ...VIEW_MENU_ENTRIES.flatMap(({ group, entries }) => [
    ...(VIEW_MENU_GROUPS[group].groupRowId ? [VIEW_MENU_GROUPS[group].groupRowId!] : []),
    ...entries.flatMap((e) => (e.kind === "enum" ? [e.id] : [])),
  ]),
]);

interface MenuBarProps {
  editor: Editor | null;
  /** Every registry-owned view-pref VALUE, in one object read straight off the
   *  store (task 274). The View menu addresses each row's value by its registry
   *  key, so a new pref adds no prop here. */
  viewPrefs: RegistryPrefs;
  /** Heading levels actually PRESENT in the doc — a derivation, not a pref, so
   *  it stays its own prop. Rows outside it aren't rendered. */
  availableDividerLevels: Set<DividerLevel>;
  /** The three registry-driven writers (`useViewPrefs`), keyed by
   *  `ViewPrefKey`. The menu never holds a per-pref callback. */
  onToggleViewPref: (key: ViewPrefKey) => void;
  onSetViewPref: <K extends ViewPrefKey>(key: K, value: RegistryPrefs[K]) => void;
  onToggleViewPrefMember: <K extends SetViewPrefKey>(
    key: K,
    member: ViewPrefMember<K>,
  ) => void;
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
}

/** The ctx every ¶ commit is asked against — the lightning panel's one
 *  constructor, which asks the surface's live editability itself. */
function blockTypeContext(editor: Editor): ActionContext {
  return lightningContext(editor);
}

/** Apply a BlockType row's pick — the shared verb behind a click AND an
 *  Enter activation (so keyboard + mouse take the identical path).
 *
 *  Task 1199: ONE door for every row. Each heading level (0–6) commits through
 *  the registry's `runHeadingLevel`, which asks the heading `applies()` before
 *  `headingRun` — the gate this path used to skip (`spec.run` without
 *  `spec.applies`, and a hand copy of the run for 0/5/6). Every row hands focus
 *  back the same way, first, as the grid's `runGridAction` does: the pick came
 *  from a toolbar button, so DOM focus may be on the ¶ trigger. The selection
 *  IS the block being converted, so the focus scroll lands on the edit. */
export function pickBlockType(
  editor: Editor,
  value: string,
  documentClass?: string | null,
): void {
  // CHIP 7b + task 733: the uniform read-only gate, both axes — a block-type
  // change (incl. 'Body' → setParagraph) refuses when the partner holds the pen
  // OR the host mounted this surface read-only. No over-gating: an ordinary
  // non-collab, host-writable doc is always editable.
  if (!surfaceEditableNow(editor)) return;
  // Task 752 fail-safe: the greyed row is inert, but the VERB also refuses a
  // level the document class does not define, so no path to it (a keyboard
  // activation, a menu left open across a class change) can write a
  // sectioning command that fails to compile.
  if (value !== BODY_TEXT_VALUE && !classAllowsHeadingLevel(documentClass, parseInt(value)))
    return;
  // A row the verdict greys is inert here too — no focus move, no write —
  // whatever path reached the verb (a keyboard activation, a menu left open
  // across a caret move). `runHeadingLevel` re-asks at commit.
  if (value !== BODY_TEXT_VALUE && headingLevelVerdict(blockTypeContext(editor), parseInt(value)).state === "disabled")
    return;
  editor.chain().focus().run();
  const ctx = blockTypeContext(editor);
  if (value === BODY_TEXT_VALUE) {
    // 'Body' is the explicit way OUT of heading-hood (CHIP 5a: the heading
    // items no longer toggle off). Task 1003: over the WHOLE selection, the
    // same range the levels convert — through the inverse door, which demotes
    // only headings (a range with none is a no-op).
    const { state } = ctx.view;
    const paragraphType = state.schema.nodes.paragraph;
    if (!paragraphType) return;
    ctx.view.dispatch(
      setParagraphInRange(state.tr, state.selection.from, state.selection.to, paragraphType),
    );
    return;
  }
  // CHIP 5a: SET (never toggle), every level through the one heading door.
  runHeadingLevel(ctx, parseInt(value));
}

// Both MenuBar dropdowns are ordinary PORTALED menus (task 751): the ONE
// placement owner (`useFloatingMenuPosition`, via `<MenuProvider>`) flips,
// clamps and — with `maxHeight` — caps them to the space the chosen side has,
// scrolling the rest. They used to dock inline (`portal={false}`, design §3.3
// R4) and each hand-rolled its own RAF `getBoundingClientRect` flip into
// placement classes: the View menu dropped the height clamp (fully expanded it
// ran off the window with its last rows unreachable), and the block-type
// dropdown's `absolute` classes lost to the docked branch's inline
// `position: relative`, so it rendered in flow and its flip never applied. R4's
// own stated exit ("consider the portal+hook path if drift appears") is taken:
// the docked path is deleted from the primitive, and the menus' anchors are the
// LIVE trigger rects (`elementAnchor`), so they follow a scrolled or dragged
// host by the sanctioned RAF-coalesced re-anchor.
//
// When NO placement fits, the positioner (with `maxHeight`) takes the side with
// the most room, so order here is preference, not a fallback-of-last-resort.
const BLOCK_TYPE_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
  { side: "below", align: "end" },
  { side: "above", align: "end" },
];
const VIEW_MENU_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "end" },
  { side: "below", align: "start" },
  { side: "above", align: "end" },
  { side: "above", align: "start" },
];

/**
 * Block-type dropdown — migrated onto the `<Menu>` primitive (Phase C,
 * design §4 the BlockTypeDropdown row; portaled since task 751). The provider owns click-outside dismissal, the Escape handler, the
 * keyboard controller, and the ARIA wiring. Each block-type row calls
 * `useMenuItem` and spreads `getItemProps()` onto its `<button>` (no markup
 * rewrite). GAINS Up/Down/Home/End arrow nav + Enter; PRESERVES the
 * current-level checkmark (now also `aria-checked`),
 * click-outside + Escape close, and the collab
 * read-only gate.
 *
 * Positioning: a portaled menu anchored to the LIVE trigger rect; the
 * primitive's one positioner owns the flip, clamp and height cap (task 751 —
 * see `BLOCK_TYPE_PLACEMENTS`). It overlays the lightning grid rather than
 * pushing it, and as a nested provider it registers itself into the grid
 * menu's click-outside excludes (R8), so a pick never dismisses the grid.
 *
 * Note: when this dropdown ALSO appears as a nested cell in the lightning grid
 * (a future sub-menu trigger), the R6 nested-key gating means only the topmost
 * provider's window keydown is live — so the grid's keys and this menu's keys
 * never double-fire. The provider stack handles that automatically.
 */
export function BlockTypeDropdown({
  editor,
  documentClass = null,
  disabled = false,
  disabledReason = null,
}: {
  editor: Editor;
  /** The document's `\documentclass` (EditorPane's `documentClassName`), or
   *  null when unknown — decides which heading rows are greyed (task 752). */
  documentClass?: string | null;
  /** Task 1017: the host surface's `canEdit` verdict, inverted. A read-only
   *  surface (partner holds the pen / Library Reader) greys the trigger with
   *  its reason instead of opening rows that `pickBlockType` then drops. */
  disabled?: boolean;
  /** WHY the trigger is grey — task 968's reason vocabulary. */
  disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The trigger as STATE too, for `excludeRefs`: a mousedown on it must not
  // dismiss (it toggles), and a ref can't be read during render.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const setTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
    setTriggerEl(el);
  }, []);
  const anchor = useCallback(() => elementAnchor(triggerRef.current)(), []);

  // The checked row, over the SAME vocabulary the rows derive from (task 752
  // retired the hand-spelled seven-step 0..6 ladder). Compared by level, never
  // by truthiness — `\part` is level 0.
  const activeLevel = HEADING_TYPES.find((h) =>
    editor.isActive("heading", { level: h.level }),
  )?.level;
  // Task 1003: a MIXED selection (a heading and a paragraph) checks NO row —
  // none describes the range, and checking "Body text" told the user the row
  // they needed was already applied. O(selection), like `isActive` itself.
  const current =
    activeLevel !== undefined
      ? String(activeLevel)
      : selectionHoldsHeading(editor)
        ? null
        : BODY_TEXT_VALUE;

  // The activedescendant host: the focusable trigger button. The window-capture
  // keyboard controller fires regardless of focus, but a screen reader tracks
  // the active row via this host (NO `.focus()` on the rows).
  const getActiveDescendantHost = useCallback(() => triggerRef.current, []);
  // Stable close so the provider's dismissal effect doesn't re-subscribe its
  // capture listener on re-render.
  const close = useCallback(() => setOpen(false), []);

  // Sizing ONLY — the surface (bg / border / shadow / radius) is
  // the primitive's `.menu-surface` (task 295). This string used to carry a
  // hand-copy of `MENU_SURFACE_CLASS`, which is how the header dropdowns came
  // to wear a different border grey and a heavier shadow than the editor's own
  // menus while every test stayed green.
  const dropdownClassName = "py-1 min-w-[160px]";

  return (
    <div className="relative">
      <button
        ref={setTrigger}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        {...iconHint({
          label: "Block type",
          hint: disabled && disabledReason ? `Block type — ${disabledReason}` : undefined,
        })}
        aria-description={disabled && disabledReason ? disabledReason : undefined}
        {...menuTriggerAria("menu", open)}
        data-button-exempt="glyph + caret menu trigger, not a labelled action"
        className={`px-1.5 py-0.5 rounded text-sm flex items-center gap-1 focus-ring ${
          disabled
            ? "text-ink-faint cursor-not-allowed"
            : "text-[var(--muted)] hover-on-light hover:text-ink-body"
        }`}
      >
        <span style={{ fontSize: "15px", lineHeight: 1 }}>&#182;</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><path d="M0 0l4 5 4-5z"/></svg>
      </button>
      {open && !disabled && (
        <MenuProvider
          id="block-type"
          layout="list"
          role="menu"
          anchorRect={anchor}
          trackAnchor={anchor}
          placements={BLOCK_TYPE_PLACEMENTS}
          gap={4}
          maxHeight
          excludeRefs={[triggerEl]}
          getActiveDescendantHost={getActiveDescendantHost}
          onClose={close}
          ariaLabel="Block type"
          containerClassName={dropdownClassName}
        >
          {/* Pick-ONE (a block is exactly one type), so the rows are radios by
              construction — task 770; they were hand-built checkboxes. */}
          <MenuRadioGroup
            idPrefix=""
            ariaLabel="Block type"
            options={blockTypeOptions(editor, documentClass)}
            value={current}
            onPick={(v) => {
              pickBlockType(editor, v, documentClass);
              setOpen(false);
            }}
          />
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
// ── R5 / Left-Right tree navigation (via the primitive's `onArrowHorizontal` seam) ──
// Enter (and click) expand/collapse a group via the group row's `run()`, AND
// Right=expand / Left=collapse the active group row (the tree affordance). The
// window-source keyboard controller (`useMenuKeyboard.consume`) hands Left/Right
// to the `onArrowHorizontal?(dir, activeId)` seam FIRST — but only for a vertical
// `list` layout, where nav-core's `listMove` treats them as no-ops anyway — then
// falls back to `reg.move(dir)`. The `ViewMenu` provider wires that seam (see the
// `onArrowHorizontal={…}` handler on `<MenuProvider>` below) to map the four group
// ids to their expand setters; a non-group active row is a no-op. So Right/Left,
// Enter, and click all drive expand/collapse today.

// The checkbox/toggle row this menu uses is the shared `<MenuToggleRow>`
// primitive (`menu/MenuToggleRow.tsx`) — extracted from here in task 180 when
// OutlinePanel's kebab folded onto `ItemMenu` and wanted the identical row.
// Closing stays the CALLER's business, which is how today's split survives the
// extraction unchanged: the Display rows close the menu from inside their own
// `onToggle` (`… ; setOpen(false)`), the in-group sub-toggles keep it open.

/** An expandable group header row. `aria-expanded` reflects state; Enter/click
 *  toggle it (the chevron rotates), and Right=expand / Left=collapse it via the
 *  primitive's `onArrowHorizontal` seam (see the block comment above). */
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
      className={`w-full text-left ${pad} py-1.5 text-xs ${menuRowToneClass("default", false)} flex items-center justify-between gap-3`}
      style={menuRowRovingStyle(active, false)}
    >
      <span>{label}</span>
      <svg className="w-3 h-3 text-ink-muted motion-safe:transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
      className={`w-full text-left px-3 py-1.5 text-xs ${menuRowToneClass("default", false)} flex items-center gap-3`}
      style={menuRowRovingStyle(active, false)}
    >
      <span>{label}</span>
    </button>
  );
}

/** One accepted word, as a remove row (task 856). Enter/click removes it and
 *  keeps the menu open, so several can be cleared in one visit. */
function SpellWordRow({ id, word, scopeLabel, onRemove }: { id: string; word: string; scopeLabel: string; onRemove: () => void }) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run: onRemove });
  return (
    <button
      {...getItemProps()}
      type="button"
      aria-label={`Remove “${word}” from ${scopeLabel}`}
      className={`w-full text-left pl-6 pr-3 py-1.5 text-xs ${menuRowToneClass("default", false)} flex items-center justify-between gap-3`}
      style={menuRowRovingStyle(active, false)}
    >
      <span className="truncate">{word}</span>
      <span aria-hidden className="text-ink-muted shrink-0">Remove</span>
    </button>
  );
}

/**
 * The spelling dictionaries, listed where the user can UNDO an accept (task
 * 856). "Add to this paper’s dictionary" / "Add to my dictionary" are one-way
 * from the spelling menu — an accepted word is never flagged again, so that
 * menu can never reopen on it — and before this group a misclick silenced the
 * checker AND autocorrect for the word, permanently. Rendered only inside a
 * document's SpellcheckProvider (null elsewhere).
 */
function SpellDictionaryGroup({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const dicts = useSpellDictionaries();
  if (!dicts) return null;
  const scopes = [
    { key: "paper", caption: "This paper", scopeLabel: "this paper’s dictionary", words: dicts.paper, remove: dicts.removeFromPaper },
    { key: "global", caption: "All papers", scopeLabel: "your dictionary", words: dicts.global, remove: dicts.removeGlobally },
  ] as const;
  return (
    <>
      <ViewGroupRow id={SPELL_DICTIONARY_GROUP_ID} label="Spelling dictionary" expanded={expanded} onToggle={onToggle} />
      {expanded && scopes.map((scope) => (
        <div key={scope.key} className="pl-3">
          <MenuSectionLabel>{scope.caption}</MenuSectionLabel>
          {scope.words.length === 0 ? (
            <div role="presentation" className="pl-3 pr-3 py-1 text-xs text-ink-muted">No words added</div>
          ) : (
            scope.words.map((word) => (
              <SpellWordRow
                key={word}
                id={`spell-dict-${scope.key}-${word}`}
                word={word}
                scopeLabel={scope.scopeLabel}
                onRemove={() => scope.remove(word)}
              />
            ))
          )}
        </div>
      ))}
    </>
  );
}

/** Viewport-aware dropdown — anchors to the right edge of its trigger and
 *  flips above when it would overflow the bottom of the viewport.
 *
 *  ── MENU-PRIMITIVE MIGRATION (Phase C, the R5 expandable-tree case) ──
 *  Migrated onto the `<Menu>` primitive (design §4 the ViewMenu row + §6 R5;
 *  portaled since task 751). The provider owns click-outside
 *  dismissal, the Escape handler, the keyboard controller, and the ARIA wiring;
 *  every visible row registers via `useMenuItem` so the snapshot grows/shrinks
 *  as groups expand. GAINS Up/Down/Home/End + Enter nav (none today). All
 *  toggles + expand/collapse are preserved; placement is the primitive's (task 751). See
 *  the ViewMenu-rows block comment for the Right=expand / Left=collapse tree
 *  navigation, wired via the primitive's `onArrowHorizontal` seam below.
 *
 *  Exported (named) so the migration test can mount it directly with
 *  controlled props; the default-export `MenuBar` is the only production
 *  consumer (via `MenuBarContent`). */
export function ViewMenu({
  viewPrefs,
  availableDividerLevels,
  onToggleViewPref,
  onSetViewPref,
  onToggleViewPrefMember,
  onCloseAllPanels,
  onOpenFontsDialog,
  onOpenMarginsMode,
}: Pick<MenuBarProps,
  | "viewPrefs"
  | "availableDividerLevels"
  | "onToggleViewPref" | "onSetViewPref" | "onToggleViewPrefMember"
  | "onCloseAllPanels"
  | "onOpenFontsDialog"
  | "onOpenMarginsMode"
>) {
  const [open, setOpen] = useState(false);
  // One expanded flag per expander row id (`EXPANDABLE_ROW_IDS`), absent =
  // collapsed — so a registry-declared group needs no state hook here.
  const [rowsExpanded, setRowsExpanded] = useState<Readonly<Record<string, boolean>>>({});
  const isExpanded = (id: string) => rowsExpanded[id] === true;
  const setExpanded = useCallback((id: string, next: boolean | ((prev: boolean) => boolean)) => {
    setRowsExpanded((rows) => {
      const value = typeof next === "function" ? next(rows[id] === true) : next;
      return (rows[id] === true) === value ? rows : { ...rows, [id]: value };
    });
  }, []);
  const toggleExpanded = (id: string) => setExpanded(id, (p) => !p);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  const setTrigger = useCallback((el: HTMLButtonElement | null) => {
    triggerRef.current = el;
    setTriggerEl(el);
  }, []);
  // Placement (flip, clamp, height cap + scroll) is the primitive's — see
  // `VIEW_MENU_PLACEMENTS`. Expanding a group grows the menu; the positioner's
  // ResizeObserver re-measures it, so no per-group effect deps are needed.
  const anchor = useCallback(() => elementAnchor(triggerRef.current)(), []);

  // Stable close so the provider's dismissal effect doesn't re-subscribe its
  // capture listener every time the expand state re-renders.
  const close = useCallback(() => setOpen(false), []);

  // The activedescendant host: the focusable trigger button (the window-capture
  // controller fires regardless of focus; this hosts the attribute for a screen
  // reader — NO `.focus()` on the rows).
  const getActiveDescendantHost = useCallback(() => triggerRef.current, []);

  // Sizing ONLY; surface chrome is `.menu-surface` (task 295).
  const dropdownClass = "w-52 py-1";

  return (
    <div className="relative flex items-center">
      <button
        data-iconbtn-exempt="formatting toolbar: own active state + dark-context variant (STYLE_GUIDE)"
        ref={setTrigger}
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${open ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover-on-light hover:text-ink-body"} focus-ring`}
        {...iconHint({ label: "View options" })}
        {...menuTriggerAria("menu", open)}
      >
        <svg
          width="3.69"
          height="16"
          viewBox="5.75 -1.75 4.5 19.5"
          fill="currentColor"
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
            if (!activeId || !EXPANDABLE_ROW_IDS.has(activeId)) return;
            setExpanded(activeId, dir === "right");
          }}
          anchorRect={anchor}
          trackAnchor={anchor}
          placements={VIEW_MENU_PLACEMENTS}
          gap={6}
          maxHeight
          excludeRefs={[triggerEl]}
          getActiveDescendantHost={getActiveDescendantHost}
          onClose={close}
          ariaLabel="View options"
          containerClassName={dropdownClass}
        >
        <div>
          {VIEW_MENU_ENTRIES.map(({ group, entries }, i) => {
            const { header, groupRowId } = VIEW_MENU_GROUPS[group];
            // A set's AVAILABLE members, where the host narrows them (only the
            // heading levels the doc actually has). A group holding a narrowed
            // set with nothing available is not rendered at all.
            const availableOf = (key: SetViewPrefKey): ReadonlySet<unknown> | undefined =>
              key === "dividerLevels" ? availableDividerLevels : undefined;
            if (entries.some((e) => e.kind === "set" && availableOf(e.key)?.size === 0)) return null;
            // A collapsible group's toggles are its MASTER switches: its set
            // rows show only while every one of them is on (Show marginalia →
            // the per-type rows). A flat section closes the menu on a toggle;
            // a collapsible group's rows keep it open.
            const flat = groupRowId === null;
            const indent = flat ? 0 : 1;
            const mastersOn = entries.every((e) => e.kind !== "toggle" || viewPrefs[e.key]);
            const rows = entries.map((e) => {
              if (e.kind === "toggle") {
                return (
                  <MenuToggleRow
                    key={e.id}
                    id={e.id}
                    label={e.label}
                    hint={e.hint}
                    checked={viewPrefs[e.key]}
                    indent={indent}
                    onToggle={() => { onToggleViewPref(e.key); if (flat) setOpen(false); }}
                  />
                );
              }
              if (e.kind === "set") {
                if (!mastersOn) return null;
                const available = availableOf(e.key);
                const value = viewPrefs[e.key] as readonly unknown[];
                return (
                  <div key={e.key} role="group" aria-label={e.label}>
                    {e.members.filter((m) => !available || available.has(m.member)).map((m) => (
                      <MenuToggleRow
                        key={m.id}
                        id={m.id}
                        label={m.label}
                        checked={isMemberChecked(e.key, value, m.member)}
                        indent={indent}
                        onToggle={() => onToggleViewPrefMember(e.key, m.member as never)}
                      />
                    ))}
                  </div>
                );
              }
              return (
                <div key={e.key}>
                  <ViewGroupRow id={e.id} label={e.label} expanded={isExpanded(e.id)} indent={1} onToggle={() => toggleExpanded(e.id)} />
                  {isExpanded(e.id) && (
                    <MenuRadioGroup
                      idPrefix={e.optionIdPrefix}
                      ariaLabel={e.label}
                      options={enumOptions(e.key)}
                      value={viewPrefs[e.key]}
                      indent={2}
                      onPick={(v) => onSetViewPref(e.key, v as never)}
                    />
                  )}
                </div>
              );
            });
            return (
              <div key={group} data-view-menu-group={group}>
                {/* The spelling dictionary is not a pref (its words live in
                    the dictionaries), so it is appended to Display by hand. */}
                {flat ? (
                  <>
                    <MenuSectionLabel>{header}</MenuSectionLabel>
                    {rows}
                    {group === "display" && (
                      <SpellDictionaryGroup expanded={isExpanded(SPELL_DICTIONARY_GROUP_ID)} onToggle={() => toggleExpanded(SPELL_DICTIONARY_GROUP_ID)} />
                    )}
                  </>
                ) : (
                  <>
                    {i > 0 && VIEW_MENU_GROUPS[VIEW_MENU_ENTRIES[i - 1].group].groupRowId === null && <MenuSeparator />}
                    <ViewGroupRow id={groupRowId} label={header} expanded={isExpanded(groupRowId)} onToggle={() => toggleExpanded(groupRowId)} />
                    {isExpanded(groupRowId) && rows}
                  </>
                )}
              </div>
            );
          })}
          {/* Margins editor entry — opens an in-text drag mode with
              save/cancel buttons in the docked toolbar band. Sits in
              the same trailing block as Fonts… */}
          {onOpenMarginsMode ? (
            <>
              <MenuSeparator />
              <ViewActionRow id="margins" label="Margins…" onRun={() => { onOpenMarginsMode(); setOpen(false); }} />
            </>
          ) : null}
          {/* Fonts dialog launcher — sits above the close-all action. */}
          {onOpenFontsDialog ? (
            <>
              {!onOpenMarginsMode && <MenuSeparator />}
              <ViewActionRow id="fonts" label="Fonts…" onRun={() => { onOpenFontsDialog(); setOpen(false); }} />
            </>
          ) : null}
          {onCloseAllPanels && (
            <>
              <MenuSeparator />
              <ViewActionRow id="close-all" label="Close all panels" onRun={() => { onCloseAllPanels(); setOpen(false); }} />
            </>
          )}
        </div>
        </MenuProvider>
      )}
    </div>
  );
}

/** Shared button row rendered inside the docked MenuBar. Renders the
 *  View menu + collab pill + paragraph nav. (The editor-split toggle was
 *  RETIRED in task 115 — it flipped a persisted pref no pane read, and the
 *  click left a phantom mirror indicator on the Outline that survived
 *  reloads. See `split-editor-panes.tsx` for the parked machinery.) */
function MenuBarContent({
  editor,
  viewPrefs,
  availableDividerLevels,
  onToggleViewPref, onSetViewPref, onToggleViewPrefMember,
  onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled,
  onCloseAllPanels,
  onOpenFontsDialog,
  onOpenMarginsMode,
  showEditItems = true,
  kebabAtEnd = false,
  collabStatus,
}: {
  editor: Editor;
  /** When true, render the kebab/View menu after every other control
   *  instead of before. Used by the docked MenuBar above the editor. */
  kebabAtEnd?: boolean;
} & Omit<MenuBarProps, "editor">) {
  const viewMenu = (
    <ViewMenu
      viewPrefs={viewPrefs}
      availableDividerLevels={availableDividerLevels}
      onToggleViewPref={onToggleViewPref}
      onSetViewPref={onSetViewPref}
      onToggleViewPrefMember={onToggleViewPrefMember}
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
        <div className="flex items-stretch gap-1 flex-row">
          {onParaNavBack && (
            <button
              data-iconbtn-exempt="16x20 para-nav arrow in the MenuBar pod (MenuBar is toolbar-exempt)"
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              {...iconHint({ label: "Go back" })}
              className="flex items-center justify-center rounded disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover-on-light hover:text-ink-body focus-ring"
              style={{ width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              data-iconbtn-exempt="16x20 para-nav arrow in the MenuBar pod (MenuBar is toolbar-exempt)"
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              {...iconHint({ label: "Go forward" })}
              className="flex items-center justify-center rounded disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover-on-light hover:text-ink-body focus-ring"
              style={{ width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {kebabAtEnd && viewMenu}
    </>
  );
}

/** Main MenuBar — docked at the top of the document, centered over
 *  the text window. Icons sit directly on the canvas background with
 *  no enclosing pod, mirroring the left tool strip's loose buttons.
 *  No grab handle, no tear-off; the kebab/View menu sits at the end. */
function MenuBar(props: MenuBarProps) {
  if (!props.editor) return null;
  return (
    <div className="flex flex-row items-center gap-0.5 h-[24px]">
      <MenuBarContent
        {...props}
        editor={props.editor}
        kebabAtEnd
      />
    </div>
  );
}

export default memo(MenuBar);
