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

import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { formatRelativeShort } from "@/lib/collab";
import { useCollabContext } from "@/hooks/useCollab";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";

// Anchor the kebab dropdown below its trigger, flipping above when the topbar
// sits near the viewport bottom. Matches ExternalChangeBadge (the sibling
// topbar kebab) so the two dropdowns behave identically.
const MENU_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "end" },
  { side: "above", align: "end" },
];

/** The one interactive row of the collab kebab — "Edit identity…". Registers
 *  into the provider (via `useMenuItem`) so it gains arrow-nav + the roving
 *  active highlight for free, matching every other `<Menu>` list item. */
function EditIdentityRow({ onSelect }: { onSelect: () => void }) {
  const { active, getItemProps } = useMenuItem({
    id: "edit-identity",
    region: "list",
    run: onSelect,
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full text-left px-3 py-1.5 text-[11px] text-ink-body hover-on-light"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      Edit identity…
    </button>
  );
}

interface CollabStatusPillProps {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // The pill wrapper is held in STATE (not a ref) so it can be handed to the
  // menu provider's `excludeRefs` without reading a ref during render — the
  // kebab trigger lives outside the body-portaled menu, so it must be exempt
  // from click-outside or the toggle click would self-close the menu.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const kebabRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setAnchorRect(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((o) => {
      const next = !o;
      setAnchorRect(
        next ? (kebabRef.current?.getBoundingClientRect() ?? null) : null,
      );
      return next;
    });
  }, []);

  const trackAnchor = useCallback(
    () => kebabRef.current?.getBoundingClientRect() ?? null,
    [],
  );

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
        data-hint="Collaborator mode"
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
  const pendingNames =
    collab.pen.requestedBy.length > 0 && iHavePen
      ? collab.pen.requestedBy.map((r) => r.name).join(", ")
      : null;

  const menu: ReactNode =
    menuOpen && anchorRect && typeof document !== "undefined" ? (
      <MenuProvider
        id="collab-status-menu"
        layout="list"
        role="menu"
        portal
        anchorRect={anchorRect}
        placements={MENU_PLACEMENTS}
        gap={4}
        trackAnchor={trackAnchor}
        // The kebab trigger lives outside the portaled menu, so exempt the pill
        // wrapper from click-outside (else the toggle click self-closes it).
        excludeRefs={[wrapEl]}
        onClose={closeMenu}
        ariaLabel="Collaborator options"
        containerClassName="min-w-[11rem] max-w-[260px] py-1"
        // Body-portaled at the menu primitive's CHROME_Z (z:2000 tier) so the
        // sticky topbar's z-30 stacking context can't clip the dropdown.
        containerStyle={{
          background: "var(--pod-editor)",
          border: "var(--pod-border)",
          boxShadow: "var(--pod-shadow)",
          borderRadius: "var(--pod-radius)",
        }}
      >
        <EditIdentityRow
          onSelect={() => {
            closeMenu();
            onEditIdentity();
          }}
        />
        {pendingNames && (
          <div className="px-3 py-1 text-[10px] text-ink-faint border-t border-edge-subtle">
            Pending request: {pendingNames}
          </div>
        )}
      </MenuProvider>
    ) : null;

  return (
    <div ref={setWrapEl} className="relative flex items-center gap-1">
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] text-ink-body bg-surface border border-edge-subtle max-w-[260px] truncate"
        style={partnerColor && !iHavePen ? { borderColor: partnerColor } : undefined}
        data-hint="Collaborator pen status" aria-label="Collaborator pen status"
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
          button is a pure toggle. Renders next to the pen action. The
          dropdown body-portals via MenuProvider at the chrome-menu tier
          (OPEN_CHROME_MENU_Z) — the Virgil bar is `sticky z-30`, which
          establishes a stacking context that would trap an inline
          `absolute` dropdown BELOW floating panels / popped cards
          (z-1200+), no matter its own z-index (STYLE_GUIDE portal rule).
          Portaling to document.body escapes that trap. */}
      <button
        ref={kebabRef}
        type="button"
        onClick={toggleMenu}
        data-hint="Collaborator options"
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
      {menu}
    </div>
  );
}

export default memo(CollabStatusPill);
