/**
 * The ONE authority both renderers of a card's anchor read (task 369).
 *
 * A paragraph-anchored card is drawn TWICE, by two different surfaces:
 *
 *   - the **margin marker** (`EditorPane.marginaliaMarkers`), and
 *   - the **omni card** (`src/panels/<Panel>/omni.tsx` via `omni-host`).
 *
 * Before this module they answered "which paragraph is this card on?" from
 * two different tables. The margin routed every card through the four-rung
 * anchor-recovery SSOT `resolveCardAnchor` (live uuid → surviving
 * `linkedAnchor` mark → RC1 self-heal → text-snapshot relocation); the omni
 * builders consulted NO resolver at all — a bare live-uuid lookup
 * (`findParagraphPos`) plus, for archive, a bare `pids.some(live)` gate.
 *
 * So the two agreed ONLY on rung 1. For a card whose stored uuid has died but
 * whose `paragraphSnapshot` still matches a live paragraph — the ordinary
 * outcome of a `%!v:` anchor failing to round-trip through the `.tex`, and
 * armed for every archive snippet, which is created WITH a snapshot — the
 * margin painted an ordinary marker beside the recovered paragraph while the
 * omni row was binned `pos: null` into the orphan strip. Marker in the margin,
 * card nowhere near it: the same user-visible symptom task 362 fixed one field
 * over, arriving from the other side (there the card froze its Y; here the two
 * renderers disagree about whether the anchor RESOLVES at all).
 *
 * > **Where one fact is drawn by two surfaces, it is RESOLVED once, by one
 * > authority, and both surfaces read the resolution.** Neither may re-derive
 * > it — that is the fork. The rows list published here is the shared
 * > vocabulary: the margin emits one marker per row and the omni one card per
 * > row, so their `@<pid>` keying agrees BY CONSTRUCTION rather than by two
 * > implementations of one rule staying in step.
 *
 * Keystroke sanctity: `buildCardAnchorResolver` runs ONE `buildResolveIndex`
 * (O(doc), card-count-independent) and then resolves each card in O(1) against
 * it. Build it in a memo gated on the structural counters (`rev.anchors` /
 * `rev.blocks`) — never per card, never per keystroke. On the omni side this is
 * a strict REDUCTION: `findParagraphPos` was an O(doc) `descendants` walk PER
 * PID, so the pre-369 cost was O(doc · anchors).
 */

import type { Editor } from "@tiptap/react";
import type { AnchorRowSource, CardWithLinks } from "./links";
import { getLinkedTextObjectIds } from "./links";
import { withoutDormantLinks } from "./dormant";
import {
  buildResolveIndex,
  resolveCardAnchor,
  type ResolveIndex,
} from "./resolve-card-anchor";
import { resolveAnchorState, type AnchorIntent } from "./anchor-state";
import { isModeB, type Link } from "./_shared/types";

/** One live anchor a card renders on. */
export interface CardAnchorRow {
  /** The live paragraph uuid this row sits on. */
  pid: string;
  /** Baked doc position for `pid`, or `null` when the pid isn't live.
   *  Consumers that position a card inline MUST prefer the LIVE position
   *  re-resolved from `pid` (see `OmniItem.pos`'s contract) — this is the
   *  seed, refreshed on every structural change, not a live value. */
  pos: number | null;
  /**
   * The live `linkedAnchor` mark this row is drawn AT, when it is drawn at a
   * span rather than at its whole paragraph (task 1334). Set iff EVERY link
   * behind the row is a Mode-B link whose live mark lies in `pid` — the row
   * then sits beside the words, at the earliest such mark. A row any Mode-A
   * (whole-paragraph) link draws stays at the block top, and so does a row
   * whose mark is dead or lies in another paragraph.
   *
   * This is the ONE answer to "where on its paragraph is this card?": the
   * omni card (via `OmniItem.anchorId` → `useLivePosResolver`), the margin
   * marker (via `MarginaliaMarker.anchorId` → `computeMarkerPositions`) and
   * the search hit all read it, so the card and its icon cannot sit on
   * different lines.
   */
  anchorId?: string;
  /** The seed position of `anchorId`'s first character, beside it (a baked
   *  value, like `pos`). Use {@link rowAnchorPos} rather than reading the two
   *  fields with a hand-written fallback. */
  anchorPos?: number;
  /**
   * The links that DRAW this row, each with what detaching the row from it
   * means (task 1149). A per-row gesture — the margin's Delete — acts on these
   * by identity; it must never re-derive "which link is this?" by matching
   * `pid` against the card's stored pids, which for a Mode-B mark's paragraph
   * or a recovered paragraph name something else entirely.
   */
  sources: AnchorRowSource[];
}

