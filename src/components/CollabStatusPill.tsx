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
 */

import { useEffect, useRef, useState } from "react";
import { formatRelativeShort } from "@/lib/collab";
import type { CollabHook } from "@/hooks/useCollab";

interface CollabStatusPillProps {
  collab: CollabHook;
  /** Called when the user wants to set up / enter collaborator mode. */
  onEnableRequest: () => void;
  /** Called when the user wants to edit their identity. */
  onEditIdentity: () => void;
  /** Called when the user disables collab mode. */
  onDisable: () => void;
  variant: "icon" | "badge";
}

const DOT_COLORS: Record<string, string> = {
  active: "#15803d", // green
  idle: "#d4a843", // amber
  stale: "#78716c", // grey
  free: "#7191b0", // steel
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

export default function CollabStatusPill({
  collab,
  onEnableRequest,
  onEditIdentity,
  onDisable,
  variant,
}: CollabStatusPillProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

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
        title={collab.enabled ? "Turn off collaborator mode" : "Turn on collaborator mode"}
        className="topbarbtn"
        data-helper="Collaborator mode"
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
      label = `You have the pen · idle ${formatRelativeShort(pen.idleSec)}`;
    } else {
      label = "You have the pen";
    }
    actionLabel = "Pass";
    onAction = () => void collab.passPen();
  } else {
    const partner = pen.holder ?? "Partner";
    if (pen.status === "stale") {
      label = `${partner} unreachable · ${formatRelativeShort(pen.staleSec)}`;
      actionLabel = "Take over";
      onAction = () => void collab.takeOver();
    } else if (pen.status === "idle") {
      label = `${partner} stepped away · idle ${formatRelativeShort(pen.idleSec)}`;
      actionLabel = "Request";
      onAction = () => void collab.requestPen();
    } else {
      label = `${partner} is editing · ${formatRelativeShort(pen.idleSec)}`;
      actionLabel = "Request";
      onAction = () => void collab.requestPen();
    }
  }

  const myRequestPending = !!(
    identity &&
    pen.requestedBy.some((r) => r.name === identity.name)
  );
  const partnerColor = collab.partnerColor;
  const dotColor = DOT_COLORS[pen.status] ?? "#888";

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-ink-body bg-surface border border-edge-subtle max-w-[260px] truncate"
        style={partnerColor && !iHavePen ? { borderColor: partnerColor } : undefined}
        title="Collaborator pen status"
      >
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />
        <span className="truncate">{label}</span>
        {myRequestPending && !iHavePen && (
          <span className="text-[10px] text-ink-faint">· requested</span>
        )}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-2 py-0.5 rounded text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
        >
          {actionLabel}
        </button>
      )}
      {/* Kebab: the only home for "Edit identity" now that the icon
          button is a pure toggle. Renders next to the pen action.
          Menu is portaled-style — uses a high z-index and positions
          itself from the wrapping ref so the topbar's own stacking
          context doesn't clip it. */}
      <button
        onClick={() => setMenuOpen((v) => !v)}
        title="Collaborator options"
        aria-label="Collaborator options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-surface-muted text-ink-subtle"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute top-full right-0 mt-1 z-[1000] w-44 rounded-md border border-edge-subtle bg-surface shadow-lg py-1">
          <button
            onClick={() => {
              setMenuOpen(false);
              onEditIdentity();
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-ink-body hover-on-light"
          >
            Edit identity…
          </button>
          {collab.pen.requestedBy.length > 0 && iHavePen && (
            <div className="px-3 py-1 text-[10px] text-ink-faint border-t border-edge-subtle">
              Pending request: {collab.pen.requestedBy.map((r) => r.name).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
