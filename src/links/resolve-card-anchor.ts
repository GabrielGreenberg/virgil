/**
 * Unified anchor-recovery SSOT (CHIP R0).
 *
 * ONE pure function every consumer asks "what paragraph does this card
 * live on NOW?" — the single owner that the load reconcile, the render
 * cull, and the Mode-B re-apply paths all funnel through (replacing the
 * three uncoordinated recovery owners diagnosed as RC4 in
 * `MEMO_CARD_DROP_MARGIN_FIX.md`). No React, no side effects, no
 * `editor.on` subscriber — importable by hooks AND by ProseMirror-side
 * render code.
 *
 * The resolution ladder is **uuid STRICTLY before snapshot**: a card's
 * stored paragraph UUID, if it still resolves to a live block, ALWAYS
 * wins over a text-snapshot match — even if the snapshot would match a
 * different same-text sibling. Snapshot is the fallback for the reload
 * race where the `%!v:` UUID failed to round-trip through the `.tex` and
 * the paragraph was re-minted a fresh one.
 *
 * Keystroke sanctity: `buildResolveIndex` is O(doc) and runs ONLY where
 * O(doc) already runs today (the load-once reconcile + the
 * structurally-gated marginaliaMarkers memo). It builds ONE index per
 * pass and `resolveCardAnchor` then resolves each card in O(1) against
 * it — a net REDUCTION vs today's N inline per-card doc walks. Never
 * call `buildResolveIndex` per card.
 *
 * Subsumes (and will let the load pass replace) the legacy
 * `reconcileModeAAnchors` / `findParagraphIdBySnapshot` / `isModeAOrphaned`
 * helpers in `links.ts`, all kept exported for their own tests until those
 * tests migrate (see the staged chip plan in
 * `MEMO_ANCHOR_RECOVERY_DESIGN.md`).
 */

import type { Editor } from "@tiptap/react";
import type { Link } from "./_shared/types";
import {
  collectLiveUuids,
  paragraphUuidAt,
  type CardWithLinks,
} from "./links";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Which rung of the resolution ladder produced the binding.
 *  `uuid`/`mark` are high-confidence (the live doc still carries the
 *  exact anchor); `snapshot` is a low-confidence text re-find;
 *  `orphan` is the un-resolvable residue. */
export type AnchorSource = "uuid" | "mark" | "snapshot" | "orphan";

export interface CardAnchorResolution {
  /** Live paragraph UUID the card resolves to now, or `null` for orphan. */
  paragraphId: string | null;
  /** Which anchor mode produced the binding (`null` only for orphan). */
  mode: "A" | "B" | null;
  /** Which ladder rung produced the binding. */
  source: AnchorSource;
  /** `high` for uuid/mark (live anchor survives), `low` for snapshot/orphan. */
  confidence: "high" | "low";
  /** The Mode-B anchorId still backing the card (for mark re-apply), or
   *  `null`. Set only when a surviving `textRange.anchorId` exists. */
  liveAnchorId: string | null;
}

export interface ResolveIndex {
  /** Every `uuid` attr on a live anchorable node. */
  uuidToParagraph: Set<string>;
  /** Live `linkedAnchor` mark anchorId → its enclosing paragraph uuid. */
  anchorIdToParagraph: Map<string, string>;
  /** Normalized whole-paragraph `textContent` → live paragraph uuid
   *  (first-match-wins on duplicated text). Returns `null` when no live
   *  paragraph matches, OR when the normalized text is empty. */
  snapshotToParagraph: (normalizedSnapshot: string) => string | null;
}

// ---------------------------------------------------------------------------
// Normalization (shared by the index AND, in CHIP-D, by captureParagraphSnapshot)
// ---------------------------------------------------------------------------

/** Zero-width characters stripped before comparison: ZWSP (U+200B),
 *  ZWNJ (U+200C), ZWJ (U+200D), word-joiner (U+2060), and the BOM /
 *  zero-width no-break space (U+FEFF). Written as explicit code-point
 *  escapes so the source has no invisible characters. */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

/**
 * Canonical form for whole-paragraph snapshot comparison: trim the ends,
 * collapse every internal whitespace run to a single space, and strip
 * zero-width characters. This is the SAME normalization the resolve index
 * applies to live `textContent`, so a snapshot captured through the same
 * function compares equal across LaTeX round-trip whitespace drift.
 *
 * Exported so CHIP-D can apply it at `captureParagraphSnapshot` time —
 * capture and match MUST use the identical form.
 */
