/**
 * Drop specs for popped-out reports (`report:${id}`) and report requests
 * (`report-request:${id}`). Paragraph-side re-anchor — see `noteDropSpec`
 * for the shared shape. Both kinds share the one `reports` paragraph-anchor
 * API on the drop-mode context.
 */

import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";

export const reportDropSpec = textObjectSideReanchorSpec({
  kindLabel: "report",
  getApi: (ctx) => ctx.reports,
});

export const reportRequestDropSpec = textObjectSideReanchorSpec({
  kindLabel: "report request",
  getApi: (ctx) => ctx.reports,
});
