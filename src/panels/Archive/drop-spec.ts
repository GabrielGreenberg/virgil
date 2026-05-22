/**
 * Drop spec for popped-out archive snippets (`archive:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const archiveDropSpec = textObjectSideReanchorSpec({
  kindLabel: "archive snippet",
  getApi: (ctx) => ctx.archive,
});
