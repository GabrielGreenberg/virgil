/**
 * The ARCHIVED rule for ANCHOR CHROME — stated ONCE, read by every surface
 * that draws a card's presence *in the document*.
 *
 * > **An archived card draws no anchor chrome.** No margin marker, no re-pin
 * > chip, no omni row, no in-text wash / tint band, no hover-or-selection
 * > wash, and no Mode-A paragraph rail. It lives only under its home panel's
 * > *View Archives / All*.
 *
 * Same law as tasks 369 ("two DRAWINGS of one anchor read ONE resolution"),
 * 410, 435 and 476 — for the `archived` fact, and for the surface 476 could
 * not reach. `EditorPane.archivedIds`' doc comment has claimed since it was
 * written that it drives "the in-document exclusion (margin markers,
 * **highlights**)"; the first word was true and the second named a consumer
 * that was never written. A note archived with an associated highlight kept
 * its 18% wash standing in the paragraph, an archived *highlight* card kept
 * its `!important` tint band (its entire in-text identity — `highlight` has
 * `markerType: null`, so archiving removed nothing visible at all), and an
 * archived card hovered from the Archives view still painted 22-60% washes
 * into the prose.
 *
 * ## Two projections of ONE predicate, because the surfaces are keyed
 * ## differently — and one of the two keys does not survive a reload
 *
 * `cardIsArchived` is the rule. Everything else here is a projection of it:
 *
 *  - **`archivedCardIds`** — raw card ids across every panel. This is the key
 *    the *card-keyed* surfaces test against (`marginaliaMarkers.entityId`, an
 *    omni row's `cardPopKey`, an `AnchoredCardRef.id`).
 *  - **`archivedAnchorIds`** — the Mode-B `linkedAnchor` *anchor* ids the
 *    archived cards own. This is the key the *DOM-keyed* surface must use, and
 *    the distinction is load-bearing rather than tidy: on reload
 *    `applyLinkedAnchors` deliberately re-stamps with an EMPTY `linkCard`, so a
 *    restored span reads `data-link-card="note:"` — kind token present, **card
 *    id absent**. A sweep keyed on the card id out of `data-link-card` works
 *    in-session and silently dies after every reload. `data-link-id` (the
 *    anchorId) is the stable key, so the archived CARD set is projected into an
 *    archived ANCHOR set here rather than parsed back out of the DOM.
 *
 * Both walk the SAME collection list (`EditorPane`'s), so the two answers can
 * never disagree about which cards are archived — only about which key names
 * them.
 *
 * ## Kind-blind by construction, deliberately
 *
 * Nothing here asks what kind a card is. `archived` is an envelope fact every
 * archivable kind carries (`src/cards/envelope.ts`), and the chrome it hides is
 * kind-blind too: the per-kind 18% wash, the tint band, the hover / selection
 * washes and the paragraph rail are all painted from one `--link-anchor-color`
 * the kind merely *colours*. So a kind added later inherits the rule by
 * existing — the property `omni-archived.ts` earned by filtering the ASSEMBLED
 * array rather than per builder.
 *
 * ## Cost
 *
 * O(cards) per pass, and the pass runs only when a sidecar collection changes
 * (an archive toggle / add / delete) — never on a keystroke. Both memos live in
 * `EditorPane` beside the collections they read.
 *
 * Import-free apart from the link vocabulary, so every layer that needs the
 * rule can reach it (the placement rule `latex-markers.ts` and
 * `node-attr-sets.ts` each earned: a facet the layer that needs it cannot
 * import will be re-copied).
 */

import type { Link } from "./types";
import { isRangedModeB } from "./types";
import { archiveOriginOf } from "@/lib/archive-origin";

/** The minimum a card must expose to answer "is this archived?". */
export interface ArchivableCardLike {
  id: string;
  archived?: boolean;
}

/** …plus its links, for the Mode-B anchor projection. An Archive-panel
 *  snippet also carries its ORIGIN record when `/editor/archive-card` put it
 *  there (task 712) — see `holdsArchivedCard`. */
export interface AnchoredArchivableCardLike extends ArchivableCardLike {
  links?: Link[];
  originalPanel?: string;
  originalCard?: Record<string, unknown>;
}

/**
 * THE rule. A card is archived when its own record says so — nothing else
 * (not its panel's list filter, not whether its anchor resolves) may answer
 * this question.
 */
export function cardIsArchived(card: ArchivableCardLike): boolean {
  return card.archived === true;
}