export interface CardAnchorRows {
  /**
   * The ordered rows this card renders on:
   *   - resolved  → ONE row per LIVE anchor, seeded with the RESOLVED
   *     paragraph (which may be a paragraph that is not among the card's
   *     stored pids at all — a mark- or snapshot-recovered one) followed by
   *     each link's own live paragraphs (a Mode-A link's live stored pids, a
   *     live-marked Mode-B link's mark paragraph ONLY), deduped and
   *     order-stable;
   *   - unresolved w/ stored anchors → exactly ONE row, keyed on the card's
   *     first stored pid so the marker keeps a stable id for the re-pin
   *     gesture;
   *   - unresolved w/ no stored anchor → empty.
   */
  rows: CardAnchorRow[];
  /**
   * True iff the SSOT bound this card to a live paragraph. `false` means every
   * row above is a dead anchor being SURFACED rather than culled.
   *
   * This is deliberately NOT the free-vs-orphaned split: that one reads the
   * card's own declared intent and stays with `resolveAnchorState` at the
   * render surface, because "a card with no links at all" means different
   * things per panel (a born-free note vs. an archive clip's `unanchored`
   * flag) and this module is not entitled to decide it.
   */
  anchored: boolean;
}

/** Resolves any card to its shared anchor rows. Bound to one index. */
export type CardAnchorResolver = (card: CardWithLinks) => CardAnchorRows;

/** One pass's bound readers — build ONCE, then read O(1) per card. */
export interface CardAnchorPass {
  /** The card authority. Both renderers of a card's anchor read THIS. */
  resolve: CardAnchorResolver;
  /**
   * A bare live-uuid → position lookup off the SAME index.
   *
   * This is deliberately NOT the card authority and must never be used to
   * answer "where is this card anchored?" — it exists for the one consumer
   * whose paragraph id does not come from a card's links at all (the Errors
   * builder, whose `paragraphByErrorId` is derived from the diagnostics pass),
   * so it has no recovery ladder to run and nothing to agree with.
   */
  posOf: (uuid: string | null) => number | null;
  /**
   * Where a Jump on `card` lands (task 935) — the ACT's reading of the same
   * resolution the rows above are drawn from, so a Jump can never land
   * somewhere no marker is drawn.
   *
   * `rowPid` is the asking ROW's own paragraph (a multi-anchor omni row's
   * `@<pid>`): when live it wins outright — the row IS that anchor. Otherwise
   * the authority's winner. `anchorId` names a live `linkedAnchor` mark of
   * this card's on that paragraph, so a Mode-B card lands on its words, not
   * the bare block. `null` when the card is not anchored, or in the mount gap.
   */
  jumpTarget: (card: CardWithLinks, rowPid?: string | null) => CardJumpTarget | null;
  /**
   * The blocks ONE link is anchored on NOW ({@link anchorPidsOfLink}) — for a
   * door that acts on a link outside the row vocabulary (the archive / join
   * re-home, task 1328). A Mode-B link with a live mark answers its mark's
   * paragraph, never its stored birth record.
   */
  anchorPidsOf: (link: Link) => string[];
}

/** A Jump's landing place, read off one pass's index (see `jumpTarget`). */
export interface CardJumpTarget {
  paragraphId: string;
  /** Doc position of `paragraphId` from the pass's index. */
  pos: number | null;
  /** A live mark of the card's on `paragraphId`, preferred over the block. */
  anchorId: string | null;
}

const NO_ROWS: CardAnchorRows = { rows: [], anchored: false };

/**
 * Build the per-pass readers: ONE `buildResolveIndex` shared by every card.
 *
 * `editor` may be `null` (not yet mounted) and the doc may be momentarily
 * EMPTY during the mount gap — against a zero-uuid index every card would
 * resolve `orphan` and flash the re-pin dock spuriously, so a not-ready index
 * falls back to the card's raw stored pids with NO orphan verdict. That
 * fail-open is the same one the margin builder has carried since the SSOT
 * landed, hoisted here so both surfaces inherit it.
 */
