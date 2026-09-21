/**
 * **The document-interruption VOCABULARY** — task 545.
 *
 * Gabriel: *"Right now it just suddenly says 'changed on disk', and it's not
 * clear if you should save, reload, close — or what? We need a much more
 * guided, non-technical experience for users here."*
 *
 * Virgil already has one CHANNEL per thing that can stop or pause writing —
 * the cowork pen (`cowork-pen.ts`), the external-change store on the
 * `DiskWatcher`, the preservation refusal (`preservation-notice.ts`), and the
 * save-state ladder (`save-state.ts`) — and every DOOR out of those states is
 * built, netted and censused (`conflict-resolution.ts`, the reload path, the
 * acknowledge dialog, `save-request.ts`). What each of them lacked was a
 * PRESENTER: the states spoke in five registers, from five badges, each
 * answering "what happened?" and none answering "so what do I do?".
 *
 * > **One derivation, one voice.** Every surface that tells the user their
 * > document is interrupted reads {@link deriveDocumentInterruption}: WHAT
 * > happened (in plain words, naming the writer where the app can), what
 * > Virgil is DOING about it, ONE recommended action phrased as an OUTCOME,
 * > and the alternatives behind it. The doors themselves are untouched — this
 * > module decides only which door to point at and what to call it. A second
 * > place that composes these sentences is how the five registers came about.
 *
 * ## Writer attribution
 *
 * Task 489's stated residual: the AI holds the pen for the COMMIT only, so
 * after release "the standing conflict is still there to say" — and it said
 * "another app or a sync service", which is untrue and alarming. The pen
 * record's release trace (task 496 rewrote the record as `holder: null,
 * released_at`) is what lets {@link attributeExternalWriter} say "Virgil's AI"
 * instead; this module BRANCHES THE COPY on that answer and leaves the doors
 * alone, exactly as the task's design section asks.
 *
 * ## Which action is recommended, and why it is only a recommendation
 *
 * "The answer is always my copy" is a REPORT about past incidents, not a
 * standing order to overwrite external edits, so nothing here auto-resolves.
 * The recommendation follows what each door COSTS:
 *
 * - a change with NO unsaved edits costs nothing to load, so loading it is
 *   recommended (and for an AI writer it is what the user asked the skill for);
 * - a conflict with an UNKNOWN writer recommends keeping the user's version
 *   (the disk side is archived first, so nothing is lost either way);
 * - a conflict with the AI as writer recommends the AI's edits while the
 *   unsaved work is YOUNG (under the save ladder's warn threshold — a few
 *   keystrokes the debounce had not landed yet) and the user's own version
 *   once it is old enough to be real writing.
 *
 * Pure and React-free: every input is a store snapshot, so the words that
 * reach the user are testable as render facts with no DOM.
 */

import type { ExternalChangeState } from "./disk-watcher";
import {
  attributeExternalWriter,
  type CoworkPenState,
  type ExternalWriter,
} from "./cowork-pen";
import type { PreservationNotice } from "./preservation-notice";
import type { SidecarRefusal } from "./sidecar-refusal";
import {
  describeAge,
  UNSAVED_WARN_MS,
  type SaveStateView,
} from "./save-state";
import type { UnsavedBlockReason } from "./unsaved-work";
import type { ConflictOutcome } from "./conflict-resolution";
import {
  toneForInterruptionKind,
  type InterruptionKind,
  type InterruptionTone,
} from "./interruption-tone";

/**
 * The KINDS and their TONE live one leaf down (`interruption-tone.ts`, task
 * 571) — import-free, so `save-state.ts`, which sits BELOW this module in the
 * import graph, can read the same table for the save badge instead of
 * re-deriving the register from its tier. Re-exported here so every existing
 * importer of the vocabulary keeps its one import.
 */
export type { InterruptionKind, InterruptionTone } from "./interruption-tone";

