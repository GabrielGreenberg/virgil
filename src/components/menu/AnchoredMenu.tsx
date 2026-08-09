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

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { MenuProvider } from "./MenuProvider";
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
 * of the window (a panel header's "+") means clamping to the sliver of space
 * above it: a two-row menu becomes a scrollbar. The hand-rolled menu this
 * replaced chose its axes INDEPENDENTLY (`flipUp` and `flipLeft` were separate
 * booleans), and that behavior is preserved here by enumerating the product in
 * preference order — vertical preference first, then the horizontal escape,
 * before giving up the preferred side.
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

/** The menu surface's chrome — the literal every hand-rolled dropdown copied
 *  (`bg-surface border rounded-lg shadow-lg py-1`) minus the `fixed z-[9999]`
 *  the primitive now owns. `shadow-lg` is the established menu/dropdown
 *  elevation (`--shadow-float` is scoped to SystemDialog). */
export const MENU_SURFACE_CLASS =
  "bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1";

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
  /** Trigger tooltip (`data-hint`). */
  triggerHint?: string;
  /** Trigger accessible name. Defaults to `ariaLabel`. */
  triggerAriaLabel?: string;
  /** Wrapper (positioning context for the trigger) className. */
  wrapperClassName?: string;
  /** Extra classes on the menu surface — width floors, mostly. Appended to
   *  `MENU_SURFACE_CLASS`. */
  menuClassName?: string;
  /**
   * Close on ANY click that bubbles out of the menu body. For menus whose rows
   * are opaque children this component can't reach (`ItemMenu`). Rows that must
   * survive repeated activation stop propagation themselves
   * (`MenuToggleRow keepMenuOpen`). Default false — prefer the `children`
   * render prop's explicit `close`.
   */
  closeOnInsideClick?: boolean;
  /** Clamp the menu's height to the space available + scroll. Default true. */
  maxHeight?: boolean;
  children: ReactNode | ((p: AnchoredMenuRenderProps) => ReactNode);
}

export function AnchoredMenu({
  ariaLabel,
  align = "start",
  gap = 4,
  trigger,
  triggerClassName,
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
        className={triggerClassName}
        data-hint={triggerHint}
        aria-label={triggerAriaLabel ?? ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger(open)}
      </button>
      {open && anchorRect && (
        <MenuProvider
          id={`anchored-menu-${menuId}`}
          layout="list"
          role="menu"
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
          containerClassName={`${MENU_SURFACE_CLASS}${menuClassName ? ` ${menuClassName}` : ""}`}
        >
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
