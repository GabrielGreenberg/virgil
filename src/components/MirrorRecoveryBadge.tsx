"use client";

/**
 * **"Virgil has unsaved work from earlier"** — the user-facing half of the
 * emergency mirror (task 391).
 *
 * The mirror is cleared by exactly one thing: a write that landed. So this
 * badge appears only when a paper opens holding a mirrored model that never
 * reached disk — the 2026-08-19 incident's outcome, and every crash, forced
 * quit and closed laptop besides. It says when the work was taken, why it
 * could not save, and offers the two answers that exist.
 *
 * Both answers are safe, and the copy says why: RESTORE archives the current
 * file AND the recovered version into one `virgil/.history/` slot before it
 * writes, so it is reversible; DISCARD leaves the file on disk exactly as it
 * is. That is also what lets the badge offer a decision with no preview
 * surface — "view it first" is a folder away either way.
 *
 * Rendered before the `topbarRightCollapsed` gate in `StatusCluster`, with the
 * preservation and sync-conflict notices, because a data-integrity notice must
 * not be hideable by a layout preference.
 *
 * The tone is NOT danger: nothing here is destroying anything, and RED in this
 * codebase means "this action would destroy content without a net"
 * (STYLE_GUIDE). This is a recovery that has a net on both sides.
 */

import { memo, useCallback, useState } from "react";

import { useMirrorRecoveryOffer } from "@/hooks/useMirrorRecovery";
import { getRecoveryActions } from "@/lib/mirror-recovery";
import { describeAge } from "./SoftwareUpdateBanner";
import { useConfirmDialog } from "./ConfirmDialog";

function LifebuoyIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M5.6 5.6l3.8 3.8M14.6 14.6l3.8 3.8M18.4 5.6l-3.8 3.8M9.4 14.6l-3.8 3.8" />
    </svg>
  );
}

/** Why it could not land, said once, in the user's terms. */
function whyItSurvived(reason: string | null): string {
  switch (reason) {
    case "conflict":
      return "another app had changed the file on disk, so Virgil had paused saving";
    case "preservation":
      return "Virgil was refusing to save this paper because it could not fully read the file";
    case "error":
      return "saving to disk was failing";
    default:
      return "it had not reached disk yet";
  }
}

function MirrorRecoveryBadgeImpl({ docId }: { docId: string | null }) {
  const offer = useMirrorRecoveryOffer(docId);
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  const takenAt = offer
    ? new Date(offer.entry.savedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const age = offer ? describeAge(Date.now() - offer.entry.savedAt) : "";

  const handleRestore = useCallback(async () => {
    if (!docId || busy) return;
    const ok = await confirm({
      title: "Restore the unsaved version?",
      message:
        `Virgil kept a copy of this paper as it stood at ${takenAt} (${age} ago), when ` +
        `${whyItSurvived(offer?.entry.reason ?? null)}.\n\n` +
        `Restoring writes that version over the file on disk. Both versions — the one ` +
        `on disk now and the one being restored — are copied into the paper's ` +
        `virgil/.history/ folder first, so you can go back either way.`,
      confirmLabel: "Restore it",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const landed = await getRecoveryActions(docId)?.restore();
      if (landed === false) {
        await confirm({
          title: "Couldn't restore",
          message:
            `Virgil could not write the recovered version to disk. The copy is still ` +
            `kept, and both versions are in the paper's virgil/.history/ folder. If a ` +
            `notice in this bar says why Virgil isn't saving, answering it should ` +
            `clear the way.`,
          confirmLabel: "OK",
          hideCancel: true,
        });
      }
    } finally {
      setBusy(false);
    }
  }, [docId, busy, confirm, takenAt, age, offer]);

  const handleDiscard = useCallback(async () => {
    if (!docId || busy) return;
    const ok = await confirm({
      title: "Discard the unsaved version?",
      message:
        `Virgil will forget the copy it kept from ${takenAt} and keep the version ` +
        `currently on disk. This cannot be undone.`,
      confirmLabel: "Discard it",
      cancelLabel: "Keep it for now",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await getRecoveryActions(docId)?.discard();
    } finally {
      setBusy(false);
    }
  }, [docId, busy, confirm, takenAt]);

  if (!offer) return null;

  return (
    <>
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[360px]"
        style={{
          // The WARNING family the external-change badge uses, one step below
          // the alarm ramp — nothing here destroys anything, and RED means "no
          // net" (STYLE_GUIDE). Both answers this badge offers have one.
          background: "var(--amber-100)",
          borderColor: "var(--amber-500)",
          color: "var(--ink-strong)",
        }}
        data-mirror-recovery={offer.entry.reason ?? "aging"}
        data-hint="Virgil kept a copy of work that never reached disk"
        aria-label={`Unsaved work recovered from ${takenAt}`}
      >
        <span aria-hidden style={{ display: "inline-flex" }}>
          <LifebuoyIcon />
        </span>
        <span className="truncate">
          Unsaved work from {takenAt} — never saved to disk
        </span>
        <button
          type="button"
          className="underline underline-offset-2 disabled:opacity-50"
          disabled={busy}
          onClick={() => void handleRestore()}
        >
          Restore
        </button>
        <button
          type="button"
          className="underline underline-offset-2 disabled:opacity-50"
          disabled={busy}
          onClick={() => void handleDiscard()}
        >
          Discard
        </button>
      </span>
      {dialog}
    </>
  );
}

export const MirrorRecoveryBadge = memo(MirrorRecoveryBadgeImpl);
export default MirrorRecoveryBadge;
