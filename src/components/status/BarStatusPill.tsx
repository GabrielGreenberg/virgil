"use client";

/**
 * **BarStatusPill — the ONE pill every Virgil-bar status badge renders
 * through** (task 769).
 *
 * The data-integrity badges (`CoworkPenBadge`, `PreservationNoticeBadge`,
 * `MirrorRecoveryBadge`, `SyncConflictBadge`, `ExternalChangeBadge`,
 * `SaveStateBadge`) had unified their COLOUR on the one tone table
 * (`interruption-tone.ts`, task 571) but each rebuilt the pill around it by
 * hand from the same class string — and everything the class string did not
 * carry drifted:
 *
 * - **announcement** — two of the seven carried `role="status"`; the conflict
 *   pause, the recovery offer and the sync report were role-less spans a
 *   screen reader never announced;
 * - **width** — 260, 280 and 360 px caps with no spec;
 * - **glyph ink** — one badge left its glyph black;
 * - **actions** — three button styles, one of them underlined links nested
 *   INSIDE the labelled span, so the span's name and the buttons' competed;
 * - **the kebab** — `KebabIcon` + `MenuRow` copied three times, one copy
 *   missing the detail line and the destructive ink.
 *
 * > **A bar badge states its tone, glyph, label, actions and menu; the pill
 * > decides everything else.** The palette AND the role/aria-live pairing are
 * > read off the leaf's tables (`paletteForTone`, `announcementForTone` — the
 * > same pairing the in-document band uses), the glyph is inked by the tone's
 * > edge, the label truncates under ONE width cap, actions render as SIBLINGS
 * > of the labelled span in ONE button style (`.topbarbtn`), and the kebab and
 * > its rows are ONE implementation.
 *
 * `quiet` is the one register the leaf does not model: a non-actionable,
 * grey statement that is not an interruption at all (the external-change
 * watcher paused by a permission loss). It is the pill's own, and it never
 * enters the tone table — it presents no `InterruptionKind`.
 *
 * Census: `bar-status-pill.test.tsx` — every badge `StatusCluster` mounts
 * renders through here, and no `*Badge.tsx` spells the raw pill class.
 */

import {
  useCallback,
  useState,
  type ReactNode,
} from "react";
import {
  announcementForTone,
  paletteForTone,
  type InterruptionTone,
  type TonePalette,
} from "@/lib/interruption-tone";
import { MenuProvider } from "@/components/menu/MenuProvider";
import { ANCHORED_MENU_PLACEMENTS } from "@/components/menu/AnchoredMenu";
import { useMenuItem } from "@/components/menu/useMenuItem";
import { iconHint } from "@/components/Hint";

/** The pill's registers: the leaf's four, plus the pill's own `quiet`. */
export type BarStatusTone = InterruptionTone | "quiet";

/** The one width cap for a bar pill's labelled span. The label truncates
 *  inside it; the full sentence lives on `data-hint` and in the menu. */
export const BAR_STATUS_PILL_MAX_WIDTH = 280;

/** The pill's chrome — the ONE class string, spelled here and nowhere else. */
export const BAR_STATUS_PILL_CLASS =
  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border";

/** `quiet`: a grey statement, not an interruption — surface ground, light
 *  hairline, subtle ink. */
const QUIET_PALETTE: TonePalette = Object.freeze({
  bg: "var(--surface)",
  edge: "var(--border-light)",
  ink: "var(--ink-subtle)",
});

const QUIET_ANNOUNCEMENT = Object.freeze({
  role: "status" as const,
  "aria-live": "polite" as const,
});

export function barStatusPalette(tone: BarStatusTone): TonePalette {
  return tone === "quiet" ? QUIET_PALETTE : paletteForTone(tone);
}

export function barStatusAnnouncement(tone: BarStatusTone) {
  return tone === "quiet" ? QUIET_ANNOUNCEMENT : announcementForTone(tone);
}

