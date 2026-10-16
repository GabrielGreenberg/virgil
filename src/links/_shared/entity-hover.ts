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
import { buildFloatKey } from "@/floats/float-key";
import { CARD_KINDS, cardKindFromRecord, isAnchoredCardKind } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";
import type { EntityCollectionSlots } from "@/cards/entity-collections";

/** The anchored card kinds — derived from the registry's `anchored` flag (the
 *  single membership source), replacing the former hand-kept literal array. */
export const ANCHORED_CARD_KINDS: readonly CardKind[] =
  CARD_KINDS.filter(isAnchoredCardKind);

/** A card kind eligible for the three-surface (text · margin · card) hover /
 *  selection rule. `= CardKind`; anchored membership is the registry `anchored`
 *  flag, checked at use sites via `isAnchoredCardKind` / `ANCHORED_CARD_KINDS`
 *  — not a narrow union (which would re-introduce the drift A0 killed). */
export type EntityKind = CardKind;

// Dev canary: the in-text hover system structurally depends on every
// Card-bearing inline atom's kind being anchored (the atoms drive three-surface
// hover). If a registry `anchored` flag is ever flipped off for one — or the set
// comes back empty from a mis-load — make that loud in dev rather than silently
// breaking. The set is the atom registry's (`CARD_ATOMS`), not a re-spelling.
if (process.env.NODE_ENV !== "production") {
  for (const { kind: k } of CARD_ATOMS) {
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

export function findEntity(
  ref: EntityRef,
  c: EntityCollectionSlots,
): { id: string; kind?: string; links?: Link[] } | undefined {
  switch (ref.kind) {
    case "note":      return c.notes.find((e) => e.id === ref.id);
    case "highlight": return c.highlights.find((e) => e.id === ref.id);
    case "todo":      return c.todoItems.find((e) => e.id === ref.id);
    case "archive":   return c.archiveSnippets.find((e) => e.id === ref.id);
    case "report":
    case "report-request": {
      const card = c.reportCards.find((e) => e.id === ref.id);
      return card && cardKindFromRecord(card, "reports") === ref.kind ? card : undefined;
    }
    // `ExampleInfo` keys on `exampleId`, not `id` (the one-example carve-out);
    // resolve from either so both shapes (ExampleInfo[] and the bag-less {id})
    // work without a boundary adapter. Normalize the hit to the canonical
    // `{ id }` shape (examples carry no Mode-B `links`, so there's nothing else
    // to surface).
    case "example": {
      const ex = c.examples.find((e) => (e.exampleId ?? e.id) === ref.id);
      return ex ? { id: ref.id } : undefined;
    }
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
export function cardKeyForEntity(ref: EntityRef): string | null {
  return buildFloatKey({ domain: "card", kind: ref.kind, id: ref.id });
}

// (`entityToAnchorId` — hovered/selected entity → Mode-B anchor id — lived
// here until task 1148: its one caller was the shell's second Mode-B painter.
// The anchor reconciler resolves its targets through `collectTargets`.)
// (The entity-kind → anchor-kind mapper lived here until A10 Commit G: it had
// no remaining consumers — anchor-tint theming reads panelThemeKeyForMarkerType
// / MARKER_META directly.)
