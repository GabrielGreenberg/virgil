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

import { claimDoc, ownsDoc, requestHandoff } from "./doc-ownership";

/** The slice of `SystemDialogApi` a handoff needs. */
export interface HandoffDialog {
  confirm(opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
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
  if (ownsDoc(target.id)) return true;
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
