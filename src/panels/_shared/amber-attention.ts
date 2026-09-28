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

/** The amber "pending" CHIP (task 825): a small button whose state is an
 *  outstanding request — `BibEntryCard`'s "Requested" review/annotation
 *  toggles. Same family as {@link AMBER_ATTENTION_STRIP} (tokens, not raw
 *  Tailwind palette classes), so the chip and the request-note strip it opens
 *  read as one state. */
export const AMBER_PENDING_CHIP =
  "text-[var(--amber-600)] bg-[var(--amber-50)] hover:bg-[var(--amber-100)]";

/** Amber ink for a label whose content is present (the bib "Annotations"
 *  disclosure when an annotation exists). */
export const AMBER_ATTENTION_INK =
  "text-[var(--amber-600)] hover:text-[var(--amber-700)]";
