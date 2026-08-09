import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isAnchorableNode } from "@/lib/marginalia";
import { isDeferredInnerParagraph } from "@/lib/anchor-uuid";
import { readDocStructure } from "@/lib/tiptap/doc-structure";
import { generateShortId } from "@/lib/uuid";

// ─────────────────────────────────────────────────────────────────────────────
// BlockUuidBackfill — universal, keystroke-safe block identity.
//
// THE BUG IT FIXES
// Blocks created by `rangeSliceToBlocks` (the lifted-range / between-paragraphs
// drop), by paste, and by any other slice insertion are bare nodes whose
// `uuid` defaults to null (UUID_ATTR_SPEC). The grab handle finds graspable
// blocks via `querySelectorAll("[data-uuid]")` (resolveTextObjectsAtMouse),
// and `UuidAttrDecorator` only emits `data-uuid` for a NON-null uuid. uuids are
// otherwise minted lazily on interaction (`ensureAnchorUuid`) — but a block
// with no handle can't be interacted with to trigger that mint. So a dropped /
// pasted block stays handle-less: it has lost its text-object identity.
//
// THE FIX — ONE transaction-time backfill (not a per-call-site patch)
// This plugin guarantees that every anchorable block carries a unique, non-null
// `uuid` by the END of the transaction that inserted it. Drops, pastes, splits
// and any future programmatic insertion are therefore immediately graspable.
// `ensureAnchorUuid` stays as the lazy belt-and-suspenders path. The load-time
// sibling is `assignUuids` (latex-serializer): this is its live-insertion
// complement, centralizing block identity for ALL insertions in one place.
//
// KEYSTROKE SANCTITY (binding — see AGENTS.md)
// Runs in `appendTransaction`, registered right AFTER `DocStructureObserver`.
//   • O(1) bail on `!tr.docChanged`.
//   • Work is proportional to the INSERTED step ranges only (the same ranges
//     the observer's own `collectRange` walks every keystroke), NEVER a
//     full-doc walk. Plain typing inserts inline content with no block-start in
//     range → zero candidates → returns null before reading any doc-sized set.
//   • The one O(live-block-count) read (the observer's known-uuid set, to mint
//     collision-free + detect genuine duplicates) happens ONLY once at least
//     one inserted block needs an id — i.e. on a real structural insert, never
//     on a structurally-null keystroke.
// Note: we cannot consume `diff.addedBlocks` here — the step-inspector only
// records a block in `addedBlocks` when it ALREADY has a non-null, non-
// duplicate uuid (inspectNodeAt: `if (uuid && isAnchorableNode)` + the
// prevStructure dedup filter). A freshly-inserted null/duplicate-uuid block is
// invisible to the diff, which is exactly the gap this plugin closes — so it
// reads the inserted ranges directly instead.
//
// LOOP SAFETY
// The backfill is one size-stable `setNodeMarkup` per fixed block,
// `addToHistory:false`, tagged with `BACKFILL_META`. The plugin skips any
// transaction carrying that meta, and returns null when nothing needs fixing
// (mirrors MarginaliaAnchorGuard). After the backfill every touched block holds
// a unique id, so a re-walk finds no genuine duplicate either way → no loop.
//
// IDENTITY PRESERVATION (moves + float sync)
// A uuid is re-minted only when it is a GENUINE duplicate: still live in the
// doc from before this batch AND not the subject of a removal in the same batch
// (and not already kept earlier this pass). So a block MOVE (lifted-overlay's
// own gesture: delete-here + insert-there) keeps its uuid — the source removal
// exempts it — and a float↔main `setContent` re-sync (every synced block is
// both removed and re-inserted with its main uuid) keeps every uuid too. Only
// real copies (e.g. an Enter-split's cloned half) get a fresh id.
//
// A NET, NOT A MECHANISM (task 320)
// This plugin can see that two blocks collide; it cannot see which one the user
// meant to keep. Left to decide alone it keeps the FIRST occurrence in document
// order — which for a range move is the empty residue the cut left behind, so
// the moved text is re-minted and every card anchored to those words silently
// detaches from them. A gesture that RELOCATES content therefore states its own
// identity before dispatch (`@/lib/tiptap/node-identity`, the collision rule
// read off the post-cut doc), and this net catches only what no mechanism
// declared. Same division of labour as the container fit: the caller decides,
// the guard refuses to let a mistake through.
//
// COORDINATES ARE PER-STEP (task 320)
// Step `si`'s positions live in `trk.docs[si]`, and reach the final doc through
// `trk.mapping.slice(si)` — its own map and the ones after it. Reading every
// step against `trk.before` and the FULL `trk.mapping` re-applies the earlier
// steps' maps to positions that already reflect them; for the delete-then-insert
// shape every relocation uses, that collapses the inserted range to nothing and
// the whole net goes silent while a duplicate lands in the document. (The same
// law the DocStructureObserver learned — see its multi-step step-inspector.)
// The RANGE stays the step's own span, never the ranges its StepMap reports: a
// ReplaceAroundStep's map omits the GAP, and a block lifted out of a
// listItem/blockquote becomes anchorable entirely inside that gap.
// ─────────────────────────────────────────────────────────────────────────────

