"use client";

/**
 * The inline-atom lifecycle reconciler — as a POLICY on the single W1b bus
 * consumer (T2 §3b, PLAN D1.4 — registered via `IdentityBusConsumer.
 * registerPolicy`, NOT a new `editor.on('update')` / `onFootnotes*` /
 * `onCitations*` subscription). This is the +1-not-+3 invariant: the only
 * inline-atom bus subscription is the one in `useIdentityBusConsumer`; every
 * reactor to citation/footnote add/remove is a policy fanned out from it.
 *
 * ON EACH inline-atom diff (after T1's regen-remap policy ran FIRST, so this
 * policy sees post-remap ids), it reconciles the four mirror stores against the
 * live atom set:
 *
 *  (a) ORPHAN upsert/clear (kills FN-A1-03 by construction).
 *      - A footnote whose marker left AND whose body has content → upsert an
 *        orphan record (so a deliberate-but-recoverable delete keeps its text).
 *      - A footnote/citation that came BACK (undo / redo / re-drop / re-anchor /
 *        code-view re-insert all route through `addedFootnotes`) → CLEAR its
 *        orphan record. This is the missing edge: the atom can never be
 *        simultaneously anchored AND orphan, so `FootnotePanel`'s id-keyed merge
 *        can never produce two `f007` cards → no React duplicate-key crash.
 *
 *  (b) cardStore PRUNE (kills the C14 selection-ghost class — FN-A1-01 etc.).
 *      When a footnote/citation's marker leaves and the id is NOT recoverable
 *      (not an orphan record, not still live), clear any `cardStore`
 *      selected/hover/expand ref that pointed at it, so a deleted atom never
 *      leaves a stale halo on an unrelated card or an id-reuse mis-paint window.
 *
 *  (c) poppedOutCards PRUNE / re-point. A popped float of a removed atom is
 *      CLOSED — unless the footnote has a recoverable orphan record, in which
 *      case the float is LEFT OPEN so it re-renders the orphan body rather than
 *      blanking (the orphan card renders from the durable sidecar). Citations
 *      have no orphan model here (W2b owns the remove-prune; T5/C17 owns the
 *      citation add-resync), so a removed citation's float always closes.
 *
 *  (d) selection / float RE-POINT on the regen remap. This policy also exposes
 *      the `inlineAtom`/`regenIds` migrator (`makeInlineAtomRegenMigrator`) the
 *      mount hook registers on the `IdentityCascade`, so a markerless re-parse
 *      that re-mints ids keeps the selected/floated card pointed at the NEW id
 *      (OMNI-F3-02, CI-A3-01, CI-F1-02 — until now the regen remap fanned to an
 *      EMPTY inlineAtom migrator set).
 *
 * PURE LOGIC: no React, no editor import. The policy is built by a factory that
 * closes over injected deps (the orphan API, a liveness/body snapshot accessor,
 * cardStore, a float-close fn). The mount hook (`useInlineAtomLifecycle`) wires
 * those from the editor / sidecar / view-prefs and registers the policy. The
 * factory + the regen migrator are unit-testable with plain stubs.
 *
 * KEYSTROKE SANCTITY: this runs only inside the single consumer's dispatch,
 * which the bus handler bails O(1) on for any non-atom transaction. Per fire it
 * is O(added + removed atoms), never O(doc).
 */

import { cardStore } from "./anchored-card-store";
import { cardKeyForEntity } from "./entity-hover";
import {
  type IdentityChange,
  type IdentityMigrator,
  isRegenIds,
} from "@/lib/identity/identity-cascade";
import type {
  InlineAtomPolicy,
  InlineAtomPolicyContext,
} from "@/lib/identity/identity-bus-consumer";
import type { StructureDiff } from "@/lib/tiptap/doc-structure";
import type { OrphanedFootnote } from "@/lib/types";

/** The body+title+thanks of a footnote whose marker just left, read from the
 *  consumer's liveness snapshot (the diff carries no body). `null` body ⇒ the
 *  footnote had no recoverable content (orphan-worthiness fails). */
export interface RemovedFootnoteContent {
  /** Rich-body JSON (TipTap doc) of the dying footnote, or null if empty. */
  content: unknown | null;
  /** Plain-text flatten of body + title — the orphan-worthiness test reads it. */
  plainText: string;
  title?: string;
  thanks?: boolean;
}

/** The injected surface the policy reconciles. Each method is side-effect-
 *  contained; the mount hook supplies the live wiring, a test supplies stubs. */
