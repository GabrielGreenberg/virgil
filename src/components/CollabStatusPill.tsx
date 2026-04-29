"use client";

/**
 * CollabStatusPill — pen-status indicator and primary collab actions.
 *
 * Lives inside the docked MenuBar. Shows the current pen state with a
 * colored dot, and surfaces the next-natural action (Take / Pass /
 * Request / Take over). Clicking the pill itself opens a small popover
 * with the disable-collab option. When collab is off, the pill is
 * collapsed into a single "Co" toggle.
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
    <svg width="16" height="14" viewBox="0 0 20 16" fill="currentColor" aria-hidden>
      {/* Background figure (offset up-right, slightly smaller) */}
      <circle cx="13.5" cy="3.5" r="2" />
      <path d="M9.8 9.6c0-2 1.7-3.6 3.7-3.6s3.7 1.6 3.7 3.6v0.6h-7.4z" />
      {/* Foreground figure */}
      <circle cx="7" cy="4.5" r="2.6" />
      <path d="M2 12.4c0-2.4 2.2-4.4 5-4.4s5 2 5 4.4V14H2z" />
    </svg>
  );
}

export default function CollabStatusPill({
  collab,
  onEnableRequest,
  onEditIdentity,
  onDisable,
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

  // Off state — topbar icon button (two-person silhouette) to enter collab mode.
  if (!collab.enabled) {
    return (
      <button
        onClick={onEnableRequest}
        title="Turn on collaborator mode"
        className="topbarbtn topbarbtn-icon"
        data-helper="Collaborator mode"
      >
        <CollaboratorsIcon />
      </button>
    );
  }

  const { pen, iHavePen, identity } = collab;

  // Build label + action for the current state.
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
    // Partner holds it
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

  // Derived: if a request from me is pending, show an indicator.
  const myRequestPending = !!(
    identity &&
    pen.requestedBy.some((r) => r.name === identity.name)
  );

  // Partner-color border when partner holds it (informational).
  const partnerColor = collab.partnerColor;
  const dotColor = DOT_COLORS[pen.status] ?? "#888";

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-ink-body bg-surface border border-edge-subtle hover:border-edge-strong transition-colors max-w-[260px] truncate"
        style={partnerColor && !iHavePen ? { borderColor: partnerColor } : undefined}
        title="Collaborator mode"
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
      </button>
      {actionLabel && onAction && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction!();
          }}
          className="px-2 py-0.5 rounded text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
        >
          {actionLabel}
        </button>
      )}
      {menuOpen && (
        <div className="absolute top-full left-0 mt-1 z-[1000] w-44 rounded-md border border-edge-subtle bg-surface shadow-lg py-1">
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
          <button
            onClick={() => {
              setMenuOpen(false);
              onDisable();
            }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-ink-body hover-on-light"
          >
            Turn off collaborator mode
          </button>
        </div>
      )}
    </div>
  );
}
