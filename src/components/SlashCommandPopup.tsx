"use client";

/**
 * Inline popup that floats from the cursor's text line when the user
 * types `\` at a fresh position in a paragraph. The popup lists the
 * Virgil LaTeX commands ({@link VIRGIL_COMMAND_NAMES}); arrow keys +
 * Enter / Tab pick one and immediately run its action. Backspace,
 * Escape, or typing past any prefix match dismisses.
 *
 * The ProseMirror plugin in {@link SlashPopupExtension} owns the
 * canonical state and publishes it to {@link slashPopupStore} keyed by its
 * editor; this component subscribes to ITS OWN editor's entry via
 * {@link useSlashPopupState} (task 750 — a hidden keep-alive pane's popup
 * reads its own, closed, state, so it can never paint a stray copy).
 *
 * Task 398: the plugin also carries the registry's `applies()` verdict
 * (`state.disabled`), and this component RENDERS it — a command that
 * cannot run at the caret is greyed and inert. Greying beats hiding
 * (a command that vanishes reads as "Virgil doesn't have `\section`"),
 * and it is the same visible-disabled idiom `MenuActionRow` and the
 * lightning grid already use. The verdict shown here is the same one
 * `executeSelection` refuses on, so what a row OFFERS is what the
 * commit ACCEPTS.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useSlashPopupState } from "@/lib/slash-popup-store";
import { executeSlashSelectionAt } from "@/lib/tiptap/slash-popup";
import { slashCommandReason } from "@/lib/tiptap/slash-applicability";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import { menuRowRovingStyle, menuRowToneClass } from "@/components/menu/row-tone";
import {
  recordScrollPlacement,
  SCROLL_PORTAL_SLASH_POPUP,
} from "@/lib/scroll-reposition-probe";
import {
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";
import {
  isLayoutGestureActive,
  useLayoutGestureActive,
} from "@/lib/pane-resize";

const POPUP_WIDTH = 180;
/** Task 968: a popup with greyed rows carries their reasons as a suffix, so it
 *  widens to fit a short phrase beside the command (truncated past that; the
 *  row's hint holds the whole text). */
const POPUP_WIDTH_WITH_REASONS = 280;
const VIEWPORT_MARGIN = 8;
const GAP = 4;
const ROW_HEIGHT = 24;
const POPUP_PAD_Y = 4;

interface Coords {
  left: number;
  top: number;
  bottom: number;
}

export function SlashCommandPopup({ editor }: { editor: Editor | null }) {
  const state = useSlashPopupState(editor);
  const [coords, setCoords] = useState<Coords | null>(null);

  const rafRef = useRef<number>(0);
  // Hidden for the duration of a pane-divider drag / OS window resize. The
  // placement effect below re-runs on the end edge (the flag is a dep), which
  // is the settle.
  const gestureActive = useLayoutGestureActive();
  const slashPos = state.open ? state.slashPos : -1;
  useEffect(() => {
    if (!editor) return;
    if (!state.open) {
      setCoords(null);
      return;
    }
    const view = editor.view;
    const update = () => {
      try {
        const c = view.coordsAtPos(slashPos);
        // Scroll-anchor stability probe (task 042): one record per coalesced frame.
        recordScrollPlacement(SCROLL_PORTAL_SLASH_POPUP, c.top);
        // Equality bail (task 317): `coordsAtPos` returns fresh numbers in a
        // fresh object, so an unconditional set re-rendered the popup on every
        // coalesced frame even when the caret hadn't moved a pixel.
        setCoords((prev) =>
          prev &&
          prev.left === c.left &&
          prev.top === c.top &&
          prev.bottom === c.bottom
            ? prev
            : { left: c.left, top: c.top, bottom: c.bottom },
        );
      } catch {
        setCoords(null);
      }
    };
    // RAF-coalesce: a burst of transactions needs one caret re-read per
    // frame. (Scroll and window resize are NOT subscribed here any more —
    // task 1364: they re-anchor through the placement hook's own
    // `trackAnchor` door, RAF-coalesced and gesture-parked there.)
    const scheduleUpdate = () => {
      // SUPPRESSED during a continuous layout gesture (task 317): the popup is
      // a caret-anchored fixed portal, so it hides for the gesture (the render
      // gate below) rather than parking half-detached from its slash.
      if (isLayoutGestureActive()) return;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        update();
      });
    };
    update();
    const onTr = () => scheduleUpdate();
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [state.open, slashPos, editor, gestureActive]);

  // The live caret anchor the placement hook re-reads on scroll / resize
  // (RAF-coalesced, gesture-parked — the hook's one scheduler). A throw
  // (the slash position left the doc) falls back to the last `coords`.
  const trackAnchor = useCallback((): CaretRect | null => {
    if (!editor || slashPos < 0) return null;
    try {
      return caretRect(editor.view.coordsAtPos(slashPos));
    } catch {
      return null;
    }
  }, [editor, slashPos]);

  if (!state.open || !coords || gestureActive) return null;

  return (
    <SlashCommandList
      editor={editor}
      coords={coords}
      filtered={state.filtered}
      disabled={state.disabled}
      selectedIndex={state.selectedIndex}
      trackAnchor={trackAnchor}
    />
  );
}

type CaretRect = ReturnType<typeof caretRect>;

/** A caret line box as the zero-width point anchor the placement hook takes. */
function caretRect(c: Coords) {
  return {
    left: c.left,
    top: c.top,
    right: c.left,
    bottom: c.bottom,
    width: 0,
    height: c.bottom - c.top,
  };
}

/** The rows' placement candidates: under the caret line first, else over it.
 *  Module-level so the hook's `placements` dep keeps one identity. */