/** What a door DOES, named by its outcome rather than its mechanism. */
export type InterruptionActionId =
  | "keep-mine"
  | "take-disk"
  | "reload"
  | "dismiss"
  | "review"
  | "retry"
  /** "Understood" — the one honest offer for a state whose cause is already
   *  past and whose retry is the user redoing the edit (task 630). */
  | "acknowledge";

export interface InterruptionAction {
  id: InterruptionActionId;
  /** The button's words — an OUTCOME ("Keep my version"), never a mechanism
   *  ("Acknowledge"). */
  label: string;
  /** One sentence: what happens, and what is kept. */
  detail: string;
  /** For `review`: the blocking REASON whose owning surface opens, through
   *  task 392's routing channel (`requestBlockingFlow`) — so which dialog a
   *  reason leads to is decided in `describeBlockReason` and nowhere here. */
  reason?: UnsavedBlockReason;
}

export interface DocumentInterruption {
  kind: InterruptionKind;
  tone: InterruptionTone;
  /** Who changed the file, for the two external-change kinds; `unknown`
   *  elsewhere. Surfaced so a probe can read the verdict off the view. */
  writer: ExternalWriter;
  /** What happened — one line, plain words, naming the writer where known. */
  title: string;
  /** What Virgil is doing about it, and what is (and is not) at risk. */
  body: string;
  /** The ONE thing to do, or `null` when the honest answer is to wait. */
  recommended: InterruptionAction | null;
  /** Everything else the user may do instead, in the order to offer them. */
  alternatives: InterruptionAction[];
  /** The external change's detection time, when this view is about one. */
  detectedAt: number | null;
}

export interface InterruptionInputs {
  docId: string | null | undefined;
  pen: CoworkPenState | null;
  /** From `getCoworkPenLastRelease(docId)` — the release trace. */
  penLastReleasedAt: number | null;
  external: ExternalChangeState;
  preservation: PreservationNotice | null;
  /** From `getSidecarRefusal(docId)` — a `virgil/` sidecar write that did not
   *  land (task 630). Independent of the `.tex` channels above: the paper's
   *  own bytes can be perfectly saved while an AI request is not. */
  sidecarRefusal: SidecarRefusal | null;
  save: SaveStateView;
  now?: number;
}

/* ── Copy, in one place ─────────────────────────────────────────────── */

const KEEP_MINE: InterruptionAction = {
  id: "keep-mine",
  label: "Keep my version",
  detail:
    "Saves what is in Virgil over the file on disk. The disk version is kept in the paper's history folder.",
};
const TAKE_DISK_UNKNOWN: InterruptionAction = {
  id: "take-disk",
  label: "Use the disk version",
  detail:
    "Loads the file as it is on disk. Your unsaved edits are kept in the paper's history folder.",
};
const TAKE_DISK_AI: InterruptionAction = {
  id: "take-disk",
  label: "Use Virgil's edits",
  detail:
    "Loads the paper with the AI's changes. Your unsaved edits are kept in the paper's history folder.",
};
const RELOAD_UNKNOWN: InterruptionAction = {
  id: "reload",
  label: "Load the new version",
  detail: "Shows the file as it is on disk now. Nothing here is unsaved, so nothing is lost.",
};
const RELOAD_AI: InterruptionAction = {
  id: "reload",
  label: "Load Virgil's edits",
  detail:
    "Shows the paper with the AI's changes. Nothing here is unsaved, so nothing is lost.",
};
const DISMISS_UNKNOWN: InterruptionAction = {
  id: "dismiss",
  label: "Keep what's in Virgil",
  detail: "Ignores the disk change; Virgil's next save writes its own version over it.",
};
const DISMISS_AI: InterruptionAction = {
  id: "dismiss",
  label: "Keep what's in Virgil",
  detail:
    "Ignores the AI's changes; Virgil's next save writes its own version over them.",
};
const RETRY: InterruptionAction = {
  id: "retry",
  label: "Try saving again",
  detail: "Attempts the write again now.",
};
const ACKNOWLEDGE: InterruptionAction = {
  id: "acknowledge",
  label: "OK, got it",
  detail: "Closes this message. Nothing else changes.",
};

