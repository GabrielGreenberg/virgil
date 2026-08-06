/** Shared chrome for the app's amber "attention" surfaces — a pending/warning
 *  wash with an amber-200 hairline. One SSOT so every amber-attention surface
 *  reads as one family and can't drift apart again (task 280: the Bibliography
 *  request form had picked up a neutral `--border-light` seam and the three
 *  washes had drifted to /50, /40, /30; task 305: `BibEntryCard`'s two
 *  request-note strips had silently re-fragmented to raw `amber-200`/`amber-50`
 *  Tailwind at the pre-280 `/50` wash, invisible to the panel-only test).
 *
 *  Token-based (`var(--amber-*)`, per STYLE_GUIDE "Warm amber") and reconciled
 *  to a single `/40` wash. Holds the color family + padding only; each caller
 *  adds the border *shape* and layout it needs:
 *    · `border-b`                    → panelExtras row (conflict decision / request form)
 *    · `border rounded-md`           → standalone card (pending-requests item)
 *    · `rounded-md border overflow-hidden` → per-entry request-note strip (BibEntryCard)
 *
 *  Lives here (not as a private const in BibliographyPanel) so the panel AND
 *  `BibEntryCard` — its across-the-boundary sibling — share one physical home;
 *  `bibliography-amber-strip-convergence.test.ts` pins both consumers to it. */
export const AMBER_ATTENTION_STRIP =
  "px-3 py-2 border-[var(--amber-200)] bg-[var(--amber-50)]/40";