const CARET_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below" },
  { side: "above" },
];

/**
 * The popup's list, mounted only while it is open (so the placement hook
 * measures — and attaches its ResizeObserver to — a live element each open).
 *
 * Task 1364: PLACEMENT is the shared menu door's, `useFloatingMenuPosition`,
 * with a point anchor at the caret line. It used to be hand-rolled here as
 * `rows * ROW_HEIGHT` plus an unconditional flip above the caret whenever
 * "below" did not fit — no height cap and no clamp, so a bare `\` (every
 * command, ~750px) flipped half its rows, the default-selected one included,
 * off the top of the window. The hook brings what every other menu has: the
 * side with room, the viewport clamp, and `maxHeight` + `overflow-y: auto`.
 *
 * The caret anchor is re-read through two coalesced paths: SCROLL and window
 * RESIZE ride the hook's `trackAnchor` (its one RAF scheduler, gesture-parked,
 * `(left,top)` equality bail, scroll-anchor probe); the TRANSACTIONS that can
 * move the slash (a wrap as the prefix grows) stay the parent's coalesced
 * effect, which feeds `coords` back in as `anchorRect`. The layout-gesture
 * SUPPRESSION stays the parent's render gate: the popup hides for a
 * pane/window drag rather than parking half-detached from its slash.
 */
function SlashCommandList({
  editor,
  coords,
  filtered,
  disabled,
  selectedIndex,
  trackAnchor,
}: {
  editor: Editor | null;
  coords: Coords;
  filtered: readonly string[];
  disabled: readonly string[];
  selectedIndex: number;
  trackAnchor: () => CaretRect | null;
}) {
  const width = disabled.length > 0 ? POPUP_WIDTH_WITH_REASONS : POPUP_WIDTH;
  const { ref, style: placeStyle } = useFloatingMenuPosition({
    anchorRect: caretRect(coords),
    placements: CARET_PLACEMENTS,
    gap: GAP,
    margin: VIEWPORT_MARGIN,
    maxHeight: true,
    trackAnchor,
  });

  // Keep the roving row inside the list's visible band. Once the list is
  // capped and scrolls, ArrowUp/Down would otherwise move a highlight the
  // user cannot see. `scrollTop` on the list, not `scrollIntoView`, so no
  // ancestor (the editor column) is ever scrolled by a popup row.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[selectedIndex] as HTMLElement | undefined;
    if (!list || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - POPUP_PAD_Y;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight + POPUP_PAD_Y;
    }
  }, [selectedIndex]);

  return createPortal(
    <div
      // `.menu-surface` is the MENU tier (task 295) — bg + border + radius +
      // shadow off `--menu-*`, in one class, so this popup cannot author a
      // vocabulary of its own. It mounts no `<MenuProvider>` (its open state and
      // its caret placement are the slash plugin's), which is precisely why the
      // surface census could not see it and why it shipped bare `rounded` (4px)
      // where every other menu is 8px, `--edge-subtle` where the menus use the
      // pod grey, and Tailwind's stock `shadow-md` where they use the pod halo.
      // Task 459. Everything else here is LAYOUT, which is still the caller's.
      className="slash-command-popup menu-surface py-1"
      ref={(el) => {
        listRef.current = el;
        ref(el);
      }}
      style={{
        ...placeStyle,
        width,
        // Caret popup rides the open-chrome-menu tier (task 033), promoted off
        // the old ad-hoc `1000` so a popped card / lifted overlay can't occlude
        // it — matches NodeEditPopover + the <Menu> primitive.
        zIndex: OPEN_CHROME_MENU_Z,
      }}
      onMouseDown={(e) => {
        // Prevent the editor from losing focus when clicking a row.
        e.preventDefault();
      }}
    >
      {filtered.map((name, i) => {
        // Task 398: the popup RENDERS the registry's verdict. A command that
        // cannot run at this caret is greyed and inert — never hidden (a command
        // that vanishes reads as "Virgil doesn't have `\\section`") and never
        // silently offered (which is how this surface came to eat the user's
        // keystrokes on its way to refusing). The `disabled` list is derived in
        // the plugin's state from the SAME `applies()` `executeSelection` reads,
        // so what this row offers is what the commit accepts.
        const isDisabled = disabled.includes(name);
        const selected = i === selectedIndex && !isDisabled;
        // Task 968: a greyed command SAYS why — a muted suffix on the row, the
        // row's hint, and its accessible description. Same row, same ctx as
        // the grey itself (`slashCommandReason` → `verdictOf`); asked only for
        // the rows that ARE grey.
        const why = isDisabled && editor ? slashCommandReason(editor.view, name) : null;
        return (
          <button
            key={name}
            type="button"
            disabled={isDisabled}
            data-hint={why ?? undefined}
            aria-description={why ?? undefined}
            onClick={() => {
              if (!editor) return;
              executeSlashSelectionAt(editor.view, i);
              editor.commands.focus();
            }}
            // The row's state paint is the menu's ONE vocabulary (`row-tone.ts`,
            // task 1361): the selected row wears `--menu-roving-bg` like every
            // other menu's arrow cursor (it painted `bg-edge-subtle`, a grey no
            // other menu used), and the greyed / hover tones are the shared ones.
            className={`flex w-full items-baseline gap-2 text-left px-3 font-mono text-xs ${menuRowToneClass("default", isDisabled)}`}
            style={{
              height: ROW_HEIGHT,
              lineHeight: `${ROW_HEIGHT}px`,
              ...menuRowRovingStyle(selected, isDisabled),
            }}
          >
            <span className="shrink-0">{`\\${name}`}</span>
            {why ? (
              <span className="min-w-0 flex-1 truncate text-right font-sans">{why}</span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
