"use client";

import type { IndexedState, BibAuthState } from "@library/lib/catalog";

type Tone = "green" | "amber" | "red" | "gray" | "blue";

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
        borderRadius: 999,
        fontFamily: "var(--mono)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function PdfPill({ present }: { present: boolean }) {
  return present
    ? <Pill label="✓ pdf" tone="green" title="PDF on disk" />
    : <Pill label="— pdf" tone="gray" title="No PDF" />;
}

const indexedTone: Record<IndexedState, Tone> = {
  none: "gray",
  queued: "amber",
  running: "amber",
  indexed: "green",
  deepIndexed: "green",
  failed: "red",
};

const indexedLabel: Record<IndexedState, string> = {
  none: "— idx",
  queued: "⋯ idx",
  running: "⋯ idx",
  indexed: "✓ idx",
  deepIndexed: "✓✓ idx",
  failed: "! idx",
};

export function IndexedPill({ state }: { state: IndexedState }) {
  return <Pill label={indexedLabel[state]} tone={indexedTone[state]} title={`Indexed: ${state}`} />;
}

const bibTone: Record<BibAuthState, Tone> = {
  none: "gray",
  unverified: "amber",
  authenticated: "green",
  manuscript: "blue",
  canonical: "blue",
  failed: "red",
};

const bibLabel: Record<BibAuthState, string> = {
  none: "— bib",
  unverified: "⋯ bib",
  authenticated: "✓ bib",
  manuscript: "MS",
  canonical: "≈ bib",
  failed: "! bib",
};

const bibTitle: Record<BibAuthState, string> = {
  none: "Bib auth: not yet attempted",
  unverified: "Bib auth: unverified — manual review recommended",
  authenticated: "Bib auth: authenticated",
  manuscript: "Bib auth: manuscript (forthcoming / unpublished)",
  canonical:
    "Bib auth: canonical (pre-digital classic; no external registry expected)",
  failed: "Bib auth: failed — try again or fill by hand",
};

export function BibPill({ state }: { state: BibAuthState }) {
  return <Pill label={bibLabel[state]} tone={bibTone[state]} title={bibTitle[state]} />;
}

/** Blue "imported" pill — shown in the paper-header pill group when this
 *  paper's references.bib has been folded into the central master.bib.
 *  Reuses the slate-blue pill tone (same family as the manuscript/canonical
 *  bib pills). */
export function BibImportedPill() {
  return <Pill label="✓ imp" tone="blue" title="Bibliography imported into master.bib" />;
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
}: {
  pdfPresent: boolean;
  indexed: IndexedState;
  bib: BibAuthState;
  /** When true, appends a blue "imported" pill after the bib pill. */
  bibImported?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
      <PdfPill present={pdfPresent} />
      <IndexedPill state={indexed} />
      <BibPill state={bib} />
      {bibImported && <BibImportedPill />}
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
        borderRadius: 999,
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
      <Dot tone={indexedTone[indexed]} title={`indexed: ${indexed}`} />
      <Dot tone={bibTone[bib]} title={`bib: ${bib}`} />
    </span>
  );
}
