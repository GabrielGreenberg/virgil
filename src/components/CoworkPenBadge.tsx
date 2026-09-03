"use client";

/**
 * **CoworkPenBadge — "Virgil is editing this paper…"** (task 489).
 *
 * Gabriel: *"When Virgil is editing from cowork, can it flip a switch that
 * makes the doc read only (with some loud indicator to show what is
 * happening?)"*. The read-only half is the ONE existing gate
 * (`collab.canEditMainText` → `editor.setEditable`); this is the half that
 * says why, because a document that silently stops accepting keystrokes is a
 * worse experience than one that never went read-only at all.
 *
 * ## Why it is AMBER and not RED
 *
 * `STYLE_GUIDE.md` → "The destructive / alarm family": red means an action
 * would destroy content WITHOUT a net, and *"a state that is merely unexpected
 * is a firm-but-calm WARNING"*. Nothing here is destructive or even wrong — a
 * skill the user asked for is doing exactly what they asked, the file is being
 * written correctly, and the state clears itself. What makes it LOUD is that it
 * is present at all, that it names what is happening in the user's own words,
 * and that its dot animates: this is the app's only badge for something
 * happening RIGHT NOW rather than something that has happened.
 *
 * ## Where it sits
 *
 * Before the `topbarRightCollapsed` gate in `StatusCluster`, with the four
 * data-integrity badges, for the reason task 357 states and task 392 restated:
 * a notice that explains why the editor is not accepting your typing must not
 * be hideable by a layout preference. It is also not dismissible — a dismiss
 * would hide the explanation while the read-only posture stood, which is the
 * silence the whole surface exists to end. It needs no dismiss: it disappears
 * on its own.
 *
 * KEYSTROKE SANCTITY: state arrives ONLY through `useSyncExternalStore` over
 * `cowork-pen.ts`'s frozen per-doc snapshot, published by the 5 s poll. No
 * editor subscription, no timer of its own, no per-keystroke work.
 */

import { memo, useSyncExternalStore } from "react";
import {
  getCoworkPen,
  subscribeCoworkPen,
  type CoworkPenState,
} from "@/lib/cowork-pen";
import { deriveDocumentInterruption, interruptionPillLabel } from "@/lib/document-interruption";
import { deriveSaveState } from "@/lib/save-state";

/** The clean external snapshot: this pill is about the PEN alone, and the
 *  vocabulary's cowork branch reads nothing else. */
const NO_EXTERNAL = Object.freeze({
  changes: Object.freeze([]),
  severity: null,
  detectedAt: null,
  paused: false,
});

/** A 16px stroke-only quill/pen glyph — the pen, literally. */
function PenIcon() {
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
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

export function useCoworkPen(docId: string | null | undefined): CoworkPenState | null {
  return useSyncExternalStore(
    subscribeCoworkPen,
    () => getCoworkPen(docId),
    () => null,
  );
}

function CoworkPenBadge({ docId }: { docId: string | null }) {
  const pen = useCoworkPen(docId);
  // Self-gating: nothing holds the pen, nothing to say.
  if (!pen) return null;
  // TASK 545 — the words are the vocabulary's (`document-interruption.ts`),
  // so this pill and the in-document band name one event with one phrase.
  const view = deriveDocumentInterruption({
    docId,
    pen,
    penLastReleasedAt: null,
    external: NO_EXTERNAL,
    preservation: null,
    save: deriveSaveState(null),
  });
  const label = view ? interruptionPillLabel(view, null) : "Virgil is editing this paper…";
  const hint = view?.body ?? "";

  return (
    <div
      className="relative inline-flex items-center"
      data-cowork-pen={pen.source}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[280px]"
        style={{
          background: "var(--amber-100)",
          borderColor: "var(--amber-500)",
          color: "var(--ink-strong)",
        }}
        data-hint={hint}
        role="status"
        aria-label="Virgil is editing this paper — the text is read-only and saving is paused"
      >
        <span
          aria-hidden
          style={{ color: "var(--amber-500)", display: "inline-flex" }}
          className="cowork-pen-pulse"
        >
          <PenIcon />
        </span>
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

export default memo(CoworkPenBadge);
