/**
 * Drop spec for popped-out footnote cards (`footnote:${id}`).
 *
 * The footnote's content stays in the card; only its inline marker
 * (the superscript number in the prose) moves to a new inline cursor
 * position. postDrop: keep — the user is still working with the card.
 */

import { inlineAtomMoveSpec } from "@/components/drop-mode/util/inline-atom-move";

export const footnoteDropSpec = inlineAtomMoveSpec({
  nodeName: "footnote",
  idAttr: "footnoteId",
});
