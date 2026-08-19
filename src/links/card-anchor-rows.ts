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
 * > row, so their `@N` keying agrees BY CONSTRUCTION rather than by two
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
   *     every still-live stored pid, deduped and order-stable;
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

  // Emit a row for EVERY live stored pid (multi-anchor Mode-A), not just the
  // resolver's first-live binding — a healthy multi-paragraph card would
  // otherwise silently drop P2..Pn and lose its per-pid detach affordance.
  // Seed with `res.paragraphId` so a mark-/snapshot-recovered paragraph that
  // is NOT a raw stored pid is still rendered; then append every still-live
  // stored pid, deduped, order-stable.
  const seen = new Set<string>();
  const rows: CardAnchorRow[] = [];
  for (const pid of [
    res.paragraphId,
    ...pids.filter((p) => index.uuidToParagraph.has(p)),
  ]) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    rows.push({ pid, pos: index.uuidToPos.get(pid) ?? null });
  }
  return { rows, anchored: true };
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
}

/** The margin's rows for a card — one marker per resolved row. */
export function buildMarginMarkerRows(
  card: CardWithLinks,
  resolve: CardAnchorResolver,
): MarginMarkerRow[] {
  const { rows, anchored } = resolve(card);
  return rows.map((r) => ({ pid: r.pid, unanchored: !anchored }));
}

/**
 * The `@N` anchor index of a marker's paragraph — indexed over the RESOLVED
 * rows, which is exactly the list `buildOmniAnchorRows` suffixes its per-anchor
 * omni row with. Indexing the raw STORED pids instead (pre-369) returned
 * `undefined` for a paragraph the resolver had RECOVERED, so a marker click on
 * such a card pinned no omni row at all.
 *
 * `undefined` for a single-row card — its omni row carries no `@N` suffix, so
 * the bridge keys the bare card popKey.
 */
export function marginAnchorIndex(
  card: CardWithLinks,
  pid: string,
  resolve: CardAnchorResolver,
): number | undefined {
  const { rows } = resolve(card);
  if (rows.length <= 1) return undefined;
  const i = rows.findIndex((r) => r.pid === pid);
  return i >= 0 ? i : undefined;
}
