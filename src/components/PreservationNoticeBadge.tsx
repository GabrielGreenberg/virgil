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

import { memo, useCallback } from "react";
import { usePreservationNotice } from "@/hooks/usePreservationNotice";
import { useBlockingFlowRequest } from "@/hooks/useSaveState";
import { requestBlockingFlow, requestSaveNow } from "@/lib/save-request";
import { toneForInterruptionKind } from "@/lib/interruption-tone";
import { useConfirmDialog } from "./ConfirmDialog";
import {
  BarStatusMenuDetail,
  BarStatusMenuRow,
  BarStatusPill,
  useBarStatusMenu,
} from "./status/BarStatusPill";

/** The refusal's register — `danger`, from the one kind → tone table
 *  (`interruption-tone.ts`, task 571): the user's work is on no disk and
 *  nothing is coming to put it there. */
const TONE = toneForInterruptionKind("preservation");

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

function PreservationNoticeBadge({ docId }: { docId: string | null }) {
  const notice = usePreservationNotice(docId);
  const { confirm, dialog } = useConfirmDialog();

  const menuCtl = useBarStatusMenu();
  const { closeMenu, openMenu } = menuCtl;

  // TASK 392 — "Save now" on a document a preservation gate is refusing routes
  // here: the way out is the informed acknowledgement this menu offers, and a
  // Save button is not entitled to make that call on the user's behalf.
  useBlockingFlowRequest(docId, "preservation", openMenu);

  const lost = notice?.lost ?? 0;
  const region = notice?.region ?? "body";
  // A MOUNT refusal (task 357 hole 3) is a different KIND of fact from a word
  // shortfall: the editor could not hold the parsed document at all and opened
  // blank, so there is no partial figure to quote — and where this process
  // never loaded the file through `readDocBundle` there is no baseline either,
  // which is exactly why the sentence must not be assembled out of the numbers.
  const isMount = notice?.source === "mount";
  // A SERIALIZE refusal (task 357) is the one source with NOTHING to save: the
  // serializer could not produce bytes at all, so there is no shorter document
  // for the user to knowingly accept. The "Save anyway" row is withheld rather
  // than offered-and-refused one gesture later — an affordance must not promise
  // what the commit cannot do.
  const isSerialize = notice?.source === "serialize";

  const handleSaveAnyway = useCallback(async () => {
    closeMenu();
    if (!docId) return;
    const ok = await confirm({
      title: "Save anyway?",
      message: isMount
        ? `Virgil could not open this document at all — the editor you see is ` +
          `EMPTY, and saving will write that empty document over the file on ` +
          `disk. A copy of the current file is in the paper's virgil/.history/ ` +
          `folder.`
        : `Virgil could not represent about ${lost} words of this document's ${region} — ` +
          `saving will write the version you see in the editor over the file on disk, ` +
          `and those words will be gone from it. A copy of the current file is in the ` +
          `paper's virgil/.history/ folder.`,
      confirmLabel: "Save anyway — I understand",
      tone: "danger",
    });
    if (!ok) return;
    // TASK 567 — "Save anyway" IS a save. The confirm above promised that
    // saving will write the version in the editor over the file, so the
    // gesture asks the manual-save door for exactly that write, carrying the
    // acknowledgment as a CLAIM the write-side gate steps aside for. The
    // acknowledgment is RECORDED on the landed receipt inside `useDocument`'s
    // `save` — never here. Pre-567 this line flipped the notice flag and
    // requested no write: the refusal had already disarmed the debounce, so
    // the file stayed stale until the next keystroke, the pill vanished, and
    // the save badge went on saying "Not saving … Review…" over a document
    // whose next Save would silently overwrite the file — a door labelled
    // "review" with the effect "overwrite", one gesture after a dialog that
    // said the overwrite had happened.
    //
    // A write that cannot land ROUTES (the 392 rule): a conflict pause hands
    // the user to the conflict flow, which must be answered first; the notice
    // stays standing until a write with this claim actually lands.
    const outcome = await requestSaveNow(docId, { acknowledgePreservation: true });
    if (outcome.landed || outcome.reason === "no-door") return;
    requestBlockingFlow(docId, outcome.reason);
  }, [closeMenu, confirm, docId, lost, region, isMount]);

  // ── render gate ────────────────────────────────────────────────────
  // No doc, no refusal, or the user has already answered → nothing to say.
  if (!notice || notice.acknowledged) return null;

  const detail = isSerialize
    ? `Virgil read this file and can display it, but cannot write it back to ` +
      `LaTeX: the document holds something this version of the editor cannot ` +
      `express${notice.reason ? ` (${notice.reason})` : ""}. Your file on disk ` +
      `has NOT been changed, and Virgil will not write to it. Copy anything you ` +
      `have added out of the editor, then update Virgil and reopen the paper.`
    : isMount
    ? `Virgil read this file but could not display it: the parsed document uses ` +
      `something this version of the editor doesn't know${
        notice.reason ? ` (${notice.reason})` : ""
      }, so the editor opened EMPTY. Your file on disk has NOT been changed, and ` +
      `Virgil will not write to it. Open the code view to see the source, or ` +
      `update Virgil and reopen the paper.`
    : `Virgil read this file but could not represent all of it: about ${lost} of ` +
      `${notice.before} content words in the ${region} are missing from the editor's ` +
      `version. Your file on disk has NOT been changed, and Virgil will not write to ` +
      `it. Open the code view to see the source, or fix the file in another editor ` +
      `and reopen it.`;

  return (
    <BarStatusPill
      tone={TONE}
      glyph={<ShieldIcon />}
      label={
        isSerialize
          ? "Not saving — Virgil can't write this document"
          : isMount
            ? "Not saving — this file didn't open"
            : "Not saving — this file didn't fully load"
      }
      ariaLabel="Not saving — Virgil could not fully read this file"
      hint="Virgil could not fully read this file — it is not saving"
      data={{ "data-preservation-notice": notice.source }}
      menu={{
        controller: menuCtl,
        id: "preservation-notice-menu",
        ariaLabel: "Preservation notice actions",
        kebabLabel: "Preservation notice options",
        children: (
          <>
            {isSerialize ? null : (
              <BarStatusMenuRow
                id="save-anyway"
                label={
                  isMount
                    ? "Save anyway — writes an EMPTY document"
                    : "Save anyway — drops the missing text"
                }
                detail="Writes the editor's version over the file on disk. A copy of the current file is kept in virgil/.history/."
                danger
                run={() => void handleSaveAnyway()}
              />
            )}
            <BarStatusMenuDetail>{detail}</BarStatusMenuDetail>
          </>
        ),
      }}
    >
      {dialog}
    </BarStatusPill>
  );
}

export default memo(PreservationNoticeBadge);
