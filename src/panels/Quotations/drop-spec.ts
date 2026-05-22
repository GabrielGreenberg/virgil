/**
 * Drop spec for popped-out quotations (`quotation:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const quotationDropSpec = textObjectSideReanchorSpec({
  kindLabel: "quotation",
  getApi: (ctx) => ctx.quotations,
});
