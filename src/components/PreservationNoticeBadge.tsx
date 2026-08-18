"use client";

/**
 * PreservationNoticeBadge — the USER-facing half of Virgil's preservation
 * gates (task 357 hole 4).
 *
 * Both gates refuse a write that would drop content the document was loaded
 * with. Before this they refused into `console.error` on a promise nobody
 * awaits, so the only person who could act on it never heard: the editor
 * mounted the lossy model and the next gesture that counted as a user edit
 * persisted exactly what had just been refused.
 *
 * This is the pill that says so, and it states the two facts that matter in
 * that order: **your file on disk is unchanged**, and **Virgil is not saving
 * this document**. Rendered before the `topbarRightCollapsed` gate in
 * `StatusCluster` (like the update banner and the skill-sync surface), because
 * a data-integrity notice must not be hideable by a layout preference.
 *
 * The one action is "Save anyway…", behind a danger confirm — the informed
 * choice. It cannot silently cost the missing bytes: the first refusal already
 * forced an unconditional forensic snapshot of the intact bundle into
 * `virgil/.history/` (FSA backend), so the pre-refusal file survives whatever
 * the user decides. There is deliberately NO plain dismiss: dismissing would
 * hide the notice while the writes stayed refused, which is the silence this
 * whole surface exists to end.
 *
 * KEYSTROKE SANCTITY: reads state ONLY through `usePreservationNotice()` →
 * `useSyncExternalStore` over the notice store's frozen per-doc snapshot. No
 * editor subscription, no per-keystroke work.
 */

import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { usePreservationNotice } from "@/hooks/usePreservationNotice";
import { acknowledgePreservationNotice } from "@/lib/preservation-notice";
import { useConfirmDialog } from "./ConfirmDialog";
import { MenuProvider } from "./menu/MenuProvider";
import { ANCHORED_MENU_PLACEMENTS } from "./menu/AnchoredMenu";
import { useMenuItem } from "./menu/useMenuItem";
import { iconHint } from "@/components/Hint";

const MENU_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.end;

/** ShieldAlert — a 16px stroke-only shield-with-alert glyph. */
function ShieldIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
      <path d="M12 9v4" />
      <path d="M12 16h.01" />
    </svg>
  );
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

/** A single menu row — registers into the provider so arrow nav reaches it. */
function MenuRow({
  id,
  label,
  detail,
  danger,
  run,
}: {
  id: string;
  label: string;
  detail?: string;
  danger?: boolean;
  run: () => void;
}) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover-on-light"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span
        className="text-[12px]"
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

function PreservationNoticeBadge({ docId }: { docId: string | null }) {
  const notice = usePreservationNotice(docId);
  const { confirm, dialog } = useConfirmDialog();

  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Held in STATE (not a ref) so it can be passed to the menu provider's
  // `excludeRefs` without reading a ref during render — same as the
  // external-change badge.
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

  const lost = notice?.lost ?? 0;
  const region = notice?.region ?? "body";

  const handleSaveAnyway = useCallback(async () => {
    closeMenu();
    if (!docId) return;
    const ok = await confirm({
      title: "Save anyway?",
      message:
        `Virgil could not represent about ${lost} words of this document's ${region} — ` +
        `saving will write the version you see in the editor over the file on disk, ` +
        `and those words will be gone from it. A copy of the current file is in the ` +
        `paper's virgil/.history/ folder.`,
      confirmLabel: "Save anyway — I understand",
      tone: "danger",
    });
    if (!ok) return;
    acknowledgePreservationNotice(docId);
  }, [closeMenu, confirm, docId, lost, region]);

  // ── render gate ────────────────────────────────────────────────────
  // No doc, no refusal, or the user has already answered → nothing to say.
  if (!notice || notice.acknowledged) return null;

  const detail =
    `Virgil read this file but could not represent all of it: about ${lost} of ` +
    `${notice.before} content words in the ${region} are missing from the editor's ` +
    `version. Your file on disk has NOT been changed, and Virgil will not write to ` +
    `it. Open the code view to see the source, or fix the file in another editor ` +
    `and reopen it.`;

  const menu: ReactNode =
    menuOpen && anchorRect && typeof document !== "undefined" ? (
      <MenuProvider
        id="preservation-notice-menu"
        layout="list"
        role="menu"
        portal
        anchorRect={anchorRect}
        placements={MENU_PLACEMENTS}
        gap={4}
        excludeRefs={[wrapEl]}
        onClose={closeMenu}
        ariaLabel="Preservation notice actions"
        trackAnchor={trackAnchor}
        containerClassName="min-w-[260px] max-w-[340px] py-1"
      >
        <MenuRow
          id="save-anyway"
          label="Save anyway — drops the missing text"
          detail="Writes the editor's version over the file on disk. A copy of the current file is kept in virgil/.history/."
          danger
          run={() => void handleSaveAnyway()}
        />
        <div className="px-3 pt-1.5 mt-1 border-t border-edge-subtle text-[10px] text-ink-subtle leading-snug">
          {detail}
        </div>
      </MenuProvider>
    ) : null;

  return (
    <div
      ref={setWrapEl}
      className="relative inline-flex items-center gap-1"
      data-preservation-notice={notice.source}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[280px]"
        style={{
          background: "var(--danger-soft)",
          borderColor: "var(--danger)",
          color: "var(--ink-strong)",
        }}
        data-hint="Virgil could not fully read this file — it is not saving"
        aria-label="Not saving — Virgil could not fully read this file"
      >
        <span aria-hidden style={{ color: "var(--danger)", display: "inline-flex" }}>
          <ShieldIcon />
        </span>
        <span className="truncate">Not saving — this file didn&apos;t fully load</span>
      </span>

      <button
        ref={kebabRef}
        type="button"
        onClick={toggleMenu}
        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-surface-muted text-ink-subtle focus-ring"
        {...iconHint({ label: "Preservation notice options" })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <KebabIcon />
      </button>

      {menu}
      {dialog}
    </div>
  );
}

export default memo(PreservationNoticeBadge);
