/**
 * Public API for the Link system, as it ships.
 *
 * READ side: `collectLinksFromEditor` derives every in-doc `Link` record
 * from the live doc; `resolveLink` locates one; `jumpToLink`/`jumpToCard`
 * navigate; `deleteLink` removes. All live.
 *
 * WRITE side: anchors are minted by `createLinkedAnchor` (here) and inline
 * atoms by the atom commands (`src/lib/tiptap/insert-inline-atom.ts` +
 * `runAction`). There is deliberately no unified `createLink(kind, …)`
 * front door — one was scaffolded in Phase 0/1 and never adopted, so it was
 * removed rather than left as a write path nothing writes through (task 202).
 * If a unified door is ever wanted, wire it at the call sites in the same
 * commit; `link-surface-honesty.test.ts` fails an export nothing calls.
 *
 * `collectLinksFromEditor` is pure-ish: it reads the live doc and derives
 * every in-doc `Link` record. It does NOT read card sidecars, so Mode A
 * pure-paragraph anchor links (a card anchored only via `paragraphIds`,
 * with no `linkedAnchor` mark) are NOT returned: nothing in the DOCUMENT marks
 * them, so they are read from the card record's own persisted `links[]`.
 * (`derivedLinksForCard`, below, is NOT that source — it is the legacy→canonical
 * shim `migrateCardLinks` falls back to for a pre-D8 sidecar that has no
 * `links[]` yet.)
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { CardKind } from "@/panels/_shared/types";
import type { TextObjectKind } from "@/text-objects/types";
import { countWords } from "@/hooks/useWordCount";
import { findInlineAtomPosDeep } from "@/lib/inline-content";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import type { Link, LinkResolution } from "./_shared/types";
import { normalizeParagraphText } from "./_shared/normalize-text";
import { generateEntityId } from "@/lib/uuid";
import {
  linkCardKeyFromToken,
  linkCardSelector,
  linkIdSelector,
  parseLinkCardKey,
} from "./link-dom-contract";
import {
  legacyDataKindForCardKind,
  legacyMarkKindForCardKind,
  legacyMarkKindToCardKind,
  defaultTintForLinkedAnchorKind,
} from "@/cards/legacy-token-crosswalk";
import {
  alignEntryToYIfNeeded,
  scrollEntryIntoViewIfNeeded,
} from "@/components/editor-layout/layout-scroll";

// Re-exports so callers import everything from one module.
export type { Link, LinkAnchor, LinkKind, LinkResolution, LinkTarget, ModeBAnchorLink } from "./_shared/types";
export { isModeB } from "./_shared/types";
// The DOM contract (`DATA_LINK_*`, `linkCardKey`, `parseLinkCardKey`) is NOT
// re-exported here. It was, and that is how a dead surface hid for three
// months: a re-export makes a symbol look referenced to every grep while no
// caller exists, so the barrel became the only "consumer" of the whole
// registry subtree (task 202). Import it from `./link-dom-contract` directly.

// ---------------------------------------------------------------------------
// Kind mapping from legacy `linkedAnchor.kind` attr to CardKind
// ---------------------------------------------------------------------------

/** Legacy `linkedAnchor.kind` mark-attr value → spine `CardKind`, for a mark that
 *  carries NO explicit `linkCard` token (the fallback branch in
 *  `collectLinksFromEditor`). Routes through the crosswalk SSOT
 *  (`legacyMarkKindToCardKind`) so it stays complete — the previous hand-rolled
 *  copy silently omitted `todo`/`report`/`report-request`, dropping those anchors
 *  from the collected `Link[]`. The one thing the SSOT map lacks is the dead
 *  pre-Cutter-rebuild `"cut"` alias (cuts migrated to comments), preserved here
 *  explicitly. Exported so the crosswalk-completeness contract is unit-pinnable. */
export function legacyAnchorKindToCardKind(
  kind: string | undefined,
): CardKind | null {
  if (kind == null) return null;
  // Dead legacy alias the crosswalk mark-kind map deliberately omits (no spine
  // kind carries a `"cut"` mark attr); pre-Cutter-rebuild cuts fold to comments.
  if (kind === "cut") return "cutter-comment";
  return legacyMarkKindToCardKind(kind);
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
 * returned by this function — nothing in the document marks them, so they are
 * read from the card record's persisted `links[]` (with `derivedLinksForCard`
 * as the pre-D8 fallback inside `migrateCardLinks`, not the primary source).
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

