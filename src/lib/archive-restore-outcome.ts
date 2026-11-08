/**
 * What an Archive RESTORE did — or why it didn't (task 1525).
 *
 * `useArchive.restoreSnippet` used to answer a bare boolean for five different
 * refusals, and `EditorPane.handleArchiveRestore` re-derived the cause from the
 * snippet's origin and return address read BEFORE the call. The guess misnamed
 * two of them: a card its panel's migrator rejected was reported as "a card
 * with the same id is already there", and a repeat press after a SUCCESSFUL
 * restore (the snippet already retired, or already removed) told the user the
 * restore had failed and "Nothing was removed from the Archive". Task 968's
 * rule for greyed commands applies here too: the reason is decided where the
 * verdict is. So the refusing code returns its cause as a VALUE, and ONE table
 * (`restoreRefusalMessage`) turns that value into words — the caller branches
 * on nothing.
 *
 * The pen gate (`archive-restore-gate.ts`) runs BEFORE either route and keeps
 * its own message; it is not a cause this module names.
 *
 * [cost: O(1) — a discriminated union and a switch.]
 */
import { ARCHIVE_ORIGIN_PANEL_LABEL, type ArchiveOriginPanel } from "./archive-origin";

/** What a panel's archive-origin `reinstate` door did (`reinstateCard`). */
export type ReinstateOutcome =
  /** The card is back in its panel. */
  | "ok"
  /** The panel's own load migrator refused the record (or it had no id). */
  | "rejected"
  /** The panel already holds a card with that id. */
  | "duplicate";

export type RestoreRefusal =
  /** No snippet with that id — already reinstated (a card snippet is removed
   *  on success) or deleted. Nothing is wrong. */
  | { cause: "gone" }
  /** The excerpt is already retired — it already landed. Nothing is wrong. */
  | { cause: "already-restored" }
  /** The snippet's origin record is present but unreadable. */
  | { cause: "unreadable-origin" }
  /** The card's panel refused the record, or the host wired no reinstate door. */
  | { cause: "card-rejected"; panel: ArchiveOriginPanel }
  /** The card's panel already holds that id. */
  | { cause: "card-duplicate"; panel: ArchiveOriginPanel }
  /** The excerpt's landing refused (schema, caret container, no editor). */
  | { cause: "land-refused" };

export type RestoreOutcome =
  | { ok: true; route: "card" | "excerpt" }
  | ({ ok: false } & RestoreRefusal);

/** Context the landing refusal's wording needs: whether the excerpt had a
 *  return address (task 965) — if it did, moving the caret would not help. */
export interface RestoreRefusalContext {
  addressed: boolean;
}

const NOTHING_REMOVED = "Nothing was removed from the Archive.";

/** The ONE cause → words table. `null` means stay silent: the restore already
 *  happened, so a toast would report a failure that did not occur. */
export function restoreRefusalMessage(
  refusal: RestoreRefusal,
  ctx: RestoreRefusalContext,
): string | null {
  switch (refusal.cause) {
    case "gone":
    case "already-restored":
      return null;
    case "unreadable-origin":
      return `Couldn't restore this card: its record of where it came from is unreadable. ${NOTHING_REMOVED}`;
    case "card-duplicate":
      return (
        `Couldn't put this card back in ${ARCHIVE_ORIGIN_PANEL_LABEL[refusal.panel]} — ` +
        `a card with the same id is already there. ${NOTHING_REMOVED}`
      );
    case "card-rejected":
      return (
        `Couldn't put this card back in ${ARCHIVE_ORIGIN_PANEL_LABEL[refusal.panel]} — ` +
        `its saved record isn't one that panel can read. ${NOTHING_REMOVED}`
      );
    case "land-refused":
      // With a return address the body itself didn't fit (a read-only surface
      // was refused earlier, by name) — moving the caret would not help, so
      // don't tell the user to. Without one, the overwhelmingly common refusal
      // is the caret sitting somewhere a block insert would tear. The card body
      // is the ONLY copy of this prose, so a silent no-op would read as "the
      // button is broken".
      return ctx.addressed
        ? `Couldn't put this back where it came from. ${NOTHING_REMOVED}`
        : "Couldn't put this back. Click in an ordinary paragraph where the " +
            "text should go, then try again — it can't be dropped inside a " +
            `heading, list, or example. ${NOTHING_REMOVED}`;
  }
}
