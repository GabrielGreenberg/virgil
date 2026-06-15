/**
 * Pure DOM-attribute policy for a `linkedAnchor` mark.
 *
 * Extracted from the mark's `renderHTML` so it can be unit-tested without a
 * ProseMirror schema or the editor-extension barrel (which pulls in storage
 * and other heavy deps). `LinkedAnchor.renderHTML` simply merges the object
 * this returns onto its `HTMLAttributes`.
 *
 * The one behavioural rule that lives here: a TRANSIENT anchor — the plain
 * selection grab's invisible range handle, stamped with `kind:"transient"`
 * and no `linkCard` — emits NO `data-link-card`. Every per-kind colour rule
 * in globals.css keys off `data-link-card="<cardKind>:…"`, so omitting the
 * attribute (paired with the `.linked-anchor:not([data-link-card])`
 * transparent rule) leaves the grabbed text unpainted: no card, no
 * highlight, even with the per-kind highlight toggle on or on hover. The
 * grab is gesture input, not an annotation.
 *
 * A real card attached to the same range later sets `linkCard`, which wins
 * here, so the anchor renders with its per-kind colour the moment it becomes
 * an annotation (the sentinel never sticks once a card exists).
 *
 * Non-transient marks always emit `data-link-card`: the explicit `linkCard`
 * if present, else a per-kind token derived from the legacy `kind` via the
 * SSOT `dataLinkCardTokenForLegacyMarkKind` (legacy-token-crosswalk). That
 * fallback is what a RESTORED mark relies on — `applyLinkedAnchors` re-stamps
 * with an empty `linkCard` (no cardId), so the kind→token derivation is the
 * only thing giving the reload-restored span its per-kind tint. It covers the
 * full `LinkedAnchorKind` set (note, highlight, todo, revision, the two cutter
 * kinds, the two report kinds); note/highlight/cut/revision are byte-identical
 * to the prior hand-rolled switch, while todo, the cutter kinds and the report
 * kinds — previously fell through to an empty token, dropping their reload
 * tint — now paint correctly.
 */

import { dataLinkCardTokenForLegacyMarkKind } from "@/cards/legacy-token-crosswalk";

export interface LinkedAnchorAttrsInput {
  anchorId?: unknown;
  linkId?: unknown;
  linkCard?: unknown;
  kind?: unknown;
}

const TRANSIENT_KIND = "transient";

export function linkedAnchorRenderAttrs(
  attrs: LinkedAnchorAttrsInput,
): Record<string, string> {
  const linkId = typeof attrs.linkId === "string" ? attrs.linkId : "";
  const legacyAnchorId =
    typeof attrs.anchorId === "string" ? attrs.anchorId : "";
  const anchorId = linkId || legacyAnchorId || "";

  // Prefer the explicit linkCard attr; fall back to a prefix derived from
  // the legacy `kind` attr so older anchors still get a per-kind CSS colour
  // and the per-kind highlight toggle reaches them.
  const explicitCard = typeof attrs.linkCard === "string" ? attrs.linkCard : "";
  // Cardless transient handle: only when there is no real card yet.
  const transient = !explicitCard && attrs.kind === TRANSIENT_KIND;

  let linkCard = explicitCard;
  if (!transient && !linkCard) {
    // Derive the per-kind token from the SSOT crosswalk (note, highlight, todo,
    // revision→comment, the cutter and report kinds, plus the legacy `cut`
    // alias) so the restored mark's `data-link-card` can never drift from the
    // CSS selectors. Unrecognised kind → null → empty token (amber), as before.
    const legacyKind = typeof attrs.kind === "string" ? attrs.kind : "";
    const token = dataLinkCardTokenForLegacyMarkKind(legacyKind);
    if (token) linkCard = `${token}:`;
  }

  const out: Record<string, string> = {
    class: "linked-anchor",
    "data-link-id": anchorId,
    "data-link-kind": "anchor",
  };
  // Omit data-link-card entirely for a transient handle so no colour rule
  // matches; every other anchor always carries it (possibly empty).
  if (!transient) out["data-link-card"] = linkCard;
  return out;
}
