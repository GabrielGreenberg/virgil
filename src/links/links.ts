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
import { generateEntityId } from "@/lib/uuid";
import {
  DATA_LINK_ID,
  linkCardKey,
  parseLinkCardKey,
} from "./link-registry";

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
// Public API: create / resolve / jump / delete
// ---------------------------------------------------------------------------

export type CreateLinkArgs =
  | {
      kind: "footnote";
      /** When omitted, a fresh UUID is generated. */
      targetCardId?: string;
      /** Tiptap JSONContent for the footnote body. */
      content?: unknown;
      title?: string;
      /** If provided, consume the current selection (Markdown-like
       *  `\footnote{…}` behavior). Otherwise inserts at cursor. */
      fromSelection?: boolean;
    }
  | {
      kind: "citation";
      targetCardId?: string;
      command: string;
      displayText?: string;
    }
  | {
      kind: "anchor";
      targetCardKind: CardKind;
      targetCardId: string;
      paragraphIds: string[];
      textRange?: { from: number; to: number };
    };

/** Create a new link. */
export function createLink(editor: Editor, args: CreateLinkArgs): Link {
  if (args.kind === "footnote") return createFootnoteLink(editor, args);
  if (args.kind === "citation") return createCitationLink(editor, args);
  if (args.kind === "anchor") return createAnchorLink(editor, args);
  throw new Error(
    `createLink: kind "${(args as { kind: string }).kind}" not supported.`,
  );
}

function createFootnoteLink(
  editor: Editor,
  args: Extract<CreateLinkArgs, { kind: "footnote" }>,
): Link {
  const linkId = args.targetCardId ?? generateEntityId();
  const cardKey = linkCardKey("footnote", linkId);
  let content = args.content ?? null;
  const chain = editor.chain().focus();

  if (args.fromSelection) {
    const { from, to } = editor.state.selection;
    if (from !== to) {
      const text = editor.state.doc.textBetween(from, to, " ");
      if (text.trim()) {
        content = content ?? {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        };
        chain.deleteSelection();
      }
    }
  }

  chain
    .insertContent({
      type: "footnote",
      attrs: {
        content,
        title: args.title ?? "",
        number: 0,
        footnoteId: linkId,
        linkId,
        linkKind: "footnote",
        linkCard: cardKey,
      },
    })
    .run();

  const pos = findInlineAtomPos(editor, "footnote", linkId);
  return {
    id: linkId,
    kind: "footnote",
    anchor: { type: "inline-atom", nodeName: "footnote", pos },
    target: { type: "card", ref: { kind: "footnote", id: linkId } },
    createdAt: new Date().toISOString(),
  };
}

function createAnchorLink(
  editor: Editor,
  args: Extract<CreateLinkArgs, { kind: "anchor" }>,
): Link {
  const linkId = generateEntityId();
  const cardKey = linkCardKey(args.targetCardKind, args.targetCardId);

  // Mode B: wrap the text range in a linkedAnchor mark.
  let textRange: { anchorId: string; textSnapshot: string } | undefined;
  if (args.textRange) {
    const { from, to } = args.textRange;
    if (to > from) {
      const snapshot = editor.state.doc.textBetween(from, to, " ");
      const ok = editor
        .chain()
        .setTextSelection(args.textRange)
        .setMark("linkedAnchor", {
          anchorId: linkId,
          kind: cardKindToLegacyAnchorKind(args.targetCardKind),
          linkId,
          linkKind: "anchor",
          linkCard: cardKey,
        })
        .setTextSelection(from)
        .run();
      if (ok) textRange = { anchorId: linkId, textSnapshot: snapshot };
    }
  }

  // Paragraph ids: either explicit, or derived from the text range's
  // containing paragraph.
  let paragraphIds = args.paragraphIds.slice();
  if (paragraphIds.length === 0 && args.textRange) {
    const pid = paragraphUuidAt(editor.state.doc, args.textRange.from);
    if (pid) paragraphIds = [pid];
  }

  return {
    id: linkId,
    kind: "anchor",
    anchor: {
      type: "anchor",
      paragraphIds,
      margin: { side: inferMarginSide(args.targetCardKind) },
      ...(textRange ? { textRange } : {}),
    },
    target: { type: "card", ref: { kind: args.targetCardKind, id: args.targetCardId } },
    createdAt: new Date().toISOString(),
  };
}

