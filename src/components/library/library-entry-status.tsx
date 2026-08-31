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
 *
 * COLOUR is not this file's decision (task 500). Both axes resolve their tone
 * through `@/lib/library/status-tone`, the one table the Library list's
 * `StatusPill`s read too — the two surfaces describe the same catalog row one
 * tab apart, so a private palette here is a second answer to one question.
 * What this file DOES own is its label/tooltip dialect: sentence-case phrases
 * where the list is glyph-dense.
 */

import type {
  LibraryBibState,
  LibraryIndexTier,
} from "@/lib/library/library-types";
import { bibStateTone, indexTierTone, type Tone } from "@/lib/library/status-tone";
import { OpenEntryLink } from "./open-library-entry";

// Status-badge dialect — a documented sibling of the META tier: 10px, but
// sentence-case (the user-facing vocabulary reads "Verified" / "Indexed PDF",
// not shouty uppercase) with tracking-wide to stay in the chip family. The
// membership chips on the layer above keep their denser 9px-uppercase
// "location tag" look. See STYLE_GUIDE § In-card type scale.
const CHIP_BASE =
  "inline-flex items-center gap-0.5 text-[10px] tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap border";

/** Paint a chip from a resolved {@link Tone}. The runtime-built token name is
 *  the same shape `StatusPill`'s `Pill` uses, so the two surfaces read the
 *  identical `--pill-<tone>-*` triple. */
function toneStyle(tone: Tone): React.CSSProperties {
  return {
    color: `var(--pill-${tone}-fg)`,
    backgroundColor: `var(--pill-${tone}-bg)`,
    borderColor: `var(--pill-${tone}-edge)`,
  };
}

/** One row of this surface's bib-auth dialect. `null` = render nothing. */
interface BibChipCopy {
  label: string;
  hint: string;
  aria: string;
}

/**
 * The paper-side label/tooltip dialect, as an EXHAUSTIVE record rather than a
 * switch — which is the structural half of the M1 fix. The pre-500 renderer
 * collapsed `unverified` and `failed` into one `case` with one label, and a
 * fall-through `case` is exactly the shape that makes two states silently one.
 * A record cannot fall through: every state states its own copy, and a new
 * member of the union is a compile error here.
 */
const BIB_CHIP_COPY: Readonly<Record<LibraryBibState, BibChipCopy | null>> = {
  none: null,
  authenticated: {
    label: "✓ Authenticated",
    hint: "Authenticated against authoritative sources (Crossref / OpenAlex / …)",
    aria: "Authenticated bibliography entry",
  },
  unverified: {
    label: "Unverified",
    hint: "Best-effort fields — not yet authenticated against an authoritative source",
    aria: "Unverified bibliography entry",
  },
  // The state the pre-500 renderer printed as "Unverified" in amber. It is a
  // different fact — an attempt was made and it FAILED — and it is the only
  // one on this axis that is an alarm rather than a caution.
  failed: {
    label: "! Auth failed",
    hint: "Authentication was attempted and failed — this entry couldn't be matched against external sources. Try again or fill the fields by hand.",
    aria: "Bibliography authentication failed",
  },
  "needs-reauth": {
    label: "↻ Needs re-auth",
    hint: "Metadata rewritten from the file — run /library/authenticate-bib to re-verify",
    aria: "Needs re-authentication",
  },
  manuscript: {
    label: "Manuscript",
    hint: "Unpublished or forthcoming — no external source applies",
    aria: "Manuscript",
  },
  canonical: {
    label: "Canonical",
    hint: "Pre-digital classic — no DOI/ISBN registry will ever index it",
    aria: "Canonical work",
  },
};

/** Authentication badge from the bib-auth axis. `none`/undefined → nothing. */
function verifiedChip(state: LibraryBibState | undefined) {
  if (!state) return null;
  const copy = BIB_CHIP_COPY[state];
  if (!copy) return null;
  return (
    <span
      className={CHIP_BASE}
      style={toneStyle(bibStateTone(state))}
      data-hint={copy.hint}
      aria-label={copy.aria}
    >
      {copy.label}
    </span>
  );
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
      className={CHIP_BASE}
      style={toneStyle(indexTierTone(tier))}
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
