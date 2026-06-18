"use client";

/**
 * useInlineAtomLifecycle — the React mount for the W2b inline-atom lifecycle
 * reconciler (T2 §3b, PLAN D1.4). Mounts ONCE per pane beside the single bus
 * consumer, behind `virgil:inline-atom-lifecycle` (default OFF).
 *
 * This hook does NOT open a bus subscription — that would break the
 * +1-not-+3 keystroke-sanctity invariant. Instead it:
 *
 *  1. registers the lifecycle policy on the EXISTING single consumer (W1b) via
 *     `consumer.registerPolicy` — the policy fires from the one `onAnyChange`
 *     subscription, which already bails O(1) on a non-atom transaction;
 *  2. registers the `inlineAtom`/`regenIds` selection+float re-point migrator on
 *     the `IdentityCascade` (so the regen remap finally fans to a real migrator —
 *     OMNI-F3-02, CI-A3-01, CI-F1-02);
 *  3. installs the footnote-body resolver source on the consumer so the regen
 *     matcher's same-position-swap discriminator (the W1 review NIT) can read
 *     the dying/born footnote body.
 *
 * THE DYING-BODY SNAPSHOT. The policy's orphan-upsert needs the body of a
 * footnote whose marker just LEFT, but at dispatch time that node is already
 * gone from the post-tx doc. So this hook maintains a `Map<footnoteId, content>`
 * of the LIVE footnotes, seeded on mount from the loaded doc and refreshed after
 * every dispatch from the post-tx live set. A footnote removed in tx N is still
 * in the snapshot captured at the end of tx N-1 (its body didn't change in the
 * tx that deleted it), so the policy resolves the dying body from the snapshot.
 * The snapshot also answers `isAtomLive` (re-added-in-the-same-tx moves) and the
 * added-side body resolver (born footnotes ARE in the post-tx doc).
 *
 * KEYSTROKE SANCTITY: the snapshot refresh walks only footnote/citation nodes
 * and runs only inside the consumer's dispatch — which never fires on a plain
 * keystroke. Per fire it is O(atoms in doc) at most (the refresh), gated behind
 * the atom-touched dispatch, never per-keystroke. (A tighter O(edit) refresh is
 * possible but the atom count is small and the walk is off the keystroke path.)
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";
import type { IdentityCascade } from "@/lib/identity/identity-cascade";
import type {
  IdentityBusConsumer,
  RegenBodyResolvers,
} from "@/lib/identity/identity-bus-consumer";
import type { FootnoteEntry } from "@/lib/tiptap/doc-structure";
import type { OrphanedFootnote } from "@/lib/types";
import {
  makeInlineAtomLifecyclePolicy,
  makeInlineAtomRegenMigrator,
  type InlineAtomLifecycleDeps,
  type RemovedFootnoteContent,
} from "./inline-atom-lifecycle-policy";

/** The orphan-store surface the hook re-targets onto the durable sidecar
 *  (`useOrphanedFootnotes`) in the cutover. */
export interface OrphanStoreApi {
  orphans: readonly OrphanedFootnote[];
  upsertOrphan: (orphan: OrphanedFootnote) => void;
  clearOrphan: (id: string) => void;
}

/** The view-prefs float surface (absent in the Reader). */
export interface FloatStoreApi {
  poppedOutCards: readonly string[];
  closeCardPopout: (key: string) => void;
  remapCardPopKey: (oldKey: string, newKey: string) => void;
}

export interface UseInlineAtomLifecycleArgs {
  editor: Editor | null | undefined;
  /** The single W1b consumer (or null when `virgil:identity-cascade` is off —
   *  then there is no consumer to register on and this hook is inert). */
  consumer: IdentityBusConsumer | null;
  cascade: IdentityCascade;
  orphans: OrphanStoreApi;
  floats?: FloatStoreApi;
  /** The inline-atom structural counter (footnotes + citations). Bumps on any
   *  atom add/remove/reorder — INCLUDING an undo/redo that restores a footnote
   *  the per-transaction DIFF does NOT report as `addedFootnotes` (the step-
   *  inspector maps a replace-based restore as a no-op on the footnote set; see
   *  `atom_drag_and_observer_move`). Gating a liveness reconcile on this counter
   *  closes the orphan-clear undo edge (FN-A1-03) robustly without widening the
   *  consumer's O(1) atom-touched bail. Silent on a plain keystroke. */
  atomRevision?: number;
}

interface AtomSnapshot {
  /** footnoteId → body/title/thanks, for the dying-body resolver + orphan gate. */
  footnotes: Map<string, RemovedFootnoteContent>;
  /** Every live atom id (footnote + citation) for `isAtomLive`. */
  liveIds: Set<string>;
}

/** Walk the editor's footnote + citation nodes into a fresh snapshot. O(atoms
 *  in doc) — runs only inside dispatch / on mount, never per keystroke. */
function snapshotAtoms(editor: Editor): AtomSnapshot {
  const footnotes = new Map<string, RemovedFootnoteContent>();
  const liveIds = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") {
      const id = (node.attrs.footnoteId as string) || (node.attrs.linkId as string) || "";
      if (id) {
        const content = node.attrs.content ?? null;
        const title = typeof node.attrs.title === "string" ? node.attrs.title : undefined;
        footnotes.set(id, {
          content,
          plainText: content ? richJsonToPlainText(content) : "",
          title,
          thanks: !!node.attrs.thanks,
        });
        liveIds.add(id);
      }
      return false; // don't descend into the footnote body (nested atoms are
      // tracked out-of-band; their liveness isn't pruned here)
    }
    if (node.type.name === "citation") {
      const id = (node.attrs.citationId as string) || "";
      if (id) liveIds.add(id);
    }
    return true;
  });
  return { footnotes, liveIds };
}