/** Legacy `linkedAnchor.kind` values the mark accepts today. Kept until
 *  the mark's `kind` attr is dropped in Phase 3 cleanup. */
function cardKindToLegacyAnchorKind(cardKind: CardKind): string {
  switch (cardKind) {
    case "note":
      return "note";
    case "cut":
      return "cut";
    case "comment":
      return "revision";
    default:
      return "note";
  }
}

function createCitationLink(
  editor: Editor,
  args: Extract<CreateLinkArgs, { kind: "citation" }>,
): Link {
  const linkId = args.targetCardId ?? generateEntityId();
  const cardKey = linkCardKey("citation", linkId);
  editor
    .chain()
    .focus()
    .insertContent({
      type: "citation",
      attrs: {
        command: args.command,
        displayText: args.displayText ?? "",
        citationId: linkId,
        linkId,
        linkKind: "citation",
        linkCard: cardKey,
      },
    })
    .run();

  const pos = findInlineAtomPos(editor, "citation", linkId);
  return {
    id: linkId,
    kind: "citation",
    anchor: { type: "inline-atom", nodeName: "citation", pos },
    target: { type: "card", ref: { kind: "citation", id: linkId } },
    createdAt: new Date().toISOString(),
  };
}

/** Locate `link` in the live editor. Returns null if it's missing. */
export function resolveLink(
  editor: Editor,
  link: Link,
): LinkResolution | null {
  if (link.anchor.type === "inline-atom") {
    const pos = findInlineAtomPos(editor, link.anchor.nodeName, link.id);
    if (pos == null) return null;
    const node = editor.state.doc.nodeAt(pos);
    const domEl = editor.view.dom.querySelector(
      `[${DATA_LINK_ID}="${link.id}"]`,
    ) as HTMLElement | null;
    return {
      kind: "inline-atom",
      pos,
      nodeSize: node?.nodeSize ?? 1,
      domEl,
    };
  }
  if (link.anchor.type === "anchor") {
    // Mode B: prefer the text-range mark.
    if (link.anchor.textRange) {
      const range = resolveTextRangeByAnchorId(
        editor,
        link.anchor.textRange.anchorId,
      );
      if (range) {
        const domEl = editor.view.dom.querySelector(
          `[data-link-id="${link.anchor.textRange.anchorId}"]`,
        ) as HTMLElement | null;
        return { kind: "text-range", from: range.from, to: range.to, domEl };
      }
    }
    // Mode A (or Mode B with a lost mark): fall back to the first paragraph.
    const paragraphId = link.anchor.paragraphIds[0];
    if (!paragraphId) return null;
    const pos = findParagraphByUuid(editor, paragraphId);
    if (pos == null) return null;
    const domEl = editor.view.dom.querySelector(
      `[data-uuid="${paragraphId}"]`,
    ) as HTMLElement | null;
    return { kind: "paragraph", paragraphId, pos, domEl };
  }
  return null;
}

/** Scroll the appropriate end of the link into view.
 *
 *  - `"to-marker"`: scroll the editor to the in-text marker.
 *  - `"to-card"`:   scroll the panel to the card entry.
 *  - `"both"`:      do both. */
export function jumpToLink(
  editor: Editor,
  link: Link,
  dir: "to-marker" | "to-card" | "both",
): void {
  if (dir === "to-marker" || dir === "both") {
    const resolved = resolveLink(editor, link);
    if (resolved?.domEl) {
      resolved.domEl.scrollIntoView({ behavior: "instant", block: "center" });
    }
  }
  if (dir === "to-card" || dir === "both") {
    const cardKey = linkCardKey(link.target.ref.kind, link.target.ref.id);
    const entryEl = document.querySelector(
      `[data-link-card="${cardKey}"]`,
    ) as HTMLElement | null;
    entryEl?.scrollIntoView({ behavior: "instant", block: "center" });
  }
}

/** Delete `link` from the editor. For inline-atom kinds this removes the
 *  node; for Mode B anchor links it strips the `linkedAnchor` mark. Mode A
 *  anchor links have no in-doc trace so this is a no-op — the caller is
 *  responsible for removing the entry from the target card's `links[]`.
 *  The target card is NOT deleted — a caller that wants cascading
 *  deletion handles that separately. */
