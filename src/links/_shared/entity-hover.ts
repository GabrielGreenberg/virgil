"use client";

/**
 * Centralized "linked entity" hover/selection types and helpers.
 *
 * The three linked elements (text passages, margin icons, panel cards) all
 * resolve to a single underlying *entity*: a card object identified by
 * `(entityId, entityKind)`. This module defines the kind union and a few
 * generic helpers that all three call sites use, so we never write per-kind
 * hover handlers.
 *
 * EntityKind matches the per-kind selection slots already in EditorLayout
 * (note, cut, revision, todo, archive, quotation, footnote, citation). It
 * is *not* the same as `CardKind` from `panels/_shared/types.ts` — that
 * union has more variants (suggestion/comment splits, ai, error) and is
 * meant for rendering. EntityKind is the linking-vocabulary subset.
 */

import type { Link } from "./types";
import { getTextAnchor } from "../links";

export type EntityKind =
  | "note"
  | "cut"
  | "revision"
  | "todo"
  | "archive"
  | "quotation"
  | "footnote"
  | "citation";

export interface EntityRef {
  id: string;
  kind: EntityKind;
}

export interface EntityCollections {
  notes: ReadonlyArray<{ id: string; links?: Link[] }>;
  cutterCards: ReadonlyArray<{ id: string; kind?: string; links?: Link[] }>;
  comments: ReadonlyArray<{ id: string; links?: Link[] }>;
  todos: ReadonlyArray<{ id: string; links?: Link[] }>;
  archiveSnippets: ReadonlyArray<{ id: string; links?: Link[] }>;
  quotationGroups: ReadonlyArray<{ id: string; links?: Link[] }>;
}

export function findEntity(
  ref: EntityRef,
  c: EntityCollections,
): { id: string; kind?: string; links?: Link[] } | undefined {
  switch (ref.kind) {
    case "note": return c.notes.find((e) => e.id === ref.id);
    case "cut": return c.cutterCards.find((e) => e.id === ref.id);
    case "revision": return c.comments.find((e) => e.id === ref.id);
    case "todo": return c.todos.find((e) => e.id === ref.id);
    case "archive": return c.archiveSnippets.find((e) => e.id === ref.id);
    case "quotation": return c.quotationGroups.find((e) => e.id === ref.id);
    case "footnote":
    case "citation":
      return undefined;
  }
}

/** `data-card-key` prefix for an entity. Cutter cards split into
 *  comment/suggestion based on the card's own `kind` field. */
export function cardKeyForEntity(
  ref: EntityRef,
  c: EntityCollections,
): string | null {
  switch (ref.kind) {
    case "note": return `note:${ref.id}`;
    case "todo": return `todo:${ref.id}`;
    case "archive": return `archive:${ref.id}`;
    case "quotation": return `quotation:${ref.id}`;
    case "revision": return `revision:${ref.id}`;
    case "footnote": return `footnote:${ref.id}`;
    case "citation": return `citation:${ref.id}`;
    case "cut": {
      const card = c.cutterCards.find((e) => e.id === ref.id);
      return card?.kind === "suggestion"
        ? `cutter-suggestion:${ref.id}`
        : `cutter-comment:${ref.id}`;
    }
  }
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

/** Map an EntityKind (+ the entity itself for cut polymorphism) to the
 *  LinkedAnchorKind used by `useLinkHighlight` for color theming. */
export function entityKindToAnchorKind(
  ref: EntityRef | null,
  c: EntityCollections,
): "note" | "revision" | "cutter-comment" | "cutter-suggestion" | null {
  if (!ref) return null;
  if (ref.kind === "note") return "note";
  if (ref.kind === "revision") return "revision";
  if (ref.kind === "cut") {
    const card = c.cutterCards.find((e) => e.id === ref.id);
    return card?.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
  }
  return null;
}
