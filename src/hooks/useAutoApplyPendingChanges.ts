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
 *  mutators — the unit the driver iterates. */
export interface ResolvedSuggestion {
  card: AnySuggestionCard;
  anchorUuid: string;
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
    (c): c is RevisionCard & RevisionSuggestionCard => c.kind === "suggestion",
  );
  push(
    cutter,
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
    const inFlight = paragraphsWithInFlightApplied([
      ...revisions.cards,
      ...cutter.cards,
    ]);
    const pending = collectPendingAiSuggestions(revisions, cutter);
    for (const target of pending) {
      applyOne(editor, target, caret, inFlight);
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
      const inFlight = paragraphsWithInFlightApplied([
        ...rev.cards,
        ...cut.cards,
      ]);
      const pending = collectPendingAiSuggestions(rev, cut);
      for (const target of pending) {
        // Only the suggestions anchored to the paragraph we just left became
        // newly-safe; `next` is the current caret paragraph for the gate.
        if (target.anchorUuid !== prev) continue;
        applyOne(ed, target, next, inFlight);
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
 */
function applyOne(
  editor: Editor,
  target: ResolvedSuggestion,
  caretParagraphUuid: string | null,
  inFlight: Set<string>,
): void {
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
  const result = applySuggestion<string>({
    editor,
    card: target.card,
    setSuggestionStatus: target.setSuggestionStatus,
    setAppliedChange: target.setAppliedChange as never,
    generateAnchorId: generateEntityId,
    appliedStatus: "applied",
    staleStatus: "stale",
  });
  if (result.outcome === "applied") inFlight.add(target.anchorUuid);
}