export function deleteLink(editor: Editor, link: Link): void {
  if (link.anchor.type === "inline-atom") {
    const pos = findInlineAtomPos(editor, link.anchor.nodeName, link.id);
    if (pos == null) return;
    const tr = editor.state.tr.delete(pos, pos + 1);
    editor.view.dispatch(tr);
    return;
  }
  if (link.anchor.type === "anchor" && link.anchor.textRange) {
    removeLinkedAnchorMark(editor, link.anchor.textRange.anchorId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findInlineAtomPos(
  editor: Editor,
  nodeName: "footnote" | "citation",
  linkId: string,
): number | null {
  const idAttr = nodeName === "footnote" ? "footnoteId" : "citationId";
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.type.name !== nodeName) return true;
    const attrs = node.attrs as Record<string, unknown>;
    if (attrs.linkId === linkId || attrs[idAttr] === linkId) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function findParagraphByUuid(editor: Editor, uuid: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false;
    if (node.attrs?.uuid === uuid) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function resolveTextRangeByAnchorId(
  editor: Editor,
  anchorId: string,
): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (to !== null) return false;
    if (!node.isText) return true;
    const has = node.marks.some(
      (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
    );
    const end = pos + node.nodeSize;
    if (has) {
      if (from === null) from = pos;
      to = end;
    } else if (from !== null && to === null) {
      to = pos;
    }
    return true;
  });
  if (from === null || to === null) return null;
  return { from, to };
}

function removeLinkedAnchorMark(editor: Editor, anchorId: string): void {
  const range = resolveTextRangeByAnchorId(editor, anchorId);
  if (!range) return;
  editor
    .chain()
    .setTextSelection(range)
    .unsetMark("linkedAnchor")
    .setTextSelection(range.from)
    .run();
}

// ---------------------------------------------------------------------------
// Legacy linked-anchor API (absorbed from src/lib/linked-anchors.ts).
// These five exports preserve the signatures that callers depended on
// before the Link unification. New code should prefer `createLink`,
// `resolveLink`, `deleteLink`.
// ---------------------------------------------------------------------------

export type LinkedAnchorKind = "note" | "revision" | "cut";

export interface LinkedAnchorRecord {
  anchorId: string;
  paragraphId: string;
  text: string;
  createdAt: string;
}

function legacyKindToCardKindString(kind: LinkedAnchorKind): string {
  switch (kind) {
    case "note":
      return "note";
    case "cut":
      return "cut";
    case "revision":
      return "comment";
  }
}

/**
 * Apply a `linkedAnchor` mark to the current selection (or the given
 * range), returning the new record. When `cardId` is provided, the mark
 * carries `linkCard="<cardKind>:<cardId>"` so it's self-describing.
 */
export function createLinkedAnchor(
  editor: Editor,
  kind: LinkedAnchorKind,
  range?: { from: number; to: number },
  cardId?: string,
): LinkedAnchorRecord | null {
  const sel = range ?? {
    from: editor.state.selection.from,
    to: editor.state.selection.to,
  };
  if (sel.to <= sel.from) return null;
  const anchorId = generateEntityId();
  const text = editor.state.doc.textBetween(sel.from, sel.to, " ");
  const paragraphId = paragraphUuidAt(editor.state.doc, sel.from) ?? "";
  const cardKind = legacyKindToCardKindString(kind);
  const linkCard = cardId ? `${cardKind}:${cardId}` : "";
  const ok = editor
    .chain()
    .setTextSelection(sel)
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard,
    })
    .setTextSelection(sel.from)
    .run();
  if (!ok) return null;
  return {
    anchorId,
    paragraphId,
    text,
    createdAt: new Date().toISOString(),
  };
}

/** Locate the contiguous run carrying `anchorId`. Returns null if missing. */
export function resolveAnchorRange(
  editor: Editor,
  anchorId: string,
): { from: number; to: number } | null {
  return resolveTextRangeByAnchorId(editor, anchorId);
}

/** Remove the `linkedAnchor` mark for `anchorId` wherever it appears. */
export function removeLinkedAnchor(editor: Editor, anchorId: string): void {
  removeLinkedAnchorMark(editor, anchorId);
}

