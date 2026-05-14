/**
 * Drop spec for popped-out archive snippets (`archive:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const archiveDropSpec = paragraphSideReanchorSpec({
  kindLabel: "archive snippet",
  getApi: (ctx) => ctx.archive,
});
