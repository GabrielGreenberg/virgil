/**
 * Drop spec for popped-out todos (`todo:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const todoDropSpec = textObjectSideReanchorSpec({
  kindLabel: "todo",
  getApi: (ctx) => ctx.todos,
});