export function normalizeParagraphText(s: string): string {
  return s.replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Index builder — ONE O(doc) pass, card-count-independent
// ---------------------------------------------------------------------------

/**
 * Build the per-resolve index from the live editor. O(doc), independent
 * of card count — build ONCE per reconcile/render pass, then resolve each
 * card in O(1) against it.
 *
 * Three lookups, populated together:
 *   - `uuidToParagraph` — reuses `collectLiveUuids` (the live `uuid` set).
 *   - `anchorIdToParagraph` — every `linkedAnchor` mark's anchorId mapped
 *     to its enclosing paragraph uuid (modeled on
 *     `collectLinksFromEditor`'s mark walk).
 *   - `snapshotToParagraph` — a closure over a normalized-textContent →
 *     uuid map; first-match-wins on duplicated text, and duplicates are
 *     recorded so a collision is detectable (a duplicated normalized key
 *     still resolves to its FIRST uuid — documented, position
 *     disambiguation is backlog).
 *
 * Cost: `collectLiveUuids` is one full descendants walk and the
 * mark+snapshot pass below is one more — both O(doc) and constant in the
 * number of cards. The contract's "never O(doc·cards)" is the load-bearing
 * invariant: no per-card walking.
 */
export function buildResolveIndex(editor: Editor): ResolveIndex {
  const uuidToParagraph = collectLiveUuids(editor);
  const anchorIdToParagraph = new Map<string, string>();

  // Normalized whole-paragraph text → uuid, first-match-wins. A second
  // uuid for the same normalized text is recorded in `dupKeys` so a
  // collision is detectable, but the map keeps the FIRST uuid (matching
  // `findParagraphIdBySnapshot`'s documented first-match behavior).
  const normTextToParagraph = new Map<string, string>();
  const dupKeys = new Set<string>();

  const doc = editor.state.doc;
  doc.descendants((node, pos) => {
    // (a) linkedAnchor marks → enclosing paragraph uuid.
    if (node.isText) {
      for (const m of node.marks) {
        if (m.type.name !== "linkedAnchor") continue;
        const anchorId = (m.attrs.anchorId as string) || "";
        if (!anchorId || anchorIdToParagraph.has(anchorId)) continue;
        const paragraphId = paragraphUuidAt(doc, pos);
        if (paragraphId) anchorIdToParagraph.set(anchorId, paragraphId);
      }
      return true;
    }

    // (b) uuid-bearing nodes → normalized-textContent map.
    const uuid = (node.attrs as { uuid?: string } | null)?.uuid;
    if (uuid) {
      const key = normalizeParagraphText(node.textContent);
      if (key) {
        if (normTextToParagraph.has(key)) {
          dupKeys.add(key);
        } else {
          normTextToParagraph.set(key, uuid);
        }
      }
    }
    return true;
  });

  const snapshotToParagraph = (normalizedSnapshot: string): string | null => {
    if (!normalizedSnapshot) return null;
    return normTextToParagraph.get(normalizedSnapshot) ?? null;
  };

  return { uuidToParagraph, anchorIdToParagraph, snapshotToParagraph };
}

// ---------------------------------------------------------------------------
// The resolution ladder
// ---------------------------------------------------------------------------

/**
 * Resolve where a card is anchored NOW, against a pre-built index.
 *
 * Priority ladder — **uuid STRICTLY before snapshot**:
 *   1. Any Mode-A link (`targetKind !== "linkedRange"`) whose
 *      `textObjectIds[0]` is a live uuid → `{mode:'A', source:'uuid',
 *      high}`. A still-live UUID always wins, even over a snapshot that
 *      would match a different sibling.
 *   2. Else a Mode-B link (`targetKind === "linkedRange"`) whose
 *      `textRange.anchorId` resolves via `anchorIdToParagraph` →
 *      `{mode:'B', source:'mark', liveAnchorId, high}`.
 *   2b. RC1 self-heal — Else a POISONED `linkedRange` link (mark dead, so
 *      rung 2 missed it) whose `textObjectIds` contains a live uuid →
 *      `{mode:'A', source:'uuid', high}` on that paragraph. This is the
 *      legacy hybrid `addTextObjectLink` left behind when it folded the
 *      re-anchor's new paragraph into the surviving linkedRange link
 *      instead of writing a clean Mode-A link (RC1 in
 *      MEMO_CARD_DROP_MARGIN_FIX.md). It runs STRICTLY after the mark rung,
 *      so a healthy Mode-B card (live mark + live containing paragraph) is
 *      never hijacked onto its paragraph — and STILL before the snapshot
 *      rung, preserving "uuid before snapshot."
 *   3. Else any link's snapshot — Mode-A `paragraphSnapshot` or Mode-B
 *      `textRange.textSnapshot` — normalized and matched against
 *      `snapshotToParagraph` → `{source:'snapshot', low}`. The mode is
 *      reported per the link the snapshot came from.
 *   4. Else `{paragraphId:null, source:'orphan', low}`.
 *
 * Pure — reads only the card and the pre-built index. `editor` is accepted
 * for symmetry with the chip contract and future use; the index already
 * carries every live-doc lookup, so this function never walks the doc.
 */
export function resolveCardAnchor(
  card: CardWithLinks,
  editor: Editor | null,
  index: ResolveIndex,
): CardAnchorResolution {
  void editor; // accepted for contract symmetry; the index carries every lookup
  const links = card.links ?? [];

  // --- Rung 1: Mode-A uuid (strictly first) -------------------------------
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    if (link.anchor.targetKind === "linkedRange") continue;
    const pid = link.anchor.textObjectIds[0];
    if (pid && index.uuidToParagraph.has(pid)) {
      return {
        paragraphId: pid,
        mode: "A",
        source: "uuid",
        confidence: "high",
        liveAnchorId: null,
      };
    }
  }

  // --- Rung 2: Mode-B surviving mark --------------------------------------
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    if (link.anchor.targetKind !== "linkedRange") continue;
    const anchorId = link.anchor.textRange?.anchorId;
    if (!anchorId) continue;
    const paragraphId = index.anchorIdToParagraph.get(anchorId);
    if (paragraphId) {
      return {
        paragraphId,
        mode: "B",
        source: "mark",
        confidence: "high",
        liveAnchorId: anchorId,
      };
    }
  }

  // --- Rung 2b: RC1 self-heal — poisoned linkedRange w/ a live uuid -------
  // The mark is dead (rung 2 missed it), but `addTextObjectLink`'s legacy
  // fold left the re-anchor's new paragraph in this link's `textObjectIds`.
  // If any of them is live, treat it as a clean Mode-A uuid binding. Strictly
  // after the mark rung (so a healthy Mode-B is never hijacked) and before
  // the snapshot rung (so uuid still beats snapshot).
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    if (link.anchor.targetKind !== "linkedRange") continue;
    for (const pid of link.anchor.textObjectIds) {
      if (pid && index.uuidToParagraph.has(pid)) {
        return {
          paragraphId: pid,
          mode: "A",
          source: "uuid",
          confidence: "high",
          liveAnchorId: null,
        };
      }
    }
  }

  // --- Rung 3: snapshot fallback (low confidence) -------------------------
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    const isModeB = link.anchor.targetKind === "linkedRange";
    const rawSnapshot = isModeB
      ? link.anchor.textRange?.textSnapshot
      : link.anchor.paragraphSnapshot;
    if (!rawSnapshot) continue;
    const paragraphId = index.snapshotToParagraph(
      normalizeParagraphText(rawSnapshot),
    );
    if (paragraphId) {
      return {
        paragraphId,
        mode: isModeB ? "B" : "A",
        source: "snapshot",
        confidence: "low",
        // Preserve the Mode-B anchorId (even though the mark is gone) so a
        // caller relocating the card by snapshot can re-apply the mark.
        liveAnchorId: isModeB ? link.anchor.textRange?.anchorId ?? null : null,
      };
    }
  }

  // --- Rung 4: orphan -----------------------------------------------------
  return {
    paragraphId: null,
    mode: null,
    source: "orphan",
    confidence: "low",
    liveAnchorId: null,
  };
}