/** The one sentence about the net, shared by every conflict door. */
const NET_SENTENCE =
  "Both versions are copied into the paper's history folder before either one is applied, so whichever you choose, the other is not lost.";

/**
 * The preservation refusal's guidance, per SOURCE. Kept beside the other
 * copy rather than in the badge so the band and the pill say one thing.
 */
export function describePreservation(n: PreservationNotice): {
  title: string;
  body: string;
} {
  const region = n.region ?? "body";
  switch (n.source) {
    case "serialize":
      return {
        title: "Virgil can't write this paper back to LaTeX",
        body:
          "Virgil can show this paper but can't save it: the document holds something this version of Virgil cannot write" +
          (n.reason ? ` (${n.reason})` : "") +
          ". Your file on disk is unchanged and Virgil will not touch it. Copy anything you have added out of the editor, then update Virgil and reopen the paper.",
      };
    case "mount":
      return {
        title: "This paper didn't open, so Virgil is not saving it",
        body:
          "Virgil read the file but could not display it" +
          (n.reason ? ` (${n.reason})` : "") +
          ", so the editor opened empty. Your file on disk is unchanged and Virgil will not write to it until you decide. Open the code view to see the source, or update Virgil and reopen the paper.",
      };
    default:
      return {
        title: "Virgil couldn't fully read this paper, so it is not saving it",
        body:
          `About ${n.lost} of ${n.before} words in the ${region} didn't make it into the editor. Your file on disk is unchanged and Virgil will not write to it until you decide. Open the code view to see the source, or fix the file in another editor and reopen it.`,
      };
  }
}

/**
 * The sidecar refusal's words, per REASON (task 630). Beside the other copy
 * rather than in the publishing hook, for the same reason
 * {@link describePreservation} is here: three writers publish to that channel
 * (the AI-request inbox, the card-flag bridge, the bib-review queue) and they
 * must not each compose their own sentence about the same event.
 *
 * `what` is the publisher's noun ("AI request"), because only the writer knows
 * what it was writing; every word around it is decided once, here.
 *
 * `unreadable` (task 679) is the one reason on the READ side, so it is also the
 * one that does not take the shared "couldn't save" title: nothing was lost yet
 * — what the user is looking at is simply less than the file holds, and the
 * words have to say that rather than imply a failed save.
 */
export function describeSidecarRefusal(r: SidecarRefusal): {
  title: string;
  body: string;
} {
  if (r.reason === "unreadable") {
    return {
      title: `Virgil couldn't read this paper's ${r.what}`,
      body:
        `The file holding your ${r.what} could not be read` +
        (r.detail ? ` (${r.detail})` : "") +
        `, so what Virgil is showing you may be less than the file holds — an empty list here does not mean the file is empty. The paper's own text is unaffected, and Virgil has stood down from the automatic changes that would have relied on it. Reopen the paper to try the read again; until then, avoid adding to this list, since saving would replace the file with what is on screen.`,
    };
  }
  const title = `Virgil couldn't save your ${r.what}`;
  switch (r.reason) {
    case "read-only":
      return {
        title,
        body:
          `This paper is open for reading only, so Virgil could not write your ${r.what} into its folder. The paper itself is untouched, and what you just filed has been taken back off the screen because it is not on disk. Open the paper in Virgil's editor to make it there.`,
      };
    case "failed":
      return {
        title,
        body:
          `The write to this paper's folder failed, so your ${r.what} was not saved` +
          (r.detail ? ` (${r.detail})` : "") +
          `. The paper's own text is unaffected. Check that Virgil still has access to the folder, then make it again.`,
      };
    default:
      return {
        title,
        body:
          `Virgil does not have write access to this paper's folder right now, so your ${r.what} was not saved. The paper's own text is unaffected. Reopen the paper, then make it again.`,
      };
  }
}

/* ── The derivation ─────────────────────────────────────────────────── */

