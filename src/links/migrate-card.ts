import type { CardKind } from "@/panels/_shared/types";
import type { Link } from "./_shared/types";
import { derivedLinksForCard } from "./links";

/**
 * Given the raw sidecar shape for a link-bearing card, return the
 * canonical `Link[]` — either the one already present, or a fresh one
 * derived from legacy per-card fields (`paragraphIds`, `anchorId`,
 * `anchorText`). Per-hook migrators previously duplicated this block
 * verbatim; consolidating here gives agents a single place to reason
 * about the legacy → canonical transition.
 *
 * This handles only the links field. Callers still normalize the rest
 * of the card (content, title, createdAt, …) themselves, since those
 * vary per card kind.
 */
export function migrateCardLinks(kind: CardKind, raw: unknown): Link[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as {
    id?: unknown;
    links?: unknown;
    paragraphIds?: unknown;
    anchorId?: unknown;
    anchorText?: unknown;
  };
  if (Array.isArray(r.links) && r.links.length > 0) {
    return r.links as Link[];
  }
  return derivedLinksForCard(kind, {
    id: typeof r.id === "string" ? r.id : "",
    paragraphIds: Array.isArray(r.paragraphIds)
      ? (r.paragraphIds as string[])
      : [],
    anchorId: typeof r.anchorId === "string" ? r.anchorId : undefined,
    anchorText: typeof r.anchorText === "string" ? r.anchorText : undefined,
  });
}
