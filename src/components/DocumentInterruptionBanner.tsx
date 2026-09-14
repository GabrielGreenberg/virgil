"use client";

/**
 * **The document-interruption BAND** — task 545, the guided front end.
 *
 * Gabriel: *"I'd still like to see a loud stop-and-read-only mode when Virgil
 * is editing … there should be its own front end. Right now it just suddenly
 * says 'changed on disk', and it's not clear if you should save, reload,
 * close — or what?"*
 *
 * This is that front end, for EVERY state that stops or pauses writing — not
 * a second badge. It sits INSIDE the paper's card, directly under the sticky
 * chrome header and above the first line of prose, spanning the pod: visible
 * without looking at the topbar, at every scroll position, and impossible to
 * mistake for chrome. It says, in this order, what happened, what Virgil is
 * doing about it, and ONE thing to do — with the alternatives one click
 * behind. All of it comes from `deriveDocumentInterruption`; this component
 * decides nothing about the words and nothing about which door a choice
 * enters — it only wires each outcome to the door that already exists:
 *
 * - keep-mine / take-disk → `resolveConflict` (task 364, nets both sides);
 * - reload → `reloadFromDisk`; dismiss → `watcher.acknowledge()`;
 * - review → `requestBlockingFlow` (task 392's routing channel, so the
 *   preservation badge's own acknowledge dialog opens — its danger confirm is
 *   the one place that decision is made);
 * - retry → `requestSaveNow`, routed on refusal like every other Save.
 *
 * ## The cowork hold's own identity
 *
 * While an `/editor/*` skill holds the pen the band is the LOUD state the
 * task asks for: the warm "live" family, the breathing pen glyph, and the
 * pane root stamped `data-doc-interruption="cowork-hold"` so the prose
 * itself is veiled (globals.css). No "collaborator" vocabulary anywhere —
 * the machinery underneath is collab's, the identity is not.
 *
 * ## Tone
 *
 * `live` / `warning` / `info` take the warm family (STYLE_GUIDE → "The
 * destructive / alarm family": nothing here destroys anything, every conflict
 * door is netted); `danger` is reserved for the two states in which the
 * user's work is on no disk and nothing is coming — the preservation refusal
 * and a failed write. Which kind takes which tone, and which tokens a tone
 * paints, are both stated in `interruption-tone.ts` and read here (task 571
 * retired this file's private copy of the palette). The recommended button is
 * the accented one; an alternative is a plain link-button. No dismiss: a state that is still true
 * cannot be hidden, and every state here clears itself when its cause does.
 *
 * KEYSTROKE SANCTITY: reads state only through `useDocumentInterruption`
 * (store reads); no editor subscription, no timer of its own.
 */

import { memo, useCallback, useEffect, useState } from "react";

import { useDocumentInterruption } from "@/hooks/useDocumentInterruption";
import { useDiskWatcherOrNull } from "@/components/editor-layout/contexts/disk-watcher";
import { useExternalChangesOrNull } from "@/hooks/useExternalChanges";
import {
  conflictOutcomeNotice,
  type DocumentInterruption,
  type InterruptionAction,
} from "@/lib/document-interruption";
import { paletteForTone } from "@/lib/interruption-tone";
import { requestBlockingFlow, requestSaveNow } from "@/lib/save-request";
import { useConfirmDialog } from "./ConfirmDialog";

/** The pen glyph the topbar badge draws — the same shape, so the two surfaces
 *  read as one event. */
function PenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function FileWarningIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M12 11v3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function ShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function glyphFor(v: DocumentInterruption) {
  switch (v.kind) {
    case "cowork-hold":
      return <PenIcon />;
    case "conflict":
    case "disk-change":
      return v.writer === "virgil-ai" ? <PenIcon /> : <FileWarningIcon />;
    default:
      return <ShieldIcon />;
  }
}

