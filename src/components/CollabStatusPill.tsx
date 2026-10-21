"use client";

/**
 * CollabStatusPill — pen-status indicator and primary collab actions.
 *
 * Renders in two variants:
 *
 * - `variant="icon"` — the always-visible two-person silhouette button in
 *   the topbar's menu-icon cluster. Behaves as a plain mode toggle: a
 *   click flips collab on (via the identity-dialog flow) or off (no
 *   menu — instant disable). The button is `aria-pressed` while collab
 *   is on so the `.topbarbtn` accent-tint styling kicks in. To edit
 *   identity, open the kebab on the badge variant.
 *
 * - `variant="badge"` — the pen-state pill (dot + label) and the
 *   next-natural action button (Take / Pass / Request / Take over),
 *   plus a kebab that exposes "Edit identity" (the only collab affordance
 *   that doesn't fit naturally on the icon toggle). Lives in the
 *   topbar's modes/views section, left of the divider. Renders nothing
 *   when collab is off.
 *
 * The badge renders through the ONE bar pill, `BarStatusPill` (task 1214):
 * its distinct family is a REGISTER of that pill (`presence` — body ink, not
 * a live region, because the label is a ticking duration), and the partner's
 * colour arrives as the pill's `identityEdge`. The width cap, the action
 * style (`.topbarbtn`), the kebab and its rows are the pill's — this file
 * used to hand-roll all four (a 260px cap, a `Button variant="warm"`, a
 * private kebab and an 11px private row).
 */

import { memo } from "react";
import { type PenStatus } from "@/lib/collab";
import { formatElapsed } from "@/lib/relative-time";
import { StatusDot, type StatusTone } from "./StatusDot";
import { useCollabContext } from "@/hooks/useCollab";
import { iconHint } from "@/components/Hint";
import {
  BarStatusAction,
  BarStatusMenuDetail,
  BarStatusMenuRow,
  BarStatusPill,
  useBarStatusMenu,
} from "@/components/status/BarStatusPill";

interface CollabStatusPillProps {
  /** Called when the user wants to set up / enter collaborator mode. */
  onEnableRequest: () => void;
  /** Called when the user wants to edit their identity. */
  onEditIdentity: () => void;
  /** Called when the user disables collab mode. */
  onDisable: () => void;
  variant: "icon" | "badge";
}

/**
 * Pen state → what the dot MEANS (task 315). Keyed on the closed `PenStatus`
 * union, so a fifth pen state is a compile error rather than a silent grey —
 * which is what retired the old `?? "#888"` fallback: it was a defensive branch
 * over a `Record<string, string>` that could never fire, spelling a fifth raw
 * hex to say so.
 *
 * `active`/`idle` take the pill's own `--status-collab-*` pair rather than the
 * alarm ramp; `stale`/`free` take tokens that already fit. The colours are
 * byte-identical to the four hex literals this replaced — see globals.css.
 */
const PEN_TONE: Readonly<Record<PenStatus, StatusTone>> = {
  active: "collab-active",
  idle: "collab-idle",
  stale: "muted",
  free: "info",
};

/** Two-person silhouette: a slightly smaller figure offset behind a primary
 *  figure. Conveys "collaborator alongside you" at icon size. */
function CollaboratorsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {/* Background figure (offset up-right, slightly smaller). Sized so
          the combined silhouette fills y=2 → y=22, matching the optical
          height of stroke-based 24-viewBox icons in the same row. */}
      <circle cx="19.5" cy="5" r="2.7" />
      <path d="M15 14c0-3.4 2.5-6 4.5-6s4.5 2.6 4.5 6V15H15z" />
      {/* Foreground figure */}
      <circle cx="8.5" cy="8.5" r="3.9" />
      <path d="M1.5 19.5c0-3.9 3.3-6.8 7.5-6.8s7.5 3 7.5 6.8V22H1.5z" />
    </svg>
  );
}

