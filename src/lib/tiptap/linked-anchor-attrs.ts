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
 * Non-transient marks (every existing anchor) render byte-identically to the
 * previous inline implementation: `data-link-card` is always emitted, with
 * the explicit `linkCard` if present else a prefix derived from the legacy
 * `kind`.
 */

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
    const legacyKind = typeof attrs.kind === "string" ? attrs.kind : "";
    const cardKind =
      legacyKind === "revision"
        ? "comment"
        : legacyKind === "note"
          ? "note"
          : legacyKind === "highlight"
            ? "highlight"
            : legacyKind === "cut"
              ? "cut"
              : "";
    if (cardKind) linkCard = `${cardKind}:`;
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
