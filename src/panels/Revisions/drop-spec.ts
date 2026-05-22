/**
 * Drop specs for popped-out Revisions cards.
 *
 * The renderer uses one cardKey prefix (`revision:${id}`) for both
 * comments and suggestions — they live in the same `useRevisions`
 * hook with one ID space, so a single spec covers both.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const revisionDropSpec = textObjectSideReanchorSpec({
  kindLabel: "revision",
  getApi: (ctx) => ctx.revisions,
});
