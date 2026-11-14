/**
 * The ONE cross-window handoff door (task 596).
 *
 * Opening a paper that a peer window owns is a four-step conversation —
 * claim, ask the user, ask the peer to release, claim again — and it was
 * written out twice in `useFiles` (the Recents path and the picker path),
 * with each copy independently deciding what to do when a step fails. Both
 * copies dropped the SECOND claim's failure on the floor: the user confirmed
 * "Move it here", and nothing happened, with no error anywhere. That failure
 * is the near-deterministic outcome of the release-ordering bug this task
 * fixes, so the two belong in one commit — but a silent return is wrong even
 * once the race is gone (a third window can still win the doc in between).
 *
 * The dialog is injected as a narrow structural interface, not imported from
 * the React host, so this door is a plain module a test can drive.
 */

import {
  claimDoc,
  requestHandoff,
  withDocIfUnclaimed,
} from "./doc-ownership";

/** The slice of `SystemDialogApi` a handoff needs. */
export interface HandoffDialog {
  confirm(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: "default" | "danger";
  }): Promise<boolean>;
  alert(opts: {
    title: string;
    message: string;
    tone?: "default" | "danger";
  }): Promise<void>;
}

/** Enough of a doc's identity to claim it and name it to the user. */
export interface HandoffTarget {
  id: string;
  name?: string;
  folderName?: string;
}

function labelFor(target: HandoffTarget): string {
  return target.name || target.folderName || "this document";
}

/**
 * Acquire the cross-window lock for `target`, prompting for a handoff if a
 * peer window owns it. Resolves true iff this window owns the doc afterward.
 *
 * Every false arm the user could mistake for success is announced: only a
 * declined confirm returns quietly, because declining IS the answer.
 */
export async function claimDocWithHandoff(
  target: HandoffTarget,
  dialog: HandoffDialog,
): Promise<boolean> {
  // Always claim, even when this window already holds the doc: a claim of
  // a held doc is free, and a claim of a doc whose close is still draining
  // is what CANCELS that release (task 1454). `ownsDoc` here would skip it.
  let result = await claimDoc(target.id);
  if (result.owned) return true;

  const ok = await dialog.confirm({
    title: "Document is open elsewhere",
    message: `${labelFor(target)} is open in another Virgil window. Move it here?`,
    confirmLabel: "Move it here",
    cancelLabel: "Keep it there",
  });
  if (!ok) return false;

  const released = await requestHandoff(target.id);
  if (!released) {
    await dialog.alert({
      title: "Couldn't move the document",
      message:
        "The other window didn't release the document in time. Try again, or close it there first.",
      tone: "danger",
    });
    return false;
  }

  result = await claimDoc(target.id);
  if (!result.owned) {
    await dialog.alert({
      title: "Couldn't move the document",
      message:
        "The other window released the document, but it couldn't be claimed here. Another window may have taken it first — try again.",
      tone: "danger",
    });
    return false;
  }
  return true;
}

/**
 * Task 1616 — the door's SECOND refusal: retiring a doc id deletes its
 * emergency mirror and unanswered recovery offers, the only copy of work
 * that never reached its folder, which by doctrine ends only by the user's
 * ANSWER (task 851). A FORGET passes this probe and the door asks — a
 * `danger` confirm (Cancel cued) naming what is lost and how to keep it.
 * Nothing unlanded → no question: forget stays one click. A gesture that
 * already confirmed a destruction naming the loss (reset example) omits it.
 */
export interface RetireUnlandedGuard {
  hasUnlandedWork: (docId: string) => Promise<boolean>;
}

/** The confirm a forget of a doc holding unlanded work must win. */
export function unlandedWorkConfirm(target: HandoffTarget) {
  return {
    title: "Delete unsaved changes?",
    message:
      `${labelFor(target)} has unsaved changes that never reached its folder, ` +
      "which Virgil kept for this paper. Removing it from Recents deletes them. " +
      "To keep them, Cancel and open the paper — use Locate folder… if Virgil " +
      "can't find its folder.",
    confirmLabel: "Remove and delete changes",
    cancelLabel: "Cancel",
    tone: "danger" as const,
  };
}

/**
 * The ONE door for retiring a doc's identity from this window — forgetting
 * it from Recents / the unreachable-paper gate, resetting the example
 * (task 1105). `retire` deletes the doc's folder handle, emergency mirror
 * and local sidecars (`purgeDoc`); run while ANOTHER live window has the
 * paper open, that pulls the floor out from under its editor: its next
 * save finds no folder and its crash net is gone. So a peer-held doc is
 * REFUSED, and the refusal is told to the user — the gesture did nothing,
 * and they must know why. Resolves true iff `retire` ran.
 *
 * Refuse rather than hand off: a handoff would close the paper in the
 * other window only to delete it here, which is never what "forget" or
 * "reset" in one window asked for.
 *
 * With an `unlanded` guard (task 1616) it also refuses to delete this
 * window's own unlanded work without the user's answer — a declined
 * confirm resolves false quietly, because declining IS the answer.
 */
export async function retireDocUnlessOpenElsewhere(
  target: HandoffTarget,
  dialog: HandoffDialog,
  retire: () => Promise<void>,
  unlanded?: RetireUnlandedGuard,
): Promise<boolean> {
  // Asked UNDER the doc's lock, so nothing can arm a mirror between the
  // probe and the purge; a peer-held doc is refused before anything is asked.
  const result = await withDocIfUnclaimed(target.id, async () => {
    if (unlanded && (await unlanded.hasUnlandedWork(target.id))) {
      if (!(await dialog.confirm(unlandedWorkConfirm(target)))) return false;
    }
    await retire();
    return true;
  });
  if (result.ran) return result.value;
  await dialog.alert({
    title: "Document is open in another window",
    message: `${labelFor(target)} is open in another Virgil window. Close it there first, then try again.`,
  });
  return false;
}