function DocumentInterruptionBannerImpl({ docId }: { docId: string | null }) {
  const view = useDocumentInterruption(docId);
  const diskCtx = useDiskWatcherOrNull();
  const { watcher } = useExternalChangesOrNull();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);

  // The VEIL stamp. The pane root is stamped from the SAME view this band
  // renders, so the dimmed prose and the words above it cannot disagree.
  // Edge-driven (kind changes, never per keystroke) and idempotent; the
  // attribute comes off when the band unmounts or the state clears.
  const kind = view?.kind ?? null;
  useEffect(() => {
    const root = el?.closest(".editor-pane-root");
    if (!root) return;
    if (kind) root.setAttribute("data-doc-interruption", kind);
    else root.removeAttribute("data-doc-interruption");
    return () => {
      root.removeAttribute("data-doc-interruption");
    };
  }, [el, kind]);

  const run = useCallback(
    async (action: InterruptionAction) => {
      if (!docId || busy) return;
      setBusy(true);
      try {
        switch (action.id) {
          case "keep-mine":
          case "take-disk": {
            const outcome = await diskCtx?.resolveConflict?.(action.id);
            if (!outcome) return;
            const notice = conflictOutcomeNotice(outcome);
            if (notice) {
              await confirm({
                title: notice.title,
                message: notice.message,
                confirmLabel: "OK",
                hideCancel: true,
                tone: notice.tone === "danger" ? "danger" : undefined,
              });
            }
            return;
          }
          case "reload":
            await diskCtx?.reloadFromDisk?.();
            return;
          case "dismiss":
            await watcher?.acknowledge();
            return;
          case "review":
            if (action.reason) requestBlockingFlow(docId, action.reason);
            return;
          case "retry": {
            const outcome = await requestSaveNow(docId);
            if (outcome.landed || outcome.reason === "no-door") return;
            requestBlockingFlow(docId, outcome.reason);
            return;
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [docId, busy, diskCtx, watcher, confirm],
  );

  if (!view) {
    // A zero-size sentinel keeps a DOM anchor for the veil stamp's cleanup
    // edge; it paints nothing and takes no space.
    return <span ref={setEl} hidden data-doc-interruption-band="none" />;
  }
  // The tone → token map lives in `interruption-tone.ts` (task 571): this band
  // used to hold a private copy, and the save badge beside it read none — so
  // one state painted two colours. One map, every surface.
  const palette = paletteForTone(view.tone);
  const live = view.tone === "live";

  return (
    <div
      ref={setEl}
      className="doc-interruption-band shrink-0"
      data-doc-interruption-band={view.kind}
      data-doc-interruption-writer={view.writer}
      role={view.tone === "danger" ? "alert" : "status"}
      aria-live={view.tone === "danger" ? "assertive" : "polite"}
      style={{
        background: palette.bg,
        borderBottom: `1px solid ${palette.edge}`,
        boxShadow: `inset 3px 0 0 ${palette.edge}`,
        color: palette.ink,
      }}
    >
      <div className="doc-interruption-band__glyph" style={{ color: palette.edge }}>
        <span className={live ? "cowork-pen-pulse" : undefined} style={{ display: "inline-flex" }}>
          {glyphFor(view)}
        </span>
      </div>
      <div className="doc-interruption-band__text">
        <div className="doc-interruption-band__title">{view.title}</div>
        <div className="doc-interruption-band__body">{view.body}</div>
      </div>
      {(view.recommended || view.alternatives.length > 0) && (
        <div className="doc-interruption-band__actions">
          {view.recommended && (
            <button
              type="button"
              className="doc-interruption-band__primary"
              disabled={busy}
              onClick={() => void run(view.recommended!)}
              title={view.recommended.detail}
              data-interruption-action={view.recommended.id}
              data-interruption-recommended
            >
              {view.recommended.label}
            </button>
          )}
          {view.alternatives.map((a) => (
            <button
              key={a.id}
              type="button"
              className="doc-interruption-band__secondary"
              disabled={busy}
              onClick={() => void run(a)}
              title={a.detail}
              data-interruption-action={a.id}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {dialog}
    </div>
  );
}

export const DocumentInterruptionBanner = memo(DocumentInterruptionBannerImpl);
export default DocumentInterruptionBanner;
