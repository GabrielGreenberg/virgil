/**
 * Archive ORIGIN — "where did this archived snippet come from?" (task 712).
 *
 * The Archive panel holds two different things under one kind:
 *
 *  - an EXCERPT — a slice of the document the user cut out of the prose. Its
 *    body is the only copy of that text, and restoring it hands the slice back
 *    to the document at the caret (`useArchive.restoreSnippet`'s landing path).
 *  - a whole CARD set aside by `/editor/archive-card`
 *    (`editor/scripts/apply_response.py` `cmd_archive`). It carries an origin
 *    record — `originalPanel` + the verbatim `originalCard` + `archivedAt` — and
 *    restoring it puts that card back in its panel, exactly as the agent's
 *    `cmd_restore` does. Its body is a margin note's words, never paper text;
 *    landing it in the prose would put a note INTO the essay and lose the note.
 *
 * `archiveOriginOf` is the ONE reader of that distinction; every restore door
 * and every restore label asks it rather than sniffing fields.
 *
 * The panel vocabulary mirrors `_ANCHORED_PANEL_CARDS` in apply_response.py —
 * the only panels `cmd_archive` admits (atom-bearing footnotes/citations are
 * refused there, since archiving them would orphan their `.tex` marker).
 */
import type { ArchivedSnippet } from "./types";

export const ARCHIVE_ORIGIN_PANELS = [
  "notes",
  "todos",
  "cutter",
  "revisions",
  "reports",
] as const;

export type ArchiveOriginPanel = (typeof ARCHIVE_ORIGIN_PANELS)[number];

/** The panel name a user reads ("Restore to Notes"). */
export const ARCHIVE_ORIGIN_PANEL_LABEL: Record<ArchiveOriginPanel, string> = {
  notes: "Notes",
  todos: "Todos",
  cutter: "Cutter",
  revisions: "Revisions",
  reports: "Reports",
};

export type ArchiveOrigin =
  /** A document excerpt — no origin record. */
  | { kind: "excerpt" }
  /** A card from `panel`; `card` is the verbatim record to put back. */
  | { kind: "card"; panel: ArchiveOriginPanel; card: Record<string, unknown> }
  /** An origin record is present but unusable (unknown panel, missing card).
   *  It is still NOT an excerpt — restore refuses rather than paste a card
   *  body into the prose. */
  | { kind: "unknown-card"; panel: string | undefined };

const isOriginPanel = (p: unknown): p is ArchiveOriginPanel =>
  typeof p === "string" && (ARCHIVE_ORIGIN_PANELS as readonly string[]).includes(p);

export function archiveOriginOf(
  snippet: Pick<ArchivedSnippet, "originalPanel" | "originalCard">,
): ArchiveOrigin {
  const { originalPanel, originalCard } = snippet;
  if (originalPanel == null && originalCard == null) return { kind: "excerpt" };
  if (
    isOriginPanel(originalPanel) &&
    originalCard &&
    typeof originalCard === "object" &&
    !Array.isArray(originalCard) &&
    typeof originalCard.id === "string" &&
    originalCard.id
  ) {
    return { kind: "card", panel: originalPanel, card: originalCard };
  }
  return {
    kind: "unknown-card",
    panel: typeof originalPanel === "string" ? originalPanel : undefined,
  };
}