/**
 * The one view. `null` when nothing interrupts this document — the common
 * case, and the one every surface renders as NOTHING.
 */
export function deriveDocumentInterruption(
  input: InterruptionInputs,
): DocumentInterruption | null {
  const { docId, pen, penLastReleasedAt, external, preservation, sidecarRefusal, save } =
    input;
  if (!docId) return null;
  const now = input.now ?? Date.now();

  // 1. The pen — something happening RIGHT NOW outranks every standing fact,
  //    because it is the one state the user can do nothing about but wait.
  if (pen !== null && now < pen.expiresAt) {
    return {
      kind: "cowork-hold",
      tone: toneForInterruptionKind("cowork-hold"),
      writer: "virgil-ai",
      title: "Virgil is editing this paper",
      body:
        "Virgil's AI is writing its changes into this paper right now. Your text is read-only and saving is paused until it finishes — usually a few seconds. Nothing is lost; you can keep reading.",
      recommended: null,
      alternatives: [],
      detectedAt: null,
    };
  }

  // 2. A standing refusal: the user's work is on no disk and nothing is
  //    coming to put it there. Danger, and the way out is a decision only
  //    the user can make (the acknowledge dialog the badge owns).
  if (preservation && !preservation.acknowledged) {
    const { title, body } = describePreservation(preservation);
    const review: InterruptionAction = {
      id: "review",
      label: "See what I can do…",
      detail: "Opens the options for this paper.",
      reason: "preservation",
    };
    return {
      kind: "preservation",
      tone: toneForInterruptionKind("preservation"),
      writer: "unknown",
      title,
      body,
      recommended: preservation.source === "serialize" ? null : review,
      alternatives: [],
      detectedAt: null,
    };
  }

  // 3./5. The file changed on disk. Who wrote it decides the words; whether
  //       the user has unsaved edits decides the tier.
  if (external.severity !== null && !external.paused) {
    const writer = attributeExternalWriter({
      detectedAt: external.detectedAt,
      pen,
      lastReleasedAt: penLastReleasedAt,
      now,
    });
    const ai = writer === "virgil-ai";
    const removed = external.changes.some((c) => c.kind === "removed");
    if (external.severity === "conflict") {
      const age = describeAge(save.ageMs);
      const young = save.ageMs < UNSAVED_WARN_MS;
      if (ai) {
        return {
          kind: "conflict",
          tone: toneForInterruptionKind("conflict"),
          writer,
          title: "Virgil's AI edited this paper while you had unsaved changes",
          body:
            `Virgil's AI finished writing its changes to the file, but you have ${age} of edits here that it didn't see. Saving is paused so that neither version overwrites the other. ` +
            NET_SENTENCE,
          recommended: young ? TAKE_DISK_AI : KEEP_MINE,
          alternatives: young ? [KEEP_MINE] : [TAKE_DISK_AI],
          detectedAt: external.detectedAt,
        };
      }
      return {
        kind: "conflict",
        tone: toneForInterruptionKind("conflict"),
        writer,
        title: removed
          ? "This paper's file was removed from disk while you were editing"
          : "This paper was changed outside Virgil while you were editing",
        body:
          `Another app or a sync service — Dropbox, Overleaf, a text editor — ${
            removed ? "removed" : "changed"
          } the file on disk, and you have ${age} of unsaved edits here. Saving is paused so that neither version overwrites the other. ` +
          NET_SENTENCE,
        recommended: KEEP_MINE,
        alternatives: [TAKE_DISK_UNKNOWN],
        detectedAt: external.detectedAt,
      };
    }
    // severity === "change": nothing unsaved, nothing at risk.
    if (ai) {
      return {
        kind: "disk-change",
        tone: toneForInterruptionKind("disk-change"),
        writer,
        title: "Virgil's AI finished editing this paper",
        body:
          "Virgil's AI wrote its changes to the file. You have no unsaved edits here, so loading them loses nothing.",
        recommended: RELOAD_AI,
        alternatives: [DISMISS_AI],
        detectedAt: external.detectedAt,
      };
    }
    return {
      kind: "disk-change",
      tone: toneForInterruptionKind("disk-change"),
      writer,
      title: removed
        ? "This paper's file was removed from disk"
        : "This paper was changed outside Virgil",
      body:
        `Another app or a sync service ${
          removed ? "removed" : "changed"
        } the file on disk. You have no unsaved edits here, so nothing is at risk.`,
      recommended: removed ? DISMISS_UNKNOWN : RELOAD_UNKNOWN,
      alternatives: removed ? [] : [DISMISS_UNKNOWN],
      detectedAt: external.detectedAt,
    };
  }

  // 4. The write itself failed.
  if (save.tier === "blocked" && save.reason === "error") {
    return {
      kind: "save-error",
      tone: toneForInterruptionKind("save-error"),
      writer: "unknown",
      title: "Virgil couldn't save this paper",
      body:
        `The last write to this paper's folder failed, and ${describeAge(save.ageMs)} of edits are waiting. Check that Virgil still has access to the folder, then try again. Your work is safe in Virgil meanwhile, and an emergency copy is kept in this browser.`,
      recommended: RETRY,
      alternatives: [],
      detectedAt: null,
    };
  }

  // 6. A sidecar write did not land (task 630). LAST, and deliberately so: the
  //    four states above are all about the `.tex`, which is the user's only
  //    copy, and each of them asks the user to DO something about a document
  //    that is still at risk. This one is about apparatus around the document
  //    (an AI request, a bib review, a card flag), the loss has already
  //    happened, and the only offer is "understood" — so it must not stand in
  //    front of a state the user can still act on.
  if (sidecarRefusal) {
    const { title, body } = describeSidecarRefusal(sidecarRefusal);
    return {
      kind: "sidecar-refused",
      tone: toneForInterruptionKind("sidecar-refused"),
      writer: "unknown",
      title,
      body,
      recommended: ACKNOWLEDGE,
      alternatives: [],
      detectedAt: null,
    };
  }

  return null;
}

