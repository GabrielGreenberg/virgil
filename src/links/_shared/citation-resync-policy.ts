"use client";

/**
 * The citation add/resync reconciler — as a POLICY on the single W1b bus
 * consumer (T5 §3 Pillar C-1, PLAN D1.4 / W2c — registered via
 * `IdentityBusConsumer.registerPolicy`, NOT a new `editor.on('update')` /
 * `onCitationsAdded` / `onCitationsRemoved` subscription). This is the
 * +1-not-+3 invariant: the only inline-atom bus subscription is the one in
 * `useIdentityBusConsumer`; every reactor to citation add/remove is a policy
 * fanned out from it.
 *
 * ROOT DEFICIENCY (T5 §2 / C17). The citation sidecar (the `CitationRef` list
 * the Citations / Bibliography panels read) is reconciled from the editor only
 * ONCE at component mount — `EditorPane`'s `syncFromEditor` effect is gated on
 * `[editor]`, stable across in-place edits. So a `\cite` added or deleted
 * out-of-band (a code-view edit, a Backspace over the marker) leaves the panel
 * stale until a full reload:
 *   - CI-F8-03 — a code-view-added `\cite` shows no card until reload.
 *   - CI-A1-01 — a `\cite` deleted in the editor leaves a dead, dashed card
 *     that can't jump.
 *
 * THE DEEP FIX (T5 Pillar C-1, "consume the diff, don't snapshot at mount").
 * The add/remove of a `\cite` marker is observable on the `DocStructureBus` as
 * `diff.addedCitations` / `diff.removedCitations`. This policy re-runs the
 * EXISTING `syncFromEditor` reconcile whenever a citation entered or left the
 * top-level doc, so the sidecar tracks the live editor without a remount —
 * `syncFromEditor` re-derives every anchored `CitationRef` from the live
 * `getCitations()` and preserves the panel-only `unanchored` ones, so it is
 * idempotent and covers BOTH the add (a new atom appears in `getCitations()`)
 * and the remove (a deleted atom drops out → its dead card prunes).
 *
 * COORDINATION WITH W2b (the +1-not-+3 / "do not double-own" rule, PLAN W2c).
 * W2b's `useInlineAtomLifecycle` owns the *cardStore / float* prune on a
 * citation removal; W2c owns the *sidecar* add/resync. They touch DIFFERENT
 * stores from the SAME diff (both policies on the one consumer), so CI-A1-01's
 * "card prunes without remount" is the sidecar half here acting in concert with
 * W2b's cardStore/float half — never a duplicated reconcile.
 *
 * THE REGEN-REMAP SKIP. A markerless whole-doc re-parse drops every citation
 * atom and re-inserts a fresh one IN THE SAME TRANSACTION with a regenerated
 * id; T1's regen policy (registered FIRST) already matched dropped↔added by
 * `command` and re-pointed selection/float/pin via the cascade. Those atoms are
 * survivors, not real adds/removes. `syncFromEditor` re-derives from the live
 * `getCitations()` anyway, so re-running it after a pure regen is HARMLESS (it
 * rebuilds the same anchored set under the new ids). But a re-parse that is
 * ONLY a regen (every added id is a remap value, every removed id is a remap
 * key, and the live citation set is unchanged in size) need not re-derive — we
 * skip it so a re-parse storm doesn't thrash the sidecar write. A re-parse that
 * ALSO adds a genuinely-new `\cite` (an added id with no remap counterpart)
 * still resyncs (that's the CI-F8-03 path arriving via the code view).
 *
 * KEYSTROKE SANCTITY. This runs only inside the single consumer's dispatch,
 * which the bus handler bails O(1) on for any non-atom transaction — a plain
 * in-paragraph keystroke adds/removes no citation, so the policy never fires and
 * `syncFromEditor` (which writes the sidecar) is never called. Per fire the
 * policy is O(1) plus the cost of one `syncFromEditor`, which is O(citations) —
 * gated behind a real citation add/remove, never per-keystroke.
 *
 * PURE LOGIC: no React, no editor import. The policy is built by a factory that
 * closes over injected deps (a `resyncCitations` callback the mount hook wires
 * to `syncFromEditor(getCitations())`). Unit-testable with plain stubs.
 */

import type {
  InlineAtomPolicy,
  InlineAtomPolicyContext,
} from "@/lib/identity/identity-bus-consumer";
import type { StructureDiff } from "@/lib/tiptap/doc-structure";

/** The injected surface the citation-resync policy drives. The mount hook wires
 *  `resyncCitations` to re-read the editor's live citations and feed them to the
 *  citations hook's `syncFromEditor`. */
export interface CitationResyncDeps {
  /** Re-derive the citation sidecar from the live editor (the existing
   *  `syncFromEditor` reconcile). Idempotent — re-derives anchored from the
   *  live `getCitations()` and preserves panel-only `unanchored` entries. */
  resyncCitations: () => void;
}

/**
 * True iff this diff's citation add/remove is ENTIRELY accounted for by the
 * regen remap T1 already applied — i.e. every added id is a remap value and
 * every removed id is a remap key, with matched counts. Such a diff is a pure
 * markerless re-parse (survivors re-pointed by T1), not a real add/remove, so
 * the sidecar already tracks the live set under the new ids and a resync would
 * only thrash the write. A diff that adds a genuinely-new `\cite` (an added id
 * absent from the remap values) is NOT pure-regen and must resync (CI-F8-03 via
 * the code view).
 */
function isPureCitationRegen(
  diff: StructureDiff,
  remap: ReadonlyMap<string, string>,
): boolean {
  if (remap.size === 0) return false; // not a re-parse at all → real add/remove
  const added = diff.addedCitations;
  const removed = diff.removedCitations;
  if (added.length === 0 && removed.length === 0) return false;
  const remapValues = new Set(remap.values());
  // Every added citation must be a remap target (a re-pointed survivor).
  for (const a of added) {
    if (!remapValues.has(a.id)) return false; // a genuinely-new cite → resync
  }
  // Every removed citation must be a remap key (a re-pointed survivor).
  for (const r of removed) {
    if (!remap.has(r.id)) return false; // a genuine delete → resync
  }
  return true;
}

/**
 * Build the W2c citation add/resync policy. Registered on the single bus
 * consumer (AFTER T1's regen policy, so `ctx.remap` is populated). Fires the
 * sidecar resync whenever a citation entered or left the top-level doc and the
 * change is not a pure regen-remap.
 */
export function makeCitationResyncPolicy(
  deps: CitationResyncDeps,
): InlineAtomPolicy {
  return (diff: StructureDiff, ctx: InlineAtomPolicyContext) => {
    if (diff.addedCitations.length === 0 && diff.removedCitations.length === 0) {
      return; // no citation entered/left — nothing to resync
    }
    if (isPureCitationRegen(diff, ctx.remap)) {
      // A markerless re-parse with no genuine add/delete — T1 already
      // re-pointed the survivors; the sidecar tracks the live set. Skip.
      return;
    }
    deps.resyncCitations();
  };
}
