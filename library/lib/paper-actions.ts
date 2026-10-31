/**
 * The Library's per-paper action vocabulary that ISN'T a queued AI request
 * (those are declared in `paper-ai-requests.ts`): the open-in-tab hint and the
 * clipboard copy. Both the catalog row (`LeftListRow`) and the paper header
 * (`PaperHeader`) offer these actions; before task 1382 each spelled its own
 * label and its own failure handling — the row's failed copy was silent, the
 * header's dropped the reason.
 */

/** The hint on every "open this paper in a new Virgil tab" control. */
export const OPEN_IN_TAB_HINT = "Open in a new Virgil tab";

export type CopyOutcome = { ok: true } | { ok: false; reason: string };

/** Write `text` to the clipboard, reporting failure WITH its reason rather
 *  than throwing — `navigator.clipboard` is absent outside a secure context,
 *  and `writeText` rejects without document focus or permission. */
export async function copyText(text: string): Promise<CopyOutcome> {
  const clipboard =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) {
    return { ok: false, reason: "clipboard unavailable" };
  }
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch (e) {
    const reason = e instanceof Error && e.message ? e.message : String(e);
    return { ok: false, reason };
  }
}

/** The one spelling of a copy's outcome for a status flash / hint. */
export function copyOutcomeMessage(
  outcome: CopyOutcome,
  okMessage: string,
): string {
  return outcome.ok ? okMessage : `copy failed: ${outcome.reason}`;
}
