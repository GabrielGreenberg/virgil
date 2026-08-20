"use client";

/**
 * **The save-state badge, and the "Save now" button** — task 392, Gabriel's ask
 * after the 2026-08-19 data loss.
 *
 * On that day autosave WAS working properly. It was deliberately paused by a
 * correct guard, and the topbar said nothing about it for seventy minutes.
 * This is the surface that answers the only question a writer has — **is my
 * work on disk?** — and it answers it from the ONE channel every silencing gate
 * reports through (`unsaved-work.ts`), through the ONE tier ladder
 * (`save-state.ts`), so it cannot come to disagree with the conflict pill or
 * the preservation banner beside it.
 *
 * Four tiers, and the two quiet ones matter as much as the loud ones:
 *
 * - **clean** — "Saved · 13:28". A REASSURANCE, so a layout preference may
 *   collapse it away.
 * - **pending** — "Saving…". The ordinary gap between a keystroke and the
 *   1500 ms debounce. No button: an affordance whose only effect is to do what
 *   is already happening is dead chrome, and a control that blinks in and out
 *   on every typing pause is the fastest way to teach someone to stop seeing
 *   it. Cmd+S still works here — the KEYBOARD door is always open.
 * - **unsaved** — amber, aged, with **Save now**. Twenty seconds of writing has
 *   not landed and nothing has declined it.
 * - **blocked** — red, with the REASON in the user's words and a button that
 *   OPENS the flow holding the write. Never a re-attempt into the same wall:
 *   a Save that silently re-refuses is the incident's silence with a button
 *   on it.
 *
 * Past two minutes the non-clean tiers ESCALATE — the sentence comes out beside
 * the pill, because the incident ran on a pill nobody saw.
 *
 * KEYSTROKE SANCTITY: state comes from `useSaveState` (a `useSyncExternalStore`
 * over an edge-driven store plus a self-scheduling timer that fires at tier
 * boundaries and whole minutes). No editor subscription; a typing burst costs
 * ONE render.
 */

import { memo, useCallback, useState } from "react";

import { useSaveState } from "@/hooks/useSaveState";
import {
  describeAge,
  describeBlockReason,
  describeLandedAt,
  isSaveTierProtected,
} from "@/lib/save-state";
import { requestBlockingFlow, requestSaveNow } from "@/lib/save-request";

function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function SaveStateBadgeImpl({
  docId,
  /** The user's collapsed-toolbar / zen preference. Hides the REASSURANCE
   *  tiers only — a data-integrity state is never hideable by a layout
   *  preference (the task-357 rule, stated once in `isSaveTierProtected`). */
  collapsed = false,
}: {
  docId: string | null;
  collapsed?: boolean;
}) {
  const view = useSaveState(docId);
  const [busy, setBusy] = useState(false);

  const handleSave = useCallback(async () => {
    if (!docId || busy) return;
    setBusy(true);
    let outcome;
    try {
      outcome = await requestSaveNow(docId);
    } finally {
      setBusy(false);
    }
    if (outcome.landed) return;
    if (outcome.reason === "no-door") return; // no pipeline to ask
    // Blocked. ROUTE to whoever owns the flow rather than re-attempting.
    requestBlockingFlow(docId, outcome.reason);
  }, [docId, busy]);

  if (!docId) return null;
  if (!isSaveTierProtected(view.tier) && collapsed) return null;

  // ── the two quiet tiers ────────────────────────────────────────────────
  if (view.tier === "clean") {
    if (view.lastLandedAt === null) return null; // nothing saved, nothing dirty
    return (
      <span
        className="inline-flex items-center px-2 text-[11px] text-ink-subtle whitespace-nowrap"
        data-save-state="clean"
        aria-label={describeLandedAt(view.lastLandedAt)}
      >
        {describeLandedAt(view.lastLandedAt)}
      </span>
    );
  }
  if (view.tier === "pending") {
    return (
      <span
        className="inline-flex items-center px-2 text-[11px] text-ink-subtle whitespace-nowrap"
        data-save-state="pending"
        aria-label="Saving"
      >
        Saving…
      </span>
    );
  }

  // ── the two loud tiers ─────────────────────────────────────────────────
  const blocked = view.tier === "blocked" && view.reason !== null;
  const desc = blocked && view.reason ? describeBlockReason(view.reason) : null;
  const age = describeAge(view.ageMs);
  const label = desc ? `${desc.short} · ${age} unsaved` : `Unsaved · ${age}`;
  const action = desc ? desc.action : "Save now";

  return (
    <span
      className="inline-flex items-center gap-1"
      data-save-state={blocked ? "blocked" : "unsaved"}
      data-save-escalated={view.escalated ? "true" : undefined}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border whitespace-nowrap"
        style={
          blocked
            ? {
                background: "var(--danger-soft)",
                borderColor: "var(--danger)",
                color: "var(--ink-strong)",
              }
            : {
                background: "var(--amber-100)",
                borderColor: "var(--amber-500)",
                color: "var(--ink-strong)",
              }
        }
        role="status"
        aria-label={label}
        data-hint={desc ? desc.sentence : "This document's recent changes are not on disk yet"}
      >
        <span
          aria-hidden
          style={{
            color: blocked ? "var(--danger)" : "var(--amber-500)",
            display: "inline-flex",
          }}
        >
          <SaveIcon />
        </span>
        <span>{label}</span>
      </span>
      {view.escalated && (
        <span className="text-[10px] text-ink-subtle max-w-[420px] leading-snug">
          {desc
            ? desc.sentence
            : "Virgil has not managed to write this paper to disk. Save now, or copy your recent work somewhere safe."}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={busy}
        className="topbarbtn"
        data-save-now
        aria-label={action}
      >
        {busy ? "Saving…" : action}
      </button>
    </span>
  );
}

export const SaveStateBadge = memo(SaveStateBadgeImpl);
export default SaveStateBadge;
