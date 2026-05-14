/**
 * Drop specs for popped-out Cutter cards.
 *
 * Two cardKey prefixes (`cutter-comment:${id}` and
 * `cutter-suggestion:${id}`) share one underlying `useCutter` hook,
 * so both specs map to `ctx.cutterCards`.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const cutterCommentDropSpec = paragraphSideReanchorSpec({
  kindLabel: "comment",
  getApi: (ctx) => ctx.cutterCards,
});

export const cutterSuggestionDropSpec = paragraphSideReanchorSpec({
  kindLabel: "suggestion",
  getApi: (ctx) => ctx.cutterCards,
});
