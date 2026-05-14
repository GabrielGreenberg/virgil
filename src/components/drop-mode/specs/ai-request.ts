/**
 * Drop spec for popped-out AI-request cards (`ai:${id}`).
 *
 * The AI-request card stays; only its inline marker (the
 * `aiRequestMarker` atom node carrying `requestId`) moves to a new
 * inline cursor position. AI requests have no dedicated panel folder
 * — the spec lives at the drop-mode module level alongside other
 * document-spanning kinds.
 */

import { inlineAtomMoveSpec } from "../util/inline-atom-move";

export const aiRequestDropSpec = inlineAtomMoveSpec({
  nodeName: "aiRequestMarker",
  idAttr: "requestId",
});
