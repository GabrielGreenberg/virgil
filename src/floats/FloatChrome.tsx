"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";
import { PopoutButton } from "@/components/panel-primitives";
import { DropChevrons } from "@/components/icons/DropChevrons";
import { JumpChevron } from "@/components/icons/JumpChevron";
import { beginCardDropGesture } from "@/components/drop-mode/card-drop-gesture";
import { FONT_SANS } from "@/lib/font-stacks";
import { iconHint } from "@/components/Hint";

/**
 * `FloatChrome` — the ONE header skeleton for every popped-out window, shared
 * by `Card` and `TextObject` floats. Promoted from the text-object
 * `FloatHeaderContent` and the card `PanelCard` popped-header branch, which are
 * both retired in its favor (the jump glyph is now drawn exactly once, here).
 *
 * Layout: grip · title · `{trailing}` · jump · drop · close (X). Domain-neutral
 * — it imports nothing card- or text-specific. The two domain contributions
 * ride in as opaque nodes:
 *   - `titleNode` — the label-position override (e.g. the revision morph
 *     dropdown); supersedes the `title` string.
 *   - `trailing` — the narrow region before jump/close (collab pill, status
 *     dot, AI checkbox, …). For cards this is a `CardChromeTrailing` element
 *     that hosts its own `CardClaimContext`, so FloatChrome stays neutral.
 *
 * `redock` is intentionally absent — cards/text-objects never dock
 * (`canRedock=false`); panels keep their own chrome.
 *
 * ## Two mounts, one CONTENT (task 437)
 *
 * A popped-out float is also PREVIEWED: the lift ghost
 * (`LiftedTextOverlay`) grows a header bar past the popout threshold, and on
 * release that ghost becomes this window. **A preview shows what the release
 * produces**, so the two headers render the SAME children — {@link
 * FloatChromeContent}, exported for exactly that mount and mounted nowhere
 * else. Only the OUTER container differs, because the two are positioned by
 * different owners: here it is a flex row inside `FloatingPanel`'s 1px border;
 * in the ghost it is a JS-positioned portal sibling whose bg/border/radius come
 * from `globals.css` `.lifted-text-overlay__header`. Those two containers must
 * declare the SAME leading inset (1px border + 8px padding) and the same 4px
 * gap or the label shifts at the handoff — pinned by
 * `lift-ghost-header-parity.test.tsx`, which is the census that replaced the
 * PROSE claim four files used to make (and which had been false since this
 * component gained the grip and the drop button; the retired
 * `FloatHeaderContent` had neither, so the label sat ~14px left of where the
 * release put it).
 *
 * The preview mount passes `inert`, which is a claim about the whole subtree
 * rather than a per-button one: the ghost's container carries the HTML `inert`
 * attribute (nothing inside is focusable or clickable) and the content attaches
 * no handlers at all. The prop type is a discriminated union so a live mount
 * cannot forget a handler and a preview cannot be handed one.
 */

/** The UI-chrome sans stack, so the label resolves identically wherever it
 *  mounts — honoring the user's `--font-sans-override` (the L3d.1
 *  explicit-font fix, so no label can drift). Taken from the font-stack SSOT
 *  rather than re-spelled: this was one of three hand-written copies of the
 *  same chain (task 170). */
const FLOAT_HEADER_FONT_FAMILY = FONT_SANS;

/** The header container's own leading inset and rhythm, spelled ONCE as
 *  Tailwind utilities here and mirrored by `globals.css`
 *  `.lifted-text-overlay__header` (CSS can't import TS). `px-2` = 8px padding,
 *  `gap-1` = 4px, `h-6` = 24px (== `CARD_FLOAT_HEADER_H`). The parity census
 *  reads BOTH spellings and fails if they diverge — that inset is where the
 *  label lands, so a drift between them is a label jump on release. */
export const FLOAT_CHROME_CONTAINER_CLASS =
  "flex items-center gap-1 px-2 h-6 shrink-0 border-b border-edge-subtle";

/** Decorative 6-dot grip (mirrors `CardDragHandle`). The whole header strip is
 *  the drag surface (FloatingPanel `onHeaderMouseDown`); this just signals it. */
function FloatGrip() {
  return (
    <div
      className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint shrink-0"
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>
  );
}

/** What the header renders, independent of who renders the handlers. */
interface FloatChromeShape {
  /** Resolved display title (`titleOverride ?? floatable.title`). */
  title: string;
  /** Label-position override (morph control); supersedes `title` when set. */
  titleNode?: ReactNode;
  /** The single domain-contributed trailing slot. */
  trailing?: ReactNode;
  /** Whether to show the jump-to-source chevron. */
  canJump: boolean;
  /** Whether to show the (re)anchor drop button (mirrors `canJump`). Stays
   *  domain-neutral: the caller (`FloatWindow` via `cardFloatable`) reads the
   *  static `CARD_REGISTRY[kind].droppable` facet and hands a plain boolean —
   *  no card code reaches in here. Absent / false → no button. */
  canDrop?: boolean;
  /** Opaque `float:card:<kind>:<id>` key the neutral drop button hands to
   *  `beginCardDropGesture` so the drop controller can look the spec up. A
   *  string at this layer — FloatChrome never parses or imports a card kind. */
  dropCardKey?: string;
}