// ---------------------------------------------------------------------------
// The lone pure card mutator the load pass calls
// ---------------------------------------------------------------------------

/**
 * Reconcile a card's stored links to a resolution. The ONLY pure card
 * mutator the load reconcile pass invokes. Idempotent: a second call on a
 * just-reconciled card returns `changed:false` (no save loop).
 *
 *   - `source === 'uuid'` → the card is already on the live paragraph;
 *     BACKFILL a missing/stale `paragraphSnapshot` from the live text so
 *     the snapshot fallback stays durable. No id rewrite.
 *   - `source === 'snapshot'` → the stored UUID is dead but the text was
 *     re-found. REWRITE `textObjectIds[0]` to `res.paragraphId` and
 *     restamp the snapshot. If the relocated link was Mode-B, CONVERT it
 *     to a clean Mode-A `{targetKind:'paragraph', textObjectIds:[pid],
 *     paragraphSnapshot}` link (the mark is gone; the text re-find is the
 *     only surviving binding, so it becomes a paragraph anchor).
 *   - `source === 'mark'` or `'orphan'` → no-op (mark survives / nothing
 *     recoverable).
 *
 * Returns a NEW card object when changed (never mutates the input in
 * place), so a stale reference can't observe the rewrite — preserving the
 * idempotency contract for callers that diff by identity.
 */
export function reconcileCardToResolved<T extends CardWithLinks>(
  card: T,
  res: CardAnchorResolution,
): { card: T; changed: boolean } {
  const links = card.links;
  if (!Array.isArray(links) || links.length === 0) {
    return { card, changed: false };
  }

  if (res.source === "uuid" && res.paragraphId) {
    return backfillUuidSnapshot(card, res.paragraphId, links);
  }

  if (res.source === "snapshot" && res.paragraphId) {
    return relocateBySnapshot(card, res, links);
  }

  // mark / orphan → nothing to write.
  return { card, changed: false };
}

