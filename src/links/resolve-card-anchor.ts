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
import { normalizeParagraphText } from "./_shared/normalize-text";
import { paragraphUuidAt, type CardWithLinks } from "./links";

// Re-export so consumers (and CHIP-D's capture side) keep importing the
// canonical normalization from the resolver's public surface, even though
// the implementation lives in a leaf module to break the links.ts cycle.
export { normalizeParagraphText };

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
  /** Live `uuid` → its document position (first match wins, document order).
   *  Populated by the SAME walk that builds the mark/snapshot lookups, so it
   *  costs no extra pass. It exists so the omni surface can seed a card's row
   *  positions from THIS index instead of running an O(doc) `descendants` walk
   *  per pid (`findParagraphPos`, retired by task 369). */
  uuidToPos: Map<string, number>;
  /** Live `linkedAnchor` mark anchorId → its enclosing paragraph uuid. */
  anchorIdToParagraph: Map<string, string>;
  /** Normalized whole-paragraph `textContent` → live paragraph uuid
   *  (first-match-wins on duplicated text). Returns `null` when no live
   *  paragraph matches, OR when the normalized text is empty. */
  snapshotToParagraph: (normalizedSnapshot: string) => string | null;
}

// ---------------------------------------------------------------------------
// Normalization — see `_shared/normalize-text.ts` (re-exported at the top of
// this file). Canonical form shared by the index AND, since CHIP-D, by
// `captureParagraphSnapshot`. Lives in a leaf module to break the links.ts
// import cycle (links.ts imports it; this file imports links.ts).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Index builder — ONE O(doc) pass, card-count-independent
// ---------------------------------------------------------------------------

/**
 * Build the per-resolve index from the live editor. O(doc), independent
 * of card count — build ONCE per reconcile/render pass, then resolve each
 * card in O(1) against it.
 *
 * Three lookups, populated together by ONE walk:
 *   - `uuidToPos` — every live `uuid` → its document position, and
 *     `uuidToParagraph` is its key set. This used to be a SECOND, redundant
 *     `collectLiveUuids` pass; since task 369 the same walk that reads the
 *     marks and the snapshots carries the position, so the set is derived
 *     rather than re-walked. (The only shape the two passes could ever have
 *     disagreed on is a TEXT node carrying a `uuid` attr — the walk below
 *     returns early for text — and the schema has none: no member of
 *     `UUID_BEARING_NODE_TYPES` is inline and there is no
 *     `addGlobalAttributes` anywhere in `src/`.)
 *   - `anchorIdToParagraph` — every `linkedAnchor` mark's anchorId mapped
 *     to its enclosing paragraph uuid (modeled on
 *     `collectLinksFromEditor`'s mark walk).
 *   - `snapshotToParagraph` — a closure over a normalized-textContent →
 *     uuid map; first-match-wins on duplicated text, and duplicates are
 *     recorded so a collision is detectable (a duplicated normalized key
 *     still resolves to its FIRST uuid — documented, position
 *     disambiguation is backlog).
 *
 * Cost: ONE full `descendants` walk, O(doc) and constant in the number of
 * cards. The contract's "never O(doc·cards)" is the load-bearing invariant:
 * no per-card walking.
 */