// `inferMarginSide` lived here — a hardcoded `report|report-request → left,
// default → right` switch whose own docstring claimed to read the panel
// registry and never did, and whose output was frozen into every anchor link's
// `anchor.margin.side`. Deleted in task 205: the side a card's margin chrome
// lives on is a LIVE function of where its panel is docked, so it is resolved
// at read time by `marginSideForCardKind` (`@/lib/margin-side`) — the one
// authority the marginalia grid and the anchor rail now share.

// ---------------------------------------------------------------------------
// Public API: create / resolve / jump / delete
// ---------------------------------------------------------------------------

// The unified create door (`createLink` + its three kind builders) and the
// `cardKindToLegacyAnchorKind` adapter that only it reached were removed in
// task 202: zero callers since Phase 1, while real footnote/citation creation
// went through the atom commands and real anchors through `createLinkedAnchor`
// below. The crosswalk SSOT they wrapped is live and unchanged
// (`legacyMarkKindForCardKind` in `@/cards/legacy-token-crosswalk`).

/** Locate `link` in the live editor. Returns null if it's missing. */
export function resolveLink(
  editor: Editor,
  link: Link,
): LinkResolution | null {
  if (link.anchor.type === "inline-atom") {
    // Deep resolve: a TOP-LEVEL atom resolves exactly as before; a citation
    // (or footnote) NESTED in a footnote body resolves to the HOST footnote's
    // marker — the nested atom has no own DOM, so the host superscript is the
    // only scrollable target (`BIB-F3-01` / `CI-F3-01`).
    const loc = findInlineAtomPosDeep(editor, link.anchor.nodeName, link.id);
    if (loc == null) return null;
    const pos = loc.pos;
    const node = editor.state.doc.nodeAt(pos);
    // The DOM address to query: a top-level hit uses the atom's own link id;
    // a nested hit uses the HOST footnote's id (its marker carries
    // `data-link-id="<hostFootnoteId>"`).
    const domLinkId = loc.nested ? loc.hostFootnoteId : link.id;
    // Prefer `data-link-id` (set by newer atoms); fall back to the atom's
    // own DOM via view.nodeDOM — older atoms (footnote/citation) render
    // their id as `data-footnote-id`/`data-citation-id`, not linkId.
    const queried = domLinkId
      ? (editor.view.dom.querySelector(
          linkIdSelector(domLinkId),
        ) as HTMLElement | null)
      : null;
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
          linkIdSelector(link.anchor.textRange.anchorId),
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
        // Necessity-gated since task 328: a jump is TWO movements — the
        // document's and the card's — and the card's exists only to
        // compensate for the document's, so the pin rides the scroll's
        // verdict. Marker already visible and near enough ⇒ neither happens.
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
        const moved = alignEntryToYIfNeeded(resolved.domEl, sourceY);
        if (moved && omniKey && pinTop !== null) {
          window.dispatchEvent(
            new CustomEvent("virgil-card-jumped", {
              detail: { omniKey, pinTop },
            }),
          );
        }
      } else {
        scrollEntryIntoViewIfNeeded(resolved.domEl, {
          behavior: "instant",
          block: "center",
        });
      }
    }
  }
  if (dir === "to-card" || dir === "both") {
    const entryEl = document.querySelector(
      linkCardSelector(link.target.ref.kind, link.target.ref.id),
    ) as HTMLElement | null;
    if (entryEl) {
      if (sourceY != null) {
        alignEntryToYIfNeeded(entryEl, sourceY);
      } else {
        scrollEntryIntoViewIfNeeded(entryEl, {
          behavior: "instant",
          block: "center",
        });
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
        // Necessity-gated (task 328), and the pin rides the scroll's verdict:
        // if the marker is already fully visible and near enough to the card,
        // the click moves nothing at all — no document scroll, and therefore
        // no compensating pin to re-cascade the deck.
        const moved = alignEntryToYIfNeeded(resolved.domEl, preY);
        if (moved && omniKey && pinTop !== null) {
          window.dispatchEvent(
            new CustomEvent("virgil-card-jumped", {
              detail: { omniKey, pinTop },
            }),
          );
        }
      } else {
        scrollEntryIntoViewIfNeeded(resolved.domEl, {
          behavior: "instant",
          block: "center",
        });
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

/** TOP-LEVEL position of an inline atom by id, or null. Used by the create /
 *  delete paths, which operate only on a real top-level doc atom (you can't
 *  delete a footnote-nested cite by deleting its host footnote — that's
 *  `stripFootnoteNestedCitation`'s job). Delegates to `findInlineAtomPosDeep`
 *  but discards a nested hit, preserving the legacy "descendants-only" contract
 *  for these mutators. */
function findInlineAtomPos(
  editor: Editor,
  nodeName: "footnote" | "citation",
  linkId: string,
): number | null {
  const loc = findInlineAtomPosDeep(editor, nodeName, linkId);
  return loc && loc.nested === false ? loc.pos : null;
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

/**
 * The live plain-text content of the paragraph node carrying `uuid`, or null if
 * no such node exists. Used by the open-AI-request highlight (request-marks.ts)
 * to stamp a whole-paragraph `pending-ai-request` mark: it feeds this text back
 * into `reanchorByText` as the uuid-scoped snapshot, so a Mode-A card's WHOLE
 * anchored paragraph gets the persistent blue wash (no sub-range). `textContent`
 * excludes inline atoms (footnote/citation), which is fine — `reanchorByText`'s
 * per-child offset walk maps the char span back across any interleaved atoms.
 */
export function paragraphTextByUuid(editor: Editor, uuid: string): string | null {
  const pos = findParagraphByUuid(editor, uuid);
  if (pos == null) return null;
  const node = editor.state.doc.nodeAt(pos);
  return node ? node.textContent : null;
}

/**
 * Full span `[firstMarkedPos, lastMarkedEnd)` of the `linkedAnchor` carrying
 * `anchorId`. Delegates to the codebase SSOT walker `findLinkedAnchorRange`
 * (src/lib/linked-anchor-range.ts) so atom-split (a mark interrupted by an
 * inline atom) and cross-block anchors resolve to their WHOLE span, not just
 * the first contiguous run (task 071). Every caller here — resolveLink's
 * textRange branch, removeLinkedAnchorMark, resolveAnchorRange,
 * removeTransientAnchor, updateLinkedAnchorCard, apply-linked-anchors — hands
 * the range to nodesBetween / setTextSelection / unsetMark and wants the full
 * extent.
 */
export function resolveTextRangeByAnchorId(
  editor: Editor,
  anchorId: string,
): { from: number; to: number } | null {
  return findLinkedAnchorRange(editor.state.doc, anchorId);
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
// These five exports preserve the signatures that callers depended on before
// the Link unification. "Legacy" is now a historical label, not a deprecation:
// this line used to send new code to `createLink`, which never had a caller and
// was deleted in task 202. `createLinkedAnchor` IS the anchor write path.
// ---------------------------------------------------------------------------

export type LinkedAnchorKind =
  | "note"
  | "highlight"
  | "todo"
  | "revision"
  | "cutter-comment"
  | "cutter-suggestion"
  | "report"
  | "report-request"
  // The light-blue marker the headless AI-change applicator stamps over an
  // applied-but-not-yet-kept suggestion (Phase 0). Folds onto the
  // `revision-suggestion` spine kind so the data-link-card token, jump-to, and
  // float plumbing reuse the suggestion machinery — the only thing distinct is
  // the tint (`#bfdbfe`, see `defaultTintForLinkedAnchorKind`).
  | "pending-ai-change"
  // The light-blue marker stamped over the anchored text of an OPEN AI request
  // (the request-open twin of `pending-ai-change`). Same `#bfdbfe` tint, but a
  // DISTINCT kind so request marks and applied-change marks keep independent
  // lifecycles. Lifecycle-owned by `reconcileRequestMarks` (request-marks.ts),
  // NOT by a card text-anchor — so the orphan reapers skip it by kind and its
  // `linkCard` token is always threaded explicitly by the reconcile (never
  // kind-derived, which is why the fold below maps it to a placeholder).
  | "pending-ai-request";

export interface LinkedAnchorRecord {
  anchorId: string;
  paragraphId: string;
  text: string;
  createdAt: string;
}

/** `LinkedAnchorKind` (the legacy mark-attr namespace) → spine `CardKind`. The
 *  one many-to-one fold is `revision` → `revision-comment` (the canonical
 *  comment spine kind for the shared `revision` marker). The eight real mark
 *  kinds route through the crosswalk SSOT (`legacyMarkKindToCardKind`); the two
 *  `pending-ai-*` render sentinels — which are NOT card marker kinds and so are
 *  absent from the crosswalk — are folded here. */
function linkedAnchorKindToCardKind(kind: LinkedAnchorKind): CardKind {
  if (kind === "pending-ai-change") return "revision-suggestion";
  // Placeholder fold: the request reconcile ALWAYS threads an explicit
  // `linkCardToken` (the owning card's real kind), so this fallback is never
  // consulted for a `pending-ai-request` mark's stamped token — it exists only
  // to keep the switch exhaustive. `note` is an arbitrary safe CardKind.
  if (kind === "pending-ai-request") return "note";
  // The remaining LinkedAnchorKinds are exactly the crosswalk's mark kinds, so
  // the `?? "note"` is unreachable-defensive (every real mark kind resolves).
  return legacyMarkKindToCardKind(kind) ?? "note";
}

/** The `data-link-card` token for a legacy `LinkedAnchorKind`. Single-sourced
 *  through `LEGACY_TOKEN_CROSSWALK` (R-C: byte-identical to the old literal
 *  switch — note→"note", revision→"comment", cutter-*→"cutter-*", etc.). Every
 *  `LinkedAnchorKind` maps to a kind with a non-null `legacyDataKind`, so the
 *  fallback is unreachable (defensive). */
export function legacyKindToCardKindString(kind: LinkedAnchorKind): string {
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
  const linkCard = cardId ? linkCardKeyFromToken(cardKind, cardId) : "";
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
      linkCard: linkCardKeyFromToken(cardKind, cardId),
      tintColor,
    })
    .setTextSelection(range.from)
    .run();
}

/**
 * Restamp a `linkedAnchor` mark's KIND-DERIVED presentation — the legacy `kind`
 * attr, the `data-link-card` spine token, AND the persistent `tintColor` band —
 * to match a NEW spine `CardKind`. The SSOT for "the owning card's kind changed
 * (a MORPH), so make its in-doc mark agree."
 *
 * Unlike `updateLinkedAnchorCard` (which PRESERVES the mark's kind + tint so a
 * note sibling over a highlight doesn't dim the yellow), this AUTHORITATIVELY
 * re-derives all three kind-driven attrs from `cardKind`, using the SAME
 * `defaultTintForLinkedAnchorKind` SSOT the create + reload
 * (`reapply-mode-b-anchors`) paths use. So a note→highlight morph paints the
 * amber band IMMEDIATELY (no reload) and a highlight→note morph clears it —
 * closing the "a morph mutates the sidecar but not the mark, so kind-derived
 * mark presentation goes stale until reload" class (task 2026-07-06-073).
 *
 * `addToHistory: false` — a morph's sidecar flip is not an editor-undoable edit,
 * so the mark correction rides outside the undo stack (no torn half-undo where
 * Ctrl+Z reverts the tint but leaves the card morphed).
 */
export function restampLinkedAnchorForKind(
  editor: Editor,
  anchorId: string,
  cardKind: CardKind,
  cardId: string,
): void {
  const range = resolveTextRangeByAnchorId(editor, anchorId);
  if (!range) return;
  // Legacy mark-kind attr for the target (note/highlight are identity; both
  // revision spine kinds fold to "revision"). Fall back to the spine string for
  // a mark-less kind (unreachable — callers guard on getTextAnchor).
  const kind = legacyMarkKindForCardKind(cardKind) ?? cardKind;
  // data-link-card spine token (`legacyDataKind` == the spine CardKind string
  // for every mark-carrying kind — see the crosswalk).
  const spineToken = legacyDataKindForCardKind(cardKind) ?? cardKind;
  editor
    .chain()
    // Load/lifecycle correction: not an undoable user edit (mirrors the reload
    // reconcile's addToHistory:false re-stamp).
    .command(({ tr }) => {
      tr.setMeta("addToHistory", false);
      return true;
    })
    .setTextSelection(range)
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard: linkCardKeyFromToken(spineToken, cardId),
      // The SAME kind-derived tint SSOT the create + reload paths read, so the
      // morphed mark's band is byte-identical to a created/reloaded one (amber
      // for highlight, null — no band — for every other kind).
      tintColor: defaultTintForLinkedAnchorKind(kind),
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
  tintColor?: string | null,
  // Declared from Chip 3; its uuid-scoped search body lands in Chip 6. Until
  // then it is accepted-and-ignored (the legacy doc-wide search runs).
  paragraphUuid?: string,
  // Trailing options bag (added without disturbing the positional callers):
  //  - `linkCardToken` — the EXPLICIT `data-link-card` token (card IDENTITY) to
  //    stamp instead of the one derived from `kind`. The pending-AI-change kind
  //    folds onto `revision-suggestion` for BOTH suggestion families, so a cutter
  //    pending mark would otherwise stamp the WRONG family token. The caller
  //    threads the real family ("revision-suggestion" | "cutter-suggestion") so
  //    the three-surface halo (text ↔ gutter ↔ card) resolves. Drives ONLY the
  //    token; the kind still drives tint/behaviour.
  //  - `pendingDelete` — when true, sets `data-pending-delete` on the mark so CSS
  //    can render the blue range as a struck-through pending DELETION (Part B).
  opts?: { linkCardToken?: string; pendingDelete?: boolean },
): LinkedAnchorRecord | null {
  let from = -1;
  let to = -1;

  // uuid-scoped path (Chip 6): when a containing-paragraph uuid is supplied
  // and resolves to a live node, search ONLY that node's text — disambiguating
  // co-located/duplicate snapshots that the legacy doc-wide first-match would
  // displace. Map the char hit to doc positions over the node's TEXT
  // DESCENDANTS: the char index advances only for text, but each text node's
  // absolute doc position (`nodePos + 1 + offsetWithinNode`, freshly computed)
  // already accounts for every preceding child's size — inline atoms
  // (footnote/citation/\ref) AND inter-block structural gaps — so `from`/`to`
  // stay correct across an atom OR a paragraph boundary inside the span.
  const nodePos = paragraphUuid
    ? findParagraphByUuid(editor, paragraphUuid)
    : null;
  if (nodePos != null) {
    const node = editor.state.doc.nodeAt(nodePos);
    if (node) {
      const index = node.textContent.indexOf(snapshot);
      if (index === -1) return null;
      const endIndex = index + snapshot.length;
      let charCount = 0;
      // Walk TEXT DESCENDANTS, not just direct children: the anchor uuid is
      // frequently a DEFERRING_PARENTS container (listItem/blockquote/
      // exampleItem/exampleBlock, `@/lib/anchor-uuid`) whose direct children are
      // BLOCK paragraphs, not text — the resolveAnchorableNode deferral means a
      // Mode-A card on text inside such a container anchors to the CONTAINER
      // uuid. A direct-child `forEach` never enters the `isText` branch there,
      // leaving `from`/`to` at -1 → a null return (task 271). `descendants`
      // reaches the inner text at any depth. `offsetWithinNode` is PM's position
      // of the descendant relative to `node`'s content start, so the text node's
      // absolute doc position is `nodePos + 1 + offsetWithinNode`. The bare-
      // paragraph + codeBlock cases (a single text run at offset 0) and the
      // atom-interleave mapping are byte-identical to the old per-child walk.
      node.descendants((child, offsetWithinNode) => {
        if (from !== -1 && to !== -1) return false; // both resolved — stop
        if (!child.isText || !child.text) return true; // descend into containers
        const charStart = charCount;
        const charEnd = charCount + child.text.length;
        const childStartPos = nodePos + 1 + offsetWithinNode;
        if (from === -1 && index >= charStart && index < charEnd) {
          from = childStartPos + (index - charStart);
        }
        if (from !== -1 && to === -1 && endIndex <= charEnd) {
          to = childStartPos + (endIndex - charStart);
        }
        charCount = charEnd;
        return true;
      });
    }
  } else {
    // Legacy doc-wide path: absent/unresolved uuid. First-match over the whole
    // doc's text (the original behavior; preserves no-uuid callers).
    const text = editor.getText();
    const index = text.indexOf(snapshot);
    if (index === -1) return null;
    let charCount = 0;
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
  }
  if (from === -1 || to === -1) return null;
  const anchorId = preferredAnchorId ?? generateEntityId();
  // Prefer the resolved scoping uuid (the uuid-scoped path guarantees `from`
  // lands inside it); fall back to deriving from the doc position (legacy path).
  const paragraphId =
    (nodePos != null ? paragraphUuid : undefined) ??
    paragraphUuidAt(editor.state.doc, from) ??
    "";
  // Card-identity token: prefer the caller's EXPLICIT family token (so a cutter
  // pending mark stamps `cutter-suggestion:<id>`, not the kind-folded
  // `revision-suggestion:<id>`); fall back to the kind-derived token otherwise.
  const cardKind = opts?.linkCardToken ?? legacyKindToCardKindString(kind);
  const linkCard = cardId ? linkCardKeyFromToken(cardKind, cardId) : "";
  const ok = editor
    .chain()
    // Load-time / gesture-time correction: not an undoable user edit.
    .command(({ tr }) => {
      tr.setMeta("addToHistory", false);
      return true;
    })
    .setTextSelection({ from, to })
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard,
      tintColor: tintColor ?? null,
      pendingDelete: opts?.pendingDelete ? true : null,
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

// `collectLiveUuids` lived here until task 369. Its last production caller was
// `buildResolveIndex`, which now derives the live-uuid SET from the position
// map its own single walk builds — so the helper became a second, redundant
// O(doc) pass with no caller but its tests, and the link-surface census
// (task 202: "a suite is not a consumer") named it. Callers that need the set
// read `buildResolveIndex(editor).uuidToParagraph`.

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

/** Set a Mode B text-range anchor on the card. Preserves existing
 *  paragraph anchors.
 *
 *  `explicitTextObjectIds`, when provided, is used as the new link's
 *  `textObjectIds` instead of the card's own `getLinkedTextObjectIds`.
 *  The create path leaves it undefined (the card already carries its
 *  containing-paragraph link, so the fallback reads it). The clone path
 *  passes the known containing paragraph id here, because a freshly-cloned
 *  card has `links: []` — without it the Mode-B link would be written with
 *  `textObjectIds: []` and the card would mis-bin as `free` in omni. */
export function setTextAnchorLink<T extends CardWithLinks>(
  card: T,
  cardKind: CardKind,
  anchorId: string,
  anchorText: string,
  explicitTextObjectIds?: string[],
): T {
  const textObjectIds = explicitTextObjectIds ?? getLinkedTextObjectIds(card);
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
 * fields (`paragraphIds` / `anchorId` / `anchorText`). Used on the
 * legacy→canonical migration path (`migrate-card.ts`) — lets Cowork read a
 * uniform shape without needing to branch per card kind.
 *
 * Policy: a Mode B card (one with an `anchorId`) produces a single Link
 * carrying `card.paragraphIds` as its `textObjectIds` plus a `textRange`
 * built from `anchorId`/`anchorText` — no containing paragraph is inferred
 * from the mark. A Mode A card (no `anchorId`) produces one Link per
 * `paragraphId`.
 */
export function derivedLinksForCard(
  cardKind: CardKind,
  card: AnchorCardShape,
): Link[] {
  const out: Link[] = [];
  if (card.anchorId) {
    out.push({
      id: card.anchorId,
      kind: "anchor",
      anchor: {
        type: "textObject",
        targetKind: "linkedRange",
        textObjectIds: card.paragraphIds?.slice() ?? [],
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
      },
      target: { type: "card", ref: { kind: cardKind, id: card.id } },
      createdAt: "",
    });
  }
  return out;
}