const BACKFILL_META = "blockUuidBackfill";

// A `paragraph` nested directly inside a DEFERRING_PARENTS container defers its
// anchor identity to the parent (the real text-object), and its uuid is
// stripped at serialization — so we never mint on it. The set + the predicate
// (`isDeferredInnerParagraph`) are the SSOT in `@/lib/anchor-uuid`, imported
// rather than re-declared so the "grabbable text-object" boundary can't drift
// between the mint resolve, this backfill, and the decoration walk. Every other
// anchorable kind (incl. nested lists, and a single example's graphicsBlock /
// displayMath / list body) is minted, matching `resolveAnchorableNode`'s policy.

interface BackfillFix {
  pos: number;
  attrs: Record<string, unknown>;
}

/**
 * Invoke `visit` for every anchorable block whose OPENING token lies in
 * `[from, to)` of `doc`. Mirrors the step-inspector's `collectRange`: a node is
 * counted iff its start is inside the range, so ancestor blocks that merely
 * overlap (e.g. the enclosing paragraph while typing) are excluded. Cost is
 * proportional to the range, never the document.
 */
function forEachAnchorableStart(
  doc: PMNode,
  from: number,
  to: number,
  visit: (node: PMNode, pos: number, parent: PMNode | null) => void,
): void {
  const lo = Math.max(0, from);
  const hi = Math.min(to, doc.content.size);
  if (hi <= lo) return;
  doc.nodesBetween(lo, hi, (node, pos, parent) => {
    if (pos >= lo && pos < hi && isAnchorableNode(node.type)) {
      visit(node, pos, parent ?? null);
    }
    return true;
  });
}

/**
 * Compute the set of `setNodeMarkup` backfills needed so every anchorable block
 * inserted by `transactions` carries a unique, non-null uuid. Returns `[]` for a
 * structurally-null edit (the keystroke fast path) before touching any
 * doc-sized structure.
 */