export function buildCardAnchorPass(editor: Editor | null): CardAnchorPass {
  const index = editor ? buildResolveIndex(editor) : null;
  const ready = !!index && index.uuidToParagraph.size > 0;
  const bound = ready ? index : null;
  // Per-card memo. A pass has SEVERAL readers per card — the margin's rows and
  // its click index, the omni row builder, the archive anchored-id fold — and
  // resolving twice would run the whole ladder twice, snapshot normalization
  // included. Keyed on the card OBJECT (stable per render from the sidecar
  // hooks' arrays) and scoped to this pass, which is itself rebuilt whenever
  // the index can have changed, so a memo can never outlive its index.
  const memo = new WeakMap<CardWithLinks, CardAnchorRows>();
  return {
    resolve: (card) => {
      const hit = memo.get(card);
      if (hit) return hit;
      const out = resolveCardAnchorRows(card, editor, bound);
      memo.set(card, out);
      return out;
    },
    posOf: (uuid) => (uuid ? index?.uuidToPos.get(uuid) ?? null : null),
    jumpTarget: (card, rowPid) =>
      bound ? resolveCardJumpTarget(card, editor, bound, rowPid ?? null) : null,
    anchorPidsOf: (link) => anchorPidsOfLink(link, bound),
  };
}

/** `CardAnchorPass.jumpTarget`'s rule, against a READY index. */
function resolveCardJumpTarget(
  card: CardWithLinks,
  editor: Editor | null,
  index: ResolveIndex,
  rowPid: string | null,
): CardJumpTarget | null {
  const links = card.links ?? [];
  const target = (paragraphId: string, anchorId: string | null): CardJumpTarget => ({
    paragraphId,
    pos: index.uuidToPos.get(paragraphId) ?? null,
    anchorId: anchorId ?? markOn(paragraphId),
  });
  const markOn = (pid: string): string | null => {
    for (const link of links) {
      if (!isModeB(link)) continue;
      const anchorId = link.anchor.textRange?.anchorId;
      if (anchorId && index.anchorIdToParagraph.get(anchorId) === pid) return anchorId;
    }
    return null;
  };

  // A row pid that died since the row was built falls through to the
  // authority rather than jumping nowhere.
  if (rowPid && index.uuidToParagraph.has(rowPid)) return target(rowPid, null);

  const res = resolveCardAnchor(card, editor, index);
  if (res.paragraphId == null || res.linkIndex == null) return null;
  const winner = links[res.linkIndex]?.anchor;
  const winnerMark =
    res.source === "mark" && winner?.type === "textObject"
      ? winner.textRange?.anchorId ?? null
      : null;
  return target(res.paragraphId, winnerMark);
}

/**
 * The pure per-card rule. `index` is `null` for "not ready" (see above).
 *
 * Exported for the contract test; production callers take
 * `buildCardAnchorResolver` so the O(doc) index can never be built per card.
 */