export function useInlineAtomLifecycle({
  editor,
  consumer,
  cascade,
  orphans,
  floats,
  atomRevision,
}: UseInlineAtomLifecycleArgs): void {
  const flagOn = isInlineAtomLifecycleOn();

  // The dying-body snapshot. A ref (not state) — it's read inside the policy
  // dispatch and refreshed after; it must never trigger a render.
  const snapRef = useRef<AtomSnapshot>({ footnotes: new Map(), liveIds: new Set() });

  // Keep the latest orphan list / float-open set reachable from the policy
  // closure without re-registering the policy every render (the policy is
  // registered once; these refs feed its `hasOrphan` / `isFloatOpen` lookups).
  // Written in an effect (not during render — React Compiler refs rule).
  const orphansRef = useRef(orphans);
  const floatsRef = useRef(floats);
  useEffect(() => {
    orphansRef.current = orphans;
    floatsRef.current = floats;
  });

  // Seed the snapshot once the editor mounts (counters are silent on load — the
  // initial-population rule; this keys on the reactive editor instance so the
  // first removal after load resolves the dying body from the loaded doc).
  useEffect(() => {
    if (!flagOn || !editor || editor.isDestroyed) return;
    snapRef.current = snapshotAtoms(editor);
  }, [flagOn, editor]);

  // Liveness reconcile of the orphan store, gated on the inline structural
  // counter (NOT per keystroke — the counter is silent on a plain keystroke).
  // Clears any orphan record whose footnote is now LIVE. The policy's per-diff
  // clear-on-add is the fast path; this is the robust belt for the restore
  // shapes the per-tx diff under-reports (undo/redo — FN-A1-03), keeping the
  // atom from being simultaneously anchored AND orphan. It also refreshes the
  // dying-body snapshot so a body edit between two structural events is captured.
  useEffect(() => {
    if (!flagOn || !editor || editor.isDestroyed) return;
    const live = snapshotAtomsLiveIds(editor);
    for (const o of orphansRef.current.orphans) {
      if (live.has(o.footnoteId)) orphansRef.current.clearOrphan(o.footnoteId);
    }
    snapRef.current = snapshotAtoms(editor);
  }, [flagOn, editor, atomRevision]);

  // Register the lifecycle policy on the single consumer + the regen migrator on
  // the cascade + the body-resolver source on the consumer. All behind the flag;
  // all torn down on unmount / flag-off so the legacy path is byte-identical.
  useEffect(() => {
    if (!flagOn || !consumer || !editor) return;

    const deps: InlineAtomLifecycleDeps = {
      upsertOrphan: (o) => orphansRef.current.upsertOrphan(o),
      clearOrphan: (id) => orphansRef.current.clearOrphan(id),
      hasOrphan: (id) => orphansRef.current.orphans.some((o) => o.footnoteId === id),
      listOrphanIds: () => orphansRef.current.orphans.map((o) => o.footnoteId),
      removedFootnoteContent: (id) => snapRef.current.footnotes.get(id) ?? null,
      isAtomLive: (id) => {
        // The snapshot is from the PRIOR dispatch; refresh liveness from the
        // live doc so a same-tx re-add (a move) reads as live.
        if (editor.isDestroyed) return snapRef.current.liveIds.has(id);
        return snapshotAtomsLiveIds(editor).has(id);
      },
      closeFloat: floats ? (key) => floatsRef.current?.closeCardPopout(key) : undefined,
      isFloatOpen: floats
        ? (key) => floatsRef.current?.poppedOutCards.includes(key) ?? false
        : undefined,
    };
    const policy = makeInlineAtomLifecyclePolicy(deps);

    // Wrap the policy so the dying-body snapshot is REFRESHED after each fire —
    // the next removal then resolves its dying body from this post-tx snapshot.
    const wrapped: typeof policy = (diff, ctx) => {
      const r = policy(diff, ctx);
      if (!editor.isDestroyed) snapRef.current = snapshotAtoms(editor);
      return r;
    };

    const offPolicy = consumer.registerPolicy(wrapped);

    // The regen migrator (selection/float re-point on a markerless re-parse).
    const offMigrator = cascade.registerMigrator(
      "inlineAtom",
      makeInlineAtomRegenMigrator(
        floats ? (oldKey, newKey) => floatsRef.current?.remapCardPopKey(oldKey, newKey) : undefined,
      ),
    );

    // The footnote body resolver source for the regen matcher's same-position-
    // swap discriminator: removed bodies from the prior snapshot, added bodies
    // from the live (post-tx) doc.
    const offResolver = consumer.setBodyResolverSource((): RegenBodyResolvers => ({
      removedFootnoteBody: (e: FootnoteEntry) =>
        snapRef.current.footnotes.get(e.id)?.plainText ?? null,
      addedFootnoteBody: (e: FootnoteEntry) => {
        if (editor.isDestroyed) return null;
        const live = snapshotAtoms(editor).footnotes.get(e.id);
        return live ? live.plainText : null;
      },
    }));

    return () => {
      offPolicy();
      offMigrator();
      offResolver();
    };
  }, [flagOn, consumer, cascade, editor, floats]);
}

/** Cheap liveness-only walk (no body flatten) for the `isAtomLive` re-check. */
function snapshotAtomsLiveIds(editor: Editor): Set<string> {
  const live = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") {
      const id = (node.attrs.footnoteId as string) || (node.attrs.linkId as string) || "";
      if (id) live.add(id);
      return false;
    }
    if (node.type.name === "citation") {
      const id = (node.attrs.citationId as string) || "";
      if (id) live.add(id);
    }
    return true;
  });
  return live;
}
