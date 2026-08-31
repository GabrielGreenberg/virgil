"use client";

import type { IndexedState, BibAuthState } from "@library/lib/catalog";
import { FACETS, STATUS_SUBGRID, type StatusFacet } from "@library/lib/list-columns";
import { FONT_MONO } from "@/lib/font-stacks";
import {
  bibStateTone,
  indexStateTier,
  indexTierTone,
  type Tone,
} from "@/lib/library/status-tone";

// COLOUR is not this file's decision (task 500). Both status axes resolve
// their tone through `@/lib/library/status-tone` — the one table the paper
// side's Bibliography-panel chips read too, because the two surfaces describe
// the SAME catalog row one tab apart. What this file owns is its four LABEL
// dialects (glyph / short / full-phrase / tooltip), which are genuinely
// per-surface; what it may not own is a private palette.

interface PillProps {
  label: string;
  tone: Tone;
  title?: string;
}

function Pill({ label, tone, title }: PillProps) {
  const bg = `var(--pill-${tone}-bg)`;
  const fg = `var(--pill-${tone}-fg)`;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: bg,
        color: fg,
        fontSize: 11,
        lineHeight: "16px",
        padding: "1px 6px",
        borderRadius: "var(--radius-pill)",
        fontFamily: FONT_MONO,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function PdfPill({ present, compact = false }: { present: boolean; compact?: boolean }) {
  return present
    ? <Pill label={compact ? "✓" : "✓ pdf"} tone="green" title="PDF on disk" />
    : <Pill label={compact ? "—" : "— pdf"} tone="gray" title="No PDF on disk" />;
}

const indexedLabel: Record<IndexedState, string> = {
  none: "— idx",
  queued: "⋯ idx",
  running: "⋯ idx",
  indexed: "✓ idx",
  deepIndexed: "✓✓ idx",
  failed: "! idx",
};

/** Glyph-only labels for the compact (4-mini-column) grid — the FacetSubBar
 *  header already names the facet, so the pill shows only the state glyph. */
const indexedGlyph: Record<IndexedState, string> = {
  none: "—",
  queued: "⋯",
  running: "⋯",
  indexed: "✓",
  deepIndexed: "✓✓",
  failed: "!",
};

/** Full-phrase labels for the PaperHeader's stacked STATUS column (`long`
 *  mode). One human-readable phrase per state, no glyph shorthand. */
const indexedLong: Record<IndexedState, string> = {
  none: "Not indexed",
  queued: "Queued",
  running: "Indexing…",
  indexed: "Indexed",
  deepIndexed: "Deep Indexed",
  failed: "Index failed",
};

export function IndexedPill({
  state,
  compact = false,
  long = false,
}: {
  state: IndexedState;
  compact?: boolean;
  /** Full-phrase label (PaperHeader stacked column). Wins over `compact`. */
  long?: boolean;
}) {
  const label = long ? indexedLong[state] : compact ? indexedGlyph[state] : indexedLabel[state];
  return (
    <Pill
      label={label}
      tone={indexTierTone(indexStateTier(state))}
      title={`Indexed: ${state}`}
    />
  );
}

const bibLabel: Record<BibAuthState, string> = {
  none: "— bib",
  unverified: "⋯ bib",
  authenticated: "✓ bib",
  manuscript: "MS",
  canonical: "≈ bib",
  failed: "! bib",
  "needs-reauth": "↻ bib",
};

/** Glyph-only labels for the compact grid (the header labels the facet). */
const bibGlyph: Record<BibAuthState, string> = {
  none: "—",
  unverified: "⋯",
  authenticated: "✓",
  manuscript: "MS",
  canonical: "≈",
  failed: "!",
  "needs-reauth": "↻",
};

const bibTitle: Record<BibAuthState, string> = {
  none: "Bib auth: not yet attempted",
  unverified: "Bib auth: unverified — manual review recommended",
  authenticated: "Bib auth: authenticated",
  manuscript: "Bib auth: manuscript (forthcoming / unpublished)",
  canonical:
    "Bib auth: canonical (pre-digital classic; no external registry expected)",
  failed: "Bib auth: failed — try again or fill by hand",
  "needs-reauth":
    "Bib auth: needs re-auth — metadata rewritten from the file; run /library/authenticate-bib",
};

/** Full-phrase bib-auth labels for the PaperHeader's stacked STATUS column
 *  (`long` mode). */
const bibLong: Record<BibAuthState, string> = {
  none: "Not authenticated",
  unverified: "Unverified",
  authenticated: "Authenticated",
  manuscript: "Manuscript",
  canonical: "Pre-digital classic",
  failed: "Auth failed",
  "needs-reauth": "Needs re-auth",
};

export function BibPill({
  state,
  compact = false,
  long = false,
}: {
  state: BibAuthState;
  compact?: boolean;
  /** Full-phrase label (PaperHeader stacked column). Wins over `compact`. */
  long?: boolean;
}) {
  const label = long ? bibLong[state] : compact ? bibGlyph[state] : bibLabel[state];
  return <Pill label={label} tone={bibStateTone(state)} title={bibTitle[state]} />;
}

/** Blue "imported" pill — shown in the paper-header pill group when this
 *  paper's references.bib has been folded into the central master.bib.
 *  Reuses the slate-blue pill tone (same family as the manuscript/canonical
 *  bib pills). */
export function BibImportedPill({
  compact = false,
  long = false,
}: {
  compact?: boolean;
  /** Full-phrase label (PaperHeader stacked column). Wins over `compact`. */
  long?: boolean;
}) {
  const label = long ? "Bibliography imported" : compact ? "✓" : "✓ imp";
  return <Pill label={label} tone="blue" title="Bibliography imported into master.bib" />;
}

/** Gray empty-state "imp" pill — the not-imported counterpart to
 *  {@link BibImportedPill}, matching the "— pdf"/"— idx"/"— bib" gray tone +
 *  em-dash convention. Rendered in the row's 4-facet grid so the `imp` cell is
 *  never empty (alignment under the "imp" header label is preserved). */
export function BibNotImportedPill({ compact = false }: { compact?: boolean }) {
  return (
    <Pill
      label={compact ? "—" : "— imp"}
      tone="gray"
      title="Bibliography not imported into master.bib"
    />
  );
}

/** Bare blue check — the dense indicator for the LeftList "imp" column.
 *  Same slate-blue (`--pill-blue-fg`) as BibImportedPill so the two
 *  surfaces read as the same signal. */
export function BibImportedCheck() {
  return (
    <span
      title="Bibliography imported into master.bib"
      aria-label="Bibliography imported"
      style={{
        color: "var(--pill-blue-fg)",
        fontSize: 13,
        lineHeight: 1,
        fontWeight: 600,
      }}
    >
      ✓
    </span>
  );
}

export function StatusPills({
  pdfPresent,
  indexed,
  bib,
  bibImported = false,
  grid = false,
}: {
  pdfPresent: boolean;
  indexed: IndexedState;
  bib: BibAuthState;
  /** When true, appends a blue "imported" pill after the bib pill. */
  bibImported?: boolean;
  /** Opt-in 4-mini-column grid layout (the LeftList row's STATUS cell): each
   *  facet sits in its own {@link STATUS_SUBGRID} track so the pills align
   *  directly under the FacetSubBar's pdf/idx/bib/imp header labels, and the
   *  `imp` cell ALWAYS renders a pill (gray "— imp" when not imported) so no
   *  cell is empty. Off (default): the original inline-flow layout with a
   *  conditional-null `imp` pill — used by the PaperHeader, which must not
   *  regress. */
  grid?: boolean;
}) {
  // F#14: the glyph order is GENUINELY driven by the shared `FACETS` array
  // (`list-columns.ts`) — the same SSOT the comparator switch and the facet
  // sub-bar use — so the pills, the sortable sub-bar segments, and the
  // comparator can never drift out of order. Each facet maps to its pill via
  // `FACET_PILL`. In grid mode `imp` ALWAYS renders a pill (blue when
  // imported, gray "— imp" otherwise) so every mini-column is filled; in flow
  // mode it returns null unless `bibImported`, preserving the original
  // conditional "imported" pill (no PaperHeader regression).
  // In grid mode the pills render GLYPH-ONLY (the FacetSubBar header names the
  // facet), so each fits its narrow minmax(0,1fr) track without overflowing /
  // overlapping the neighbor column. Flow mode (PaperHeader) keeps full labels.
  const FACET_PILL: Record<StatusFacet, () => React.ReactNode> = {
    pdf: () => <PdfPill present={pdfPresent} compact={grid} />,
    idx: () => <IndexedPill state={indexed} compact={grid} />,
    bib: () => <BibPill state={bib} compact={grid} />,
    imp: () =>
      bibImported ? (
        <BibImportedPill compact={grid} />
      ) : grid ? (
        <BibNotImportedPill compact />
      ) : null,
  };
  if (grid) {
    return (
      <span
        style={{
          display: "grid",
          gridTemplateColumns: STATUS_SUBGRID,
          alignItems: "center",
        }}
      >
        {FACETS.map((facet) => (
          <span
            key={facet}
            style={{ minWidth: 0, display: "flex", justifySelf: "start" }}
          >
            {FACET_PILL[facet]()}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      {FACETS.map((facet) => (
        <span key={facet} style={{ display: "contents" }}>
          {FACET_PILL[facet]()}
        </span>
      ))}
    </span>
  );
}

// ── Compact status dots (for the dense list row) ──────────────────────

export function Dot({ tone, title }: { tone: Tone; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "var(--radius-pill)",
        background: `var(--pill-${tone}-fg)`,
        flexShrink: 0,
      }}
    />
  );
}

/** Three small color-coded dots — pdf, indexed, bib. Used in the
 *  single-line LeftListRow where there's no room for full pills. */
export function StatusDots({
  pdfPresent,
  indexed,
  bib,
}: {
  pdfPresent: boolean;
  indexed: IndexedState;
  bib: BibAuthState;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <Dot
        tone={pdfPresent ? "green" : "gray"}
        title={`pdf: ${pdfPresent ? "present" : "missing"}`}
      />
      <Dot
        tone={indexTierTone(indexStateTier(indexed))}
        title={`indexed: ${indexed}`}
      />
      <Dot tone={bibStateTone(bib)} title={`bib: ${bib}`} />
    </span>
  );
}