export function buildResolveIndex(editor: Editor): ResolveIndex {
  const anchorIdToParagraph = new Map<string, string>();
  const uuidToPos = new Map<string, number>();

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

    // (b) uuid-bearing nodes → normalized-textContent map (+ the position
    // map, first-match-wins in document order — the same node
    // `findParagraphPos` used to return).
    const uuid = (node.attrs as { uuid?: string } | null)?.uuid;
    if (uuid) {
      if (!uuidToPos.has(uuid)) uuidToPos.set(uuid, pos);
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

  // The live-uuid SET is the position map's key set — same walk, no second pass.
  const uuidToParagraph = new Set(uuidToPos.keys());

  const snapshotToParagraph = (normalizedSnapshot: string): string | null => {
    if (!normalizedSnapshot) return null;
    return normTextToParagraph.get(normalizedSnapshot) ?? null;
  };

  return { uuidToParagraph, uuidToPos, anchorIdToParagraph, snapshotToParagraph };
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
 * Optional editor-aware inputs the RC-A load pass threads in so the pure
 * mutator can do the two things the resolution alone can't carry:
 *
 *   - `liveText` — the live paragraph's text (the load pass reads it once
 *     via `captureParagraphSnapshot`, already normalized). On a
 *     `source:'uuid'` resolution this BACKFILLS a MISSING snapshot from
 *     real text (AUGMENTATION 1). Without it, a missing snapshot stays
 *     missing (R0's pure-only behavior).
 *   - `isAnchorIdLive` — `index.anchorIdToParagraph.has`. On a
 *     `source:'uuid'` resolution it detects a residual `linkedRange` link
 *     whose mark anchorId is DEAD (rung 2b self-heal left it behind) so the
 *     pass can STRIP/convert it to a clean Mode-A link (AUGMENTATION 2 —
 *     the HYBRID CLEANUP class fix for re-anchored Mode-B todo/revision/
 *     cutter/report). Without it, no cleanup (R0 behavior).
 */
export interface ReconcileOpts {
  /** Normalized live paragraph text for the resolved uuid, or null/absent. */
  liveText?: string | null;
  /** True iff the given linkedRange anchorId still backs a live mark. */
  isAnchorIdLive?: (anchorId: string) => boolean;
}

/**
 * Reconcile a card's stored links to a resolution. The ONLY pure card
 * mutator the load reconcile pass invokes. Idempotent: a second call on a
 * just-reconciled card returns `changed:false` (no save loop).
 *
 *   - `source === 'uuid'` → the card is already on the live paragraph;
 *     BACKFILL a missing/stale `paragraphSnapshot` (from `opts.liveText`
 *     when present, else canonicalize an existing one) AND, via
 *     `opts.isAnchorIdLive`, STRIP a residual dead-mark `linkedRange` link
 *     (HYBRID CLEANUP) so `getTextAnchor(card)` returns null afterward. No
 *     id rewrite.
 *   - `source === 'snapshot'` → the stored UUID is dead but the text was
 *     re-found. REWRITE `textObjectIds[0]` to `res.paragraphId` and
 *     restamp the snapshot. If the relocated link was Mode-B, CONVERT it
 *     to a clean Mode-A `{targetKind:'paragraph', textObjectIds:[pid],
 *     paragraphSnapshot}` link (the mark is gone; the text re-find is the
 *     only surviving binding, so it becomes a paragraph anchor).
 *   - `source === 'mark'` or `'orphan'` → no-op (mark survives / nothing
 *     recoverable).
 *
 * `opts` is optional — called WITHOUT it (R0 pure callers / existing tests)
 * the function behaves exactly as before (no backfill from live text, no
 * hybrid cleanup). The editor-aware RC-A pass supplies it.
 *
 * Returns a NEW card object when changed (never mutates the input in
 * place), so a stale reference can't observe the rewrite — preserving the
 * idempotency contract for callers that diff by identity.
 */
export function reconcileCardToResolved<T extends CardWithLinks>(
  card: T,
  res: CardAnchorResolution,
  opts?: ReconcileOpts,
): { card: T; changed: boolean } {
  const links = card.links;
  if (!Array.isArray(links) || links.length === 0) {
    return { card, changed: false };
  }

  if (res.source === "uuid" && res.paragraphId) {
    return backfillUuidSnapshot(card, res.paragraphId, links, opts);
  }

  if (res.source === "snapshot" && res.paragraphId) {
    return relocateBySnapshot(card, res, links);
  }

  // mark / orphan → nothing to write.
  return { card, changed: false };
}

/**
 * `source === 'uuid'`: the card is bound to a live paragraph via the uuid
 * rung (rung 1, or the rung-2b RC1 self-heal). Two repairs, both idempotent:
 *
 * (A) BACKFILL the Mode-A link's `paragraphSnapshot`. With `opts.liveText`
 *     (RC-A's editor-aware pass) a MISSING snapshot is filled from the real
 *     normalized live text; without it, an EXISTING non-canonical snapshot
 *     is canonicalized (R0 pure behavior — a missing one stays missing).
 *     `opts.liveText` arrives already normalized (RC-A normalizes at
 *     capture, CHIP-D), so a second pass compares equal and is a no-op.
 *
 * (B) HYBRID CLEANUP (AUGMENTATION 2): strip/convert any residual
 *     `linkedRange` (Mode-B) link whose mark anchorId is DEAD
 *     (`opts.isAnchorIdLive(anchorId) === false`). This is the inert hybrid
 *     a re-anchored Mode-B todo/revision/cutter/report left behind (CHIP-A
 *     only wired the write-side `clearModeB` for notes). After cleanup the
 *     card carries NO live `textRange`, so `getTextAnchor` returns null and
 *     the Mode-B re-apply can't drag it back. The dead link becomes a clean
 *     Mode-A `{paragraph,[paragraphId]}` link UNLESS a clean Mode-A link on
 *     `paragraphId` already exists (the double-link hybrid), in which case
 *     it's dropped — leaving exactly one clean Mode-A link. Guarded by
 *     `isAnchorIdLive` so a HEALTHY Mode-B (live mark) is never touched —
 *     but note rung 2 already wins for those, so `source` wouldn't be
 *     'uuid' there anyway; this is belt-and-suspenders.
 */
function backfillUuidSnapshot<T extends CardWithLinks>(
  card: T,
  paragraphId: string,
  links: Link[],
  opts?: ReconcileOpts,
): { card: T; changed: boolean } {
  const liveText = opts?.liveText ? normalizeParagraphText(opts.liveText) : null;
  const isAnchorIdLive = opts?.isAnchorIdLive;

  // Does a clean Mode-A link already cover `paragraphId`? Used by cleanup to
  // decide convert-vs-drop so we never end up with two links on the same pid.
  const hasCleanModeAOnPid = links.some(
    (l) =>
      l.anchor.type === "textObject" &&
      l.anchor.targetKind !== "linkedRange" &&
      l.anchor.textObjectIds[0] === paragraphId,
  );

  let changed = false;
  const next: Link[] = [];
  for (const link of links) {
    if (link.anchor.type !== "textObject") {
      next.push(link);
      continue;
    }

    const isModeBLink = link.anchor.targetKind === "linkedRange";

    // (B) HYBRID CLEANUP — a dead-mark linkedRange residue.
    if (isModeBLink && isAnchorIdLive) {
      const anchorId = link.anchor.textRange?.anchorId;
      // Only act when the mark is provably DEAD. (No anchorId → also dead.)
      const markDead = !anchorId || !isAnchorIdLive(anchorId);
      if (markDead) {
        changed = true;
        if (hasCleanModeAOnPid) {
          // A clean Mode-A link already owns this paragraph → drop the dead
          // hybrid link entirely (avoids a duplicate anchor on `paragraphId`).
          continue;
        }
        // No clean Mode-A link yet → CONVERT the dead link into one, anchored
        // on the resolved paragraph with a normalized snapshot (live text if
        // RC-A supplied it, else the link's stale textRange snapshot).
        const snap =
          liveText ??
          (link.anchor.textRange?.textSnapshot
            ? normalizeParagraphText(link.anchor.textRange.textSnapshot)
            : undefined);
        next.push({
          ...link,
          anchor: {
            type: "textObject",
            targetKind: "paragraph",
            textObjectIds: [paragraphId],
            ...(snap ? { paragraphSnapshot: snap } : {}),
          },
        });
        continue;
      }
      // Mark still live (healthy Mode-B) → leave untouched.
      next.push(link);
      continue;
    }

    // (A) BACKFILL on the resolved Mode-A link.
    if (!isModeBLink && link.anchor.textObjectIds[0] === paragraphId) {
      const snap = link.anchor.paragraphSnapshot;
      // Editor-aware: backfill a MISSING snapshot from live text.
      if (!snap && liveText) {
        changed = true;
        next.push({
          ...link,
          anchor: { ...link.anchor, paragraphSnapshot: liveText },
        });
        continue;
      }
      // Canonicalize an existing non-canonical snapshot (pure R0 behavior).
      if (snap) {
        const normalized = liveText ?? normalizeParagraphText(snap);
        if (normalized !== snap) {
          changed = true;
          next.push({
            ...link,
            anchor: { ...link.anchor, paragraphSnapshot: normalized },
          });
          continue;
        }
      }
    }

    next.push(link);
  }

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
