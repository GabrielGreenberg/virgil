/**
 * Public API for the Link system.
 *
 * Phase 0: only `collectLinksFromEditor` is implemented. The
 * create/resolve/jump/delete functions throw — callers still use the
 * legacy code paths (footnote CRUD in `Editor.tsx`, the helpers in
 * `src/lib/linked-anchors.ts`, per-entity paragraph-id mutators in
 * `EditorLayout.tsx`). Phases 1–2 absorb those legacy paths into this
 * module.
 *
 * `collectLinksFromEditor` is pure-ish: it reads the live doc and
 * derives every in-doc `Link` record. It does NOT read card sidecars,
 * so Mode A pure-paragraph anchor links (a card anchored only via
 * `paragraphIds`, with no `linkedAnchor` mark) are NOT returned.
 * Those are added in Phase 2 when card sidecars gain a `links[]` field.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { CardKind } from "@/panels/_shared/types";
import type { Link, LinkResolution } from "./_shared/types";
import { parseLinkCardKey } from "./link-registry";

// Re-exports so callers import everything from one module.
export type { Link, LinkAnchor, LinkKind, LinkResolution, LinkTarget, ModeBAnchorLink } from "./_shared/types";
export { isAnchorLink, isModeB } from "./_shared/types";
export {
  LINK_REGISTRY,
  LinkMultiplicityError,
  enforceMultiplicity,
  linkCardKey,
  parseLinkCardKey,
  resolveCardKind,
  resolveLinkPanel,
  DATA_LINK_ID,
  DATA_LINK_KIND,
  DATA_LINK_CARD,
  DATA_LINK_IDS,
} from "./link-registry";

// ---------------------------------------------------------------------------
// Kind mapping from legacy `linkedAnchor.kind` attr to CardKind
// ---------------------------------------------------------------------------

/** Legacy `linkedAnchor.kind` values map to CardKinds. Revisions use the
 *  `comment` card kind in the panel registry. */
