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
 * EntityKind enumerates the *anchored* card kinds — the ones whose
 * three-surface hover/selection rule applies. It is *not* the same as
 * `CardKind` from `panels/_shared/types.ts`, which has additional
 * non-anchored variants (bib, error, ai) used only for rendering.
 */

import type { Link } from "./types";
import { getTextAnchor } from "../links";

export const ANCHORED_CARD_KINDS = [
  "note",
  "highlight",
  "footnote",
  "citation",
  "report",
  "report-request",
  "example",
  "todo",
  "archive",
  "revision-comment",
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
] as const;

export type EntityKind = (typeof ANCHORED_CARD_KINDS)[number];

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
    case "report": {
      const card = c.reports?.find((e) => e.id === ref.id);
      return card && card.kind !== "report-request" ? card : undefined;
    }
    case "report-request": {
      const card = c.reports?.find((e) => e.id === ref.id);
      return card && card.kind === "report-request" ? card : undefined;
    }
    case "example":   return c.examples.find((e) => e.id === ref.id);
    case "cutter-comment": {
      const card = c.cutterCards.find((e) => e.id === ref.id);
      return card && card.kind !== "suggestion" ? card : undefined;
    }
    case "cutter-suggestion": {
      const card = c.cutterCards.find((e) => e.id === ref.id);
      return card && card.kind === "suggestion" ? card : undefined;
    }
    case "revision-comment": {
      const card = c.comments.find((e) => e.id === ref.id);
      return card && card.kind !== "suggestion" ? card : undefined;
    }
    case "revision-suggestion": {
      const card = c.comments.find((e) => e.id === ref.id);
      return card && card.kind === "suggestion" ? card : undefined;
    }
    case "footnote":
    case "citation":
      return undefined;
  }
}

/** `data-card-key` prefix for an entity. One-to-one with EntityKind — no
 *  polymorphism. The prefixes themselves are owned by `CARD_KEY_PREFIXES`
 *  in panel-registry; this function exists so callers don't need to import
 *  the registry just to build a card key. */
export function cardKeyForEntity(
  ref: EntityRef,
  _c: EntityCollections,
): string | null {
  switch (ref.kind) {
    case "note":                return `note:${ref.id}`;
    case "highlight":           return `highlight:${ref.id}`;
    case "todo":                return `todo:${ref.id}`;
    case "archive":             return `archive:${ref.id}`;
    case "report":              return `report:${ref.id}`;
    case "report-request":      return `report-request:${ref.id}`;
    case "example":             return `example:${ref.id}`;
    case "revision-comment":    return `revision:${ref.id}`;
    case "revision-suggestion": return `revision-suggestion:${ref.id}`;
    case "cutter-comment":      return `cutter-comment:${ref.id}`;
    case "cutter-suggestion":   return `cutter-suggestion:${ref.id}`;
    case "footnote":            return `footnote:${ref.id}`;
    case "citation":            return `citation:${ref.id}`;
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