export interface InlineAtomLifecycleDeps {
  /** Insert-or-replace the orphan record for a recoverable removed footnote. */
  upsertOrphan: (orphan: OrphanedFootnote) => void;
  /** Drop the orphan record for `footnoteId` (it came back / was empty). */
  clearOrphan: (footnoteId: string) => void;
  /** True iff `footnoteId` currently has an orphan record (gates the float
   *  close vs re-point decision). */
  hasOrphan: (footnoteId: string) => boolean;
  /** Every footnoteId that currently has an orphan record. The orphan-clear
   *  edge reconciles these against the live atom set on EVERY inline-atom diff —
   *  not just `addedFootnotes` — because a footnote restored by undo does NOT
   *  always surface as `addedFootnotes` (the step-inspector maps a replace-based
   *  undo as a no-op on the footnote set; see the `atom_drag_and_observer_move`
   *  memo). Reconciling against liveness closes the undo/redo/re-anchor edge
   *  robustly: any orphan whose footnote is now live is cleared. */
  listOrphanIds: () => readonly string[];
  /** Body/title/thanks of a footnote that just left, or null if unresolvable
   *  (the dying node is gone from the post-tx doc — the snapshot must have
   *  cached it BEFORE the removal, on the prior live pass). */
  removedFootnoteContent: (footnoteId: string) => RemovedFootnoteContent | null;
  /** True iff an atom id (footnote OR citation) is live in the post-tx doc.
   *  A removed-then-re-added-in-the-same-tx atom (a move) is still live, so the
   *  prune must consult this, not just the removed list. */
  isAtomLive: (id: string) => boolean;
  /** Close a popped-out float by its `float:card:<kind>:<id>` key (no-op when
   *  the key isn't open). Absent in the Reader (no view-prefs). */
  closeFloat?: (floatKey: string) => void;
  /** True iff the float key is currently popped out. */
  isFloatOpen?: (floatKey: string) => boolean;
}

/** Clear every `cardStore` ref (selected / hover / expand) pointing at a card
 *  of `kind` + `id` that is genuinely gone. Module-scoped store, so no instance
 *  needed. Used both by the inline-atom removal path and by the D6 card-deleted
 *  signal handler (sidecar-backed kinds). */
export function pruneCardStoreFor(kind: string, id: string): void {
  const s = cardStore.getState();
  const matches = (ref: { kind: string; id: string } | null | undefined) =>
    !!ref && ref.kind === kind && ref.id === id;
  if (matches(s.selected)) cardStore.clearSelection();
  if (matches(s.hover)) cardStore.setHover(null);
  for (const ref of s.expandedSet) {
    if (matches(ref)) cardStore.collapse(ref);
  }
}

/** Re-key every `cardStore` ref from `{fromKind, id}` to `{toKind, id}` after a
 *  kind-change morph, so the selection halo / hover / expansion survive the
 *  flip (REP-F6-02 / OMNI-F6-02). The id is preserved across a morph; only the
 *  kind changes. The D6 card-morphed signal handler calls this. */
export function rekeyCardStoreForMorph(
  fromKind: string,
  toKind: string,
  id: string,
): void {
  const s = cardStore.getState();
  const matches = (ref: { kind: string; id: string } | null | undefined) =>
    !!ref && ref.kind === fromKind && ref.id === id;
  if (matches(s.selected)) cardStore.select({ kind: toKind as never, id });
  if (matches(s.hover)) cardStore.setHover({ kind: toKind as never, id });
  for (const ref of s.expandedSet) {
    if (matches(ref)) {
      cardStore.collapse(ref);
      cardStore.expand({ kind: toKind as never, id });
    }
  }
}

/**
 * Build the W2b inline-atom lifecycle policy. Registered on the single bus
 * consumer (after T1's regen policy). Idempotent and side-effect-contained.
 */