/**
 * `source === 'uuid'`: backfill a missing/stale `paragraphSnapshot` on the
 * Mode-A link that owns the resolved paragraph. Idempotent — when the
 * snapshot already equals the (normalized) live text, returns
 * `changed:false`.
 *
 * The live snapshot is stored in NORMALIZED form so a second pass — which
 * reads the same normalized live text — compares equal and is a no-op. The
 * normalized form is also what the snapshot rung matches against, so a
 * future reload-by-snapshot resolves correctly.
 */
function backfillUuidSnapshot<T extends CardWithLinks>(
  card: T,
  paragraphId: string,
  links: Link[],
): { card: T; changed: boolean } {
  // No editor here — the resolution already proved the uuid is live, but
  // the live text isn't carried on the resolution. The index doesn't carry
  // per-uuid text either. So backfill is best-effort from what the link
  // already knows: we can only stamp a normalized form of an EXISTING
  // snapshot (cleaning a legacy un-normalized one). A missing snapshot is
  // left missing here — the editor-aware load pass (RC-A) backfills the
  // real text via `captureParagraphSnapshot`; this pure mutator only
  // canonicalizes what's present so idempotency holds.
  let changed = false;
  const next = links.map((link) => {
    if (link.anchor.type !== "textObject") return link;
    if (link.anchor.targetKind === "linkedRange") return link;
    if (link.anchor.textObjectIds[0] !== paragraphId) return link;
    const snap = link.anchor.paragraphSnapshot;
    if (!snap) return link; // nothing to canonicalize; RC-A fills real text
    const normalized = normalizeParagraphText(snap);
    if (normalized === snap) return link; // already canonical → idempotent
    changed = true;
    return {
      ...link,
      anchor: { ...link.anchor, paragraphSnapshot: normalized },
    };
  });
  if (!changed) return { card, changed: false };
  return { card: { ...card, links: next }, changed: true };
}

/**
 * `source === 'snapshot'`: the stored UUID is dead; rewrite the link to the
 * re-found live paragraph. Mode-A → rewrite `textObjectIds[0]` + restamp
 * snapshot. Mode-B → CONVERT to a clean Mode-A paragraph link (drop the
 * dead `textRange` mark binding; the text re-find is now the only anchor).
 *
 * Idempotent: after the rewrite, `textObjectIds[0]` is the live uuid, so a
 * second resolve hits the uuid rung (not snapshot) → `reconcileCardToResolved`
 * routes to the no-op/backfill branch. (We also guard here: if the link is
 * already a clean Mode-A on `paragraphId` with the normalized snapshot, no
 * change.)
 */
function relocateBySnapshot<T extends CardWithLinks>(
  card: T,
  res: CardAnchorResolution,
  links: Link[],
): { card: T; changed: boolean } {
  const paragraphId = res.paragraphId!;
  // Which link carried the matching snapshot? Re-derive by mode so we
  // rewrite the right one. The resolver reports `mode` for the snapshot
  // rung, so match Mode-B vs Mode-A accordingly.
  let changed = false;
  const next = links.map((link) => {
    if (link.anchor.type !== "textObject") return link;
    const isModeBLink = link.anchor.targetKind === "linkedRange";

    if (res.mode === "B" && isModeBLink) {
      const snap = link.anchor.textRange?.textSnapshot;
      if (!snap) return link;
      // CONVERT Mode-B → clean Mode-A. Drop textRange (the mark is gone),
      // anchor on the re-found paragraph, stamp a normalized snapshot.
      changed = true;
      return {
        ...link,
        anchor: {
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds: [paragraphId],
          margin: link.anchor.margin,
          paragraphSnapshot: normalizeParagraphText(snap),
        },
      };
    }

    if (res.mode === "A" && !isModeBLink) {
      const snap = link.anchor.paragraphSnapshot;
      if (!snap) return link;
      // Already correctly bound + canonical → idempotent no-op.
      const normalized = normalizeParagraphText(snap);
      if (
        link.anchor.textObjectIds[0] === paragraphId &&
        link.anchor.paragraphSnapshot === normalized
      ) {
        return link;
      }
      changed = true;
      const newIds = link.anchor.textObjectIds.slice();
      newIds[0] = paragraphId;
      return {
        ...link,
        anchor: {
          ...link.anchor,
          textObjectIds: newIds,
          paragraphSnapshot: normalized,
        },
      };
    }

    return link;
  });
  if (!changed) return { card, changed: false };
  return { card: { ...card, links: next }, changed: true };
}
