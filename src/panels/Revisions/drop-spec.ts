/**
 * Drop specs for popped-out Revisions cards.
 *
 * The renderer uses one cardKey prefix (`revision:${id}`) for both
 * comments and suggestions — they live in the same `useRevisions`
 * hook with one ID space, so a single spec covers both.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const revisionDropSpec = paragraphSideReanchorSpec({
  kindLabel: "revision",
  getApi: (ctx) => ctx.revisions,
});
