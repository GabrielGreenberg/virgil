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
import type { CardWithLinks } from "./links";
import { getLinkedTextObjectIds } from "./links";
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
  };
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
  const pids = getLinkedTextObjectIds(card);

  if (!index) {
    // Mount gap — raw stored pids, no orphan verdict. Positions are unknown
    // (there is no index to read them from) and the render surfaces fall back
    // to the live resolver, so `null` here is the honest answer.
    if (pids.length === 0) return NO_ROWS;
    return { rows: pids.map((pid) => ({ pid, pos: null })), anchored: true };
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
      ? { rows: [{ pid: pids[0], pos: null }], anchored: false }
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
  const seen = new Set<string>();
  const rows: CardAnchorRow[] = [];
  const candidates = [res.paragraphId];
  for (const link of card.links ?? []) {
    candidates.push(...liveParagraphsOfLink(link, index));
  }
  for (const pid of candidates) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    rows.push({ pid, pos: index.uuidToPos.get(pid) ?? null });
  }
  return { rows, anchored: true };
}

/**
 * The live paragraphs ONE link is anchored on — the per-link reading of the
 * resolver's rungs 1, 2 and 2b (task 934):
 *
 *   - Mode-A → every live stored pid (multi-paragraph legacy links included);
 *   - Mode-B with a LIVE mark → the mark's paragraph, and ONLY that — the
 *     stored pids name where the highlight was born, not where it is;
 *   - Mode-B whose mark is dead → its live stored pids (the RC1 self-heal);
 *   - anything else → none.
 */
function liveParagraphsOfLink(link: Link, index: ResolveIndex): string[] {
  if (link.anchor.type !== "textObject") return [];
  if (isModeB(link)) {
    const anchorId = link.anchor.textRange?.anchorId;
    const markPid = anchorId ? index.anchorIdToParagraph.get(anchorId) : undefined;
    if (markPid) return [markPid];
  }
  return link.anchor.textObjectIds.filter(
    (p) => !!p && index.uuidToParagraph.has(p),
  );
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
}

/** The margin's rows for a card — one marker per resolved row. */
export function buildMarginMarkerRows(
  card: CardWithLinks,
  resolve: CardAnchorResolver,
): MarginMarkerRow[] {
  const { rows, anchored } = resolve(card);
  const cardPids = rows.map((r) => r.pid);
  return rows.map((r) => ({ pid: r.pid, unanchored: !anchored, cardPids }));
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
   * paragraph? This is the BODY's question too (archive's `orphaned` state, a
   * todo's `isAnchored`), which is why the gate publishes it — but no surface
   * may re-derive the Jump decision from it. That is `withJump`'s job.
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
 * apply `jumpGate(card).withJump(handler)` — they never re-derive the decision
 * from the card's stored links.
 */
export type DockedJumpGate = (card: CardWithLinks) => CardJumpGate;

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
