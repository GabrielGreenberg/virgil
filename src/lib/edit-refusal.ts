/**
 * Task 1436 — ONE voice for "your edit was refused AFTER you acted".
 *
 * A gesture refused at gesture time (the doc is read-only, the pen is held)
 * shows nothing to act on and stays silent — the chrome is hidden or the
 * control is inert, and that is pinned (`figure-write-gate.test.tsx`). But a
 * gesture refused AFTER the user has acted — picked a file in the OS dialog,
 * answered "Delete figure?" or "Update references?", saved a popover — is a
 * real loss the user cannot see: they did something and nothing happened.
 * Every such branch announces through `announceEditRefused`, with copy built
 * by `editRefusalNotice`, so the wording and the rendering are stated once.
 *
 * Task 1314 built this for the atom popovers inside `EditorLayout`; it lives
 * here now so a NodeView, a pure door (`requestFigureDelete`,
 * `renameLabelWithRefs`) and the popover save all reach the same voice
 * without each threading a dialog callback through its props.
 *
 * The voice is APP-wide, not per-document: one `SystemDialogProvider` (the
 * page root) registers it, and a departing registrant removes only its own
 * entry. With no voice registered (a test harness, a surface outside the
 * provider) the notice falls back to one console line — never silence.
 */

/** Why the edit did not land. */
export type EditRefusalReason =
  /** The target was changed or removed while the user was deciding. */
  | "changed"
  /** The document stopped accepting edits (read-only host, pen taken). */
  | "read-only"
  /** The write itself failed (an import error, no writable folder). */
  | "failed";

export interface EditRefusalNotice {
  title: string;
  message: string;
  /** What the user typed or picked, handed back so it is not lost. */
  draft?: string;
}

/**
 * Build the notice. `what` names the target in a sentence ("figure",
 * "label", "image"); `during` names what the user was doing while the
 * document moved ("you were choosing a file"); `detail` is the failure's own
 * words for `failed`.
 */
export function editRefusalNotice(args: {
  title: string;
  what: string;
  reason: EditRefusalReason;
  during?: string;
  detail?: string;
  draft?: string;
}): EditRefusalNotice {
  const during = args.during ?? "the editor was open";
  let message: string;
  switch (args.reason) {
    case "changed":
      message = `The ${args.what} was changed or removed while ${during}, so nothing was applied.`;
      break;
    case "read-only":
      message =
        `The document stopped accepting edits while ${during} — it is read-only, ` +
        "or an assistant is writing to it — so nothing was applied. Try again in a moment.";
      break;
    case "failed":
      message = args.detail
        ? `The ${args.what} could not be updated: ${args.detail}`
        : `The ${args.what} could not be updated.`;
      break;
  }
  return args.draft ? { title: args.title, message, draft: args.draft } : { title: args.title, message };
}

/** A thrown value's own words for a `failed` notice's detail. */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return typeof err === "string" && err ? err : "an unexpected error";
}

type EditRefusalVoice = (notice: EditRefusalNotice) => void;

let voice: EditRefusalVoice | null = null;

/** Register the app's voice; returns the unregister, which removes only THIS
 *  registrant (a later one that replaced it is left alone). */
export function registerEditRefusalVoice(next: EditRefusalVoice): () => void {
  voice = next;
  return () => {
    if (voice === next) voice = null;
  };
}

/** Say that an edit the user made was refused. Exactly one announcement per
 *  call: the registered voice, else one console line. */
export function announceEditRefused(notice: EditRefusalNotice): void {
  if (voice) {
    voice(notice);
    return;
  }
  console.warn(
    `[edit refused] ${notice.title}: ${notice.message}` +
      (notice.draft ? ` (your input: ${notice.draft})` : ""),
  );
}
