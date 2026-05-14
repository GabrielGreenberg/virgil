/**
 * Drop specs for popped-out Notes panel cards.
 *
 * Both `note:${id}` and `highlight:${id}` follow the same shape —
 * paragraph-side re-anchor via the generic factory. The factory
 * handles Mode B preservation: if the card had a textRange anchor,
 * its data is saved into `card.originalAnchor` before the link is
 * stripped, so a future restore-the-highlight UX has the data to
 * work with.
 */

import { paragraphSideReanchorSpec } from "@/components/drop-mode/util/paragraph-side-reanchor";

export const noteDropSpec = paragraphSideReanchorSpec({
  kindLabel: "note",
  getApi: (ctx) => ctx.notes,
});

export const highlightDropSpec = paragraphSideReanchorSpec({
  kindLabel: "highlight",
  getApi: (ctx) => ctx.highlights,
});
