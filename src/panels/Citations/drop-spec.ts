/**
 * Drop spec for popped-out citation cards (`citation:${id}`).
 *
 * The citation card stays; only its inline `\cite{}` atom moves to a
 * new inline cursor position.
 */

import { inlineAtomMoveSpec } from "@/components/drop-mode/util/inline-atom-move";

export const citationDropSpec = inlineAtomMoveSpec({
  nodeName: "citation",
  idAttr: "citationId",
});