export function makeInlineAtomLifecyclePolicy(
  deps: InlineAtomLifecycleDeps,
): InlineAtomPolicy {
  return (diff: StructureDiff, ctx: InlineAtomPolicyContext) => {
    // A removed atom whose id is a regen-remap KEY did NOT actually leave — it
    // survived under a new id (the markerless re-parse). T1's regen policy ran
    // first and already re-pointed selection/float to the new id; treating it
    // as a removal here would wrongly orphan/prune it. So skip remap keys.
    const remapKeys = ctx.remap;

    // ── (a)+(b)+(c) on REMOVALS ──────────────────────────────────────────
    for (const removed of diff.removedFootnotes) {
      const id = removed.id;
      if (remapKeys.has(id)) continue; // re-parse survivor, not a removal
      if (deps.isAtomLive(id)) continue; // re-added in the same tx (a move)

      // Orphan upsert IFF the dying footnote had recoverable content (body or
      // title). Folds FN-A1-02: title counts toward orphan-worthiness.
      const dying = deps.removedFootnoteContent(id);
      const recoverable =
        !!dying &&
        (dying.plainText.trim().length > 0 ||
          (dying.title?.trim().length ?? 0) > 0);
      if (recoverable && dying) {
        deps.upsertOrphan({
          footnoteId: id,
          content: dying.content,
          title: dying.title,
          thanks: dying.thanks,
          orphanedAt: new Date().toISOString(),
        });
      } else {
        // Empty footnote deleted → no orphan; make sure no stale record lingers.
        deps.clearOrphan(id);
      }

      // cardStore prune (b) — always, for the genuinely-gone footnote.
      pruneCardStoreFor("footnote", id);

      // Float prune/re-point (c): close the float UNLESS the footnote is now a
      // recoverable orphan (then leave it open to render the orphan body).
      const floatKey = cardKeyForEntity({ kind: "footnote", id });
      if (floatKey && deps.isFloatOpen?.(floatKey)) {
        if (!recoverable) deps.closeFloat?.(floatKey);
      }
    }

    for (const removed of diff.removedCitations) {
      const id = removed.id;
      if (remapKeys.has(id)) continue;
      if (deps.isAtomLive(id)) continue;
      // Citations have no orphan model in W2b (T5/C17 owns add-resync). A
      // removed citation marker is a genuine vanish → prune + close its float.
      pruneCardStoreFor("citation", id);
      const floatKey = cardKeyForEntity({ kind: "citation", id });
      if (floatKey && deps.isFloatOpen?.(floatKey)) deps.closeFloat?.(floatKey);
    }

    // ── (a) ORPHAN CLEAR — reconcile against LIVENESS (the FN-A1-03 edge) ──
    // Any footnote whose id is now live can have NO orphan record (the atom is
    // anchored AND orphan would be the FN-A1-03 duplicate-key crash). The fast
    // path is `addedFootnotes`, but an undo that restores a footnote does NOT
    // always surface as `addedFootnotes` (the step-inspector maps a replace-
    // based restore as a no-op on the footnote SET) — so we ALSO reconcile every
    // existing orphan record against the live atom set on EVERY inline-atom
    // diff. This makes "anchored AND orphan" unrepresentable regardless of how
    // the restore was shaped. O(orphans), and orphans are few.
    for (const added of diff.addedFootnotes) {
      deps.clearOrphan(added.id);
    }
    for (const orphanId of deps.listOrphanIds()) {
      if (deps.isAtomLive(orphanId)) deps.clearOrphan(orphanId);
    }
  };
}

/**
 * The `inlineAtom`/`regenIds` migrator the mount hook registers on the
 * `IdentityCascade` (D1.4 (d)). On a markerless re-parse the cascade fans the
 * `oldId -> newId` remap here; this re-points the `cardStore` selection/hover/
 * expand AND the open float key so the selected/floated card survives the
 * re-parse. Until W2b this migrator set was EMPTY — the remap fanned to nothing,
 * stranding the card (OMNI-F3-02, CI-A3-01, CI-F1-02).
 *
 * `remapFloatKey(oldKey, newKey)` is the view-prefs lockstep float-key remap
 * (keys + saved rect move together); absent in the Reader.
 */
export function makeInlineAtomRegenMigrator(
  remapFloatKey?: (oldKey: string, newKey: string) => void,
): IdentityMigrator {
  return (change: IdentityChange) => {
    if (!isRegenIds(change)) return;
    const remap = change.regenIds.remap;
    if (remap.size === 0) return;

    // Re-point the cardStore selection / hover / expand if it pointed at an old
    // inline-atom id. The atom kind (footnote vs citation) isn't carried in the
    // remap, but the id is globally unique across the two kinds, so a match on
    // id alone is safe — re-select under the new id, same kind.
    const s = cardStore.getState();
    const repoint = (ref: { kind: string; id: string }) => {
      const next = remap.get(ref.id);
      return next ? { ...ref, id: next } : null;
    };
    if (s.selected && (s.selected.kind === "footnote" || s.selected.kind === "citation")) {
      const moved = repoint(s.selected);
      if (moved) cardStore.select(moved as typeof s.selected);
    }
    if (s.hover && (s.hover.kind === "footnote" || s.hover.kind === "citation")) {
      const moved = repoint(s.hover);
      if (moved) cardStore.setHover(moved as typeof s.hover);
    }
    for (const ref of s.expandedSet) {
      if (ref.kind !== "footnote" && ref.kind !== "citation") continue;
      const moved = repoint(ref);
      if (moved) {
        cardStore.collapse(ref);
        cardStore.expand(moved as typeof ref);
      }
    }

    // Re-point the open float key (lockstep with its saved rect). Try both
    // domains for each remapped id — the no-op when the key isn't open keeps it
    // cheap and the id is unique across kinds so at most one matches.
    if (remapFloatKey) {
      for (const [oldId, newId] of remap) {
        for (const kind of ["footnote", "citation"] as const) {
          const oldKey = cardKeyForEntity({ kind, id: oldId });
          const newKey = cardKeyForEntity({ kind, id: newId });
          if (oldKey && newKey) remapFloatKey(oldKey, newKey);
        }
      }
    }
  };
}