export function resolveCardAnchorRows(
  card: CardWithLinks,
  editor: Editor | null,
  index: ResolveIndex | null,
): CardAnchorRows {
  // A DORMANT link (task 1193) draws nothing: its text is in an archive
  // snippet. Resolve the card's LIVE view, so an all-dormant card has no rows
  // (not an orphan row) and a multi-anchor card renders only its live anchors.
  const live = withoutDormantLinks(card);
  if (live !== card) return resolveCardAnchorRows(live, editor, index);
  const pids = getLinkedTextObjectIds(card);

  if (!index) {
    // Mount gap — raw stored pids, no orphan verdict. Positions are unknown
    // (there is no index to read them from) and the render surfaces fall back
    // to the live resolver, so `null` here is the honest answer.
    if (pids.length === 0) return NO_ROWS;
    return {
      rows: pids.map((pid) => ({ pid, pos: null, sources: storedSourcesOf(card, pid, null) })),
      anchored: true,
    };
  }

  const res = resolveCardAnchor(card, editor, index);
  // Classify through the `resolveAnchorState` SSOT rather than re-reading the
  // resolver's rung-4 `source === "orphan"` residue (task 205 M1). A live
  // witness wins unconditionally there, so this is equivalent to
  // `res.paragraphId != null` for every card — the SSOT is what keeps it
  // equivalent tomorrow.
  const anchored =
    resolveAnchorState(res.paragraphId, card as AnchorIntent) === "anchored";

  if (!anchored || !res.paragraphId) {
    // uuid + mark + snapshot all dead → SURFACE, don't vanish. Key on the
    // first stored pid (a stable id for the marker + the re-pin gesture).
    return pids.length > 0
      ? {
          rows: [{ pid: pids[0], pos: null, sources: storedSourcesOf(card, pids[0], index) }],
          anchored: false,
        }
      : NO_ROWS;
  }

  // Emit a row for EVERY live anchor (multi-anchor Mode-A), not just the
  // resolver's first-live binding — a healthy multi-paragraph card would
  // otherwise silently drop P2..Pn and lose its per-pid detach affordance.
  // Seed with `res.paragraphId` so a mark-/snapshot-recovered paragraph that
  // is NOT a raw stored pid is still rendered; then append each link's OWN
  // live paragraphs (`liveParagraphsOfLink`), deduped, order-stable.
  //
  // Per LINK, not per stored pid (task 934): a Mode-B link whose mark is live
  // is anchored where its MARK is, and its stored `textObjectIds` are only a
  // record of where the mark was born. Split the paragraph before the
  // highlighted words (Enter) and the mark rides into the new tail P' while
  // the stored pid P stays live — appending the flat stored-pid list painted
  // a SECOND marker on P for the one highlight, and Delete on the real one
  // took the multi-anchor branch and `unanchor`ed a pid the card never stored.
  //
  // Each row also records WHICH links draw it (task 1149) — the winner link
  // for the seed, each link for its own live paragraphs — so the per-row
  // Delete removes exactly the link(s) behind its marker.
  const links = card.links ?? [];
  const byPid = new Map<string, CardAnchorRow>();
  const rows: CardAnchorRow[] = [];
  const draw = (pid: string, link: Link | undefined) => {
    let row = byPid.get(pid);
    if (!row) {
      row = { pid, pos: index.uuidToPos.get(pid) ?? null, sources: [] };
      byPid.set(pid, row);
      rows.push(row);
    }
    if (link && !row.sources.some((s) => s.linkId === link.id)) {
      row.sources.push(sourceOf(link, pid, index));
    }
  };
  draw(res.paragraphId, res.linkIndex == null ? undefined : links[res.linkIndex]);
  for (const link of links) {
    for (const pid of liveParagraphsOfLink(link, index)) draw(pid, link);
  }
  for (const row of rows) placeRowAtSpan(row, index);
  return { rows, anchored: true };
}

/**
 * Seat a row at its span (task 1334) — see `CardAnchorRow.anchorId`.
 *
 * Every source must be a live mark IN this row's paragraph: one whole-
 * paragraph binding (a source that stores the pid, a link without a mark, a
 * dead mark) keeps the row at the block top, since the card is ABOUT the
 * paragraph as well. A cross-block span is seated only on the row whose
 * paragraph holds its first character — on any other row its mark's
 * paragraph is not `pid`, so that row stays at its block top.
 */
function placeRowAtSpan(row: CardAnchorRow, index: ResolveIndex): void {
  const toPos = index.anchorIdToPos;
  if (!toPos || row.sources.length === 0) return;
  let best: { anchorId: string; pos: number } | null = null;
  for (const s of row.sources) {
    const pos = s.anchorId != null ? toPos.get(s.anchorId) : undefined;
    if (
      s.pid != null ||
      s.anchorId == null ||
      pos == null ||
      index.anchorIdToParagraph.get(s.anchorId) !== row.pid
    ) {
      return;
    }
    if (!best || pos < best.pos) best = { anchorId: s.anchorId, pos };
  }
  if (best) {
    row.anchorId = best.anchorId;
    row.anchorPos = best.pos;
  }
}

/** Where a row is anchored, as a seed position: its span's first character
 *  when it is drawn at one (`anchorId`), else its block (`pos`). */
export function rowAnchorPos(row: CardAnchorRow): number | null {
  return row.anchorPos ?? row.pos;
}

