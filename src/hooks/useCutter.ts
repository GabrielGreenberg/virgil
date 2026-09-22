"use client";

import { useAnchorOrphaned } from "@/lib/tiptap/orphan-events";
import { useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import type {
  CutterState,
  CutterCard,
  CutterCommentCard,
  CutterSuggestionCard,
  CutterGoal,
} from "@/lib/types";
import {
  normalizeRichContent,
  emptyRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  getTextAnchorFromLinks,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { migrateCardLinks } from "@/links/migrate-card";
import {
  bridgeCardAiRequestFlag,
  bridgeFlagForCard,
  type AiRequestSyncMode,
  type BridgeContext,
} from "@/lib/ai-request-bridge";
import { applyCardMorph } from "@/cards/morphs";
import { carryCardEnvelope, carryCapturedPassage } from "@/cards/envelope";
import { cardHasContent } from "@/cards/has-content";
import type { PullSeed } from "@/lib/stack/pull-seed";
import { carryUnknownKeys } from "@/lib/sidecar-migrate";
import { reinstateCard } from "./reinstate-card";
import { usePersistentState } from "./usePersistentState";
import { usePristineTracker } from "./usePristineTracker";
import { useReconcileModeAAnchors } from "./useReconcileModeAAnchors";
import type { PristineKindApi } from "./usePristineCardManager";

const EMPTY_STATE: CutterState = { cards: [], goal: null };

function migrateGoal(raw: unknown): CutterGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Partial<CutterGoal>;
  if (
    typeof g.target !== "number" ||
    typeof g.initialWords !== "number" ||
    typeof g.setAt !== "string"
  )
    return null;
  if (!Number.isFinite(g.target) || g.target < 0) return null;
  if (!Number.isFinite(g.initialWords) || g.initialWords < 0) return null;
  return { target: g.target, initialWords: g.initialWords, setAt: g.setAt };
}

function migrateComment(raw: unknown): CutterCommentCard | null {
  const r = (raw ?? {}) as Partial<CutterCommentCard>;
  if (!r.id || !r.createdAt) return null;
  const content = normalizeRichContent(r.content);
  const text =
    typeof r.text === "string" && r.text.length > 0
      ? r.text
      : richJsonToPlainText(content) || "";
  const links = migrateCardLinks("cutter-comment", raw);
  // Task 712: unknown keys ride through the load (`carryUnknownKeys`); the
  // present-only captures below are consumed — their carries are the rule.
  return carryUnknownKeys<CutterCommentCard>(raw, {
    kind: "comment",
    id: r.id,
    archived: r.archived,
    createdAt: r.createdAt,
    text,
    content,
    aiRequest: !!r.aiRequest,
    selectedText:
      r.selectedText ??
      getTextAnchorFromLinks(links)?.anchorText,
    // Carried through unchanged (task 488). There is no snapshot fallback and
    // there must not be one: the link's `textSnapshot` is the PLAIN relocation
    // string, so synthesising a rich body from it would put a second, lossier
    // answer where the door's own parse rung already gives the right one.
    ...(r.selectedContent ? { selectedContent: r.selectedContent } : {}),
    // Task 696, same rule: carried through when present, never synthesised.
    // Absent means a pre-696 card whose `original_text` is the flattened line
    // — the apply path's plain-text rung is what repairs that, not a guess
    // made here from a string that has already lost the markup.
    ...(typeof r.selectedLatex === "string" ? { selectedLatex: r.selectedLatex } : {}),
    links,
  }, ["selectedContent", "selectedLatex"]);
}

function migrateSuggestion(raw: unknown): CutterSuggestionCard | null {
  const r = (raw ?? {}) as Partial<CutterSuggestionCard>;
  if (!r.id || !r.createdAt) return null;
  const links = migrateCardLinks("cutter-suggestion", raw);
  const status: CutterSuggestionCard["status"] =
    r.status === "accepted" ||
    r.status === "rejected" ||
    r.status === "applied" ||
    r.status === "stale"
      ? r.status
      : "pending";
  return carryUnknownKeys<CutterSuggestionCard>(raw, {
    kind: "suggestion",
    id: r.id,
    archived: r.archived,
    createdAt: r.createdAt,
    author: r.author === "ai" ? "ai" : "human",
    original_text: typeof r.original_text === "string" ? r.original_text : "",
    suggested_text: typeof r.suggested_text === "string" ? r.suggested_text : "",
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    user_text: typeof r.user_text === "string" ? r.user_text : "",
    instructions: typeof r.instructions === "string" ? r.instructions : "",
    status,
    // Carry the apply descriptor through unchanged when present (only set on
    // `applied` cards via the flag-ON apply path); absent otherwise.
    ...(r.appliedChange ? { appliedChange: r.appliedChange } : {}),
    selectedText:
      r.selectedText ??
      getTextAnchorFromLinks(links)?.anchorText,
    // Carried through unchanged (task 488). There is no snapshot fallback and
    // there must not be one: the link's `textSnapshot` is the PLAIN relocation
    // string, so synthesising a rich body from it would put a second, lossier
    // answer where the door's own parse rung already gives the right one.
    ...(r.selectedContent ? { selectedContent: r.selectedContent } : {}),
    // Task 696, same rule: carried through when present, never synthesised.
    // Absent means a pre-696 card whose `original_text` is the flattened line
    // — the apply path's plain-text rung is what repairs that, not a guess
    // made here from a string that has already lost the markup.
    ...(typeof r.selectedLatex === "string" ? { selectedLatex: r.selectedLatex } : {}),
    links,
  }, ["selectedContent", "selectedLatex", "appliedChange"]);
}

function migrateCard(raw: unknown): CutterCard | null {
  const r = (raw ?? {}) as { kind?: string };
  if (r.kind === "suggestion") return migrateSuggestion(raw);
  return migrateComment(raw);
}

function migrateCutter(raw: unknown): CutterState {
  if (!raw || typeof raw !== "object") return { cards: [], goal: null };
  const r = raw as { cards?: unknown; cuts?: unknown; goal?: unknown };
  const goal = migrateGoal(r.goal);

  if (Array.isArray(r.cards)) {
    return {
      cards: r.cards
        .map(migrateCard)
        .filter((c): c is CutterCard => c !== null),
      goal,
    };
  }

  // Legacy `cuts` shape — every cut becomes a comment.
  if (Array.isArray(r.cuts)) {
    const cards: CutterCard[] = [];
    for (const raw of r.cuts) {
      const c = (raw ?? {}) as {
        id?: string;
        title?: string;
        content?: unknown;
        createdAt?: string;
        links?: unknown[];
      };
      if (!c.id || !c.createdAt) continue;
      const content = normalizeRichContent(c.content);
      const titlePart = (c.title || "").trim();
      const bodyPart = richJsonToPlainText(content) || "";
      const text = [titlePart, bodyPart].filter(Boolean).join(" — ");
      // Legacy `"cut"` target.ref.kind tokens are normalized to
      // `"cutter-comment"` inside migrateCardLinks, via the shared
      // LEGACY_TOKEN_TO_CARD_KIND crosswalk (src/cards/legacy-token-crosswalk.ts)
      // — this branch previously carried its own rewriteLinkTargetKind wrapper.
      const links = migrateCardLinks("cutter-comment", raw);
      cards.push({
        kind: "comment",
        id: c.id,
        createdAt: c.createdAt,
        text,
        content,
        aiRequest: false,
        selectedText:
          getTextAnchorFromLinks(links)?.anchorText,
        links,
      });
    }
    return { cards, goal };
  }

  return { cards: [], goal };
}

/** The `ai-requests.json` payload a cutter-comment contributes — the ONE
 *  place its shape is written, shared by both bridge doors so the
 *  card-present payload cannot drift from the card-may-be-absent one. Read
 *  only on the ADD branch (see `bridgeFlagForCard`). */
function cutterCommentContext(card: CutterCommentCard): BridgeContext {
  return {
    text: card.text || "<cutter comment>",
    paragraphIds: getLinkedTextObjectIds(card),
    selectedText: card.selectedText ?? getTextAnchor(card)?.anchorText,
  };
}

export function useCutter(
  docId: string | null,
  externalPristine?: PristineKindApi | null,
) {
  const { state, update, stateRef, loaded, loadError } = usePersistentState<CutterState>(
    docId,
    "cutter.json",
    EMPTY_STATE,
    { migrate: migrateCutter, errorLabel: "cutter cards" },
  );
  const localPristine = usePristineTracker();
  const pristine = externalPristine ?? localPristine;

  // The ONE bridge seam for a cutter-comment (task 2026-07-03-016 6b). Both the
  // AI-request checkbox toggle AND the default-on-create path funnel through it,
  // so the `ai-requests.json` payload shape lives once. `value=true` writes the
  // unified-queue entry; `value=false` drops it.
  const bridgeComment = useCallback(
    (card: CutterCommentCard, value: boolean, mode: AiRequestSyncMode = "toggle") => {
      void bridgeCardAiRequestFlag(
        docId,
        "cutter-comment",
        card.id,
        value,
        cutterCommentContext(card),
        mode,
      );
    },
    [docId],
  );

  // The card-MAY-BE-ABSENT door onto the same seam (task 697): clearing a flag
  // needs no card, so `bridgeFlagForCard` degrades the CONTEXT rather than
  // skipping the CALL. Shares `cutterCommentContext` with `bridgeComment`, so
  // the present-card payload cannot drift between the two doors.
  const bridgeCommentById = useCallback(
    (
      id: string,
      card: CutterCommentCard | undefined,
      value: boolean,
      mode: AiRequestSyncMode,
    ) => {
      bridgeFlagForCard(docId, "cutter-comment", id, value, mode, card, cutterCommentContext);
    },
    [docId],
  );

  const addComment = useCallback(
    (
      paragraphId: string | null,
      content?: JSONContent,
      anchor?: {
        anchorId: string;
        anchorText: string;
        anchorContent?: unknown;
        anchorLatex?: string;
      },
      targetKind?: import("@/text-objects/types").TextObjectKind,
    ) => {
      let card: CutterCommentCard = {
        kind: "comment",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: content ? richJsonToPlainText(content) || "" : "",
        content: content ?? emptyRichContent(),
        // task 2026-07-03-016 6b: a comment is an AI request by default. The
        // bridge that puts it in the inbox follows the SAME pristine gate as
        // sidecar persistence (below) — a still-empty pristine comment is not
        // bridged until it commits, so a click-away discard leaves no orphan
        // `ai-requests.json` entry.
        aiRequest: true,
        selectedText: anchor?.anchorText,
        // The RICH twin of the captured span (task 488): what the "Original"
        // surfaces render. `anchorText` stays the plain relocation currency.
        selectedContent: anchor?.anchorContent,
        // The LATEX form of the same span (task 696). A comment has no
        // `original_text`, but morphing it into a suggestion seeds one — so
        // the apply currency has to be captured HERE, at the only moment the
        // live span is still in hand, or the morph can only offer the
        // flattened line.
        selectedLatex: anchor?.anchorLatex,
        links: [],
      };
      if (paragraphId) card = addTextObjectLink(card, "cutter-comment", paragraphId, targetKind);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-comment",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Unified pristine contract (BUG #54): an empty-body comment discards on
      // click-away regardless of anchor/paragraph (an anchor isn't user content).
      if (!content) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      // Non-pristine (seeded-with-content) comments are committed immediately, so
      // bridge the default request now; empty pristine ones bridge on first edit
      // (updateCommentContent/Text), mirroring the persistence gate.
      if (content) bridgeComment(card, true);
      return card;
    },
    [update, pristine, bridgeComment],
  );

  const addSuggestion = useCallback(
    (
      paragraphId: string | null,
      originalText?: string,
      anchor?: {
        anchorId: string;
        anchorText: string;
        anchorContent?: unknown;
        anchorLatex?: string;
      },
    ) => {
      let card: CutterSuggestionCard = {
        kind: "suggestion",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author: "human",
        // Task 696: the APPLY dialect, never the relocation one. `locateSpan`
        // byte-matches this against the paragraph's inline-LaTeX
        // serialization, so `anchorText` — which has dropped every mark and
        // every inline atom — could only ever match a span that carried no
        // markup. A span with no inline form leaves this EMPTY on purpose:
        // `suggestionApplicability` then reads `no-capture` and the card says
        // so, instead of offering an Apply that cannot succeed (task 695).
        original_text: originalText ?? anchor?.anchorLatex ?? "",
        suggested_text: "",
        explanation: "",
        user_text: "",
        instructions: "",
        status: "pending",
        selectedText: anchor?.anchorText,
        // The RICH twin of the captured span (task 488) — display-only; the
        // `original_text` string stays the currency the apply path splices,
        // and `selectedLatex` (task 696) is that currency: the two are the
        // same capture, so `original_text` above is seeded from it.
        selectedContent: anchor?.anchorContent,
        selectedLatex: anchor?.anchorLatex,
        links: [],
      };
      if (paragraphId)
        card = addTextObjectLink(card, "cutter-suggestion", paragraphId);
      if (anchor)
        card = setTextAnchorLink(
          card,
          "cutter-suggestion",
          anchor.anchorId,
          anchor.anchorText,
        );
      // Unified pristine contract (BUG #54): a suggestion is pristine when it
      // carries no seed text — `original_text` is empty. We still gate on
      // `!anchor` because a suggestion seeded from a selection captures the
      // anchor text AS its `original_text` (real content), but `!paragraphId`
      // is dropped: a blank suggestion anchored to a paragraph (Mode-A) has no
      // original text and must discard on click-away like every other card.
      if (!originalText && !anchor) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      return card;
    },
    [update, pristine],
  );

  /**
   * Stack-pull doors (task 330) — the Cutter twins of
   * `useRevisions.addCommentFromSeed` / `addSuggestionFromSeed`. Same law, same
   * shape: spread the WHOLE surviving record; never read fields off the seed.
   * (The duplication is the pre-existing revisions/cutter fork, filed as task
   * 201 — not something to unify inside this one.)
   */
  const addCommentFromSeed = useCallback(
    (
      paragraphId: string | null,
      seed: PullSeed<"cutter-comment">,
    ): CutterCommentCard => {
      const fresh = {
        kind: "comment" as const,
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        links: [] as CutterCommentCard["links"],
      };
      let card: CutterCommentCard = {
        text: "",
        content: emptyRichContent(),
        aiRequest: true,
        ...fresh,
        ...seed,
        ...fresh, // identity floor — see `useNotes.addNoteFromSeed`
      };
      if (paragraphId)
        card = addTextObjectLink(card, "cutter-comment", paragraphId);
      const committed = cardHasContent("cutter-comment", card);
      if (!committed) pristine.markNew(card.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, card] }));
      if (committed) bridgeComment(card, true);
      return card;
    },
    [update, pristine, bridgeComment],
  );

  const addSuggestionFromSeed = useCallback(
    (
      paragraphId: string | null,
      seed: PullSeed<"cutter-suggestion">,
    ): CutterSuggestionCard => {
      const fresh = {
        kind: "suggestion" as const,
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        links: [] as CutterSuggestionCard["links"],
      };
      const card: CutterSuggestionCard = {
        author: "human",
        original_text: "",
        suggested_text: "",
        explanation: "",
        user_text: "",
        instructions: "",
        ...fresh,
        ...seed,
        // Lifecycle floor: a pulled suggestion is always a fresh `pending`
        // record — `appliedChange` describes a splice in another document.
        status: "pending",
        appliedChange: undefined,
        ...fresh, // identity floor — see `useNotes.addNoteFromSeed`
      };
      const linked = paragraphId
        ? addTextObjectLink(card, "cutter-suggestion", paragraphId)
        : card;
      if (!cardHasContent("cutter-suggestion", linked)) pristine.markNew(linked.id);
      update((prev) => ({ ...prev, cards: [...prev.cards, linked] }));
      return linked;
    },
    [update, pristine],
  );

  const updateCommentContent = useCallback(
    (id: string, content: JSONContent) => {
      // A pristine→committed transition is the moment an empty default-request
      // comment becomes real user content (task 2026-07-03-016 6b): bridge its
      // default AI-request flag now, so it reaches the inbox without a manual
      // checkbox toggle. Read isPristine BEFORE markDirty clears it.
      const firstCommit = pristine.isPristine(id);
      pristine.markDirty(id);
      const text = richJsonToPlainText(content) || "";
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment"
            ? { ...c, content, text }
            : c,
        ),
      }));
      if (firstCommit) {
        const card = state.cards.find(
          (c) => c.id === id && c.kind === "comment",
        ) as CutterCommentCard | undefined;
        if (card?.aiRequest) bridgeComment({ ...card, content, text }, true);
      }
    },
    [update, pristine, state.cards, bridgeComment],
  );

  const updateCommentText = useCallback(
    (id: string, text: string) => {
      const firstCommit = pristine.isPristine(id);
      pristine.markDirty(id);
      const content: JSONContent = text
        ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
        : emptyRichContent();
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, content, text } : c,
        ),
      }));
      if (firstCommit) {
        const card = state.cards.find(
          (c) => c.id === id && c.kind === "comment",
        ) as CutterCommentCard | undefined;
        if (card?.aiRequest) bridgeComment({ ...card, content, text }, true);
      }
    },
    [update, pristine, state.cards, bridgeComment],
  );

  const setCommentAiRequest = useCallback(
    (id: string, value: boolean, mode: AiRequestSyncMode = "toggle") => {
      pristine.markDirty(id);
      const card = state.cards.find(
        (c) => c.id === id && c.kind === "comment",
      ) as CutterCommentCard | undefined;
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "comment" ? { ...c, aiRequest: value } : c,
        ),
      }));
      bridgeCommentById(
        id,
        card && { ...card, aiRequest: value },
        value,
        mode,
      );
    },
    [update, pristine, state.cards, bridgeCommentById],
  );

  const updateSuggestionField = useCallback(
    (
      id: string,
      field:
        | "original_text"
        | "suggested_text"
        | "explanation"
        | "user_text"
        | "instructions",
      value: string,
    ) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "suggestion" ? { ...c, [field]: value } : c,
        ),
      }));
    },
    [update, pristine],
  );

  const setSuggestionStatus = useCallback(
    (id: string, status: CutterSuggestionCard["status"]) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id && c.kind === "suggestion" ? { ...c, status } : c,
        ),
      }));
    },
    [update, pristine],
  );

  /** Set (or clear, when `appliedChange` is undefined) the `appliedChange`
   *  splice descriptor on a suggestion card. Mirrors `setArchived`: functional
   *  `update`, marks the card pristine-dirty so it persists. Only the flag-ON
   *  apply path calls this; with the flag OFF nothing ever sets it. Clearing
   *  drops the key entirely (Keep) rather than leaving an `undefined` field. */
  const setAppliedChange = useCallback(
    (id: string, appliedChange: CutterSuggestionCard["appliedChange"] | undefined) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind !== "suggestion") return c;
          if (appliedChange) return { ...c, appliedChange };
          const { appliedChange: _drop, ...rest } = c;
          return rest;
        }),
      }));
    },
    [update, pristine],
  );

  /** Flip a cutter card's kind in place (comment ⇄ suggestion) via the
   *  registered morph transform. Preserves id/createdAt/links; salvages text
   *  across the shape change. Mirrors `useRevisions.convertCard`. The float-key
   *  remap rides on `convertCardWithRemap` in EditorPane (the morph chokepoint),
   *  so a popped-then-morphed card keeps its window. */
  const convertCard = useCallback(
    (id: string, toKind: "comment" | "suggestion") => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => {
          if (c.id !== id || c.kind === toKind) return c;
          const fromKind =
            c.kind === "comment" ? "cutter-comment" : "cutter-suggestion";
          return applyCardMorph(fromKind, c);
        }),
      }));
    },
    [update, pristine],
  );

  const setGoal = useCallback(
    (target: number, currentWords: number) => {
      if (!Number.isFinite(target) || target < 0) return;
      if (!Number.isFinite(currentWords) || currentWords < 0) return;
      update((prev) => {
        // `initialWords`/`setAt` are the baseline captured at goal START — the
        // SSOT for cut-so-far progress. Editing an existing goal only changes the
        // TARGET; it must never re-baseline (that's what Clear ✕ is for). Deciding
        // the baseline HERE (not at each call site) makes every caller — the
        // strip's edit path and any future one — preserve it by construction.
        const goal: CutterGoal = prev.goal
          ? { ...prev.goal, target: Math.round(target) }
          : {
              target: Math.round(target),
              initialWords: Math.round(currentWords),
              setAt: new Date().toISOString(),
            };
        return { ...prev, goal };
      });
    },
    [update],
  );

  const clearGoal = useCallback(() => {
    update((prev) => ({ ...prev, goal: null }));
  }, [update]);

  const addCardParagraphId = useCallback(
    (
      id: string,
      paragraphId: string,
      targetKind?: import("@/text-objects/types").TextObjectKind,
      paragraphSnapshot?: string | null,
    ) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id
            ? addTextObjectLink(
                c,
                c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment",
                paragraphId,
                targetKind,
                paragraphSnapshot,
              )
            : c,
        ),
      }));
    },
    [update],
  );

  const removeCardParagraphId = useCallback(
    (id: string, paragraphId: string) => {
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) =>
          c.id === id ? removeTextObjectLink(c, paragraphId) : c,
        ),
      }));
    },
    [update],
  );

  // Mode-A self-healing reconcile (load-only). See useReconcileModeAAnchors.
  const reconcileAnchors = useReconcileModeAAnchors<CutterState, CutterCard>(
    update,
    () => stateRef.current,
    (s) => s.cards,
    (s, cards) => ({ ...s, cards }),
  );

  // Archive-origin restore door (task 712) — see hooks/reinstate-card.ts.
  const reinstate = useCallback(
    (raw: unknown): boolean =>
      reinstateCard<CutterState, CutterCard>(
        stateRef.current,
        update,
        (s) => s.cards,
        (s, cards) => ({ ...s, cards }),
        migrateCard,
        raw,
      ),
    [update, stateRef],
  );

  const deleteCard = useCallback(
    (id: string) => {
      pristine.markDirty(id);
      update((prev) => ({ ...prev, cards: prev.cards.filter((c) => c.id !== id) }));
    },
    [update, pristine],
  );

  /** Flip a cutter card's archived (set-aside) flag. Filtering happens at the
   *  panel; this persists through the same sidecar path. */
  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      pristine.markDirty(id);
      update((prev) => ({
        ...prev,
        cards: prev.cards.map((c) => (c.id === id ? { ...c, archived } : c)),
      }));
    },
    [update, pristine],
  );

  /** Deep-copy a cutter-comment sidecar entry with a fresh id. Links
   *  cleared; walker rewires anchors after slice insertion. */
  const cloneComment = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "comment") return null;
      // Envelope (`archived`) carried via the shared clone/morph SSOT (task 099);
      // the CAPTURE PAIR (`selectedText` + its rich twin `selectedContent`) via
      // the sibling SSOT `carryCapturedPassage` (task 694) — the literal names
      // neither half, so it cannot carry one and drop the other;
      // `aiRequest`→false and `links`→[] are intentionally reset for the clone.
      const clone: CutterCommentCard = carryCapturedPassage(source, carryCardEnvelope(source, {
        kind: "comment",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        text: source.text,
        content: normalizeRichContent(source.content),
        aiRequest: false,
        links: [],
      }));
      update((prev) => ({ ...prev, cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, state.cards],
  );

  /** Deep-copy a cutter-suggestion sidecar entry with a fresh id. */
  const cloneSuggestion = useCallback(
    (sourceId: string): string | null => {
      const source = state.cards.find((c) => c.id === sourceId);
      if (!source || source.kind !== "suggestion") return null;
      // Envelope (`archived`) carried via the shared clone/morph SSOT (task 099);
      // the CAPTURE PAIR via the sibling SSOT `carryCapturedPassage` (task 694);
      // `status`→"pending" and `links`→[] are intentionally reset for the clone.
      const clone: CutterSuggestionCard = carryCapturedPassage(source, carryCardEnvelope(source, {
        kind: "suggestion",
        id: generateEntityId(),
        createdAt: new Date().toISOString(),
        author: source.author,
        original_text: source.original_text,
        suggested_text: source.suggested_text,
        explanation: source.explanation,
        user_text: source.user_text,
        instructions: source.instructions,
        status: "pending",
        links: [],
      }));
      update((prev) => ({ ...prev, cards: [...prev.cards, clone] }));
      return clone.id;
    },
    [update, state.cards],
  );

  const discardPristineCards = useCallback(() => {
    if (externalPristine) {
      externalPristine.discardAll();
      return;
    }
    const ids = localPristine.takePristine();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    update((prev) => ({ ...prev, cards: prev.cards.filter((c) => !idSet.has(c.id)) }));
  }, [update, externalPristine, localPristine]);

  /** Re-attach a Mode B text-range anchor on a freshly-cloned cutter
   *  card. Idempotent — see CardLifecycle.bindAnchor doc. */
  const bindAnchor = useCallback(
    (id: string, paragraphId: string, anchorId: string, anchorText: string) => {
      update((prev) => {
        const card = prev.cards.find((c) => c.id === id);
        if (!card) return prev;
        const existing = getTextAnchor(card);
        if (existing?.anchorId === anchorId) return prev;
        const kind = card.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            c.id === id
              ? setTextAnchorLink(
                  c,
                  kind,
                  anchorId,
                  anchorText,
                  paragraphId ? [paragraphId] : undefined,
                )
              : c,
          ),
        };
      });
    },
    [update],
  );

  const clearCardAnchor = useCallback(
    (anchorId: string) => {
      update((prev) => {
        if (
          !prev.cards.some((c) => getTextAnchor(c)?.anchorId === anchorId)
        ) {
          return prev;
        }
        return {
          ...prev,
          cards: prev.cards.map((c) =>
            getTextAnchor(c)?.anchorId === anchorId
              ? clearTextAnchorLink(
                  c,
                  c.kind === "suggestion"
                    ? "cutter-suggestion"
                    : "cutter-comment",
                )
              : c,
          ),
        };
      });
    },
    [update],
  );

  // Orphan listener — when a linkedAnchor mark is deleted from the doc,
  // clear the dead anchorId on the matching cutter card. Single panel-
  // scoped listener handles both card kinds.
  // Gated on `docId` by the door (task 598): a sibling pane holding the same
  // anchorId must not strip its own card for a deletion in another document.
  useAnchorOrphaned(docId, ({ anchorId }) => {
    // No kind gate: a reloaded orphan event carries the parser-default
    // `kind:"note"`, so gating made this panel ignore its own orphaned
    // cutter mark (BUG1). `clearCardAnchor` self-filters by anchorId
    // membership (no-match early-return) — the owning panel decides.
    if (!anchorId) return;
    clearCardAnchor(anchorId);
  });

  return useMemo(
    () => ({
      cards: state.cards,
      goal: state.goal ?? null,
      addComment,
      addCommentFromSeed,
      addSuggestion,
      addSuggestionFromSeed,
      updateCommentContent,
      updateCommentText,
      setCommentAiRequest,
      updateSuggestionField,
      setSuggestionStatus,
      setAppliedChange,
      setGoal,
      clearGoal,
      addCardParagraphId,
      removeCardParagraphId,
      reconcileAnchors,
      reinstate,
      loaded,
      loadError,
      deleteCard,
      setArchived,
      cloneComment,
      cloneSuggestion,
      convertCard,
      bindAnchor,
      clearCardAnchor,
      discardPristineCards,
    }),
    [
      state.cards,
      state.goal,
      addComment,
      addCommentFromSeed,
      addSuggestion,
      addSuggestionFromSeed,
      updateCommentContent,
      updateCommentText,
      setCommentAiRequest,
      updateSuggestionField,
      setSuggestionStatus,
      setAppliedChange,
      setGoal,
      clearGoal,
      addCardParagraphId,
      removeCardParagraphId,
      reconcileAnchors,
      reinstate,
      loaded,
      loadError,
      deleteCard,
      setArchived,
      cloneComment,
      cloneSuggestion,
      convertCard,
      bindAnchor,
      clearCardAnchor,
      discardPristineCards,
    ],
  );
}
