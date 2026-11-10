"use client";

import { useCallback, useState, useRef } from "react";
import { Editor } from "@tiptap/react";
import { MenuProvider } from "./menu/MenuProvider";
import { MenuRadioGroup } from "./menu/MenuRadioGroup";
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
import { menuTriggerAria, useCloseOnDisabledEdge } from "@/components/menu/menu-trigger";

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

// A portaled menu (task 751; the View menu's note in MenuBar.tsx tells the
// history): the ONE placement owner flips, clamps and — with `maxHeight` — caps
// it to the space the chosen side has. When NO placement fits, the positioner
// takes the side with the most room, so order here is preference.
const BLOCK_TYPE_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
  { side: "below", align: "end" },
  { side: "above", align: "end" },
];

/**
 * Block-type dropdown — migrated onto the `<Menu>` primitive (Phase C,
 * design §4 the BlockTypeDropdown row; portaled since task 751). The provider
 * owns click-outside dismissal, the Escape handler, the
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
 * Its one production mount is the ¶ cell of the lightning grid
 * (`ActionsMenuPanel`), nested inside the grid's own provider: the R6
 * nested-key gating means only the topmost provider's window keydown is live,
 * so the grid's keys and this menu's keys never double-fire.
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
  // Task 1369: greyed while open (the pen changes hands with the grid up) →
  // CLOSE, never mask — so `aria-expanded` stays honest and the menu does not
  // reappear, keyboard re-armed, when the pen comes back.
  useCloseOnDisabledEdge(disabled, close);

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
      {open && (
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