/**
 * What detaching `pid`'s row from `link` means: a link that STORES the pid as
 * its binding loses that pid; anything else — a Mode-B link whose mark is LIVE
 * (its range IS the binding), or a link the ladder recovered onto a paragraph
 * it does not store — loses the whole link.
 *
 * A Mode-B link whose mark is DEAD is bound by its stored pids (the rung-2b
 * self-heal draws one row per live stored pid — task 1328), so it detaches per
 * pid exactly like Mode-A: Delete on one of those rows must not take its
 * sibling rows with it. With no index (mount gap) a mark's liveness is
 * unknown, and a Mode-B link keeps the whole-link answer.
 */
function sourceOf(link: Link, pid: string, index: ResolveIndex | null): AnchorRowSource {
  const anchor = link.anchor.type === "textObject" ? link.anchor : null;
  const anchorId = anchor?.textRange?.anchorId ?? null;
  const storesPid = !!anchor && anchor.textObjectIds.includes(pid);
  const boundByPids = !isModeB(link) || (!!index && liveMarkParagraphOf(link, index) == null);
  return {
    linkId: link.id,
    pid: boundByPids && storesPid ? pid : null,
    anchorId,
  };
}

/** The sources of a row keyed on a STORED pid (mount gap / unresolved). */
function storedSourcesOf(
  card: CardWithLinks,
  pid: string,
  index: ResolveIndex | null,
): AnchorRowSource[] {
  return (card.links ?? [])
    .filter((l) => l.anchor.type === "textObject" && l.anchor.textObjectIds.includes(pid))
    .map((l) => sourceOf(l, pid, index));
}

/** The paragraph a Mode-B link's mark lives in NOW, or null (not Mode-B, no
 *  mark id, or the mark is not in the document). */
function liveMarkParagraphOf(link: Link, index: ResolveIndex): string | null {
  if (!isModeB(link) || link.anchor.type !== "textObject") return null;
  const anchorId = link.anchor.textRange?.anchorId;
  return (anchorId && index.anchorIdToParagraph.get(anchorId)) || null;
}

/**
 * The blocks ONE link is anchored on NOW — the one answer to "where is this
 * link?" that every door asks (task 1328), live or not:
 *
 *   - Mode-A → its stored pids;
 *   - Mode-B with a LIVE mark → the mark's paragraph, and ONLY that — the
 *     stored `textObjectIds` are a BIRTH RECORD (where the highlight was born,
 *     plus any block folded in later), not where it is;
 *   - Mode-B whose mark is dead → its stored pids (the RC1 self-heal binding);
 *   - anything else → none.
 *
 * `index: null` (mount gap) cannot see marks, so it answers the stored pids.
 * A door that must not mistake the birth record for identity — the row
 * authority below, the archive/join re-home (`retargetDisplacedAnchors`) —
 * reads THIS, never `textObjectIds` raw for a Mode-B link.
 */
export function anchorPidsOfLink(link: Link, index: ResolveIndex | null): string[] {
  if (link.anchor.type !== "textObject") return [];
  const markPid = index ? liveMarkParagraphOf(link, index) : null;
  if (markPid) return [markPid];
  return link.anchor.textObjectIds.filter((p) => !!p);
}

/**
 * The live paragraphs ONE link is anchored on — {@link anchorPidsOfLink}
 * narrowed to the live ones: the per-link reading of the resolver's rungs 1,
 * 2 and 2b (task 934).
 */
function liveParagraphsOfLink(link: Link, index: ResolveIndex): string[] {
  return anchorPidsOfLink(link, index).filter((p) => index.uuidToParagraph.has(p));
}

// ---------------------------------------------------------------------------
// The MARGIN's reader of the same rows
// ---------------------------------------------------------------------------
//
// The omni surface's reader lives beside the builders it serves
// (`src/panels/_shared/omni-anchor-rows.ts`, which needs the panel row shape).
// The margin's is two lines and has no UI dependency at all, so it lives here
// — beside the authority, where the two readers can be read against each other.

