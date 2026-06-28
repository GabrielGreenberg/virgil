"use client";

/**
 * Status layer for a library-backed bibliography / citation entry — the
 * third stacked layer of the card (text → libraries → status). It surfaces
 * the two axes that are NOT library membership (those live on the layer
 * above, via `LibraryMembershipChips`):
 *
 *   - an AUTHENTICATION badge from the catalog's bib-auth state
 *     (`authenticated` → "✓ Authenticated"). This replaces the old cramped
 *     "AUTH" chip and lives on its own layer, distinct from the libraries.
 *   - a PROCESSING-TIER badge (Bib only / Indexed PDF / Deep-indexed PDF),
 *     derived from `indexed.state` via `LibraryIndexTier`.
 *   - the shared `<OpenEntryLink>` affordance — opens the entry as a new
 *     Virgil-bar paper tab.
 */

import type {
  LibraryBibState,
  LibraryIndexTier,
} from "@/lib/library/library-types";
import { OpenEntryLink } from "./open-library-entry";

// Status-badge dialect — a documented sibling of the META tier: 10px, but
// sentence-case (the user-facing vocabulary reads "Verified" / "Indexed PDF",
// not shouty uppercase) with tracking-wide to stay in the chip family. The
// membership chips on the layer above keep their denser 9px-uppercase
// "location tag" look. See STYLE_GUIDE § In-card type scale.
const CHIP_BASE =
  "inline-flex items-center gap-0.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap";

/** Authentication badge from the bib-auth axis. `none`/undefined → nothing. */
function verifiedChip(state: LibraryBibState | undefined) {
  switch (state) {
    case "authenticated":
      return (
        <span
          className={`${CHIP_BASE} text-emerald-700 bg-emerald-50 border border-emerald-200`}
          data-hint="Authenticated against authoritative sources (Crossref / OpenAlex / …)"
          aria-label="Authenticated bibliography entry"
        >
          ✓ Authenticated
        </span>
      );
    case "unverified":
    case "failed":
      return (
        <span
          className={`${CHIP_BASE} text-amber-700 bg-amber-50 border border-amber-200`}
          data-hint="Best-effort fields — not yet authenticated against an authoritative source"
          aria-label="Unverified bibliography entry"
        >
          Unverified
        </span>
      );
    case "manuscript":
      return (
        <span
          className={`${CHIP_BASE} text-sky-700 bg-sky-50 border border-sky-200`}
          data-hint="Unpublished or forthcoming — no external source applies"
          aria-label="Manuscript"
        >
          Manuscript
        </span>
      );
    case "canonical":
      return (
        <span
          className={`${CHIP_BASE} text-indigo-700 bg-indigo-50 border border-indigo-200`}
          data-hint="Pre-digital classic — no DOI/ISBN registry will ever index it"
          aria-label="Canonical work"
        >
          Canonical
        </span>
      );
    default:
      return null;
  }
}

/** Human-readable label for a processing tier. Exported for reuse / tests. */
export function indexTierLabel(tier: LibraryIndexTier): string {
  switch (tier) {
    case "bib-only":
      return "Bib only";
    case "processing":
      return "Indexing…";
    case "indexed":
      return "Indexed PDF";
    case "deep-indexed":
      return "Deep-indexed PDF";
    case "failed":
      return "Index failed";
  }
}

const TIER_TONE: Record<LibraryIndexTier, string> = {
  "bib-only": "text-slate-600 bg-slate-50 border border-slate-200",
  processing: "text-amber-700 bg-amber-50 border border-amber-200",
  indexed: "text-emerald-700 bg-emerald-50 border border-emerald-200",
  "deep-indexed": "text-emerald-800 bg-emerald-100 border border-emerald-300",
  failed: "text-rose-700 bg-rose-50 border border-rose-200",
};

const TIER_HINT: Record<LibraryIndexTier, string> = {
  "bib-only": "In the library as a bibliography entry only — no PDF indexed",
  processing: "The PDF is being indexed",
  indexed: "PDF text extracted and indexed",
  "deep-indexed": "PDF deep-indexed — structural cleanup applied",
  failed: "PDF indexing failed",
};

function indexTierChip(tier: LibraryIndexTier) {
  return (
    <span
      className={`${CHIP_BASE} ${TIER_TONE[tier]}`}
      data-hint={TIER_HINT[tier]}
      aria-label={TIER_HINT[tier]}
    >
      {indexTierLabel(tier)}
    </span>
  );
}

/**
 * Layer 3 — verification badge + processing-tier badge + open link. Renders
 * nothing when the entry isn't library-backed and carries no auth state.
 */
export function LibraryStatusRow({
  indexTier,
  bibState,
  citekey,
  inLibrary,
}: {
  indexTier?: LibraryIndexTier;
  bibState?: LibraryBibState;
  citekey: string;
  inLibrary: boolean;
}) {
  const verified = verifiedChip(bibState);
  const tier = indexTier ? indexTierChip(indexTier) : null;
  if (!verified && !tier && !inLibrary) return null;
  return (
    <div className="flex items-center flex-wrap gap-1">
      {verified}
      {tier}
      {inLibrary && <OpenEntryLink citekey={citekey} />}
    </div>
  );
}
