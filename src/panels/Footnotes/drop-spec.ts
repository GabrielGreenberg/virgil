/**
 * Drop spec for popped-out footnote cards (`footnote:${id}`).
 *
 * The footnote's content stays in the card; only its inline marker
 * (the superscript number in the prose) moves to a new inline cursor
 * position. postDrop: keep — the user is still working with the card.
 *
 * "Anchor the unanchored": a footnote card can exist with NO marker in the
 * prose (created via the panel "+"). The opt-in `createAtom` factory builds
 * a fresh `footnote` atom — reusing the card's EXISTING footnoteId — and the
 * shared `inlineAtomMoveSpec` inserts it at the drop point. The node shape
 * mirrors the `\footnote` create path (`commands.ts`: an empty-body doc with
 * `number: 0`), substituting the existing id instead of minting a new one.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { inlineAtomMoveSpec } from "@/components/drop-mode/util/inline-atom-move";

export const footnoteDropSpec = inlineAtomMoveSpec({
  nodeName: "footnote",
  idAttr: "footnoteId",
  createAtom: ({ id, schema }): PMNode | null => {
    const footnoteNodeType = schema.nodes.footnote;
    if (!footnoteNodeType) return null;
    // Empty body — the panel card hosts the editable footnote text. Same
    // shape the `\footnote` slash/menu create path builds (commands.ts), but
    // carry the card's EXISTING footnoteId so the new marker stays coupled to
    // the card. `number: 0` lets the renumber pass assign the live number.
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    return footnoteNodeType.create({ footnoteId: id, content, number: 0 });
  },
});
