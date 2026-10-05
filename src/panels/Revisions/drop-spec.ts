/**
 * Drop specs for popped-out Revisions cards.
 *
 * Registration is by card KIND (`src/cards/drop-specs/index.ts`): both
 * `revision-comment` and `revision-suggestion` register this one spec —
 * they live in the same `useRevisions` hook with one ID space, so a single
 * spec covers both.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const revisionDropSpec = textObjectSideReanchorSpec({
  kindLabel: "revision",
  getApi: (ctx) => ctx.revisions,
});
