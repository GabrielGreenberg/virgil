/**
 * Drop spec for popped-out footnote cards (`footnote:${id}`).
 *
 * The footnote's content stays in the card; only its inline marker
 * (the superscript number in the prose) moves to a new inline cursor
 * position. postDrop: keep — the user is still working with the card.
 *
 * "Anchor the unanchored": a footnote card can exist with NO marker in the
 * prose — created via the panel "+", or archived (which splices the
 * `\footnote` atom out and keeps the body in `footnotes.json`) and then
 * unarchived, which leaves a re-placeable parked ref. The opt-in `createAtom`
 * factory builds a fresh `footnote` atom — reusing the card's EXISTING
 * footnoteId — and the shared `inlineAtomMoveSpec` inserts it at the drop
 * point.
 *
 * **The body comes from the CARD** (`ctx.atomCards.footnote`, task 233). A
 * footnote's prose IS the atom's `content` attr: it lives in the node, it
 * serializes to the `.tex` `\footnote{…}`, and it regenerates from nothing
 * else. This factory used to hard-code the empty create shape — so re-placing
 * an archived footnote planted an EMPTY atom, `getFootnotes()` re-derived the
 * panel from that empty node, and the user's footnote text was destroyed in
 * both the panel and the `.tex`. (The citation twin was wired from the start;
 * the footnote's accessor was simply never added — see `InlineAtomCardAttrs`.)
 *
 * With NO accessor wired this DECLINES, exactly like the citation twin. It is
 * tempting to fall back to the empty create shape and call that a graceful
 * degradation — an empty body is, after all, a legal footnote. It isn't
 * graceful: that fallback IS the task-233 bug. The body is sitting in
 * `footnotes.json` (unread), the empty atom serializes an empty `\footnote{}`
 * into the document, and the ref then drops out of the atomless list because
 * its atom is live — so the surviving text is reachable from no surface at all.
 * A rebuild that can't read what it needs must refuse, leaving the card parked
 * with its text intact. (The wired accessor never returns null, so this
 * refusal only fires where the feature genuinely isn't present.)
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { inlineAtomMoveSpec } from "@/components/drop-mode/util/inline-atom-move";
import { CARD_ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

/** The footnote atom's own registry row — the `{nodeName, idAttr}` pair the
 *  by-id resolver needs, read rather than re-spelled (task 645). */
const ATOM = CARD_ATOM_REGISTRY.footnote;

export const footnoteDropSpec = inlineAtomMoveSpec({
  nodeName: ATOM.nodeName,
  idAttr: ATOM.idAttr,
  cardApiKind: "footnote",
  createAtom: ({ id, schema, cardAttrs }): PMNode | null => {
    const footnoteNodeType = schema.nodes[ATOM.nodeName];
    if (!footnoteNodeType) return null;
    // No accessor in this doc ⇒ refuse (see jsdoc). A card that HAS no text yet
    // still resolves — the accessor answers with the empty doc, which is a real
    // answer, not an absence.
    if (!cardAttrs) return null;
    // The card's live body — the one thing the new atom cannot reconstruct on
    // its own. Same `{type:"doc",…}` shape the `\footnote` slash/menu create
    // path builds (commands.ts), normalized by the hook accessor.
    // Carry the card's EXISTING footnoteId so the new marker stays coupled to
    // the card. `number: 0` lets the renumber pass assign the live number.
    return footnoteNodeType.create({
      [ATOM.idAttr]: id,
      content: cardAttrs.content,
      number: 0,
    });
  },
});
