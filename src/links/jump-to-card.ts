/**
 * Jump — "scroll the editor to where this card is anchored" (task 935).
 *
 * The question "where is this card anchored?" has ONE owner, the anchor
 * authority (`resolveCardAnchor`): its ladder checks live uuids across ALL of a
 * card's links first, then surviving marks, then the RC1 self-heal, then text
 * snapshots — and the margin marker, the omni row and the Jump GATE all bind
 * to its winner. Jump used to be a second answer: `jumpToCard` ran
 * `resolveLink`'s full ladder PER LINK, in link order, and took the first that
 * resolved. A card `[L0: dead pid whose snapshot matches Px, L1: live pid Py]`
 * therefore drew its marker on Py and jumped to Px, where nothing was drawn.
 * And every multi-anchor omni row (`@<pid>`) jumped to the same paragraph,
 * because the act was handed the CARD, never the row.
 *
 * So the act is split in two, and neither half re-implements a ladder:
 *
 *   - `resolveCardJumpTarget` names a TARGET by asking the authority's own
 *     pass (`CardAnchorPass.jumpTarget`) — the row's own paragraph when a row
 *     is asking, else the authority's winner (`linkIndex`, task 664).
 *     Inline-atom links (footnote / citation), which the authority does not
 *     resolve, are the one fallback, located by `resolveLink`.
 *   - `jumpToTarget` is the ONE door that turns a target into a scroll: the
 *     card-aligned / centered scroll and the omni pin, written once.
 *
 * Cost: one pass (one O(doc) index) per CLICK — never per keystroke.
 */

import type { Editor } from "@tiptap/react";
import type { Link } from "./_shared/types";
import { resolveLink, type CardWithLinks } from "./links";
import { buildCardAnchorPass } from "./card-anchor-rows";
import { linkIdSelector } from "./link-dom-contract";
import {
  alignEntryToYIfNeeded,
  scrollEntryIntoViewIfNeeded,
} from "@/components/editor-layout/layout-scroll";

/** Where a Jump lands. */
export type JumpTarget =
  /** A live `linkedAnchor` mark — the highlighted words themselves. */
  | { kind: "mark"; anchorId: string }
  /** A live paragraph (any uuid-bearing block), with its doc position. */
  | { kind: "paragraph"; paragraphId: string; pos: number | null }
  /** An inline atom (footnote / citation) — outside the authority's ladder. */
  | { kind: "atom"; link: Link };

/**
 * Name the place a Jump on `card` should land: the anchor authority's reading
 * (`CardAnchorPass.jumpTarget` — the row's own paragraph when a row asks, else
 * the authority's winner), and only for a card the authority does not bind, an
 * inline-atom link located by `resolveLink`.
 */
export function resolveCardJumpTarget(
  editor: Editor,
  card: CardWithLinks,
  rowPid?: string | null,
): JumpTarget | null {
  const hit = buildCardAnchorPass(editor).jumpTarget(card, rowPid);
  if (hit) {
    return hit.anchorId
      ? { kind: "mark", anchorId: hit.anchorId }
      : { kind: "paragraph", paragraphId: hit.paragraphId, pos: hit.pos };
  }
  // Inline atoms are not paragraph anchors, so the authority never binds them.
  for (const link of card.links ?? []) {
    if (link.anchor.type !== "inline-atom") continue;
    if (resolveLink(editor, link)?.domEl) return { kind: "atom", link };
  }
  return null;
}

function targetElement(editor: Editor, target: JumpTarget): HTMLElement | null {
  switch (target.kind) {
    case "mark":
      return editor.view.dom.querySelector(
        linkIdSelector(target.anchorId),
      ) as HTMLElement | null;
    case "paragraph": {
      // `data-uuid` is not rendered to the DOM by our node specs (rendered:
      // false) — the position from the index reaches the block's own DOM.
      const queried = editor.view.dom.querySelector(
        `[data-uuid="${target.paragraphId}"]`,
      ) as HTMLElement | null;
      if (queried) return queried;
      if (target.pos == null) return null;
      const nodeDom = editor.view.nodeDOM(target.pos);
      return nodeDom instanceof HTMLElement
        ? nodeDom
        : (nodeDom?.parentElement as HTMLElement | null) ?? null;
    }
    case "atom":
      return resolveLink(editor, target.link)?.domEl ?? null;
  }
}

/**
 * The ONE door from a jump target to a scroll. Returns true if it landed.
 *
 *  When `sourceEl` is provided (the clicked card's wrapper), the in-text
 *  marker is aligned to that card's vertical position — the inverse of
 *  the marker→card alignment via `alignEntryToY`. Without `sourceEl`, the
 *  marker is centered in the viewport.
 *
 *  When `sourceEl` is an omni-entry wrapper (`data-omni-entry-wrapper`),
 *  computes the card's pod-relative Y BEFORE the row scrolls and fires
 *  a `virgil-card-jumped` event with it; EditorLayout pins the card at
 *  that pod-Y so it stays visually fixed during the scroll. Pod-relative
 *  is scroll-invariant under unified scroll, so the pre-scroll value is
 *  the post-scroll value — no rAF needed.
 */
export function jumpToTarget(
  editor: Editor,
  target: JumpTarget,
  sourceEl?: HTMLElement | null,
): boolean {
  const domEl = targetElement(editor, target);
  if (!domEl) return false;
  if (sourceEl) {
    const preY = sourceEl.getBoundingClientRect().top;
    // Pin pod-rel = marker's pre-scroll pod-relative Y. After the row
    // scrolls (by `markerY - preY`), the pod moves with it, and pin Y =
    // `markerY_pre - podTop_pre` lands the card at preY viewport-Y — the
    // card's original click position. See the same derivation in
    // `jumpToLink`.
    const omniWrapper = sourceEl.closest(
      "[data-omni-entry-wrapper]",
    ) as HTMLElement | null;
    const pod = omniWrapper?.parentElement as HTMLElement | null;
    const omniKey = omniWrapper?.dataset.omniEntryWrapper;
    const pinTop =
      omniKey && pod
        ? domEl.getBoundingClientRect().top - pod.getBoundingClientRect().top
        : null;
    // Necessity-gated (task 328), and the pin rides the scroll's verdict:
    // if the marker is already fully visible and near enough to the card,
    // the click moves nothing at all — no document scroll, and therefore
    // no compensating pin to re-cascade the deck.
    const moved = alignEntryToYIfNeeded(domEl, preY);
    if (moved && omniKey && pinTop !== null) {
      window.dispatchEvent(
        new CustomEvent("virgil-card-jumped", {
          detail: { omniKey, pinTop },
        }),
      );
    }
  } else {
    scrollEntryIntoViewIfNeeded(domEl, {
      behavior: "instant",
      block: "center",
    });
  }
  return true;
}

/**
 * Jump to where `card` is anchored: resolve through the authority (or the
 * asking row's own paragraph), then go through the one door. Returns true if
 * it landed.
 */
export function jumpToCard(
  editor: Editor,
  card: CardWithLinks,
  sourceEl?: HTMLElement | null,
  rowPid?: string | null,
): boolean {
  const target = resolveCardJumpTarget(editor, card, rowPid);
  return target ? jumpToTarget(editor, target, sourceEl) : false;
}
