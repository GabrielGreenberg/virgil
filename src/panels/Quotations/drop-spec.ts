/**
 * Drop spec for popped-out quotations (`quotation:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const quotationDropSpec = paragraphSideReanchorSpec({
  kindLabel: "quotation",
  getApi: (ctx) => ctx.quotations,
});
