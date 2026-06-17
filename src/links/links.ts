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
import type { TextObjectKind } from "@/text-objects/types";
import { countWords } from "@/hooks/useWordCount";
import type { Link, LinkResolution } from "./_shared/types";
import { normalizeParagraphText } from "./_shared/normalize-text";
import { generateEntityId } from "@/lib/uuid";
import {
  DATA_LINK_ID,
  linkCardKey,
  parseLinkCardKey,
} from "./link-registry";
import { legacyDataKindForCardKind } from "@/cards/legacy-token-crosswalk";
import { alignEntryToY } from "@/components/editor-layout/layout-scroll";

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
 *  `comment` card kind in the panel registry. The legacy `"cut"` value
 *  (pre-Cutter-rebuild) maps to `"cutter-comment"` since cuts migrate
 *  to comments. */
function legacyAnchorKindToCardKind(
  kind: string | undefined,
): CardKind | null {
  switch (kind) {
    case "note":
      return "note";
    case "highlight":
      return "highlight";
    case "cut":
    case "cutter-comment":
      return "cutter-comment";
    case "cutter-suggestion":
      return "cutter-suggestion";
    case "revision":
      return "revision-comment";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Paragraph UUID resolution
// ---------------------------------------------------------------------------

/** Walk ancestors up from `pos` and return the first UUID-bearing node's uuid. */
export function paragraphUuidAt(doc: PMNode, pos: number): string | null {
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

/**
 * Capture a plain-text snapshot of the TextObject (paragraph / heading /
 * listItem / …) whose `uuid` attr is `paragraphId`, for the Mode-A
 * self-healing anchor (`LinkAnchor.paragraphSnapshot`).
 *
 * Returns the node's `textContent` in NORMALIZED form (CHIP-D:
 * `normalizeParagraphText` — trim ends, collapse internal whitespace,
 * strip zero-width), or `null` if the editor isn't ready, no live node
 * carries that uuid, OR the normalized text is empty (so a missing
 * snapshot stays `undefined`/absent rather than an empty string that
 * could false-match).
 *
 * Normalizing at CAPTURE time is the closing half of CHIP-D: the
 * resolve index (`buildResolveIndex`) already normalizes live
 * `textContent` into its snapshot map, so a snapshot captured through
 * this function is stored in the SAME canonical form and the snapshot
 * rung ties after a LaTeX parse→serialize round-trip (which can perturb
 * whitespace/markup). Capture and match MUST use the identical form.
 *
 * Container-consistency note (DEFERRING_PARENTS): this keys on the SAME
 * `uuid` attr the index walk keys on (`buildResolveIndex` step (b) reads
 * `node.attrs.uuid` → `node.textContent`), and `node.textContent` is the
 * full subtree text — so for a deferred-parent target both sides read the
 * identical node and the same normalized text.
 *
 * O(doc) — call ONLY off the keystroke path (anchor write / re-anchor /
 * load reconcile), never per keystroke.
 */
export function captureParagraphSnapshot(
  editor: Editor | null | undefined,
  paragraphId: string | null | undefined,
): string | null {
  if (!editor || !paragraphId) return null;
  let snapshot: string | null = null;
  editor.state.doc.descendants((node) => {
    if (snapshot !== null) return false;
    if ((node.attrs as { uuid?: string } | null)?.uuid === paragraphId) {
      const text = normalizeParagraphText(node.textContent);
      snapshot = text.length > 0 ? text : null;
      return false;
    }
    return true;
  });
  return snapshot;
}

// ---------------------------------------------------------------------------
// collectLinksFromEditor — the Cowork entry point
// ---------------------------------------------------------------------------

/**
 * Read-only scan of the live doc. Returns every in-doc link:
 *
 *   - footnote atoms     → kind "footnote",  anchor.type "inline-atom"
 *   - citation atoms     → kind "citation",  anchor.type "inline-atom"
 *   - linkedAnchor marks → kind "anchor",    anchor.type "textObject"
 *                                            with targetKind "linkedRange" (Mode B)
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
        type: "textObject",
        targetKind: "linkedRange",
        textObjectIds: a.paragraphId ? [a.paragraphId] : [],
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
  // are on the right; reports on the left. This defaults to "right"
  // and is only a hint — Phase 2's real data source is the card record.
  switch (cardKind) {
    case "report":
    case "report-request":
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
      /** TextObject kind being anchored to. Use `"linkedRange"` for a
       *  text-range (Mode B); persistent-node kinds (paragraph, heading,
       *  listItem, exampleItem, atom blocks, etc.) are Mode A. */
      targetKind: TextObjectKind;
      targetCardKind: CardKind;
      targetCardId: string;
      textObjectIds: string[];
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

  // TextObject ids: either explicit, or derived from the text range's
  // containing paragraph.
  let textObjectIds = args.textObjectIds.slice();
  if (textObjectIds.length === 0 && args.textRange) {
    const pid = paragraphUuidAt(editor.state.doc, args.textRange.from);
    if (pid) textObjectIds = [pid];
  }

  return {
    id: linkId,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: args.targetKind,
      textObjectIds,
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
    case "highlight":
      return "highlight";
    case "todo":
      return "todo";
    case "cutter-comment":
      return "cutter-comment";
    case "cutter-suggestion":
      return "cutter-suggestion";
    case "revision-comment":
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
    // Prefer `data-link-id` (set by newer atoms); fall back to the atom's
    // own DOM via view.nodeDOM — older atoms (footnote/citation) render
    // their id as `data-footnote-id`/`data-citation-id`, not linkId.
    const queried = editor.view.dom.querySelector(
      `[${DATA_LINK_ID}="${link.id}"]`,
    ) as HTMLElement | null;
    const nodeDom = editor.view.nodeDOM(pos);
    const domEl =
      queried ??
      (nodeDom instanceof HTMLElement
        ? nodeDom
        : (nodeDom?.parentElement as HTMLElement | null) ?? null);
    return {
      kind: "inline-atom",
      pos,
      nodeSize: node?.nodeSize ?? 1,
      domEl,
    };
  }
  if (link.anchor.type === "textObject") {
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
    // Mode A (or Mode B with a lost mark): try each textObject UUID and
    // take the first that still exists in the doc. Callers that passed
    // multiple ids shouldn't fail just because the first one was edited
    // away.
    for (const paragraphId of link.anchor.textObjectIds) {
      if (!paragraphId) continue;
      const pos = findParagraphByUuid(editor, paragraphId);
      if (pos == null) continue;
      // `data-uuid` is not rendered to the DOM by our node specs
      // (rendered: false) — fall back to view.nodeDOM(pos).
      const queried = editor.view.dom.querySelector(
        `[data-uuid="${paragraphId}"]`,
      ) as HTMLElement | null;
      const nodeDom = editor.view.nodeDOM(pos);
      const domEl =
        queried ??
        (nodeDom instanceof HTMLElement
          ? nodeDom
          : (nodeDom?.parentElement as HTMLElement | null) ?? null);
      return { kind: "paragraph", paragraphId, pos, domEl };
    }
    return null;
  }
  return null;
}

/** Scroll the appropriate end of the link into view.
 *
 *  - `"to-marker"`: scroll the editor to the in-text marker.
 *  - `"to-card"`:   scroll the panel to the card entry.
 *  - `"both"`:      do both.
 *
 *  When `sourceEl` is provided, the moving end is aligned to that
 *  element's top edge (mirroring `alignEntryToY`). Without it, the
 *  moving end is centered in the viewport (legacy behavior).
 *
 *  The post-jump visual highlight is handled separately, driven by card
 *  selection state via `useAnchorHighlightReconciler`. */
export function jumpToLink(
  editor: Editor,
  link: Link,
  dir: "to-marker" | "to-card" | "both",
  sourceEl?: HTMLElement | null,
): void {
  const sourceY = sourceEl ? sourceEl.getBoundingClientRect().top : null;
  if (dir === "to-marker" || dir === "both") {
    const resolved = resolveLink(editor, link);
    if (resolved?.domEl) {
      if (sourceY != null) {
        // Compute the pin's pod-relative Y from the marker's pre-scroll
        // position (NOT the card's). After alignEntryToY scrolls the row
        // by `markerY - sourceY`, the pinned card's viewport Y will land
        // at sourceY iff its pod-relative top equals
        // `markerY - podTop` (both measured pre-scroll). Derivation:
        //   newPodTop = podTop - scrollDelta = podTop - (markerY - sourceY)
        //   card viewportY = newPodTop + pinTop
        //                  = podTop - markerY + sourceY + markerY - podTop
        //                  = sourceY  ✓
        const omniWrapper = sourceEl?.closest(
          "[data-omni-entry-wrapper]",
        ) as HTMLElement | null;
        const pod = omniWrapper?.parentElement as HTMLElement | null;
        const omniKey = omniWrapper?.dataset.omniEntryWrapper;
        const pinTop =
          omniKey && pod
            ? resolved.domEl.getBoundingClientRect().top -
              pod.getBoundingClientRect().top
            : null;
        alignEntryToY(resolved.domEl, sourceY);
        if (omniKey && pinTop !== null) {
          window.dispatchEvent(
            new CustomEvent("virgil-card-jumped", {
              detail: { omniKey, pinTop },
            }),
          );
        }
      } else {
        resolved.domEl.scrollIntoView({ behavior: "instant", block: "center" });
      }
    }
  }
  if (dir === "to-card" || dir === "both") {
    const cardKey = linkCardKey(link.target.ref.kind, link.target.ref.id);
    const entryEl = document.querySelector(
      `[data-link-card="${cardKey}"]`,
    ) as HTMLElement | null;
    if (entryEl) {
      if (sourceY != null) {
        alignEntryToY(entryEl, sourceY);
      } else {
        entryEl.scrollIntoView({ behavior: "instant", block: "center" });
      }
    }
  }
}

/** Jump to the first resolvable link on a card. Iterates `card.links` and
 *  scrolls to the first entry whose anchor still exists in the document —
 *  `links[0].paragraphIds[0]` may be stale when a card has multiple
 *  anchors and the earliest paragraph was edited away. Returns true if a
 *  link was jumped to.
 *
 *  When `sourceEl` is provided (the clicked card's wrapper), the in-text
 *  marker is aligned to that card's vertical position — the inverse of
 *  the marker→card alignment via `alignEntryToY`. Without `sourceEl`, the
 *  marker is centered in the viewport (legacy behavior).
 *
 *  When `sourceEl` is an omni-entry wrapper (`data-omni-entry-wrapper`),
 *  computes the card's pod-relative Y BEFORE the row scrolls and fires
 *  a `virgil-card-jumped` event with it; EditorLayout pins the card at
 *  that pod-Y so it stays visually fixed during the scroll. Pod-relative
 *  is scroll-invariant under unified scroll, so the pre-scroll value is
 *  the post-scroll value — no rAF needed. */
export function jumpToCard(
  editor: Editor,
  card: CardWithLinks,
  sourceEl?: HTMLElement | null,
): boolean {
  const links = card.links ?? [];
  for (const link of links) {
    const resolved = resolveLink(editor, link);
    if (resolved?.domEl) {
      if (sourceEl) {
        const preY = sourceEl.getBoundingClientRect().top;
        // Pin pod-rel = marker's pre-scroll pod-relative Y. After the
        // row scrolls (by `markerY - preY`), the pod moves with it, and
        // pin Y = `markerY_pre - podTop_pre` lands the card at preY
        // viewport-Y — the card's original click position. See the same
        // derivation in jumpToLink above.
        const omniWrapper = sourceEl.closest(
          "[data-omni-entry-wrapper]",
        ) as HTMLElement | null;
        const pod = omniWrapper?.parentElement as HTMLElement | null;
        const omniKey = omniWrapper?.dataset.omniEntryWrapper;
        const pinTop =
          omniKey && pod
            ? resolved.domEl.getBoundingClientRect().top -
              pod.getBoundingClientRect().top
            : null;
        alignEntryToY(resolved.domEl, preY);
        if (omniKey && pinTop !== null) {
          window.dispatchEvent(
            new CustomEvent("virgil-card-jumped", {
              detail: { omniKey, pinTop },
            }),
          );
        }
      } else {
        resolved.domEl.scrollIntoView({ behavior: "instant", block: "center" });
      }
      return true;
    }
  }
  return false;
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
  if (link.anchor.type === "textObject" && link.anchor.textRange) {
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

export type LinkedAnchorKind =
  | "note"
  | "highlight"
  | "todo"
  | "revision"
  | "cutter-comment"
  | "cutter-suggestion"
  | "report"
  | "report-request";

export interface LinkedAnchorRecord {
  anchorId: string;
  paragraphId: string;
  text: string;
  createdAt: string;
}

/** `LinkedAnchorKind` (the legacy mark-attr namespace) → spine `CardKind`. The
 *  one many-to-one fold is `revision` → `revision-comment` (the canonical
 *  comment spine kind for the shared `revision` marker). */
function linkedAnchorKindToCardKind(kind: LinkedAnchorKind): CardKind {
  switch (kind) {
    case "note":              return "note";
    case "highlight":         return "highlight";
    case "todo":              return "todo";
    case "cutter-comment":    return "cutter-comment";
    case "cutter-suggestion": return "cutter-suggestion";
    case "revision":          return "revision-comment";
    case "report":            return "report";
    case "report-request":    return "report-request";
  }
}

/** The `data-link-card` token for a legacy `LinkedAnchorKind`. Single-sourced
 *  through `LEGACY_TOKEN_CROSSWALK` (R-C: byte-identical to the old literal
 *  switch — note→"note", revision→"comment", cutter-*→"cutter-*", etc.). Every
 *  `LinkedAnchorKind` maps to a kind with a non-null `legacyDataKind`, so the
 *  fallback is unreachable (defensive). */
function legacyKindToCardKindString(kind: LinkedAnchorKind): string {
  const token = legacyDataKindForCardKind(linkedAnchorKindToCardKind(kind));
  if (token == null) {
    // Unreachable: every LinkedAnchorKind maps to a kind with a non-null
    // legacyDataKind. If it ever fires, the raw `kind` is NOT a contract-faithful
    // data-link-card token (e.g. "revision" has no [data-link-card^="revision:"]
    // rule — the faithful token is "comment"). Make it loud in dev rather than
    // silently stamping a CSS-ruleless token; preserve the runtime string.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[links] legacyKindToCardKindString("${kind}"): no legacyDataKind in the ` +
          `crosswalk — the stamped data-link-card token may match no CSS rule.`,
      );
    }
    return kind;
  }
  return token;
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
  opts?: { tintColor?: string | null },
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
      tintColor: opts?.tintColor ?? null,
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
 * Remove a TRANSIENT (cardless) `linkedAnchor` — the invisible range handle
 * the plain selection grab stamps (`kind:"transient"`, no `linkCard`). Used
 * to clean the handle up when its popout closes so it never litters the doc.
 *
 * GUARDED: a no-op unless the mark at `anchorId` is actually transient, so a
 * grab that REUSED a real annotation's range (full-coverage reuse in
 * `hydrateSelectionToTextObject`) never deletes that note / highlight / cut /
 * revision on close. Reuses `removeLinkedAnchorMark`.
 */
export function removeTransientAnchor(editor: Editor, anchorId: string): void {
  const range = resolveTextRangeByAnchorId(editor, anchorId);
  if (!range) return;
  let isTransient = false;
  editor.state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      if (m.attrs.anchorId !== anchorId) continue;
      if (m.attrs.kind === "transient" && !m.attrs.linkCard) isTransient = true;
    }
    return true;
  });
  if (isTransient) removeLinkedAnchorMark(editor, anchorId);
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
  // Preserve legacy `kind` and `tintColor` attrs along with other
  // existing attrs (tintColor especially must survive kind transitions
  // so the yellow stays through highlight→note-sibling).
  let legacyKind = "note";
  let tintColor: string | null = null;
  editor.state.doc.nodesBetween(range.from, range.to, (node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        legacyKind = (m.attrs.kind as string) || legacyKind;
        const tc = m.attrs.tintColor;
        if (typeof tc === "string" && tc) tintColor = tc;
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
      tintColor,
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
  links?: Link[];
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
// ---------------------------------------------------------------------------
// Accessor / mutator API over card.links
//
// These replace every direct `card.paragraphIds` / `card.anchorId` /
// `card.anchorText` read or write in the rest of the codebase. Once all
// callsites use these helpers, the legacy fields can be dropped from
// the card type definitions entirely.
// ---------------------------------------------------------------------------

export type CardWithLinks = { id: string; links?: Link[] };

/** All TextObject UUIDs any of this card's anchor-kind links cover. */
export function getLinkedTextObjectIds(card: CardWithLinks): string[] {
  const links = card.links ?? [];
  const out: string[] = [];
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    for (const pid of link.anchor.textObjectIds) {
      if (!out.includes(pid)) out.push(pid);
    }
  }
  return out;
}

/** The first Mode B text-range anchor on this card, or null. Cards are
 *  expected to carry at most one Mode B anchor today. */
export function getTextAnchor(
  card: CardWithLinks,
): { anchorId: string; anchorText: string } | null {
  const links = card.links ?? [];
  for (const link of links) {
    if (
      link.anchor.type === "textObject" &&
      link.anchor.targetKind === "linkedRange" &&
      link.anchor.textRange
    ) {
      return {
        anchorId: link.anchor.textRange.anchorId,
        anchorText: link.anchor.textRange.textSnapshot,
      };
    }
  }
  return null;
}

export function hasTextAnchor(card: CardWithLinks): boolean {
  return getTextAnchor(card) !== null;
}

export type AnchorSummary =
  | { kind: "selection"; words: number }
  | { kind: "paragraph"; words: number }
  | null;

/** A short structural description of where this card is anchored, plus
 *  the word count of the anchored region. Used by card UIs to render a
 *  "selection · 14 words" / "paragraph · 47 words" badge. Mode B
 *  (text-range) wins over Mode A (paragraph). Returns null for cards
 *  with no anchor at all. */
export function getAnchorSummary(
  card: CardWithLinks & { selectedText?: string },
  editor: Editor | null,
): AnchorSummary {
  const ta = getTextAnchor(card);
  if (ta) {
    return { kind: "selection", words: countWords(ta.anchorText) };
  }
  const pids = getLinkedTextObjectIds(card);
  if (pids.length === 0) return null;
  if (editor) {
    let words = 0;
    const wanted = new Set(pids);
    editor.state.doc.descendants((node) => {
      if (wanted.size === 0) return false;
      const uuid = (node.attrs as { uuid?: string } | null)?.uuid;
      if (uuid && wanted.has(uuid)) {
        words += countWords(node.textContent);
        wanted.delete(uuid);
        return false;
      }
      return true;
    });
    return { kind: "paragraph", words };
  }
  // No editor — fall back to selectedText snapshot if present.
  return {
    kind: "paragraph",
    words: card.selectedText ? countWords(card.selectedText) : 0,
  };
}

/**
 * Single predicate for "this card has no anchor in the document."
 *
 * Two card shapes feed into this:
 *   - Link-bearing cards (notes, cuts, archives, reports, revisions, todos)
 *     — unanchored iff `links[]` is empty.
 *   - Citations — carry an explicit `unanchored?: true` flag because anchoring
 *     is tracked by the editor's inline atoms, not by card-resident links.
 *     The flag is the authoritative in-memory check and is persisted on disk
 *     so an unanchored citation survives reload (the editor regenerates
 *     anchored ids on every parse).
 *
 * Callers should not reach into either shape directly — go through here.
 */
export function isUnanchored(
  card: { links?: readonly Link[]; unanchored?: boolean } | null | undefined,
): boolean {
  if (!card) return false;
  if (card.unanchored === true) return true;
  if (Array.isArray(card.links)) return card.links.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// Mode-A self-healing reconcile (symmetric with Mode B's reanchorByText)
//
// A Mode-A margin card anchors via a bare paragraph UUID. That UUID
// round-trips through the `.tex` only as a `%!v:` comment written by the
// 1500 ms autosave; if the write loses the race against a reload, the
// paragraph is re-minted a fresh UUID and the card's stored UUID matches
// nothing — the card silently orphans (and `isUnanchored` still reports
// `false` because `links.length > 0`).
//
// These helpers make the Mode-A anchor self-healing:
//   - `resolveLiveUuids` builds the live `uuid` set once per reconcile.
//   - `findParagraphIdBySnapshot` re-finds a paragraph by its captured
//     text (UUID-first is the CALLER's responsibility — see
//     `reconcileModeAAnchors`).
//   - `reconcileModeAAnchors` is the pure card mutator the panel hooks run
//     on load: UUID-first (backfill snapshot if the UUID still resolves),
//     snapshot-fallback (rewrite `textObjectIds[0]` to the live UUID when
//     the stored UUID is dead but the snapshot matches a live paragraph).
//   - `isModeAOrphaned` is a test-only predicate for the un-resolvable
//     residue (UUID dead AND snapshot unmatched). NOT wired into a
//     production orphan-surfacing UI yet — see its `@internal` note.
// ---------------------------------------------------------------------------

/** All `uuid` attrs present on live anchorable nodes, built once per
 *  reconcile so the per-link resolution is O(1). */
export function collectLiveUuids(editor: Editor): Set<string> {
  const out = new Set<string>();
  editor.state.doc.descendants((node) => {
    const uuid = (node.attrs as { uuid?: string } | null)?.uuid;
    if (uuid) out.add(uuid);
    return true;
  });
  return out;
}

/**
 * Re-find a paragraph by its Mode-A text snapshot. Returns the live `uuid`
 * of the FIRST node whose `textContent` equals the snapshot (whole-block
 * match — stricter than Mode B's `indexOf` substring search, so it won't
 * mis-bind to a sub-span). `null` if no live node matches.
 *
 * NOTE: first-match-wins on duplicated paragraph text. The reconcile
 * caller MUST try the stored UUID first (`reconcileModeAAnchors`) and only
 * fall back to this when the UUID is dead — so a still-live UUID is never
 * overridden by a same-text sibling.
 */
export function findParagraphIdBySnapshot(
  editor: Editor,
  snapshot: string,
): string | null {
  if (!snapshot) return null;
  let found: string | null = null;
  editor.state.doc.descendants((node) => {
    if (found !== null) return false;
    const uuid = (node.attrs as { uuid?: string } | null)?.uuid;
    if (uuid && node.textContent === snapshot) {
      found = uuid;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * LEGACY (test-only as of RC-A): the original per-card Mode-A reconcile.
 * Production now funnels through the unified resolver SSOT
 * (`resolve-card-anchor.ts` — `buildResolveIndex` + `resolveCardAnchor` +
 * `reconcileCardToResolved`, driven by `useReconcileModeAAnchors`). This
 * function is kept only for its own test suite (`mode-a-reconcile.test.ts`)
 * until those tests migrate onto the resolver; no non-test code imports it.
 *
 * Pure Mode-A reconcile for a single card. Returns a (possibly-rewritten)
 * card and a `changed` flag. UUID-first / snapshot-fallback:
 *
 *   1. For each Mode-A (`targetKind !== "linkedRange"`) link whose
 *      `textObjectIds[0]` STILL resolves to a live block: BACKFILL the
 *      snapshot from the live paragraph's text if absent or stale. This
 *      makes legacy snapshot-less links durable going forward, and keeps
 *      the snapshot fresh if the paragraph text drifted.
 *   2. For each Mode-A link whose `textObjectIds[0]` does NOT resolve but
 *      whose `paragraphSnapshot` matches a live paragraph: REWRITE
 *      `textObjectIds[0]` to the live UUID (and keep the snapshot).
 *   3. Links with no snapshot and a dead UUID are left untouched — the
 *      un-resolvable residue (detectable via the test-only
 *      `isModeAOrphaned`; no production orphan-surfacing UI consumes it yet).
 *
 * Mode-B links are passed through unchanged — their recovery is the
 * separate `reanchorByText` / `applyLinkedAnchors` path.
 *
 * `liveUuids` is the shared set from `collectLiveUuids(editor)`; pass it in
 * so a batch reconcile builds it once.
 */
export function reconcileModeAAnchors<T extends CardWithLinks>(
  card: T,
  editor: Editor,
  liveUuids: Set<string>,
): { card: T; changed: boolean } {
  const links = card.links;
  if (!Array.isArray(links) || links.length === 0) return { card, changed: false };
  let changed = false;
  const next: Link[] = links.map((link) => {
    if (link.anchor.type !== "textObject") return link;
    // Mode B is recovered by its own snapshot path — leave it alone.
    if (link.anchor.targetKind === "linkedRange") return link;
    const ids = link.anchor.textObjectIds;
    const pid = ids[0];
    if (!pid) return link;

    // 1. UUID-first: the stored UUID still resolves → backfill snapshot.
    if (liveUuids.has(pid)) {
      const live = captureParagraphSnapshot(editor, pid);
      if (live && link.anchor.paragraphSnapshot !== live) {
        changed = true;
        return {
          ...link,
          anchor: { ...link.anchor, paragraphSnapshot: live },
        };
      }
      return link;
    }

    // 2. Snapshot-fallback: stored UUID is dead → re-find by text.
    const snap = link.anchor.paragraphSnapshot;
    if (!snap) return link; // legacy snapshot-less + dead UUID → orphaned
    const reboundId = findParagraphIdBySnapshot(editor, snap);
    if (!reboundId || reboundId === pid) return link;
    changed = true;
    // Multi-anchor note: we rebind ONLY `textObjectIds[0]` — the primary
    // Mode-A paragraph anchor that the single `paragraphSnapshot` describes.
    // `ids.slice()` then `newIds[0] = reboundId` copies the array and
    // rewrites only index 0, so any sibling ids (a multi-paragraph link's
    // ids[1..]) are PRESERVED verbatim — no truncation, no corruption. We
    // don't attempt to heal the siblings because there's exactly one
    // snapshot (it pins index 0); a per-id snapshot + targetKind-match
    // refinement for the wrapper-shadow nested-fallback edge is backlog.
    const newIds = ids.slice();
    newIds[0] = reboundId;
    return {
      ...link,
      anchor: { ...link.anchor, textObjectIds: newIds },
    };
  });
  if (!changed) return { card, changed: false };
  return { card: { ...card, links: next }, changed: true };
}

/**
 * Derivation-layer predicate: a Mode-A card is ORPHANED (no live anchor)
 * when it has at least one Mode-A link but NONE of its Mode-A links'
 * `textObjectIds[0]` resolve to a live block — i.e. the un-resolvable
 * residue left after `reconcileModeAAnchors` runs (UUID dead AND snapshot
 * didn't match a live block).
 *
 * Returns `false` for cards with no Mode-A link (Mode-B-only / no-anchor
 * cards are governed by their own paths), and `false` while `liveUuids`
 * is empty (editor not yet ready — don't false-flag on load).
 *
 * NOTE: exported for the reconcile test suite only. There is no
 * orphan-surfacing UI consuming it yet (the panels don't render a Mode-A
 * orphan badge), so it is deliberately NOT wired into production — keep it
 * `@internal` rather than implying coverage that doesn't exist. Wiring it
 * into the card-source derivation to surface dangling cards is backlog.
 *
 * @internal test-only
 */
export function isModeAOrphaned(
  card: CardWithLinks | null | undefined,
  liveUuids: Set<string>,
): boolean {
  if (!card || liveUuids.size === 0) return false;
  const links = card.links;
  if (!Array.isArray(links)) return false;
  let hasModeA = false;
  for (const link of links) {
    if (link.anchor.type !== "textObject") continue;
    if (link.anchor.targetKind === "linkedRange") continue;
    const pid = link.anchor.textObjectIds[0];
    if (!pid) continue;
    hasModeA = true;
    if (liveUuids.has(pid)) return false; // at least one live anchor → not orphaned
  }
  return hasModeA;
}

/** Convenience: a Set of all paragraph UUIDs across a list of cards. */
export function collectAllLinkedParagraphIds(
  cards: readonly CardWithLinks[],
): Set<string> {
  const out = new Set<string>();
  for (const c of cards) {
    for (const pid of getLinkedTextObjectIds(c)) out.add(pid);
  }
  return out;
}

function makeAnchorLink(
  cardKind: CardKind,
  cardId: string,
  targetKind: TextObjectKind,
  textObjectIds: string[],
  textRange?: { anchorId: string; textSnapshot: string },
  paragraphSnapshot?: string | null,
): Link {
  return {
    id: textRange?.anchorId ?? `${cardId}@${textObjectIds[0] ?? ""}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind,
      textObjectIds,
      margin: { side: inferMarginSide(cardKind) },
      ...(textRange ? { textRange } : {}),
      ...(paragraphSnapshot ? { paragraphSnapshot } : {}),
    },
    target: { type: "card", ref: { kind: cardKind, id: cardId } },
    createdAt: new Date().toISOString(),
  };
}

/** Add a TextObject anchor to `card.links`. No-op if already present.
 *  Preserves any existing Mode B link's textRange by folding the new id
 *  into its `textObjectIds` when one exists.
 *
 *  `targetKind` defaults to `"paragraph"` to preserve the pre-D9
 *  behavior for callers that don't carry kind information through
 *  (most card-hook entry points take only a uuid). Callers that DO
 *  have the actual kind — typically anything resolving a
 *  `TextObjectRef` — should pass it explicitly so the resulting Mode A
 *  link records the right kind. After Phase G, the drag-handle and
 *  selection actions paths thread the kind through; other entry
 *  points continue to default. */
export function addTextObjectLink<T extends CardWithLinks>(
  card: T,
  cardKind: CardKind,
  textObjectId: string,
  targetKind: TextObjectKind = "paragraph",
  /** Optional Mode-A self-healing snapshot of the anchored paragraph's
   *  text, captured at the editor-aware call site (drop re-anchor /
   *  card creation). Stored on the fresh Mode-A link so the reload
   *  reconciler can re-find the paragraph if its UUID is lost. Omitted
   *  → legacy UUID-only link (still valid; backfilled on next load). */
  paragraphSnapshot?: string | null,
): T {
  if (!textObjectId) return card;
  const links = card.links ?? [];
  // If the card has a Mode B link, fold the new id into it — EXCEPT for a
  // paragraph re-anchor. A paragraph-side drop (`targetKind === "paragraph"`)
  // must NOT fold P_new into a surviving `linkedRange` link: doing so leaves
  // the card stuck as `targetKind: "linkedRange"` with the OLD textRange and
  // NO `paragraphSnapshot`, so the load reconcile skips it and the Mode-B
  // re-apply drags it back to the old paragraph (RC1). Instead it falls
  // through to the fresh Mode-A branch below, which threads the snapshot.
  // (The caller also converts the surviving link via `clearModeB`; this gate
  // is belt-and-suspenders so a fold can never re-poison the link.)
  const modeBIdx =
    targetKind === "paragraph"
      ? -1
      : links.findIndex(
          (l) =>
            l.anchor.type === "textObject" &&
            l.anchor.targetKind === "linkedRange" &&
            l.anchor.textRange,
        );
  if (modeBIdx !== -1) {
    const link = links[modeBIdx];
    if (link.anchor.type !== "textObject") return card;
    if (link.anchor.textObjectIds.includes(textObjectId)) return card;
    const updatedLinks = links.slice();
    updatedLinks[modeBIdx] = {
      ...link,
      anchor: {
        ...link.anchor,
        textObjectIds: [...link.anchor.textObjectIds, textObjectId],
      },
    };
    return { ...card, links: updatedLinks };
  }
  // Otherwise add a fresh Mode A link — unless one already covers it.
  const existing = getLinkedTextObjectIds(card);
  if (existing.includes(textObjectId)) return card;
  return {
    ...card,
    links: [
      ...links,
      makeAnchorLink(
        cardKind,
        card.id,
        targetKind,
        [textObjectId],
        undefined,
        paragraphSnapshot,
      ),
    ],
  };
}

/** Remove a TextObject anchor from `card.links`. */
export function removeTextObjectLink<T extends CardWithLinks>(
  card: T,
  textObjectId: string,
): T {
  const links = card.links ?? [];
  let changed = false;
  const next: Link[] = [];
  for (const link of links) {
    if (link.anchor.type !== "textObject") {
      next.push(link);
      continue;
    }
    if (!link.anchor.textObjectIds.includes(textObjectId)) {
      next.push(link);
      continue;
    }
    changed = true;
    const remaining = link.anchor.textObjectIds.filter((p) => p !== textObjectId);
    // Keep Mode B links even when they lose all textObjectIds — the
    // text-range anchor itself is the primary binding.
    if (remaining.length === 0 && !link.anchor.textRange) continue;
    next.push({
      ...link,
      anchor: { ...link.anchor, textObjectIds: remaining },
    });
  }
  return changed ? { ...card, links: next } : card;
}

/** Replace all paragraph anchors on the card with `textObjectIds`. */
export function setParagraphLinks<T extends CardWithLinks>(
  card: T,
  cardKind: CardKind,
  textObjectIds: string[],
): T {
  const textAnchor = getTextAnchor(card);
  const links: Link[] = [];
  if (textAnchor) {
    links.push(
      makeAnchorLink(cardKind, card.id, "linkedRange", textObjectIds, {
        anchorId: textAnchor.anchorId,
        textSnapshot: textAnchor.anchorText,
      }),
    );
  } else {
    for (const pid of textObjectIds) {
      links.push(makeAnchorLink(cardKind, card.id, "paragraph", [pid]));
    }
  }
  return { ...card, links };
}

/** Set a Mode B text-range anchor on the card. Preserves existing
 *  paragraph anchors. */
export function setTextAnchorLink<T extends CardWithLinks>(
  card: T,
  cardKind: CardKind,
  anchorId: string,
  anchorText: string,
): T {
  const textObjectIds = getLinkedTextObjectIds(card);
  const next = makeAnchorLink(cardKind, card.id, "linkedRange", textObjectIds, {
    anchorId,
    textSnapshot: anchorText,
  });
  // Drop any existing anchor-kind links; this new one is canonical.
  const kept = (card.links ?? []).filter((l) => l.anchor.type !== "textObject");
  return { ...card, links: [...kept, next] };
}

/** Clear the Mode B text-range anchor. Preserves paragraph anchors. */
export function clearTextAnchorLink<T extends CardWithLinks>(
  card: T,
  cardKind: CardKind,
): T {
  if (!hasTextAnchor(card)) return card;
  const textObjectIds = getLinkedTextObjectIds(card);
  const kept = (card.links ?? []).filter((l) => l.anchor.type !== "textObject");
  const newLinks: Link[] = [...kept];
  for (const pid of textObjectIds) {
    newLinks.push(makeAnchorLink(cardKind, card.id, "paragraph", [pid]));
  }
  return { ...card, links: newLinks };
}

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
        type: "textObject",
        targetKind: "linkedRange",
        textObjectIds: card.paragraphIds?.slice() ?? [],
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
        type: "textObject",
        // Pre-D9, derived Mode A anchors all target paragraphs. D9
        // generalizes; until then `"paragraph"` is correct for every
        // legacy sidecar that hits this branch.
        targetKind: "paragraph",
        textObjectIds: [paragraphId],
        margin: { side },
      },
      target: { type: "card", ref: { kind: cardKind, id: card.id } },
      createdAt: "",
    });
  }
  return out;
}