/** One margin marker's paragraph, plus the SURFACE-not-cull flag. */
export interface MarginMarkerRow {
  pid: string;
  /** The row's span anchor, when it is drawn at one (`CardAnchorRow.anchorId`). */
  anchorId?: string;
  /** True ⇒ the anchor is dead; the marker is surfaced (re-pin dock), not
   *  painted as an ordinary anchored marker. */
  unanchored: boolean;
  /**
   * Every pid this card draws a marker for, `pid` included — the COHORT the
   * row belongs to, carried ON the row so a per-row gesture cannot hold one
   * without the other (task 669).
   *
   * The margin's Delete has exactly one question beyond "which card?": *is
   * this the card's LAST anchor?* — unanchor if not, confirm-and-delete if so.
   * It used to answer that from `getLinkedTextObjectIds(card)`, the card's
   * STORED pids, while the marker it was deleting carried a RESOLVED pid. For
   * a card recovered through the mark or snapshot rung those two lists are
   * disjoint (`resolveCardAnchorRows` seeds the row set with `res.paragraphId`
   * precisely because it is NOT a stored pid), so the stored-pid diff removed
   * nothing, reported a phantom sibling, and took the multi-anchor branch on a
   * card with one anchor — an `unanchor` keyed on a pid the card does not
   * store, i.e. a silent no-op, for the rest of the session.
   *
   * Because the cohort ships with the row, the door is HANDED the authority's
   * answer instead of re-deriving the same question from the raw record. In
   * the mount gap the authority's rows ARE the stored pids, so the old answer
   * and the new one agree there by construction rather than by coincidence.
   */
  cardPids: readonly string[];
  /**
   * The links this marker is drawn from (`CardAnchorRow.sources`) — what the
   * multi-anchor Delete removes (task 1149). The cohort answers "is this the
   * last anchor?"; the sources answer "then detach WHAT?". Both come off the
   * same row, so neither can be re-derived from the stored pids.
   */
  sources: readonly AnchorRowSource[];
}

/** The margin's rows for a card — one marker per resolved row. */
export function buildMarginMarkerRows(
  card: CardWithLinks,
  resolve: CardAnchorResolver,
): MarginMarkerRow[] {
  const { rows, anchored } = resolve(card);
  const cardPids = rows.map((r) => r.pid);
  return rows.map((r) => ({
    pid: r.pid,
    ...(anchored && r.anchorId ? { anchorId: r.anchorId } : {}),
    unanchored: !anchored,
    cardPids,
    sources: r.sources,
  }));
}

// ---------------------------------------------------------------------------
// The per-anchor row id — ONE grammar, keyed by IDENTITY (task 916)
// ---------------------------------------------------------------------------
//
// A multi-anchor card draws one omni row per resolved anchor, and that row's
// id is what the omni pin store, the marker-click bridge and the prefix-or-
// exact matcher (`findOmniEntry`) all key on. It used to be `…@<i>`, `i` an
// index into the LIVE rows — a list that shrinks when a sibling anchor's
// paragraph dies. So a standing pin on P2's row (`@1`) silently re-bound to
// P3's row when P1 was deleted (P3 became `@1`), and a pin on the last row
// named nothing. The "Addressing the live document across an async gap" law:
// a target held across a later gesture is named by durable IDENTITY, never by
// position. The pid IS that identity, so the suffix is the pid: a pin on a
// row whose paragraph died is INERT, never re-bound.
//
// Single-row cards carry no suffix (a card going 2→1 rows re-keys to the bare
// id; its pin then goes inert rather than mis-binding). Paragraph uuids are
// short hex ids and never contain `@`; card ids never do either (link ids are
// the `${cardId}@${pid}` ones, and they are not omni keys).

/** The separator between a card's omni key and a row's anchor pid. */
const ANCHOR_ROW_SEP = "@";

/** The omni id of one row of a card: `baseId` alone for a single-row card,
 *  `${baseId}@${pid}` for each row of a multi-anchor card. */
export function anchorRowId(baseId: string, pid: string | undefined): string {
  return pid === undefined ? baseId : `${baseId}${ANCHOR_ROW_SEP}${pid}`;
}

/** Inverse of `anchorRowId`: the card's own key, any `@<pid>` row suffix
 *  stripped. */
export function anchorRowBaseId(rowId: string): string {
  const at = rowId.lastIndexOf(ANCHOR_ROW_SEP);
  return at === -1 ? rowId : rowId.slice(0, at);
}

