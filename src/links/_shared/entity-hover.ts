"use client";

/**
 * Centralized "linked entity" hover/selection types and helpers.
 *
 * The three linked surfaces (text passages, margin icons, panel cards) all
 * resolve to a single underlying *entity*: a card object identified by
 * `(id, kind)`. This module defines the kind union and a few generic
 * helpers that all three call sites use, so we never write per-kind hover
 * handlers.
 *
 * `EntityKind` is `CardKind`: the *anchored-membership* constraint — the kinds
 * whose three-surface hover/selection rule applies — is enforced at the use
 * sites by `isAnchoredCardKind` (the `CARD_REGISTRY` predicate) and the
 * `ANCHORED_CARD_KINDS` set, NOT by a separate hand-kept union. Adding an
 * anchored kind is one `anchored: true` registry edit; this list and the type
 * follow automatically (the parallel-list drift A0 set out to kill).
 */

import type { Link } from "./types";
import { getTextAnchor } from "../links";
import { buildFloatKey } from "@/floats/float-key";
import { CARD_KINDS, cardKindFromRecord, isAnchoredCardKind } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";

/** The anchored card kinds — derived from the registry's `anchored` flag (the
 *  single membership source), replacing the former hand-kept literal array. */
export const ANCHORED_CARD_KINDS: readonly CardKind[] =
  CARD_KINDS.filter(isAnchoredCardKind);

/** A card kind eligible for the three-surface (text · margin · card) hover /
 *  selection rule. `= CardKind`; anchored membership is the registry `anchored`
 *  flag, checked at use sites via `isAnchoredCardKind` / `ANCHORED_CARD_KINDS`
 *  — not a narrow union (which would re-introduce the drift A0 killed). */
export type EntityKind = CardKind;

// Dev canary: the in-text hover system structurally depends on footnote +
// citation being anchored (their inline atoms drive three-surface hover). If a
// registry `anchored` flag is ever flipped off for them — or the set comes back
// empty from a mis-load — make that loud in dev rather than silently breaking.
if (process.env.NODE_ENV !== "production") {
  for (const k of ["footnote", "citation"] as const) {
    if (!isAnchoredCardKind(k)) {
      console.error(
        `[entity-hover] "${k}" must be anchored (the three-surface hover system ` +
          `depends on its inline atom) but CARD_REGISTRY marks it non-anchored.`,
      );
    }
  }
  if (ANCHORED_CARD_KINDS.length === 0) {
    console.error("[entity-hover] ANCHORED_CARD_KINDS derived empty — registry mis-load?");
  }
}

export interface EntityRef {
  id: string;
  kind: EntityKind;
}

export interface EntityCollections {
  notes: ReadonlyArray<{ id: string; links?: Link[] }>;
  /** Highlights live alongside notes in the Notes panel; threaded here so
   *  `findEntity({ kind: "highlight", ... })` can resolve them. Optional
   *  so legacy callers (e.g. Reader paths without a highlights hook) still
   *  compile — a missing list just means highlights resolve to `undefined`. */
  highlights?: ReadonlyArray<{ id: string; links?: Link[] }>;
  cutterCards: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  comments: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  todos: ReadonlyArray<{ id: string; links?: Link[] }>;
  archiveSnippets: ReadonlyArray<{ id: string; links?: Link[] }>;
  /** Reports panel hosts both `report` and `report-request` kinds; threaded
   *  here so `findEntity` can resolve either by splitting on `kind`. Optional
   *  so legacy callers without a reports hook still compile. */
  reports?: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  examples: ReadonlyArray<{ id: string }>;
}

export function findEntity(
  ref: EntityRef,
  c: EntityCollections,
): { id: string; kind?: string; links?: Link[] } | undefined {
  switch (ref.kind) {
    case "note":      return c.notes.find((e) => e.id === ref.id);
    case "highlight": return c.highlights?.find((e) => e.id === ref.id);
    case "todo":      return c.todos.find((e) => e.id === ref.id);
    case "archive":   return c.archiveSnippets.find((e) => e.id === ref.id);
    case "report":
    case "report-request": {
      const card = c.reports?.find((e) => e.id === ref.id);
      return card && cardKindFromRecord(card, "reports") === ref.kind ? card : undefined;
    }
    case "example":   return c.examples.find((e) => e.id === ref.id);
    case "cutter-comment":
    case "cutter-suggestion": {
      // Collection routing stays here (cutter records); the comment-vs-suggestion
      // split is the single-source read classifier (cardKindFromRecord).
      const card = c.cutterCards.find((e) => e.id === ref.id);
      return card && cardKindFromRecord(card, "cutter") === ref.kind ? card : undefined;
    }
    case "revision-comment":
    case "revision-suggestion": {
      const card = c.comments.find((e) => e.id === ref.id);
      return card && cardKindFromRecord(card, "revisions") === ref.kind ? card : undefined;
    }
    case "footnote":
    case "citation":
      return undefined;
    default:
      // `EntityKind` is now `CardKind`; the non-anchored kinds (bib / ai /
      // error) have no panel-card entity. Anchored membership is guarded
      // upstream (`ANCHORED_KINDS.has(...)` in usePanelCardHoverBridge), so
      // this arm is reached only for a defensively-passed non-anchored kind.
      return undefined;
  }
}

/** The `data-card-key` an entity's panel card stamps — the canonical
 *  `float:card:<kind>:<id>` grammar (AF). EntityKind is a subset of CardKind,
 *  so we build the key exactly the way every card does (`cardPopKey` →
 *  `buildFloatKey`), which guarantees this matches the DOM byte-for-byte.
 *  Built via the runtime-leaf `float-key` (not the panel registry) to avoid an
 *  import cycle. */
export function cardKeyForEntity(
  ref: EntityRef,
  _c: EntityCollections,
): string | null {
  return buildFloatKey({ domain: "card", kind: ref.kind, id: ref.id });
}

/** Resolve a hovered/selected entity to its Mode B text-range anchor id, or null. */
export function entityToAnchorId(
  ref: EntityRef | null,
  c: EntityCollections,
): string | null {
  if (!ref) return null;
  const entity = findEntity(ref, c);
  return entity ? getTextAnchor(entity)?.anchorId ?? null : null;
}

/** Map an EntityKind to the marker-namespace key used downstream for color
 *  theming (MARKER_META, MARKER_KIND_TO_THEME_KEY). Cutter splits stay
 *  separate so each suggestion-vs-comment pair can carry its own anchor
 *  tint; revisions share one `revision` marker key for both kinds. */
export function entityKindToAnchorKind(
  ref: EntityRef | null,
  _c: EntityCollections,
): "note" | "highlight" | "revision" | "cutter-comment" | "cutter-suggestion" | null {
  if (!ref) return null;
  switch (ref.kind) {
    case "note":                return "note";
    case "highlight":           return "highlight";
    case "revision-comment":
    case "revision-suggestion": return "revision";
    case "cutter-comment":      return "cutter-comment";
    case "cutter-suggestion":   return "cutter-suggestion";
    default:                    return null;
  }
}