/**
 * True when this record is an Archive-panel snippet HOLDING a whole card that
 * `/editor/archive-card` set aside (`cmd_archive`: the card leaves its panel
 * sidecar and lands in `archive.json` with `originalPanel` + `originalCard`).
 *
 * That is the AGENT's spelling of "archived", and until task 1336 the app read
 * only its own (the `archived` flag on a card left in its panel). An agent
 * archive of a passage-anchored note therefore did not count as archived for
 * the in-text chrome: the wash stood until the `notes.json` re-read dropped the
 * card and the reaper STRIPPED the mark — which also lost the anchor
 * `/editor/restore-card` needs to put the note back on its words. Both
 * spellings now name ONE fact for the anchor surfaces: the held card's
 * anchors are archived anchors (no chrome) AND held anchors (not orphans).
 *
 * `archiveOriginOf` is the one reader of the excerpt-vs-card distinction; an
 * origin record that is present but unusable is still a card, never an
 * excerpt, so it counts here too.
 */
export function holdsArchivedCard(card: AnchoredArchivableCardLike): boolean {
  if (card.originalPanel == null && card.originalCard == null) return false;
  return archiveOriginOf(card as Parameters<typeof archiveOriginOf>[0]).kind !== "excerpt";
}

/**
 * Every Mode-B `linkedAnchor` anchorId this card owns.
 *
 * Deliberately ALL of them, not `getTextAnchor`'s first-wins answer: that
 * helper exists to name a card's *primary* anchor for jump/summary purposes,
 * where picking one is the point. Here the question is "which spans belong to
 * this card", and a second range left painted would be exactly the residue
 * this module exists to remove.
 */
function textAnchorIdsOf(card: AnchoredArchivableCardLike, into: Set<string>): void {
  addRangedAnchorIds(card.links, into);
  // A held card's verbatim record carries the links it will be restored WITH —
  // the restore re-anchors from these, so they are its anchors too (the
  // snippet's own `links` normally mirror them; this reads the source).
  if (holdsArchivedCard(card)) addRangedAnchorIds(card.originalCard?.links, into);
}

function addRangedAnchorIds(links: unknown, into: Set<string>): void {
  if (!Array.isArray(links)) return;
  // `originalCard` is a verbatim agent-written record, tolerated rather than
  // trusted: a link with no `anchor` is skipped, not dereferenced.
  for (const link of links as Link[]) {
    if (link?.anchor && isRangedModeB(link) && link.anchor.textRange.anchorId) {
      into.add(link.anchor.textRange.anchorId);
    }
  }
}

/**
 * Card ids of every archived card across the given collections — the
 * cross-panel ARCHIVED SSOT the margin markers, the re-pin chip, the omni
 * filter, the archive glyph and the jump re-check all test against.
 */
export function archivedCardIds(
  collections: ReadonlyArray<ReadonlyArray<ArchivableCardLike>>,
): Set<string> {
  const out = new Set<string>();
  for (const arr of collections) {
    for (const c of arr) if (cardIsArchived(c)) out.add(c.id);
  }
  return out;
}

/**
 * Mode-B `linkedAnchor` anchor ids owned by an archived card — the DOM-stable
 * key `useLinkHighlight` sweeps onto `.linked-anchor[data-link-id=…]`.
 *
 * Same collection list, same predicate, different projection (see the header).
 * A card with no text range contributes nothing, so the inline-atom kinds
 * (footnote / citation) are free to be in the list.
 */
export function archivedAnchorIds(
  collections: ReadonlyArray<ReadonlyArray<AnchoredArchivableCardLike>>,
): Set<string> {
  const out = new Set<string>();
  for (const arr of collections) {
    for (const c of arr) {
      if (cardIsArchived(c) || holdsArchivedCard(c)) textAnchorIdsOf(c, out);
    }
  }
  return out;
}

/**
 * Mode-B anchor ids HELD by an agent-archived card (`holdsArchivedCard`) — the
 * ids the orphan reaper must treat as owned, beside every live Mode-B card's
 * (`aliveLinkedAnchorIds`' `held` argument). An in-app archive keeps its card
 * in its panel, so the bag already covers it; this is the agent spelling's
 * half of the same guarantee: an archived card's mark survives for restore.
 * O(snippets), and only when `archive.json` changes.
 */
export function archiveHeldAnchorIds(
  snippets: ReadonlyArray<AnchoredArchivableCardLike>,
): Set<string> {
  const out = new Set<string>();
  for (const s of snippets) if (holdsArchivedCard(s)) textAnchorIdsOf(s, out);
  return out;
}