/**
 * The anchor pid a margin marker names its omni row by — `pid` itself when the
 * card has more than one RESOLVED row (the list `buildOmniAnchorRows` suffixes
 * from, so a RECOVERED paragraph is found too — task 369), `undefined` for a
 * single-row card (its omni row carries no suffix, so the bridge keys the bare
 * card popKey) or for a pid the card draws no row for.
 */
export function marginAnchorRowPid(
  card: CardWithLinks,
  pid: string,
  resolve: CardAnchorResolver,
): string | undefined {
  const { rows } = resolve(card);
  if (rows.length <= 1) return undefined;
  return rows.some((r) => r.pid === pid) ? pid : undefined;
}

// ---------------------------------------------------------------------------
// The ONE Jump gate — shared by every surface that offers a card's Jump
// ---------------------------------------------------------------------------
//
// Task 665. A card's Jump affordance is drawn by THREE surfaces — the omni row,
// the popped float, and (for archive) the docked card — and each one used to
// decide "can this jump?" for itself. Task 655 retired the omni half by taking
// the boolean out of the builder's hand: a builder hands over its callback and
// gets back either the callback or `undefined`, so there is no predicate left
// to choose differently. The float half still held a boolean, and nine of its
// builders computed it from `getLinkedTextObjectIds(card).length > 0` — merely
// "the card STORES an anchor", which is equally true of a card whose anchor is
// dead. That is the same false affordance, one surface over.
//
// So the gate itself lives HERE, beside the authority, and both readers import
// it. One pair of implementations, not two.

/** Hand in a handler; get it back only when the surface may offer the act. */
export type WithJump = <H>(handler: H) => H | undefined;

/** The two `WithJump` implementations. Module-level constants rather than
 *  per-call closures: a pass rebuilds every row/float on each structural
 *  revision, and the gate has no per-call state to capture. */
export const PASS_JUMP: WithJump = <H>(handler: H): H | undefined => handler;
export const NO_JUMP: WithJump = <H>(_handler: H): H | undefined => undefined;

/** A card's float-side anchor verdict plus the gate derived from it. */
export interface CardJumpGate {
  /**
   * The authority's verdict: did the four-rung ladder bind this card to a live
   * paragraph? Published for callers that need the verdict ITSELF (a docked
   * badge, a float's chrome) — never to be handed to a card as a second
   * "anchored" prop that re-gates `onJump`. The card receives the handler
   * already passed through `withJump`, and an absent handler IS the shut gate
   * (task 966 retired Archive's `orphaned` and Todo's `isAnchored`, which were
   * read only to re-gate Jump). That is `withJump`'s job alone.
   */
  anchored: boolean;
  /** The Jump door. `undefined` back ⇒ the surface offers nothing. */
  withJump: WithJump;
}

const GATE_OPEN: CardJumpGate = { anchored: true, withJump: PASS_JUMP };
const GATE_SHUT: CardJumpGate = { anchored: false, withJump: NO_JUMP };

/**
 * The gate for a PARAGRAPH-ANCHORED card, resolved through the one authority.
 *
 * `anchored` — not "a resolved position" — is the right rung here, and the two
 * differ only in the mount gap (index not ready ⇒ `pos: null` on every row).
 * An omni row has nothing to point at without a position, so it fails shut
 * there; a float's `jumpToCard` re-resolves against the LIVE editor at click
 * time, well after the gap, so it fails open — and since task 665 gave
 * `resolveLink` its snapshot rung, `anchored` strictly implies `jumpToCard`
 * can reach the card. "Anchored" and "reachable" cannot disagree.
 */
export function cardJumpGate(
  card: CardWithLinks,
  resolve: CardAnchorResolver,
): CardJumpGate {
  return resolve(card).anchored ? GATE_OPEN : GATE_SHUT;
}

/**
 * A docked panel's Jump door (task 699): card → its `cardJumpGate` over the
 * pane's shared pass. The six docked panels take one as a REQUIRED prop and
 * apply it through `dockedJumpDoors` — they never re-derive the decision from
 * the card's stored links, and never spell `.withJump(` themselves.
 */
export type DockedJumpGate = (card: CardWithLinks) => CardJumpGate;