/* ── the kebab menu ─────────────────────────────────────────────────── */

const MENU_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.end;

/** Open/close state + anchor for a pill's kebab menu. Lives in the badge
 *  (not the pill) so a badge can OPEN its own menu from outside — the save
 *  badge's "Resolve…" routes here via `useBlockingFlowRequest`. */
export interface BarStatusMenuController {
  open: boolean;
  anchorRect: DOMRect | null;
  /** The kebab trigger, held in STATE (a callback ref) rather than a ref
   *  object, so the controller can travel through render as a prop. */
  setKebabEl: (el: HTMLButtonElement | null) => void;
  /** The pill wrapper, held in STATE (not a ref) so it can be passed to the
   *  menu provider's `excludeRefs` without reading a ref during render. */
  wrapEl: HTMLDivElement | null;
  setWrapEl: (el: HTMLDivElement | null) => void;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
  trackAnchor: () => DOMRect | null;
}

export function useBarStatusMenu(): BarStatusMenuController {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [kebabEl, setKebabEl] = useState<HTMLButtonElement | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setAnchorRect(null);
  }, []);
  const openMenu = useCallback(() => {
    setOpen(true);
    setAnchorRect(kebabEl?.getBoundingClientRect() ?? null);
  }, [kebabEl]);
  const toggleMenu = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      setAnchorRect(next ? (kebabEl?.getBoundingClientRect() ?? null) : null);
      return next;
    });
  }, [kebabEl]);
  const trackAnchor = useCallback(() => kebabEl?.getBoundingClientRect() ?? null, [kebabEl]);
  return { open, anchorRect, setKebabEl, wrapEl, setWrapEl, openMenu, closeMenu, toggleMenu, trackAnchor };
}

function KebabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

/** One menu row — registers into the provider so arrow nav reaches it. A
 *  label, an optional detail line, and the destructive-CHOICE ink. */
export function BarStatusMenuRow({
  id,
  label,
  detail,
  danger,
  disabled,
  run,
}: {
  id: string;
  label: string;
  detail?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      disabled={disabled}
      className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover-on-light disabled:opacity-50"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
      data-bar-status-menu-row={id}
    >
      <span
        className="text-[12px]"
        // interruption-tone-exempt: a destructive-CHOICE ink for this menu row —
        // task 528's family ("a button's paint describes what pressing it
        // DOES"), not an interruption register; the row paints a choice, never
        // the state the pill above it presents.
        style={{ color: danger ? "var(--danger)" : "var(--ink-strong)" }}
      >
        {label}
      </span>
      {detail && (
        <span className="text-[10px] text-ink-subtle leading-snug">{detail}</span>
      )}
    </button>
  );
}

/** The detail block under a menu's rows — the sentence the pill truncates. */
export function BarStatusMenuDetail({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-1.5 mt-1 border-t border-edge-subtle text-[10px] text-ink-subtle leading-snug">
      {children}
    </div>
  );
}

export interface BarStatusMenu {
  controller: BarStatusMenuController;
  /** The MenuProvider id. */
  id: string;
  /** The menu's accessible name. */
  ariaLabel: string;
  /** The kebab button's accessible name + hint. */
  kebabLabel: string;
  /** Width classes for the menu surface. */
  containerClassName?: string;
  children: ReactNode;
}

/* ── actions ────────────────────────────────────────────────────────── */

/** A pill's action — ONE style (`.topbarbtn`), always a SIBLING of the
 *  labelled span, always `type="button"`. */
export function BarStatusAction({
  children,
  onClick,
  disabled,
  hint,
  ariaLabel,
  ...data
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  ariaLabel?: string;
} & { [dataAttr: `data-${string}`]: string | boolean | undefined }) {
  return (
    <button
      type="button"
      className="topbarbtn"
      onClick={onClick}
      disabled={disabled}
      data-hint={hint}
      aria-label={ariaLabel}
      {...data}
    >
      {children}
    </button>
  );
}

