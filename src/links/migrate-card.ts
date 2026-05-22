import type { CardKind } from "@/panels/_shared/types";
import type { Link, LinkAnchor } from "./_shared/types";
import { derivedLinksForCard } from "./links";

/**
 * Given the raw sidecar shape for a link-bearing card, return the
 * canonical `Link[]` — either the one already present (with any legacy
 * anchor shape migrated to the new TextObject shape), or a fresh one
 * derived from legacy per-card fields (`paragraphIds`, `anchorId`,
 * `anchorText`). Per-hook migrators previously duplicated this block
 * verbatim; consolidating here gives agents a single place to reason
 * about the legacy → canonical transition.
 *
 * Pre-D8 sidecars carry `anchor.type: "anchor"` with `paragraphIds`.
 * D8 restructures to `anchor.type: "textObject"` with `targetKind` and
 * `textObjectIds`. The migration is a one-shot shape transform on read;
 * subsequent writes use the new shape natively.
 *
 * `targetKind` inference for legacy data:
 *  • `textRange` present → `"linkedRange"` (Mode B).
 *  • Otherwise → `"paragraph"` (Mode A). Pre-D9, cards could only
 *    anchor to paragraphs or text ranges; no legacy data has sub-object
 *    or atom-block anchors. After D9, sub-object anchors will be
 *    written with the correct `targetKind` directly.
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
    return (r.links as Link[]).map(migrateLink);
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

/**
 * Migrate a single Link's anchor shape from the pre-D8 form
 * (`type: "anchor"` + `paragraphIds`) to the new TextObject form
 * (`type: "textObject"` + `targetKind` + `textObjectIds`).
 *
 * Idempotent: links already in the new shape pass through unchanged.
 * Inline-atom links (footnotes, citations) pass through unchanged.
 */
function migrateLink(link: Link): Link {
  const anchor = link.anchor as unknown as
    | LinkAnchor
    | {
        type: "anchor";
        paragraphIds?: string[];
        margin?: { side: "left" | "right" };
        textRange?: { anchorId: string; textSnapshot: string };
      };
  if (!anchor || typeof anchor !== "object") return link;
  if (anchor.type === "inline-atom") return link;
  if (anchor.type === "textObject") return link;
  if (anchor.type === "anchor") {
    const legacy = anchor;
    const textObjectIds = Array.isArray(legacy.paragraphIds)
      ? legacy.paragraphIds.slice()
      : [];
    const margin = legacy.margin ?? { side: "right" as const };
    const migrated: LinkAnchor = legacy.textRange
      ? {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds,
          margin,
          textRange: legacy.textRange,
        }
      : {
          // Pre-D9, legacy non-range anchors are paragraph-anchored.
          // After D9, sub-object/atom-block anchors are written with
          // the correct kind directly; no backfill needed.
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds,
          margin,
        };
    return { ...link, anchor: migrated };
  }
  return link;
}
