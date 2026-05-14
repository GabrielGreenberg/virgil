/**
 * Drop spec for popped-out todos (`todo:${id}`).
 * Paragraph-side re-anchor — see `noteDropSpec` for the shared shape.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const todoDropSpec = paragraphSideReanchorSpec({
  kindLabel: "todo",
  getApi: (ctx) => ctx.todos,
});
