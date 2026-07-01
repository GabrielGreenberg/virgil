/**
 * Phase 2 — the auto-apply, race-gated driver for pending AI changes.
 *
 * The chosen core UX: an AI-authored suggestion (`author:"ai"`, `status:"pending"`)
 * auto-applies into the live doc the moment it is SAFE to do so — no manual
 * Apply click needed. "Safe" means the user isn't mid-editing the target
 * paragraph and no other pending-applied change is already on it. Human-drafted
 * suggestions are NEVER auto-applied (they keep the manual Apply button); a
 * stale suggestion is marked `stale` once and never retried.
 *
 * This hook is mounted in `EditorPane`, behind `isPendingChangesOn()`, where the
 * editor + both card hooks (`useRevisions` / `useCutter`) + the selection
 * machinery all live. It drives the SHARED `applySuggestion` orchestration
 * (pending-change-actions.ts) — the exact same code path the manual Apply
 * button calls — so the two can never drift.
 *
 * ─────────────────────────── KEYSTROKE SANCTITY ───────────────────────────
 * Typing N plain characters inside a paragraph must do ZERO auto-apply work and
 * leave `window.__virgilBusStats().emitCount` flat. Two trigger paths, both
 * O(1) per keystroke:
 *
 *   1. BATCH (editor-mount + AI-pending-set change). A `useEffect` gated ONLY
 *      on `[editor, structural.blocks, structural.anchors, revisionCards,
 *      cutterCards]`. None of those bump on a structurally-null keystroke:
 *      `useStructuralRevisions` counters are DocStructureBus-backed (silent on
 *      plain typing — that's their whole contract), and the card arrays only
 *      change identity when a sidecar mutates (a card added / status flipped),
 *      never on a keystroke. So the effect does not re-run while typing. It is
 *      NOT an `editor.on('update')` subscriber.
 *
 *   2. SELECTION-LEAVE. We do NOT add a new always-on subscriber. We piggyback
 *      on the EXISTING `selectionUpdate` subscriber in `useEditorUIState`
 *      (already on the keystroke-sanctity allow-list) via its
 *      `onCaretParagraphChange(prev, next)` notifier. That notifier already
 *      bails O(1) when the caret paragraph is unchanged (typing inside one
 *      paragraph), so it fires only when the caret actually crosses a paragraph
 *      boundary. Our handler then does an O(pendingCount) scan — pendingCount is
 *      the number of AI-pending suggestions, NOT doc size — to see if the
 *      paragraph just LEFT hosts a deferred suggestion, and applies it.
 *
 * No doc walk anywhere. `applySuggestion` itself serializes only the ONE
 * anchored paragraph (not the doc) when it runs, and it runs only on a real
 * structural/selection event, never per keystroke.
 *
 * ─────────────────────────── THE SAFETY GATE ──────────────────────────────
 * A suggestion auto-applies iff ALL hold ({@link isAutoApplyEligible}):
 *   - `author === "ai"` AND `status === "pending"` (human cards excluded),
 *   - a resolvable Mode-A anchor uuid,
 *   - the caret is NOT in the target paragraph (don't clobber active editing),
 *   - no other pending-applied change already on that paragraph (serialize per
 *     paragraph — at most one in-flight applied change per anchorUuid).
 * Staleness is handled downstream: `applySuggestion` returns `stale`, which sets
 * status `stale`, which removes the card from the `pending` filter forever.
 */

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type {
  CutterCard,
  CutterSuggestionCard,
  RevisionCard,
  RevisionSuggestionCard,
} from "@/lib/types";
import { getLinkedTextObjectIds } from "@/links/links";
import { applySuggestion } from "@/links/pending-change-actions";
import type { PendingChangeFamily } from "@/links/apply-suggestion";
import { isPendingChangesOn } from "@/lib/pending-changes-flag";
import { paragraphUuidAtSelection } from "@/hooks/useEditorUIState";
import { generateEntityId } from "@/lib/uuid";
import type { StructuralRevisions } from "@/hooks/useStructuralRevisions";

/** Either suggestion family — both structurally carry the fields the gate +
 *  `applySuggestion` read (`author` / `status` / the two text fields / links). */
type AnySuggestionCard = RevisionSuggestionCard | CutterSuggestionCard;

/**
 * Per-family inputs, mirroring the `useRevisions` / `useCutter` surface the
 * shared `applySuggestion` consumes. `cards` is the family's FULL card union
 * (comment | suggestion) — the driver narrows to suggestions internally, so the
 * caller passes the hook's `cards` straight through. Generic over the union
 * card type `TCard` and the family's suggestion subtype `TSugg`.
 */