function CollabStatusPill({
  onEnableRequest,
  onEditIdentity,
  onDisable,
  variant,
}: CollabStatusPillProps) {
  // Read collab from the shared context (CollabProvider) rather than a prop:
  // it lets the owning StatusCluster bail on collab pen/presence ticks (frequent
  // during active collaboration) — only this memoized pill re-renders.
  const collab = useCollabContext();
  // Called unconditionally (rules of hooks); the icon variant mounts no kebab,
  // and a controller with no kebab can never open (task 1016).
  const menu = useBarStatusMenu();

  // ── Icon variant ──────────────────────────────────────────────────
  if (variant === "icon") {
    // Plain mode toggle: click flips state. No dropdown.
    //  - Off → onEnableRequest opens the identity dialog (first time)
    //    or re-enables silently if an identity is already saved.
    //  - On  → onDisable shuts collab off directly.
    const handleClick = collab.enabled ? onDisable : onEnableRequest;
    return (
      <button
        onClick={handleClick}
        className="topbarbtn"
        {...iconHint({ label: "Collaborator mode" })}
        aria-pressed={!!collab.enabled}
      >
        <CollaboratorsIcon />
      </button>
    );
  }

  // ── Badge variant ─────────────────────────────────────────────────
  if (!collab.enabled) return null;

  const { pen, iHavePen, identity } = collab;

  let label: string;
  let actionLabel: string | null = null;
  let onAction: (() => void) | null = null;

  if (pen.status === "free") {
    label = "Pen is free";
    actionLabel = "Take";
    onAction = () => void collab.takePen();
  } else if (iHavePen) {
    if (pen.status === "idle") {
      label = `You have the pen · idle ${idleLabel(pen.idleSec)}`;
    } else {
      label = "You have the pen";
    }
    actionLabel = "Pass";
    onAction = () => void collab.passPen();
  } else if (collab.penHeldElsewhere) {
    // Task 1213 — held under MY name by a sibling pane or window: not a
    // partner to request from. Taking it here moves the pen to this pane.
    label = "You hold the pen in another pane";
    actionLabel = "Take here";
    onAction = () => void collab.takePen();
  } else {
    const partner = pen.holder ?? "Partner";
    if (pen.status === "stale") {
      label = `${partner} unreachable · ${idleLabel(pen.staleSec)}`;
      actionLabel = "Take over";
      onAction = () => void collab.takeOver();
    } else if (pen.status === "idle") {
      label = `${partner} stepped away · idle ${idleLabel(pen.idleSec)}`;
      actionLabel = "Request";
      onAction = () => void collab.requestPen();
    } else {
      label = `${partner} is editing · ${idleLabel(pen.idleSec)}`;
      actionLabel = "Request";
      onAction = () => void collab.requestPen();
    }
  }

  const myRequestPending = !!(
    identity &&
    pen.requestedBy.some((r) => r.name === identity.name)
  );
  const partnerColor = collab.partnerColor;
  const pendingNames =
    collab.pen.requestedBy.length > 0 && iHavePen
      ? collab.pen.requestedBy.map((r) => r.name).join(", ")
      : null;

  const { closeMenu } = menu;

  return (
    <BarStatusPill
      tone="presence"
      identityEdge={partnerColor && !iHavePen ? partnerColor : null}
      // Decorative: the label states the pen state; the dot is its colour.
      glyph={<StatusDot tone={PEN_TONE[pen.status]} size="md" className="shrink-0" />}
      label={myRequestPending && !iHavePen ? `${label} · requested` : label}
      ariaLabel={`Collaborator pen status: ${label}`}
      hint="Collaborator pen status"
      data={{ "data-collab-pen": pen.status }}
      actions={
        actionLabel &&
        onAction && <BarStatusAction onClick={onAction}>{actionLabel}</BarStatusAction>
      }
      // The kebab is the only home for "Edit identity" now that the icon
      // button is a pure toggle; the pill body-portals its menu at the
      // chrome-menu tier, out of the sticky bar's z-30 stacking context.
      menu={{
        controller: menu,
        id: "collab-status-menu",
        ariaLabel: "Collaborator options",
        kebabLabel: "Collaborator options",
        children: (
          <>
            <BarStatusMenuRow
              id="edit-identity"
              label="Edit identity…"
              run={() => {
                closeMenu();
                onEditIdentity();
              }}
            />
            {pendingNames && (
              <BarStatusMenuDetail>Pending request: {pendingNames}</BarStatusMenuDetail>
            )}
          </>
        ),
      }}
    />
  );
}

export default memo(CollabStatusPill);

/** The pen pill's live-duration label ("now", "12s", "4m") — the compact
 *  register of the one relative-time ladder, with its seconds bucket. */
function idleLabel(sec: number | null): string {
  return formatElapsed(sec, { register: "compact", seconds: true });
}
