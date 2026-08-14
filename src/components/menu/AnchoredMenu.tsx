"use client";

/**
 * `<AnchoredMenu>` — the TRIGGER half of the `<Menu>` primitive.
 *
 * `MenuProvider` owns everything about an OPEN menu (placement, portal, z-tier,
 * dismissal, roving keyboard nav, ARIA container). It deliberately owns nothing
 * about the button that opens one — which left every consumer to hand-roll the
 * same six things: `open` state, an anchor `DOMRect` captured on toggle, a
 * `trackAnchor` thunk, the `excludeRefs` entry that keeps the trigger's own
 * click from self-closing, `aria-haspopup`/`aria-expanded`, and the menu
 * surface's chrome classes.
 *
 * That gap is why the migration stalled at three sites (task 143). `ItemMenu`
 * folded onto `MenuProvider` (task 180) and the STYLE_GUIDE has declared the
 * primitive canonical since — but `ItemMenu` hard-codes a kebab trigger and the
 * `PanelTextSizeRow` injection, so it is not reusable for a "+" button, a
 * horizontal kebab, or a "More ⌄" chip. Each of those three re-derived the
 * plumbing above from scratch and each dropped a different subset of the
 * guards: no viewport flip (the Display list rendered below the fold,
 * unreachable, since none of them clamped a max-height either), a `pos` computed
 * once with no re-anchor, and no menu ARIA / Escape at all.
 *
 * So the shell states the whole trigger contract ONCE:
 *   - it renders the `<button>` itself (callers supply only its CONTENT, as a
 *     function of `open`), so `aria-haspopup="menu"` / `aria-expanded` cannot be
 *     forgotten by the fourth consumer;
 *   - it captures the anchor rect on open and re-reads it through `trackAnchor`,
 *     so an OS resize / pane drag / WCO toggle can't leave the menu detached;
 *   - `maxHeight` is ON by default — a menu that outgrows the space below its
 *     trigger flips up, and one that outgrows the viewport scrolls rather than
 *     rendering rows nobody can reach;
 *   - the trigger is registered in `excludeRefs`, so its click is a real toggle
 *     (the task-094 regression, pinned by `header-add-dropdown-toggle.test.tsx`).
 *
 * Closing stays the CALLER's business, as it is for `<MenuToggleRow>`: a filter
 * menu wants to survive a run of toggles, an action menu wants to close on pick.
 * `children` may be a render prop receiving `{ close, anchorRect }` for the
 * explicit case; `closeOnInsideClick` covers the opaque-children case
 * (`ItemMenu`, whose arbitrary button children can't call `close` themselves).
 */