function planBackfill(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): BackfillFix[] {
  const newDoc = newState.doc;
  // uuids whose owning block left the doc somewhere in this batch. A re-inserted
  // copy of such a uuid is a move / re-sync, not a duplicate → keep it.
  const removedUuids = new Set<string>();
  // Inserted anchorable blocks (deduped by position), in final-doc coordinates.
  const candidates: Array<{ pos: number; node: PMNode }> = [];
  const seenPos = new Set<number>();

  for (let k = 0; k < transactions.length; k++) {
    const trk = transactions[k];
    if (!trk.docChanged) continue;
    // Never re-process our own backfill (its setNodeMarkup steps would otherwise
    // be re-walked; harmless since the ids are unique, but skipping is cheaper
    // and makes loop-freedom explicit).
    if (trk.getMeta(BACKFILL_META)) continue;
    for (let si = 0; si < trk.steps.length; si++) {
      const step = trk.steps[si];
      // The step's own SPAN `[from, to)`, not the ranges its StepMap reports.
      // The two differ on exactly the case that matters: a `ReplaceAroundStep`'s
      // map covers only its two SIDE ranges, deliberately omitting the GAP — the
      // preserved content that changes PARENT. Anchorability here is a function
      // of the parent (`isDeferredInnerParagraph`), so a paragraph LIFTED out of
      // a listItem/blockquote to top level becomes a first-class text object
      // entirely inside that gap; taking ranges from the map alone made every
      // toggle-list-off / toggle-blockquote-off / Backspace-at-list-start leave
      // the lifted block with a null uuid, hence no `data-uuid`, hence no grab
      // handle and no anchorable target — verbatim the bug this plugin exists to
      // fix (review-caught). Steps that expose no span move no content and can
      // insert no block, so skipping them loses nothing.
      if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
        continue;
      }
      // Coordinates are PER-STEP, not per-transaction (task 320 — the same law
      // the DocStructureObserver learned): step `si`'s positions live in the doc
      // BEFORE step si (`trk.docs[si]`), and reach the final doc through the maps
      // FROM si onward (`trk.mapping.slice(si)`). Reading every step against
      // `trk.before` + the FULL `trk.mapping` re-applies the earlier steps' maps
      // to positions that already reflect them, which for a delete-then-insert
      // transaction collapses the inserted range to nothing — so a multi-block
      // range move's duplicated uuids reached the document with the net silent.
      const preDoc = trk.docs[si] ?? trk.before;
      const stepOnward = trk.mapping.slice(si);
      // Removed range, in this STEP's pre-doc coordinates.
      forEachAnchorableStart(preDoc, step.from, step.to, (node) => {
        const u = node.attrs?.uuid;
        if (typeof u === "string" && u) removedUuids.add(u);
      });
      // Inserted range, mapped into final-doc coordinates: this step's own map
      // and the rest of the transaction's, then any later transaction's.
      let from = stepOnward.map(step.from, -1);
      let to = stepOnward.map(step.to, 1);
      for (let j = k + 1; j < transactions.length; j++) {
        from = transactions[j].mapping.map(from, -1);
        to = transactions[j].mapping.map(to, 1);
      }
      forEachAnchorableStart(newDoc, from, to, (node, pos, parent) => {
        // A container-nested body paragraph (list / blockquote / code /
        // exampleItem / exampleBlock) defers to its parent — don't give it its
        // own identity (matches resolveAnchorableNode and keeps inner-paragraph
        // uuids out of the serialized .tex).
        if (isDeferredInnerParagraph(node, parent)) {
          return;
        }
        if (seenPos.has(pos)) return;
        seenPos.add(pos);
        candidates.push({ pos, node });
      });
    }
  }

  // Keystroke fast path: nothing structural was inserted → no doc-sized read.
  if (candidates.length === 0) return [];

  // A real insertion. NOW consult the observer's incrementally-maintained
  // known-uuid set (O(live blocks), but only on actual inserts — human-paced,
  // never per keystroke). It is the complete set of live anchorable uuids, so
  // minting against it is globally collision-free.
  const known = readDocStructure(oldState).blocks;
  const usedIds = new Set<string>(known.keys());
  const keptThisPass = new Set<string>();
  // Document order so "keep the first occurrence" matches assignUuids.
  candidates.sort((a, b) => a.pos - b.pos);

  const fixes: BackfillFix[] = [];
  for (const { pos, node } of candidates) {
    const u = node.attrs?.uuid;
    const hasId = typeof u === "string" && u.length > 0;
    const isDuplicate =
      hasId &&
      (keptThisPass.has(u as string) ||
        (usedIds.has(u as string) && !removedUuids.has(u as string)));
    if (hasId && !isDuplicate) {
      // Legitimate identity (pre-existing-and-moved, freshly minted upstream, or
      // the first occurrence of a uuid this pass). Register and keep.
      keptThisPass.add(u as string);
      usedIds.add(u as string);
      continue;
    }
    const fresh = generateShortId(usedIds);
    usedIds.add(fresh);
    keptThisPass.add(fresh);
    fixes.push({ pos, attrs: { ...node.attrs, uuid: fresh } });
  }
  return fixes;
}

/**
 * The raw ProseMirror plugin. Exported so it can be exercised in a plain
 * `EditorState` (no TipTap Editor) in tests.
 */
export function blockUuidBackfillPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("blockUuidBackfill"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const fixes = planBackfill(transactions, oldState, newState);
      if (fixes.length === 0) return null;
      const tr = newState.tr;
      for (const { pos, attrs } of fixes) {
        tr.setNodeMarkup(pos, undefined, attrs);
      }
      tr.setMeta(BACKFILL_META, true);
      tr.setMeta("addToHistory", false);
      return tr.steps.length > 0 ? tr : null;
    },
  });
}

/**
 * TipTap extension wrapper. Register right after `DocStructureObserver` in
 * `buildEditorExtensions` so the typed diff machinery is loaded first and both
 * the main editor and every float surface get universal block identity.
 */
export const BlockUuidBackfill = Extension.create({
  name: "blockUuidBackfill",
  addProseMirrorPlugins() {
    return [blockUuidBackfillPlugin()];
  },
});