export interface AutoApplyFamily<
  TCard extends { kind: string },
  TSugg extends AnySuggestionCard,
> {
  cards: readonly TCard[];
  setSuggestionStatus: (id: string, status: TSugg["status"]) => void;
  setAppliedChange: (
    id: string,
    appliedChange: NonNullable<TSugg["appliedChange"]> | undefined,
  ) => void;
}

/** The revision family's concrete inputs. */
export type RevisionAutoApplyFamily = AutoApplyFamily<
  RevisionCard,
  RevisionSuggestionCard
>;
/** The cutter family's concrete inputs. */
export type CutterAutoApplyFamily = AutoApplyFamily<
  CutterCard,
  CutterSuggestionCard
>;

/** A suggestion paired with its resolved Mode-A anchor uuid + its family's
 *  mutators — the unit the driver iterates. `family` is set by WHICH family
 *  pushed the suggestion (revision vs cutter), so the blue mark's `linkCard`
 *  token carries the real family even though both share the `pending-ai-change`
 *  kind (Part A). */
export interface ResolvedSuggestion {
  card: AnySuggestionCard;
  anchorUuid: string;
  family: PendingChangeFamily;
  setSuggestionStatus: (id: string, status: string) => void;
  setAppliedChange: (id: string, appliedChange: unknown) => void;
}

/**
 * Pure gate: is THIS suggestion eligible to auto-apply RIGHT NOW?
 *
 * Exported for unit testing the gate in isolation (no editor / React). All
 * doc-state questions are answered through the two injected lookups so the test
 * can drive them directly:
 *   - `caretParagraphUuid`: the paragraph the caret is in (null = elsewhere).
 *   - `paragraphHasInFlightApplied`: true if some OTHER card already holds a
 *     pending-applied change on `anchorUuid` (per-paragraph serialization).
 */
export function isAutoApplyEligible(args: {
  card: Pick<AnySuggestionCard, "author" | "status">;
  anchorUuid: string | null;
  caretParagraphUuid: string | null;
  paragraphHasInFlightApplied: boolean;
}): boolean {
  const { card, anchorUuid, caretParagraphUuid, paragraphHasInFlightApplied } =
    args;
  // AI-drafted + still pending only. Human cards keep the manual Apply button.
  if (card.author !== "ai") return false;
  if (card.status !== "pending") return false;
  // Needs a resolvable Mode-A anchor.
  if (!anchorUuid) return false;
  // Don't clobber active editing: caret must not be in the target paragraph.
  if (caretParagraphUuid === anchorUuid) return false;
  // Serialize per paragraph: at most one in-flight applied change per uuid.
  if (paragraphHasInFlightApplied) return false;
  return true;
}

/**
 * The set of paragraph uuids that already carry an in-flight applied change —
 * any suggestion (either family) whose `status:"applied"` and `appliedChange`
 * is present. Built once per pass over the (small) suggestion arrays — O(cards),
 * never O(doc). Used to enforce the one-applied-per-paragraph serialization.
 */
export function paragraphsWithInFlightApplied(
  cards: readonly (RevisionCard | CutterCard)[],
): Set<string> {
  const set = new Set<string>();
  for (const c of cards) {
    if (c.kind !== "suggestion") continue;
    if (c.status === "applied" && c.appliedChange) {
      set.add(c.appliedChange.anchorUuid);
    }
  }
  return set;
}

/**
 * Reconcile the synchronous "already-dispatched-an-apply" id guard against the
 * latest card arrays. This is the fix for the double-apply race:
 *
 * A successful `applyOne` splices the paragraph, which bumps
 * `structural.blocks/.anchors` and RE-FIRES the batch effect — often BEFORE
 * React has committed the card's `pending → applied` status update. That re-run
 * reads a STALE card array (status still `"pending"`, so `paragraphsWithInFlightApplied`
 * is empty), judges the just-applied card eligible again, and re-applies against
 * the already-spliced text → `applySuggestion` returns `stale`, clobbering the
 * good applied state. (Observed: a revision applies cleanly but a same-load
 * cutter loses the race and goes `stale` with its blue mark still in the doc.)
 *
 * `dispatched` is a ref-Set of card ids we've synchronously claimed an apply for.
 * It bridges the pre-commit window: while a card's status still reads `"pending"`
 * (the array is lagging), its id stays claimed and {@link applyOne} skips it.
 * Once React commits the real status (`applied`/`stale`/gone), that status is the
 * authoritative guard, so we drop the id here — keeping the guard from leaking
 * across a later genuine re-pending (undo) or a same-paragraph successor (#7).
 * O(dispatched), never O(doc).
 */
