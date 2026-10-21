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
 * - **width** — 260, 280 and 360 px caps with no spec (and, until task 1215,
 *   three hand-typed MENU widths — 240/320, 260/340, 280/360);
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
 * > edge, the label truncates under ONE width cap (the menu has ONE width
 * > spec too, and a badge cannot pass its own), actions render as SIBLINGS
 * > of the labelled span in ONE button style (`.topbarbtn`), and the kebab and
 * > its rows are ONE implementation.
 *
 * The pill adds two registers the leaf does not model — states that are NOT
 * interruptions, so they never enter the tone table (they present no
 * `InterruptionKind`):
 *
 * - **`quiet`** — grey, not an interruption (the external-change watcher
 *   paused by a permission loss; the update chip; the running timer).
 *   Actionability is ORTHOGONAL to the register (task 1214): a quiet pill may
 *   be a control (`onActivate`) or carry controls (`widget`).
 * - **`presence`** — the collaborator pen readout. Body ink on a surface
 *   ground, and NOT a live region: its label is a running duration ("idle
 *   12s") that re-renders on every heartbeat, and a polite region would read
 *   each tick aloud. The partner's identity colour arrives as
 *   `identityEdge` — data, not a design token.
 *
 * **The widget slot** (task 1214). A resident that is a small READOUT WITH
 * CONTROLS (the Pomodoro: play/pause, a clock, a progress track, dismiss)
 * passes them as `widget`: they render INSIDE the pill's chrome, which
 * becomes a labelled `group`, and the `label` becomes the pill's announced
 * sentence (the timer's "Done") — a live region mounted for the pill's whole
 * life, so a state that appears inside it is actually read out.
 *
 * Census: `bar-status-pill.test.tsx` — its subjects are DERIVED from the
 * policy table's mount (`StatusCluster`'s `statusItems`, one per
 * `BAR_STATUS_ORDER` row) plus every component the cluster imports: each
 * policy row renders through here, and no cluster resident spells the raw
 * pill class, a private kebab or a private menu row.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
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
import { menuRowReasonProps, menuRowRovingStyle, menuRowToneClass } from "@/components/menu/row-tone";
import { iconHint } from "@/components/Hint";
import { menuTriggerAria } from "@/components/menu/menu-trigger";

/** The pill's registers: the leaf's four, plus the pill's own `quiet` and
 *  `presence` (neither is an interruption). */
export type BarStatusTone = InterruptionTone | "quiet" | "presence";

/** The one width cap for a bar pill's labelled span. The label truncates
 *  inside it; the full sentence lives on `data-hint` and in the menu. */
export const BAR_STATUS_PILL_MAX_WIDTH = 280;

/** The one width spec for a pill's kebab MENU (task 1215) — every bar status
 *  menu shares it, so a badge declares no width of its own. Sized for the
 *  widest resident (the sync-conflict menu's monospace file list). */
export const BAR_STATUS_MENU_WIDTH = Object.freeze({ min: 280, max: 360 });

const MENU_WIDTH_STYLE: CSSProperties = Object.freeze({
  minWidth: BAR_STATUS_MENU_WIDTH.min,
  maxWidth: BAR_STATUS_MENU_WIDTH.max,
});

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

/** `presence`: the collaborator pen readout — surface ground, subtle
 *  hairline, body ink. */
const PRESENCE_PALETTE: TonePalette = Object.freeze({
  bg: "var(--surface)",
  edge: "var(--edge-subtle)",
  ink: "var(--ink-body)",
});

/** A pill's role/aria-live pairing. `role` is absent for a register that is
 *  not a live region. */
export interface BarStatusAnnouncement {
  role?: "status" | "alert";
  "aria-live": "polite" | "assertive" | "off";
}

const QUIET_ANNOUNCEMENT: BarStatusAnnouncement = Object.freeze({
  role: "status" as const,
  "aria-live": "polite" as const,
});

/** `presence` is a running readout, not news: no role, and `off`. */
const PRESENCE_ANNOUNCEMENT: BarStatusAnnouncement = Object.freeze({
  "aria-live": "off" as const,
});

export function barStatusPalette(tone: BarStatusTone): TonePalette {
  if (tone === "quiet") return QUIET_PALETTE;
  if (tone === "presence") return PRESENCE_PALETTE;
  return paletteForTone(tone);
}

export function barStatusAnnouncement(tone: BarStatusTone): BarStatusAnnouncement {
  if (tone === "quiet") return QUIET_ANNOUNCEMENT;
  if (tone === "presence") return PRESENCE_ANNOUNCEMENT;
  return announcementForTone(tone);
}

/* ── the kebab menu ─────────────────────────────────────────────────── */

const MENU_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.end;

/** Open/close state + anchor for a pill's kebab menu. Lives in the badge
 *  (not the pill) so a badge can OPEN its own menu from outside — the save
 *  badge's "Resolve…" routes here via `useBlockingFlowRequest`.
 *
 *  > **The menu's lifetime is the KEBAB's** (task 1016). The state lives in
 *  > the badge, but it may only be `open` while the kebab it anchors to is
 *  > mounted: `openMenu`/`toggleMenu` are no-ops with no kebab (a request
 *  > that has nowhere to land opens nothing rather than an invisible menu),
 *  > and the kebab's callback ref RESETS the state when it detaches — so a
 *  > badge that renders no pill (its condition cleared) or a menu-less
 *  > variant cannot carry a stale `open` into its next appearance, where it
 *  > would pop unprompted at old coordinates. */
export interface BarStatusMenuController {
  open: boolean;
  anchorRect: DOMRect | null;
  /** The kebab trigger's callback ref. Detaching it closes the menu. */
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
  // A REF, not state: refs attach in the commit BEFORE effects run, so an
  // `openMenu` fired from a mount effect (a blocking-flow request that arrived
  // before the pill appeared) already sees the kebab — a state mirror would
  // still read the previous render's `null` and drop the request.
  const kebabRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setAnchorRect(null);
  }, []);
  const setKebabEl = useCallback((el: HTMLButtonElement | null) => {
    kebabRef.current = el;
    if (!el) {
      setOpen(false);
      setAnchorRect(null);
    }
  }, []);
  const openMenu = useCallback(() => {
    const el = kebabRef.current;
    if (!el) return;
    setOpen(true);
    setAnchorRect(el.getBoundingClientRect());
  }, []);
  const toggleMenu = useCallback(() => {
    const el = kebabRef.current;
    setOpen((o) => {
      const next = !o && !!el;
      setAnchorRect(next && el ? el.getBoundingClientRect() : null);
      return next;
    });
  }, []);
  const trackAnchor = useCallback(() => kebabRef.current?.getBoundingClientRect() ?? null, []);
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
  disabled: disabledProp,
  disabledReason,
  run,
}: {
  id: string;
  label: string;
  detail?: string;
  danger?: boolean;
  /** Greyed; derived from `disabledReason` when omitted (`MenuActionRow`'s
   *  contract, task 998). */
  disabled?: boolean;
  /** WHY the row is greyed — its hint + accessible description, through the
   *  menu's one reason door (`menuRowReasonProps`, task 998). */
  disabledReason?: string;
  run: () => void;
}) {
  const disabled = disabledProp ?? !!disabledReason;
  // `disabled` reaches the registry too, so a greyed row is arrow-skipped and
  // Enter cannot run it; its grey, its danger ink and its roving fill are the
  // menu's row tones (task 986) — this row used to dim `opacity-50` and spell
  // its own `--danger` label ink.
  const { active, getItemProps } = useMenuItem({ id, region: "list", disabled, run });
  return (
    <button
      {...getItemProps()}
      type="button"
      disabled={disabled}
      {...menuRowReasonProps(!!disabled, disabledReason)}
      className={`w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left ${menuRowToneClass(danger ? "danger" : "default", !!disabled)}`}
      style={menuRowRovingStyle(active, !!disabled)}
      data-bar-status-menu-row={id}
    >
      <span className="text-[12px]">
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
  /** A 14–16px stroke glyph; the pill inks it with the tone's edge. Optional
   *  only for a `widget` pill, whose controls lead. */
  glyph?: ReactNode;
  /** An IDENTITY colour (a collaborator's) replacing the register's edge on
   *  the pill's hairline — data, never a design token. */
  identityEdge?: string | null;
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
  /**
   * Makes the pill ITSELF the control (task 1131 — the update chip, whose
   * one action is the pill). The labelled element becomes a typed button: it
   * keeps the tone's `aria-live` but not its `role`, so it stays a button.
   */
  onActivate?: () => void;
  /**
   * Inline controls rendered INSIDE the pill's chrome (task 1214 — the
   * Pomodoro). The chrome becomes a `group` named by `ariaLabel`; `label` is
   * then the announced sentence, rendered after the controls in a live region
   * that stays mounted (empty until there is something to say).
   */
  widget?: ReactNode;
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
  onActivate,
  identityEdge,
  widget,
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
  const announcement = barStatusAnnouncement(tone);
  const labelStyle: CSSProperties = {
    background: palette.bg,
    borderColor: identityEdge || palette.edge,
    color: palette.ink,
    maxWidth: BAR_STATUS_PILL_MAX_WIDTH,
  };
  const glyphEl = glyph != null && (
    <span
      aria-hidden
      className={glyphClassName}
      style={{ color: palette.edge, display: "inline-flex" }}
      data-bar-status-glyph
    >
      {glyph}
    </span>
  );
  const labelBody = (
    <>
      {glyphEl}
      <span className="truncate">{label}</span>
    </>
  );

  return (
    <div
      ref={setWrapEl}
      className="relative inline-flex items-center gap-1"
      data-bar-status-pill={tone}
      {...data}
    >
      {widget != null ? (
        <div
          role="group"
          className={`${BAR_STATUS_PILL_CLASS} shrink-0`}
          style={labelStyle}
          aria-label={ariaLabel}
          data-hint={hint}
          data-bar-status-widget
        >
          {glyphEl}
          {widget}
          {/* Mounted even while empty: a live region that only appears WITH
              its text (or is `display:none` until then) is not read out. */}
          <span className="truncate" {...announcement} data-bar-status-label>
            {label}
          </span>
        </div>
      ) : onActivate ? (
        <button
          type="button"
          onClick={onActivate}
          className={`${BAR_STATUS_PILL_CLASS} cursor-pointer`}
          style={labelStyle}
          aria-live={announcement["aria-live"]}
          aria-label={ariaLabel}
          data-hint={hint}
          data-bar-status-label
        >
          {labelBody}
        </button>
      ) : (
        <span
          className={BAR_STATUS_PILL_CLASS}
          style={labelStyle}
          {...announcement}
          aria-label={ariaLabel}
          data-hint={hint}
          data-bar-status-label
        >
          {labelBody}
        </span>
      )}

      {aside}
      {actions}

      {menu && (
        <button
          ref={setKebabEl}
          type="button"
          onClick={toggleMenu}
          className="iconbtn-sm iconbtn-on-dark"
          {...iconHint({ label: menu.kebabLabel })}
          {...menuTriggerAria("menu", open)}
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
          containerClassName="py-1"
          containerStyle={MENU_WIDTH_STYLE}
        >
          {menu.children}
        </MenuProvider>
      )}

      {children}
    </div>
  );
}

export default BarStatusPill;