function legacyAnchorKindToCardKind(
  kind: string | undefined,
): CardKind | null {
  switch (kind) {
    case "note":
      return "note";
    case "cut":
      return "cut";
    case "revision":
      return "comment";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Paragraph UUID resolution
// ---------------------------------------------------------------------------

/** Walk ancestors up from `pos` and return the first UUID-bearing node's uuid. */
function paragraphUuidAt(doc: PMNode, pos: number): string | null {
  try {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      if (node.attrs?.uuid) return node.attrs.uuid as string;
    }
  } catch {
    // pos out of range
  }
  return null;
}

// ---------------------------------------------------------------------------
// collectLinksFromEditor — the Cowork entry point
// ---------------------------------------------------------------------------

/**
 * Read-only scan of the live doc. Returns every in-doc link:
 *
 *   - footnote atoms     → kind "footnote",  anchor.type "inline-atom"
 *   - citation atoms     → kind "citation",  anchor.type "inline-atom"
 *   - linkedAnchor marks → kind "anchor",    anchor.type "anchor" (Mode B)
 *
 * Mode A pure-paragraph anchor links (no linkedAnchor mark) are NOT
 * returned by this function — they live only in card sidecars until
 * Phase 2.
 */
export function collectLinksFromEditor(editor: Editor): Link[] {
  const doc = editor.state.doc;
  const links: Link[] = [];

  type AnchorAccumulator = {
    cardKind: CardKind;
    linkId: string;
    paragraphId: string | null;
    textParts: string[];
  };
  const anchors = new Map<string, AnchorAccumulator>();

  doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      const attrs = node.attrs as { linkId?: string; footnoteId?: string };
      const linkId = attrs.linkId || attrs.footnoteId || "";
      if (linkId) {
        links.push({
          id: linkId,
          kind: "footnote",
          anchor: { type: "inline-atom", nodeName: "footnote", pos },
          target: {
            type: "card",
            ref: { kind: "footnote", id: attrs.footnoteId || linkId },
          },
          createdAt: "",
        });
      }
      return false;
    }
    if (node.type.name === "citation") {
      const attrs = node.attrs as { linkId?: string; citationId?: string };
      const linkId = attrs.linkId || attrs.citationId || "";
      if (linkId) {
        links.push({
          id: linkId,
          kind: "citation",
          anchor: { type: "inline-atom", nodeName: "citation", pos },
          target: {
            type: "card",
            ref: { kind: "citation", id: attrs.citationId || linkId },
          },
          createdAt: "",
        });
      }
      return false;
    }

    if (node.isText) {
      for (const m of node.marks) {
        if (m.type.name !== "linkedAnchor") continue;
        const anchorId = (m.attrs.anchorId as string) || "";
        if (!anchorId) continue;
        const legacyKind = (m.attrs.kind as string) || "note";
        const linkCard = (m.attrs.linkCard as string) || "";
        const parsed = linkCard ? parseLinkCardKey(linkCard) : null;
        const cardKind = parsed?.kind ?? legacyAnchorKindToCardKind(legacyKind);
        if (!cardKind) continue;

        const existing = anchors.get(anchorId);
        if (existing) {
          existing.textParts.push(node.text ?? "");
        } else {
          anchors.set(anchorId, {
            cardKind,
            linkId: (m.attrs.linkId as string) || anchorId,
            paragraphId: paragraphUuidAt(doc, pos),
            textParts: [node.text ?? ""],
          });
        }
      }
    }
    return true;
  });

  for (const [anchorId, a] of anchors) {
    links.push({
      id: a.linkId,
      kind: "anchor",
      anchor: {
        type: "anchor",
        paragraphIds: a.paragraphId ? [a.paragraphId] : [],
        margin: { side: inferMarginSide(a.cardKind) },
        textRange: {
          anchorId,
          textSnapshot: a.textParts.join(""),
        },
      },
      target: { type: "card", ref: { kind: a.cardKind, id: "" } },
      createdAt: "",
    });
  }

  return links;
}

/** Margin-side default per target card kind. Reads the panel registry's
 *  `defaultStripSide`; falls back to "right". */
function inferMarginSide(cardKind: CardKind): "left" | "right" {
  // Lazily imported to avoid a circular at module load.
  // `MARKER_META` in `src/lib/marginalia.ts` already encodes the default
  // side per marker type; we just need the CardKind → side mapping here
  // for `collectLinksFromEditor`'s synthetic Link output. Revisions/cut
  // are on the right; quotations on the left. This defaults to "right"
  // and is only a hint — Phase 2's real data source is the card record.
  switch (cardKind) {
    case "quotation":
      return "left";
    default:
      return "right";
  }
}

// ---------------------------------------------------------------------------
// Stubs for Phase 1+ — throw so accidental callers are loud
// ---------------------------------------------------------------------------

export type CreateLinkArgs =
  | { kind: "footnote"; targetCardId: string; content?: unknown; title?: string }
  | { kind: "citation"; targetCardId: string; command: string; displayText?: string }
  | {
      kind: "anchor";
      targetCardKind: CardKind;
      targetCardId: string;
      paragraphIds: string[];
      textRange?: { from: number; to: number };
    };

function notImplemented(fn: string): never {
  throw new Error(
    `${fn}: not implemented in Phase 0. Use the legacy path for now.`,
  );
}

export function createLink(_editor: Editor, _args: CreateLinkArgs): Link {
  notImplemented("createLink");
}

export function resolveLink(
  _editor: Editor,
  _link: Link,
): LinkResolution | null {
  notImplemented("resolveLink");
}

export function jumpToLink(
  _editor: Editor,
  _link: Link,
  _dir: "to-marker" | "to-card" | "both",
): void {
  notImplemented("jumpToLink");
}

export function deleteLink(_editor: Editor, _link: Link): void {
  notImplemented("deleteLink");
}