export function reconcileDispatched(
  dispatched: Set<string>,
  cards: readonly (RevisionCard | CutterCard)[],
): void {
  if (dispatched.size === 0) return;
  const stillPending = new Set<string>();
  for (const c of cards) {
    if (c.kind === "suggestion" && c.status === "pending") stillPending.add(c.id);
  }
  for (const id of dispatched) {
    // Real status has caught up (no longer a lagging "pending") → hand the guard
    // back to `status`/`appliedChange`; drop the synchronous claim.
    if (!stillPending.has(id)) dispatched.delete(id);
  }
}

/** Collect every AI-authored, still-pending suggestion across both families,
 *  each resolved to its Mode-A anchor uuid (cards with no anchor are dropped:
 *  not applicable). O(cards). */
export function collectPendingAiSuggestions(
  revisions: RevisionAutoApplyFamily,
  cutter: CutterAutoApplyFamily,
): ResolvedSuggestion[] {
  const out: ResolvedSuggestion[] = [];
  const push = <
    TCard extends { kind: string },
    TSugg extends AnySuggestionCard,
  >(
    fam: AutoApplyFamily<TCard, TSugg>,
    family: PendingChangeFamily,
    isSuggestion: (c: TCard) => c is TCard & TSugg,
  ): void => {
    for (const card of fam.cards) {
      if (!isSuggestion(card)) continue;
      if (card.author !== "ai" || card.status !== "pending") continue;
      const anchorUuid = getLinkedTextObjectIds(card)[0];
      if (!anchorUuid) continue;
      out.push({
        card,
        anchorUuid,
        family,
        setSuggestionStatus: fam.setSuggestionStatus as (
          id: string,
          status: string,
        ) => void,
        setAppliedChange: fam.setAppliedChange as (
          id: string,
          ac: unknown,
        ) => void,
      });
    }
  };
  push(
    revisions,
    "revision-suggestion",
    (c): c is RevisionCard & RevisionSuggestionCard => c.kind === "suggestion",
  );
  push(
    cutter,
    "cutter-suggestion",
    (c): c is CutterCard & CutterSuggestionCard => c.kind === "suggestion",
  );
  return out;
}

export interface UseAutoApplyPendingChangesArgs {
  editor: Editor | null;
  structural: StructuralRevisions;
  revisions: RevisionAutoApplyFamily;
  cutter: CutterAutoApplyFamily;
}

/**
 * Mount the auto-apply driver. Returns an `onCaretParagraphChange` callback the
 * caller MUST wire into `useEditorUIState`'s notifier (the selection-leave
 * path) — that's how the driver hears "the caret left paragraph P" without
 * opening its own subscriber. Behind `isPendingChangesOn()`: flag-OFF, both the
 * batch effect and the leave callback are inert (no card ever reaches the
 * statuses they read), so behavior is byte-identical to pre-Phase-2.
 */