/**
 * What to tell the user AFTER a conflict door ran, when anything went wrong.
 * `null` when everything went through as asked — the ordinary case, which
 * needs no dialog. Shared by the pill and the band so the two report one
 * outcome in one voice; the tone follows STYLE_GUIDE (danger only where
 * content is now gone with no net).
 */
export function conflictOutcomeNotice(
  outcome: ConflictOutcome,
): { title: string; message: string; tone: "danger" | "default" } | null {
  if (!outcome.applied) {
    return {
      title: "Couldn't resolve the conflict",
      message:
        "Your edits are still in the editor and the file on disk is unchanged. Try again, or reopen the paper.",
      tone: "default",
    };
  }
  if (!outcome.archive) {
    return {
      title:
        outcome.choice === "keep-mine"
          ? "Saved your version — no history copy"
          : "Loaded the disk version — no history copy",
      message:
        "Virgil could not write a copy of the other version into the paper's history folder, so that version is gone. Everything else went through as asked.",
      tone: "danger",
    };
  }
  return null;
}

/** The compact one-line label a topbar pill shows for a view — derived, so
 *  the pill and the band name one event with one phrase. */
export function interruptionPillLabel(v: DocumentInterruption, unsavedAge: string | null): string {
  switch (v.kind) {
    case "cowork-hold":
      return "Virgil is editing this paper…";
    case "conflict":
      return (
        (v.writer === "virgil-ai" ? "Virgil's AI edited this paper" : "Changed on disk") +
        " · unsaved edits" +
        (unsavedAge ? ` · ${unsavedAge} unsaved` : "")
      );
    case "disk-change":
      return v.writer === "virgil-ai" ? "Virgil's AI edited this paper" : "Changed on disk";
    case "preservation":
      return "Not saving";
    case "save-error":
      return "Not saving — the last save failed";
    case "sidecar-refused":
      return "Something you filed didn't save";
  }
}