/**
 * A docked card's two Jump doors, minted TOGETHER from one gate (tasks 964,
 * 1343) so the twins cannot drift:
 *
 * - `button(card)` — the card's Jump button handler, passed through the card's
 *   `jumpGate(card).withJump`; `undefined` when the anchor is dead (task 699:
 *   no Jump that no-ops) or the host passed no jump handler. A panel's whole
 *   button wiring is `onJump={button(card)}`.
 * - `keyboard` — an Arrow step or Enter in a docked card list selects the card
 *   (the `CardListPanel` shell does that) and then jumps through the SAME gate,
 *   so a dead anchor selects without a no-op navigation. `undefined` when the
 *   host passed no jump handler (the shell then only selects).
 *
 * Before 1343 only the keyboard half had a door; the button half was
 * hand-spelled at ten sites across six panels — the "whichever ones remembered
 * to spell it" shape 964 retired. `docked-jump-gate.test.tsx`'s census pins
 * that no docked panel spells `.withJump(` itself.
 */
export interface DockedJumpDoors<C extends CardWithLinks> {
  button: (card: C) => ((sourceEl?: HTMLElement | null) => void) | undefined;
  keyboard: ((card: C) => void) | undefined;
}

const NO_BUTTON = () => undefined;

export function dockedJumpDoors<C extends CardWithLinks>(
  jumpGate: DockedJumpGate,
  onJumpToCard: ((card: C, sourceEl?: HTMLElement | null) => void) | undefined,
): DockedJumpDoors<C> {
  if (!onJumpToCard) return { button: NO_BUTTON, keyboard: undefined };
  return {
    button: (card) =>
      jumpGate(card).withJump((sourceEl?: HTMLElement | null) => onJumpToCard(card, sourceEl)),
    keyboard: (card) => {
      jumpGate(card).withJump(onJumpToCard)?.(card);
    },
  };
}

/**
 * The gate for a float whose reachability is NOT a card-anchor question — a
 * footnote resolved from its own `\footnote` atom, a citation from its own
 * position, an example from its `\ex{…}` block, a bib/AI float that has no
 * in-document source at all. These have their own resolution and nothing to
 * agree with; they say so HERE rather than spelling a bare boolean, so the
 * census can tell "resolved elsewhere" from "never asked".
 */
export function staticJumpGate(canJump: boolean): CardJumpGate {
  return canJump ? GATE_OPEN : GATE_SHUT;
}

// ---------------------------------------------------------------------------
// The DOCUMENT-ORDER reader of the same rows
// ---------------------------------------------------------------------------

/**
 * Order cards by where the authority RESOLVES them: anchored cards first in
 * document order, then everything the ladder binds to nothing, original order
 * preserved within each group (`sort` is stable, and ties answer 0).
 *
 * The third reader of the shared rows, beside `buildMarginMarkerRows` (the
 * margin's) and `buildOmniAnchorRows` (the omni's) — and the one that had gone
 * missing. `EditorPane.sortedArchiveSnippets` ran its own `doc.descendants`
 * walk keyed on the LIVE UUID only, directly below `anchoredArchiveIds`, which
 * reads the four-rung authority. So a clip recovered by its surviving
 * `linkedAnchor` mark or by its `paragraphSnapshot` — and every archive link is
 * created WITH a snapshot — was badged `anchored` by one memo and sorted into
 * the orphan tail by the other, in the SAME rendered row (task 665 M2).
 *
 * Positions come from the index's own walk (`uuidToPos`), so this costs O(cards)
 * against a pass that already exists — the extra O(doc) walk bought nothing but
 * the disagreement. Positions are monotone in document order, so sorting on
 * them IS the paragraph order the ordinal walk used to build.
 */
export function sortCardsByResolvedAnchor<T extends CardWithLinks>(
  cards: readonly T[],
  resolve: CardAnchorResolver,
): T[] {
  // The card's resolved document position, or null when the ladder binds it to
  // nothing. `rows[0]` is the RESOLVED paragraph (the resolver seeds the list
  // with it), so this is the same paragraph the margin marker sits beside.
  const posOf = (card: T): number | null => {
    const { rows, anchored } = resolve(card);
    return anchored ? rows[0]?.pos ?? null : null;
  };
  return [...cards].sort((a, b) => {
    const aPos = posOf(a);
    const bPos = posOf(b);
    if (aPos != null && bPos != null) return aPos - bPos;
    if (aPos != null) return -1;
    if (bPos != null) return 1;
    return 0;
  });
}
