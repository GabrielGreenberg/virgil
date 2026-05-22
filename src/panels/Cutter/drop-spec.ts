/**
 * Drop specs for popped-out Cutter cards.
 *
 * Two cardKey prefixes (`cutter-comment:${id}` and
 * `cutter-suggestion:${id}`) share one underlying `useCutter` hook,
 * so both specs map to `ctx.cutterCards`.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const cutterCommentDropSpec = textObjectSideReanchorSpec({
  kindLabel: "comment",
  getApi: (ctx) => ctx.cutterCards,
});

export const cutterSuggestionDropSpec = textObjectSideReanchorSpec({
  kindLabel: "suggestion",
  getApi: (ctx) => ctx.cutterCards,
});
