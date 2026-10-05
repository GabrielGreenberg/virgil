/**
 * Drop specs for popped-out Cutter cards.
 *
 * Registration is by card KIND (`src/cards/drop-specs/index.ts`):
 * `cutter-comment` and `cutter-suggestion` each register one of the specs
 * below; both share one underlying `useCutter` hook, so both map to
 * `ctx.cutterCards`.
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