import {
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { MenuProvider } from "./MenuProvider";
import type { MenuLayout, MenuOrientation, MenuRole } from "./types";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";

export type AnchoredMenuAlign = "start" | "end";

/**
 * The one placement vocabulary for a button-anchored dropdown: drop below,
 * flip above near the viewport bottom, flip sideways when the menu is wider
 * than the space its preferred alignment leaves. `start` aligns the menu's left
 * edge to the trigger's (a left-edge trigger drops rightward); `end` aligns the
 * right edges (a right-edge trigger drops leftward). `useFloatingMenuPosition`
 * tries them in order against the MEASURED menu and clamps the loser, so a rich
 * body (checkbox rows + a section header) can't overflow the way a
 * caller-estimated `POPUP_H` did.
 *
 * BOTH cross-alignments are listed under each preference, and that is a
 * correctness requirement rather than thoroughness. `fits()` tests all four
 * viewport edges at once, so a purely HORIZONTAL overflow fails every candidate
 * that shares one alignment — and the fallback is the LAST placement in the
 * list. A two-entry `[below-start, above-start]` therefore answered "the menu is
 * too wide" with "put it above and clamp it", which for a trigger near the top
 * of the window (a panel header's "+" in a narrowed right column) means clamping
 * to the sliver of space above it: a two-row menu becomes a ~28px scroll box.
 *
 * Stated precisely, because the tempting version is wrong: the hand-rolled menu
 * did NOT get this right and is not the standard being restored. Its `flipLeft`
 * required `r.left + 160 > vw - 4` AND `vw - r.right > 160`, which together
 * imply a trigger under 4px wide — unreachable for a 20px `iconbtn-sm`, so it
 * never fired and the old menu simply overflowed the right edge by a few pixels.
 * What regressed is subtler and worse: a horizontal overflow now hijacks the
 * VERTICAL decision and drags the height clamp with it. Enumerating the product
 * in preference order — vertical preference first, then the horizontal escape,
 * before giving up the preferred side — is what keeps the two axes from
 * deciding each other.
 */
export const ANCHORED_MENU_PLACEMENTS: Record<
  AnchoredMenuAlign,
  FloatingMenuPlacement[]
> = {
  start: [
    { side: "below", align: "start" },
    { side: "below", align: "end" },
    { side: "above", align: "start" },
    { side: "above", align: "end" },
  ],
  end: [
    { side: "below", align: "end" },
    { side: "below", align: "start" },
    { side: "above", align: "end" },
    { side: "above", align: "start" },
  ],
};

/** The menu body's default row PADDING — the one non-chrome survivor of the
 *  old `MENU_SURFACE_CLASS` (`bg-surface border rounded-lg shadow-lg py-1`),
 *  whose four chrome axes moved onto the primitive's `.menu-surface` in task
 *  295. Padding stays here because it genuinely varies per menu (the pod menus
 *  set their own `MENU_PAD_Y`, the combobox has none), so it is a shell
 *  default rather than part of the surface. Module-private: an exported
 *  class string is how the MenuBar dropdowns came to carry a hand-copy. */
const MENU_BODY_PAD_CLASS = "py-1";

export interface AnchoredMenuRenderProps {
  /** Close the menu (and drop the anchor). */
  close: () => void;
  /** The trigger's rect as captured at open — the anchor a callee may want to
   *  pop its own float against (Bibliography's library picker). */
  anchorRect: DOMRect | null;
}

export interface AnchoredMenuProps {
  /** ARIA label for the menu container (and the fallback trigger label). */
  ariaLabel: string;
  /**
   * The nav model the body declares — forwarded verbatim to `MenuProvider`
   * (task 181). Default `"list"`, which is every command menu.
   *
   * This exists because the shell's ONE hard-coded `layout="list"` was, on its
   * own, the reason a whole shape of dropdown had no route onto the primitive.
   * A swatch GRID (`PanelThemePicker`) navigates in two axes and its rows are
   * `region: "grid"` cells with `coords`; on a `list` layout the controller runs
   * `listMove`, which ignores `coords` entirely — so the shell would have
   * accepted the body, rendered it correctly, and silently navigated it wrong.
   * A trigger contract that models only one body shape is a trigger contract
   * every other body shape hand-rolls around, which is the whole failure this
   * component was built to end.
   */
  layout?: MenuLayout;
  /** List stepping axis, forwarded to `MenuProvider`. Only consulted for the
   *  `list` layout (a `grid`/`composite` already maps all four arrows). */
  orientation?: MenuOrientation;
  /** ARIA container-role fork, forwarded to `MenuProvider`. Default "menu". */
  role?: MenuRole;
  /** Container style overrides (width / padding), forwarded to `MenuProvider`.
   *  Merged AFTER the shell's own placement + z-tier, exactly as the provider
   *  merges it, so a caller can size a swatch grid without re-deriving the
   *  surface — which since task 295 it cannot do at all: chrome belongs to
   *  `.menu-surface`, and the census fails a bg / border / shadow / radius
   *  written here. */
  containerStyle?: CSSProperties;
  /** Which of the trigger's edges the menu aligns to. Default "start". */
  align?: AnchoredMenuAlign;
  /** Distance trigger→menu in px. Default 4. */
  gap?: number;
  /** The trigger button's CONTENT, as a function of the open state (a chevron
   *  that flips, an accent tint). The button element itself — and its ARIA — is
   *  owned by this component. */
  trigger: (open: boolean) => ReactNode;
  /** Trigger button className. */
  triggerClassName?: string;
  /** Trigger button inline style. The shell OWNS the button element, so a
   *  trigger whose appearance is data-driven (the panel-color swatch, whose fill
   *  IS the current theme colour) has no other way to express it. */
  triggerStyle?: CSSProperties;
  /** Trigger tooltip (`data-hint`). */
  triggerHint?: string;
  /** Trigger accessible name. Defaults to `ariaLabel`. */
  triggerAriaLabel?: string;
  /** Wrapper (positioning context for the trigger) className. */
  wrapperClassName?: string;
  /** Extra classes on the menu container — width floors, mostly. Appended to
   *  the shell's body padding. NOT chrome: the surface is the primitive's
   *  `.menu-surface` (task 295), and the census fails a caller that re-authors
   *  a background / border / shadow / radius here. */
  menuClassName?: string;
  /**
   * Close on ANY click that bubbles out of the menu body. For menus whose rows
   * are opaque children this component can't reach (`ItemMenu`). Rows that must
   * survive repeated activation stop propagation themselves
   * (`MenuToggleRow keepMenuOpen`). Default false — prefer the `children`
   * render prop's explicit `close`.
   *
   * Known limit, inherited from the primitive rather than introduced here: this
   * is a DOM click handler, and the keyboard controller activates a REGISTERED
   * row by calling its `run()` directly (no DOM event), so Enter/Space on such a
   * row runs the action without closing. `ItemMenu`'s children are opaque
   * buttons that register nothing, so nothing reaches that path today — but a
   * row that must close on keyboard activation should call `close()` itself
   * rather than rely on this flag.
   */
  closeOnInsideClick?: boolean;
  /** Clamp the menu's height to the space available + scroll. Default true. */
  maxHeight?: boolean;
  children: ReactNode | ((p: AnchoredMenuRenderProps) => ReactNode);
}

export function AnchoredMenu({
  ariaLabel,
  layout = "list",
  orientation,
  role = "menu",
  containerStyle,
  align = "start",
  gap = 4,
  trigger,
  triggerClassName,
  triggerStyle,
  triggerHint,
  triggerAriaLabel,
  wrapperClassName = "relative shrink-0",
  menuClassName,
  closeOnInsideClick = false,
  maxHeight = true,
  children,
}: AnchoredMenuProps) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // The trigger element in STATE, not a ref — `excludeRefs` is read during
  // render (it is a prop), and a ref read there is both a lint error and a real
  // staleness hazard: the value React sees is whatever was current at the last
  // render, so a trigger that attached after it would be exempted from
  // click-outside one commit late. State re-renders when the element attaches.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);
  // Unique per instance so two momentarily-coexisting menus don't collide in
  // the cross-backend registry table (`publishRegistry`).
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setAnchorRect(null);
  }, []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      setAnchorRect(next ? (triggerEl?.getBoundingClientRect() ?? null) : null);
      return next;
    });
  }, [triggerEl]);
  // The live anchor: re-read per RAF-coalesced reposition, so the menu follows
  // its button through a resize/scroll instead of pinning the open-time rect.
  const trackAnchor = useCallback(
    () => triggerEl?.getBoundingClientRect() ?? null,
    [triggerEl],
  );

  const renderProps = useMemo<AnchoredMenuRenderProps>(
    () => ({ close, anchorRect }),
    [close, anchorRect],
  );
  const body = typeof children === "function" ? children(renderProps) : children;

  return (
    <div className={wrapperClassName}>
      <button
        ref={setTriggerEl}
        type="button"
        // A menu trigger's click is about the menu, never about whatever the
        // button sits inside (a card header's select/collapse, a strip's
        // focus contract) — every hand-rolled copy stopped it, so the shell
        // states it once.
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        // A menu trigger must never START A DRAG either (task 181). Menu
        // triggers live inside card headers, panel headers and tab strips —
        // surfaces that are themselves HTML5-draggable or run a press-lift
        // gesture — and the repo's established isolation for a button in that
        // position is `draggable={false}` + swallowing `dragstart`
        // (`CardJumpChevron`, `CardDropButton`, and the hand-rolled
        // `CardKindDropdown` this shell absorbed). The press half is already
        // covered without a `stopPropagation`: `INTERACTIVE_CONTROL_SELECTOR`
        // lists `button`, so every gesture built on that SSOT passes a button
        // press through. The HTML5 drag half is NOT — a mousedown on a plain
        // child of a `draggable="true"` ancestor starts the ANCESTOR's drag —
        // so it is stated here once rather than left to each consumer, which is
        // how `ItemMenu` (a card-header kebab since task 180) came to be missing
        // it.
        draggable={false}
        onDragStart={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        className={triggerClassName}
        style={triggerStyle}
        data-hint={triggerHint}
        aria-label={triggerAriaLabel ?? ariaLabel}
        // DERIVED from the container role rather than hard-coded, now that the
        // role is a caller's choice: `aria-haspopup` names what the trigger
        // opens, so a trigger that opens a `role="dialog"` swatch grid
        // announcing "menu" tells a screen-reader user to expect a command list
        // and arrow through it. The default is unchanged for every existing
        // consumer, all of which leave `role` at "menu".
        aria-haspopup={role === "menu" ? "menu" : role}
        aria-expanded={open}
      >
        {trigger(open)}
      </button>
      {open && anchorRect && (
        <MenuProvider
          id={`anchored-menu-${menuId}`}
          layout={layout}
          orientation={orientation}
          role={role}
          portal
          anchorRect={anchorRect}
          placements={ANCHORED_MENU_PLACEMENTS[align]}
          gap={gap}
          maxHeight={maxHeight}
          trackAnchor={trackAnchor}
          // The trigger lives outside the portaled menu, so exempt it from
          // click-outside — else the toggle click closes it via mousedown and
          // the click re-opens it (task 094).
          excludeRefs={[triggerEl]}
          onClose={close}
          ariaLabel={ariaLabel}
          containerStyle={containerStyle}
          containerClassName={`${MENU_BODY_PAD_CLASS}${menuClassName ? ` ${menuClassName}` : ""}`}
        >
          {/* The click that ESCAPES a menu is fenced by `MenuProvider` at the
              container (task 181) — it has to be, because the surface's own
              `py-1` chrome is a hit band outside anything a caller renders.
              This wrapper is only the `closeOnInsideClick` behaviour. */}
          {closeOnInsideClick ? (
            <div
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
            >
              {body}
            </div>
          ) : (
            body
          )}
        </MenuProvider>
      )}
    </div>
  );
}