/** The handlers a LIVE header must supply. */
interface FloatChromeHandlers {
  onJump: () => void;
  /** Optional domain-supplied press handler for the (re)anchor drop button.
   *  When provided, the guarded mousedown calls THIS instead of the default
   *  `beginCardDropGesture(dropCardKey)` — the seam that lets a text-object
   *  float drive `LiftHost.beginLift({terminalPolicy:"float", …})` (the full
   *  lifted-overlay ghost) while CARD floats keep the no-ghost
   *  `beginCardDropGesture` path byte-unchanged (caller leaves this undefined).
   *  FloatChrome stays domain-blind: the caller (`FloatWindow`) builds the
   *  handler; FloatChrome imports no card/text-object code. */
  onDropPress?: (e: ReactMouseEvent) => void;
  onClose: () => void;
}

/**
 * The header's children — the ONE implementation, mounted by the live
 * {@link FloatChrome} and by the lift ghost's preview header.
 *
 * `inert: true` is the preview: no handler is attached and none may be passed
 * (the union forbids it), because a preview has nothing to call. Focusability
 * is the CONTAINER's job — the ghost's header carries the HTML `inert`
 * attribute, which is a subtree claim and so covers `PopoutButton`, whose API
 * has no `tabIndex` seam of its own.
 */
export type FloatChromeContentProps = FloatChromeShape &
  (
    | ({ inert?: false } & FloatChromeHandlers)
    | {
        inert: true;
        onJump?: never;
        onDropPress?: never;
        onClose?: never;
      }
  );

/** Inert stand-in for `PopoutButton`'s required `onClick` in preview mode. The
 *  ghost's container is `inert` + `pointer-events: none`, so it never fires. */
const NOOP = () => {};

export function FloatChromeContent(props: FloatChromeContentProps) {
  const { title, titleNode, trailing, canJump, canDrop, dropCardKey } = props;
  const preview = props.inert === true;
  const labelNoun = title.toLowerCase();
  return (
    <>
      <FloatGrip />
      {titleNode ?? (
        <span
          className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate"
          style={{ fontFamily: FLOAT_HEADER_FONT_FAMILY }}
        >
          {title}
        </span>
      )}
      <span className="flex-1" />
      {trailing}
      {canJump && (
        <button
          type="button"
          onClick={preview ? undefined : props.onJump}
          className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light focus-ring"
          {...iconHint({ label: `Jump to ${labelNoun}` })}
        >
          <JumpChevron />
        </button>
      )}
      {/* (Re)anchor drop button — the popped-float twin of the docked
          `CardDropButton`, rendered LEFT of the close X. The press guards are
          a verbatim mirror of that button (primary-button-only, then
          stopPropagation + preventDefault + draggable=false + dragstart
          swallow) so the press can't co-fire the FloatingPanel header
          drag-lift. The drop session itself is owned by the shared neutral
          `beginCardDropGesture` (arms its own one-shot commit-on-mouseup). The
          `preventDefault` on mousedown is load-bearing — this is a press-DRAG,
          not a click — and trips the header wrapper's `defaultPrevented`
          lift-guard. Gated on the static `canDrop` boolean: no per-render /
          per-keystroke work. */}
      {canDrop && dropCardKey && (
        <button
          type="button"
          onMouseDown={
            preview
              ? undefined
              : (e) => {
                  // Primary button only — a right/middle press passes through
                  // (no phantom session). The predicate is the engine's SSOT
                  // (lib/pane-resize/pointer-invariants), never re-derived.
                  if (!isPrimaryDragStart(e)) return;
                  e.stopPropagation();
                  e.preventDefault();
                  // Domain dispatch (Chip 2): a caller-supplied `onDropPress`
                  // wins (text-object floats → `LiftHost.beginLift({policy:
                  // "float"})`, the lifted-overlay ghost). Absent → the default
                  // neutral `beginCardDropGesture` (card floats, byte-
                  // unchanged). The guards above (primary-only /
                  // stopPropagation / preventDefault) run in BOTH cases so
                  // neither path co-fires the FloatingPanel header lift.
                  if (props.onDropPress) {
                    props.onDropPress(e);
                  } else {
                    beginCardDropGesture({
                      cardKey: dropCardKey,
                      origin: { x: e.clientX, y: e.clientY },
                    });
                  }
                }
          }
          onClick={preview ? undefined : (e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light bg-transparent p-0 shrink-0 cursor-grab focus-ring"
          {...iconHint({ label: `Drop ${labelNoun} into text` })}
        >
          <DropChevrons />
        </button>
      )}
      <PopoutButton
        isPoppedOut
        variant="x"
        labelNoun={labelNoun}
        className="iconbtn-xs"
        onClick={preview ? NOOP : props.onClose}
      />
    </>
  );
}

export interface FloatChromeProps extends FloatChromeShape, FloatChromeHandlers {
  /** Header-strip background (`Floatable.headerTint`) — card floats pass
   *  their kind's `theme.headerDefault` so the strip matches the docked
   *  card header (pop-out continuity #20). Absent → the neutral
   *  `--surface-muted-strong` (text-object floats; the same value
   *  `.lifted-text-overlay__header` paints, so the preview and the release
   *  agree on the strip color too). */
  headerTint?: string;
}

export function FloatChrome({ headerTint, ...content }: FloatChromeProps) {
  return (
    <div
      className={FLOAT_CHROME_CONTAINER_CLASS}
      style={{ backgroundColor: headerTint ?? "var(--surface-muted-strong)" }}
    >
      <FloatChromeContent {...content} />
    </div>
  );
}