/* ── the pill ───────────────────────────────────────────────────────── */

export interface BarStatusPillProps {
  tone: BarStatusTone;
  /** A 14–16px stroke glyph; the pill inks it with the tone's edge. */
  glyph: ReactNode;
  /** Adds a class to the glyph wrapper (the cowork hold's breathing pulse). */
  glyphClassName?: string;
  /** The visible label — truncates under the one width cap. */
  label: ReactNode;
  /** The accessible name of the labelled span. */
  ariaLabel: string;
  /** The hover hint on the labelled span. */
  hint?: string;
  /** Sibling actions, after the pill and before the kebab. */
  actions?: ReactNode;
  /** A sibling between the pill and its actions (the save badge's escalated
   *  sentence). */
  aside?: ReactNode;
  /** The kebab + its menu. */
  menu?: BarStatusMenu;
  /** `data-*` attributes stamped on the wrapper (each badge's own identity). */
  data?: Record<`data-${string}`, string | undefined>;
  /** Content rendered after everything (a confirm dialog portal). */
  children?: ReactNode;
}

export function BarStatusPill({
  tone,
  glyph,
  glyphClassName,
  label,
  ariaLabel,
  hint,
  actions,
  aside,
  menu,
  data,
  children,
}: BarStatusPillProps) {
  const palette = barStatusPalette(tone);
  // Destructured into plain locals: the two element setters are callback
  // refs, and the React Compiler treats an OBJECT one of whose members is
  // passed as `ref` as a ref itself — so reading its other fields in render
  // would be flagged.
  const {
    open = false,
    anchorRect = null,
    setKebabEl,
    wrapEl = null,
    setWrapEl,
    closeMenu,
    toggleMenu,
    trackAnchor,
  } = menu?.controller ?? {};

  return (
    <div
      ref={setWrapEl}
      className="relative inline-flex items-center gap-1"
      data-bar-status-pill={tone}
      {...data}
    >
      <span
        className={BAR_STATUS_PILL_CLASS}
        style={{
          background: palette.bg,
          borderColor: palette.edge,
          color: palette.ink,
          maxWidth: BAR_STATUS_PILL_MAX_WIDTH,
        }}
        {...barStatusAnnouncement(tone)}
        aria-label={ariaLabel}
        data-hint={hint}
        data-bar-status-label
      >
        <span
          aria-hidden
          className={glyphClassName}
          style={{ color: palette.edge, display: "inline-flex" }}
          data-bar-status-glyph
        >
          {glyph}
        </span>
        <span className="truncate">{label}</span>
      </span>

      {aside}
      {actions}

      {menu && (
        <button
          ref={setKebabEl}
          type="button"
          onClick={toggleMenu}
          className="w-5 h-5 inline-flex items-center justify-center rounded hover-on-dark text-ink-subtle focus-ring"
          {...iconHint({ label: menu.kebabLabel })}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <KebabIcon />
        </button>
      )}

      {menu && open && anchorRect && closeMenu && typeof document !== "undefined" && (
        <MenuProvider
          id={menu.id}
          layout="list"
          role="menu"
          anchorRect={anchorRect}
          placements={MENU_PLACEMENTS}
          gap={4}
          trackAnchor={trackAnchor}
          // The kebab trigger lives outside the portaled menu, so exempt the
          // pill wrapper from click-outside (else the toggle click self-closes).
          excludeRefs={[wrapEl]}
          onClose={closeMenu}
          ariaLabel={menu.ariaLabel}
          // Body-portaled at the menu primitive's CHROME_Z so the sticky
          // topbar's stacking context can't clip it (task 295).
          containerClassName={menu.containerClassName ?? "min-w-[260px] max-w-[340px] py-1"}
        >
          {menu.children}
        </MenuProvider>
      )}

      {children}
    </div>
  );
}

export default BarStatusPill;