export function useAutoApplyPendingChanges(
  args: UseAutoApplyPendingChangesArgs,
): { onCaretParagraphChange: (prev: string | null, next: string | null) => void } {
  const { editor, structural, revisions, cutter } = args;

  // Latest editor + families in refs so the stable-identity selection-leave
  // callback always reads current values without re-subscribing. Written INSIDE
  // an effect (not during render) so the React-Compiler refs rule is satisfied;
  // the batch effect doesn't use these (it closes over its deps directly).
  const editorRef = useRef(editor);
  const famRef = useRef({ revisions, cutter });
  useEffect(() => {
    editorRef.current = editor;
    famRef.current = { revisions, cutter };
  });

  // Synchronous guard against the double-apply race (see `reconcileDispatched`):
  // card ids we've already claimed an apply for this session. Survives the
  // stale-card-array window that opens when a splice re-fires the batch effect
  // before React commits the `pending → applied` status.
  const dispatchedRef = useRef<Set<string>>(new Set());

  // ── BATCH trigger ────────────────────────────────────────────────────────
  // Runs on editor-mount + whenever the AI-pending set may have changed. Gated
  // ONLY on the reactive editor + the DocStructureBus-backed structural counters
  // + the two card ARRAYS — NONE of which move on a structurally-null keystroke,
  // so this never re-runs while typing (keystroke sanctity). The wrapper family
  // objects (which EditorPane rebuilds each render) are deliberately NOT deps;
  // only the stable card-array identities + counters are, so an unrelated
  // EditorPane re-render does not re-fire the scan. Applies every currently-SAFE
  // AI-pending suggestion (closing over `editor`/`revisions`/`cutter` directly).
  const revisionCards = revisions.cards;
  const cutterCards = cutter.cards;
  useEffect(() => {
    if (!isPendingChangesOn()) return;
    if (!editor) return;
    const caret = paragraphUuidAtSelection(editor);
    reconcileDispatched(dispatchedRef.current, [
      ...revisions.cards,
      ...cutter.cards,
    ]);
    const inFlight = paragraphsWithInFlightApplied([
      ...revisions.cards,
      ...cutter.cards,
    ]);
    const pending = collectPendingAiSuggestions(revisions, cutter);
    for (const target of pending) {
      applyOne(editor, target, caret, inFlight, dispatchedRef.current);
    }
    // `revisions`/`cutter` are intentionally read but NOT deps: only the stable
    // `revisionCards`/`cutterCards` array identities + counters gate this (the
    // wrapper objects are rebuilt each EditorPane render and would over-fire).
    // `structural.blocks/.anchors` re-scan on a paragraph split/merge or anchor add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, structural.blocks, structural.anchors, revisionCards, cutterCards]);

  // ── SELECTION-LEAVE trigger ──────────────────────────────────────────────
  // Wired by the caller into useEditorUIState's `onCaretParagraphChange`. Fires
  // only when the caret crosses a paragraph boundary (the notifier bails O(1)
  // on same-paragraph typing). When the caret LEAVES `prev`, any AI-pending
  // suggestion anchored to `prev` that we deferred (because the caret was
  // there) is now safe — apply it. O(pendingCount), not O(doc). Reads the live
  // editor + families from refs so its identity stays stable (no re-subscribe).
  const onCaretParagraphChange = useCallback(
    (prev: string | null, next: string | null) => {
      if (!isPendingChangesOn()) return;
      if (!prev) return; // nothing was left
      const ed = editorRef.current;
      if (!ed) return;
      const { revisions: rev, cutter: cut } = famRef.current;
      reconcileDispatched(dispatchedRef.current, [...rev.cards, ...cut.cards]);
      const inFlight = paragraphsWithInFlightApplied([
        ...rev.cards,
        ...cut.cards,
      ]);
      const pending = collectPendingAiSuggestions(rev, cut);
      for (const target of pending) {
        // Only the suggestions anchored to the paragraph we just left became
        // newly-safe; `next` is the current caret paragraph for the gate.
        if (target.anchorUuid !== prev) continue;
        applyOne(ed, target, next, inFlight, dispatchedRef.current);
      }
    },
    [],
  );

  return { onCaretParagraphChange };
}

/**
 * Apply one resolved suggestion through the shared `applySuggestion`, but only
 * if it passes the eligibility gate against the given caret + per-paragraph
 * in-flight set. On a real apply, claims the paragraph in `inFlight` so a second
 * pending suggestion on the SAME paragraph in this pass waits (serialization
 * within one batch). A module-level helper (not a hook closure) so it needs no
 * deps and can't capture stale state.
 *
 * `dispatched` is the cross-pass id guard (see `reconcileDispatched`): if this
 * card's apply was already claimed in a prior pass whose status flip React
 * hasn't committed yet, skip it — otherwise the re-fired batch effect would
 * re-apply against the already-spliced text and mark it `stale`. We claim the id
 * synchronously BEFORE calling `applySuggestion`, so a re-entrant pass in the
 * same tick sees the claim.
 */
export function applyOne(
  editor: Editor,
  target: ResolvedSuggestion,
  caretParagraphUuid: string | null,
  inFlight: Set<string>,
  dispatched: Set<string>,
): void {
  // Already claimed an apply for this card (status flip not yet committed) —
  // don't re-apply against post-splice text.
  if (dispatched.has(target.card.id)) return;
  if (
    !isAutoApplyEligible({
      card: target.card,
      anchorUuid: target.anchorUuid,
      caretParagraphUuid,
      paragraphHasInFlightApplied: inFlight.has(target.anchorUuid),
    })
  ) {
    return;
  }
  // Claim synchronously before the splice so the splice-triggered re-run bails.
  dispatched.add(target.card.id);
  const result = applySuggestion<string>({
    editor,
    card: target.card,
    family: target.family,
    setSuggestionStatus: target.setSuggestionStatus,
    setAppliedChange: target.setAppliedChange as never,
    generateAnchorId: generateEntityId,
    appliedStatus: "applied",
    staleStatus: "stale",
  });
  if (result.outcome === "applied") inFlight.add(target.anchorUuid);
}