/**
 * Update a `linkedAnchor` mark's `linkCard` attr to point at the final
 * card. Call this after the card is persisted, so the mark becomes
 * self-describing (CSS can pick the per-kind highlight color, Cowork
 * can read the target without consulting any sidecar).
 */
export function updateLinkedAnchorCard(
  editor: Editor,
  anchorId: string,
  cardKind: CardKind,
  cardId: string,
): void {
  const range = resolveTextRangeByAnchorId(editor, anchorId);
  if (!range) return;
  // Preserve legacy `kind` attr and other existing attrs.
  let legacyKind = "note";
  editor.state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        legacyKind = (m.attrs.kind as string) || legacyKind;
      }
    }
    return true;
  });
  editor
    .chain()
    .setTextSelection(range)
    .setMark("linkedAnchor", {
      anchorId,
      kind: legacyKind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard: `${cardKind}:${cardId}`,
    })
    .setTextSelection(range.from)
    .run();
}

/**
 * Best-effort re-anchor by searching for `snapshot` text in the doc.
 * Used on load for items whose mark was lost across a parse.
 */
export function reanchorByText(
  editor: Editor,
  kind: LinkedAnchorKind,
  snapshot: string,
  preferredAnchorId?: string,
  cardId?: string,
): LinkedAnchorRecord | null {
  const text = editor.getText();
  const index = text.indexOf(snapshot);
  if (index === -1) return null;
  let charCount = 0;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from !== -1 && to !== -1) return false;
    if (node.isText && node.text) {
      const nodeStart = charCount;
      const nodeEnd = charCount + node.text.length;
      if (from === -1 && index >= nodeStart && index < nodeEnd) {
        from = pos + (index - nodeStart);
      }
      if (from !== -1 && to === -1) {
        const endIndex = index + snapshot.length;
        if (endIndex <= nodeEnd) to = pos + (endIndex - nodeStart);
      }
      charCount = nodeEnd;
    }
    return true;
  });
  if (from === -1 || to === -1) return null;
  const anchorId = preferredAnchorId ?? generateEntityId();
  const paragraphId = paragraphUuidAt(editor.state.doc, from) ?? "";
  const cardKind = legacyKindToCardKindString(kind);
  const linkCard = cardId ? `${cardKind}:${cardId}` : "";
  const ok = editor
    .chain()
    .setTextSelection({ from, to })
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard,
    })
    .setTextSelection(from)
    .run();
  if (!ok) return null;
  return {
    anchorId,
    paragraphId,
    text: snapshot,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// derivedLinksForCard — synthesize Link[] from the legacy card shape
// ---------------------------------------------------------------------------

type AnchorCardShape = {
  id: string;
  paragraphIds?: string[];
  anchorId?: string;
  anchorText?: string;
};

/**
 * Derive a canonical `Link[]` from a card that's still using legacy
 * fields (`paragraphIds` / `anchorId` / `anchorText`). Used by hooks that
 * load card sidecars into state — lets Cowork read a uniform shape
 * without needing to branch per card kind.
 *
 * Policy: Mode B cards (those with an `anchorId`) produce a single Link
 * whose `paragraphIds` include all known paragraph entries PLUS the
 * containing paragraph inferred from the mark, if distinct. Mode A cards
 * produce one Link per paragraphId.
 */
export function derivedLinksForCard(
  cardKind: CardKind,
  card: AnchorCardShape,
): Link[] {
  const out: Link[] = [];
  const side = inferMarginSide(cardKind);

  if (card.anchorId) {
    out.push({
      id: card.anchorId,
      kind: "anchor",
      anchor: {
        type: "anchor",
        paragraphIds: card.paragraphIds?.slice() ?? [],
        margin: { side },
        textRange: {
          anchorId: card.anchorId,
          textSnapshot: card.anchorText ?? "",
        },
      },
      target: { type: "card", ref: { kind: cardKind, id: card.id } },
      createdAt: "",
    });
    return out;
  }

  for (const paragraphId of card.paragraphIds ?? []) {
    out.push({
      id: `${card.id}@${paragraphId}`,
      kind: "anchor",
      anchor: {
        type: "anchor",
        paragraphIds: [paragraphId],
        margin: { side },
      },
      target: { type: "card", ref: { kind: cardKind, id: card.id } },
      createdAt: "",
    });
  }
  return out;
}

