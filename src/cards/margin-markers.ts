/**
 * The margin's card markers — ONE registry-derived builder (task 939).
 *
 * The margin used to build its markers in six near-identical loops in
 * `EditorPane` (notes, archive, revisions, cutter, reports, todos), each
 * restating the same nine fields by hand — including the marker `type`, which
 * `CARD_REGISTRY[kind].markerType` already declares, and `entityKind`, which
 * the re-pin grab (`Marginalia`) needs and nothing checked a seventh branch
 * for. "A registry earns its name by being read": here the marker's `type`
 * AND the delete door's kind are READ from the registry, `entityKind` /
 * `entityId` are set for every card marker by construction, and the only
 * per-collection facts left are the ones the registry cannot know — which
 * card kind a record resolves to, its tooltip, its muted state, and whether
 * it is skipped (a resolved suggestion).
 *
 * The census (`margin-markers-registry-census.test.ts`) pins the table
 * against the registry: every card kind whose `markerType` puts it in the
 * margin is produced by exactly one source, and every built marker's `type`
 * equals its kind's `markerType`.
 */

import type { MarginaliaMarker } from "@/lib/marginalia";
import type { CardWithLinks } from "@/links/links";
import type { AnchoredCardRef } from "@/links/_shared/anchored-card-store";
import {
  buildMarginMarkerRows,
  marginAnchorRowPid,
  type CardAnchorResolver,
} from "@/links/card-anchor-rows";
import { CARD_REGISTRY } from "./card-registry";
import type { MarginItemKind } from "./delete-margin-item";
import type { CardKind } from "./types";

/** The registry's answer to "which margin marker does this card kind paint?",
 *  narrowed to the card-bearing namespaces (the non-card `"error"` marker and
 *  the marker-less kinds answer `null`). The delete door is keyed by the same
 *  value, so one read decides both the icon and the handler bundle. */
export function marginMarkerTypeForKind(kind: CardKind): MarginItemKind | null {
  const t = CARD_REGISTRY[kind].markerType;
  return t == null || t === "error" ? null : t;
}

/** The per-collection facts the registry cannot supply. */
export interface MarginMarkerSource<T extends CardWithLinks = CardWithLinks> {
  /** Every card kind this collection's records can resolve to (read by the
   *  census, so a collection cannot silently grow a kind the table omits). */
  kinds: readonly CardKind[];
  kindOf: (card: T) => CardKind;
  title: (card: T, kind: CardKind) => string;
  muted?: (card: T) => boolean;
  /** True ⇒ the card paints no marker (e.g. a RESOLVED suggestion). */
  skip?: (card: T) => boolean;
}

/** Bound callbacks the builder wires into each marker. */
export interface CardMarkerCtx {
  resolve: CardAnchorResolver;
  onClick: (ref: AnchoredCardRef, clickY: number | undefined, anchorPid: string | undefined) => void;
  onDelete: (
    kind: MarginItemKind,
    cardId: string,
    paragraphId: string,
    anchorPids: readonly string[],
  ) => void;
}

const label = (kind: CardKind) => CARD_REGISTRY[kind].label;

// ── The per-collection table ─────────────────────────────────────────────
// Structural card shapes: only the fields each source reads.

type SuggestionLike = CardWithLinks & { kind: "comment" | "suggestion" };

const notes: MarginMarkerSource<CardWithLinks & { title?: string }> = {
  kinds: ["note"],
  kindOf: () => "note",
  title: (n, k) => n.title || label(k),
};

const archive: MarginMarkerSource = {
  kinds: ["archive"],
  kindOf: () => "archive",
  title: (_c, k) => label(k),
};

const revisions: MarginMarkerSource<SuggestionLike & { status?: string; selectedText?: string }> = {
  kinds: ["revision-comment", "revision-suggestion"],
  kindOf: (r) => (r.kind === "suggestion" ? "revision-suggestion" : "revision-comment"),
  title: (r, k) => r.selectedText || label(k),
  // Skip only *resolved* suggestions (accepted/rejected). A `pending` card is
  // awaiting review and an `applied` card is spliced into the doc but still
  // awaiting an explicit "Keep" — both are live and keep their margin marker
  // (a plain `revision` marker: no re-skin, no hover Keep/Revert chips — those
  // reach the change through the card and the in-context left-margin pill);
  // `stale` (the paragraph drifted) likewise stays visible so the user can
  // resolve it.
  skip: (r) => r.kind === "suggestion" && (r.status === "accepted" || r.status === "rejected"),
};

const cutter: MarginMarkerSource<SuggestionLike & { explanation?: string; text?: string }> = {
  kinds: ["cutter-comment", "cutter-suggestion"],
  kindOf: (c) => (c.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment"),
  // An APPLIED cutter suggestion keeps its ordinary `cut` marker (see above).
  title: (c, k) => (c.kind === "suggestion" ? c.explanation : c.text) || label(k),
};

const reports: MarginMarkerSource<
  CardWithLinks & { kind: "report" | "report-request"; title?: string; text?: string }
> = {
  kinds: ["report", "report-request"],
  kindOf: (c) => c.kind,
  title: (c, k) => (c.kind === "report" ? c.title || c.text : c.text) || label(k),
};

const todos: MarginMarkerSource<CardWithLinks & { text?: string; done?: boolean }> = {
  kinds: ["todo"],
  kindOf: () => "todo",
  title: (t, k) => t.text || label(k),
  muted: (t) => !!t.done,
};

/** Every collection that paints card markers in the margin. */
export const MARGIN_MARKER_SOURCES = {
  notes,
  archive,
  revisions,
  cutter,
  reports,
  todos,
} as const;

/**
 * Build one card's margin markers — one per resolved anchor row, through the
 * ONE card-anchor authority (`buildMarginMarkerRows`, task 369), so the
 * margin and the omni rows can never disagree about whether the card
 * resolves. A card with nothing to resolve yields zero rows and so no marker.
 */
export function buildCardMarkers<T extends CardWithLinks>(
  card: T,
  source: MarginMarkerSource<T>,
  ctx: CardMarkerCtx,
): MarginaliaMarker[] {
  if (source.skip?.(card)) return [];
  const kind = source.kindOf(card);
  const type = marginMarkerTypeForKind(kind);
  if (type == null) return [];
  const title = source.title(card, kind);
  const muted = source.muted?.(card);
  return buildMarginMarkerRows(card, ctx.resolve).map(({ pid, unanchored, cardPids }) => ({
    id: `${card.id}:${pid}`,
    entityId: card.id,
    entityKind: kind,
    type,
    textObjectId: pid,
    title,
    ...(muted !== undefined ? { muted } : {}),
    unanchored,
    // T5 Pillar E-2 / task 916: the anchor pid names the omni row by IDENTITY
    // (`undefined` for a single-row card, whose row carries no suffix).
    onClick: (clickY?: number) =>
      ctx.onClick({ kind, id: card.id }, clickY, marginAnchorRowPid(card, pid, ctx.resolve)),
    onDelete: () => ctx.onDelete(type, card.id, pid, cardPids),
  }));
}

/** Build the markers for a whole collection, appended to `out`. */
export function pushSourceMarkers<T extends CardWithLinks>(
  out: MarginaliaMarker[],
  cards: ReadonlyArray<T>,
  source: MarginMarkerSource<T>,
  ctx: CardMarkerCtx,
): void {
  for (const card of cards) out.push(...buildCardMarkers(card, source, ctx));
}
