"use client";

import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { computeCatalogStats, type CatalogStats } from "@library/lib/catalog-stats";
import { searchCatalogFuzzy } from "@library/lib/catalog-search";
import { IndexedPill, BibPill } from "./StatusPill";

/** How many fuzzy matches the inline palette renders before collapsing the
 *  rest behind a "Browse all N matches" footer. Keeps the dashboard light —
 *  the heavy virtualized LeftList stays unmounted until the user Browses. */
const PALETTE_CAP = 40;

interface Props {
  /** Central catalog (=== the panel's `entries`; Central isn't filtered). */
  entries: CatalogEntry[];
  /** master.bib entries, keyed by citekey. Drives both stats and search. */
  bibByKey: Map<string, BibEntry>;
  /** Display name of the library (e.g. "Central Library"). */
  libraryName: string;
  /** Open a paper by citekey (mounts the reader in the opposite panel). */
  onOpenPaper: (citekey: string) => void;
  /** Switch to the full virtualized list view. */
  onBrowse: () => void;
  /** Pre-fill the list's search query, then switch to list view. Used by the
   *  palette's "Browse all N matches" footer. */
  onBrowseWithQuery: (query: string) => void;
}

export default function LibraryCentralDashboard({
  entries,
  bibByKey,
  libraryName,
  onOpenPaper,
  onBrowse,
  onBrowseWithQuery,
}: Props) {
  // Stats recompute only when the catalog array identity changes (the 6 s poll
  // mints a fresh array on real change; a keystroke never touches it).
  const stats = useMemo(
    () => computeCatalogStats(entries, bibByKey),
    [entries, bibByKey],
  );

  // Search: the input reflects every keystroke immediately; the (capped) fuzzy
  // scan catches up on a deferred, low-priority render.
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const { results, matchCount } = useMemo(() => {
    if (!trimmed) return { results: [] as CatalogEntry[], matchCount: 0 };
    // Search uncapped to learn the true match count, then slice for display.
    // The WeakMap-cached synth index makes the repeat scans cheap.
    const all = searchCatalogFuzzy(entries, bibByKey, deferredQuery);
    return { results: all.slice(0, PALETTE_CAP), matchCount: all.length };
  }, [entries, bibByKey, deferredQuery, trimmed]);

  const searching = trimmed.length > 0;

  const summary = useMemo(() => summarize(stats), [stats]);

  // Autofocus the search box on mount without an effect.
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="lib-dashboard">
      <header className="lib-dashboard-head">
        <h2 className="lib-dashboard-title">{libraryName}</h2>
        <p className="lib-dashboard-summary">{summary}</p>
      </header>

      <div className="lib-dashboard-searchrow">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library — title, author, citekey…"
          className="lib-dashboard-search"
          aria-label="Search the library"
        />
        <button
          type="button"
          className="lib-dashboard-browsebtn"
          onClick={onBrowse}
        >
          Browse all →
        </button>
      </div>

      {searching ? (
        <SearchPalette
          results={results}
          matchCount={matchCount}
          bibByKey={bibByKey}
          query={deferredQuery}
          onOpenPaper={onOpenPaper}
          onBrowseAll={() => onBrowseWithQuery(query)}
        />
      ) : (
        <StatsGrid stats={stats} />
      )}
    </div>
  );
}

// ── Stats grid ──────────────────────────────────────────────────────────

function StatsGrid({ stats }: { stats: CatalogStats }) {
  return (
    <div className="lib-dashboard-scroll">
      <Section title="Library size">
        <StatCard
          value={stats.bibEntries}
          label="Bibliography"
          sub="references in master.bib"
        />
        <StatCard
          value={stats.totalSources}
          label="Sources"
          sub="papers & files tracked"
        />
        <StatCard
          value={stats.indexed}
          label="Indexed"
          sub={`of ${fmt(stats.totalSources)} sources`}
        />
        <StatCard
          value={stats.deepIndexed}
          label="Deep-indexed"
          sub={`of ${fmt(stats.indexed)} indexed`}
        />
      </Section>

      <Section title="Bibliography health">
        <StatCard
          value={stats.verifiedTerminal}
          label="Verified"
          pill={<IndexedPillNeutral tone="green" text="✓ no action" />}
        />
        <StatCard
          value={stats.authenticated}
          label="Authenticated"
          sub="checked against sources"
        />
        <StatCard
          value={stats.bibNeedsAction}
          label="Needs action"
          pill={
            <IndexedPillNeutral
              tone={stats.bibNeedsAction > 0 ? "amber" : "gray"}
              text={stats.bibNeedsAction > 0 ? "⋯ review" : "— clear"}
            />
          }
        />
      </Section>

      <Section title="Pipeline">
        <StatCard
          value={stats.queuedOrRunning}
          label="In progress"
          pill={
            <IndexedPillNeutral
              tone={stats.queuedOrRunning > 0 ? "amber" : "gray"}
              text={stats.queuedOrRunning > 0 ? "⋯ running" : "— idle"}
            />
          }
        />
        <StatCard
          value={stats.failedIndex}
          label="Failed"
          pill={
            <IndexedPillNeutral
              tone={stats.failedIndex > 0 ? "red" : "gray"}
              text={stats.failedIndex > 0 ? "! retry" : "— none"}
            />
          }
        />
        <StatCard
          value={stats.unsorted}
          label="Unsorted"
          sub="awaiting triage"
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="lib-dashboard-section">
      <h3 className="lib-dashboard-section-title">{title}</h3>
      <div className="lib-dashboard-grid">{children}</div>
    </section>
  );
}

function StatCard({
  value,
  label,
  sub,
  pill,
}: {
  value: number;
  label: string;
  sub?: string;
  pill?: React.ReactNode;
}) {
  return (
    <div className="lib-dashboard-card">
      <div className="lib-dashboard-card-value">{fmt(value)}</div>
      <div className="lib-dashboard-card-label">{label}</div>
      {pill ? (
        <div className="lib-dashboard-card-pill">{pill}</div>
      ) : sub ? (
        <div className="lib-dashboard-card-sub">{sub}</div>
      ) : null}
    </div>
  );
}

/** A bare 5-tone pill for the dashboard cards (reuses the pill CSS vars; the
 *  StatusPill module's pills are status-specific, so this is the generic
 *  variant for the dashboard's own ✓/⋯/!/— glyph labels). */
function IndexedPillNeutral({
  tone,
  text,
}: {
  tone: "green" | "amber" | "red" | "gray" | "blue";
  text: string;
}) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    background: `var(--pill-${tone}-bg)`,
    color: `var(--pill-${tone}-fg)`,
    fontSize: 11,
    lineHeight: "16px",
    padding: "1px 6px",
    borderRadius: 999,
    fontFamily: "var(--mono)",
    whiteSpace: "nowrap",
  };
  return <span style={style}>{text}</span>;
}

// ── Search palette ────────────────────────────────────────────────────────

function SearchPalette({
  results,
  matchCount,
  bibByKey,
  query,
  onOpenPaper,
  onBrowseAll,
}: {
  results: CatalogEntry[];
  matchCount: number;
  bibByKey: Map<string, BibEntry>;
  query: string;
  onOpenPaper: (citekey: string) => void;
  onBrowseAll: () => void;
}) {
  if (matchCount === 0) {
    return (
      <div className="lib-dashboard-scroll">
        <div className="lib-dashboard-empty">
          No papers match “{query.trim()}”.
        </div>
      </div>
    );
  }
  const overflow = matchCount - results.length;
  return (
    <div className="lib-dashboard-scroll">
      <div className="lib-dashboard-palette" aria-label="Search results">
        {results.map((e) => (
          <PaletteRow
            key={e.citekey ?? `__triage__${e.originalFilename}`}
            entry={e}
            bib={e.citekey ? bibByKey.get(e.citekey) : undefined}
            onOpen={onOpenPaper}
          />
        ))}
      </div>
      <div className="lib-dashboard-palette-foot">
        <span>
          {fmt(matchCount)} {matchCount === 1 ? "match" : "matches"}
          {overflow > 0 ? ` · showing first ${fmt(results.length)}` : ""}
        </span>
        {overflow > 0 ? (
          <button
            type="button"
            className="lib-dashboard-browseall"
            onClick={onBrowseAll}
          >
            Browse all {fmt(matchCount)} matches →
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaletteRow({
  entry,
  bib,
  onOpen,
}: {
  entry: CatalogEntry;
  bib: BibEntry | undefined;
  onOpen: (citekey: string) => void;
}) {
  const title =
    bib?.fields.title ?? entry.title ?? entry.originalFilename ?? "(untitled)";
  const author = firstAuthor(entry, bib);
  const year = bib?.fields.year ?? (entry.year != null ? String(entry.year) : "");
  const ck = entry.citekey;
  const disabled = !ck;

  return (
    <button
      type="button"
      className="lib-dashboard-palette-row"
      disabled={disabled}
      onClick={() => ck && onOpen(ck)}
      title={`${title}${author ? ` — ${author}` : ""}${year ? ` (${year})` : ""}`}
    >
      <span className="lib-dashboard-row-year">{year || "—"}</span>
      <span className="lib-dashboard-row-author">{author || "—"}</span>
      <span className="lib-dashboard-row-title">{title}</span>
      <span className="lib-dashboard-row-status">
        <IndexedPill state={entry.indexed.state} />
        <BibPill state={entry.bib.state} />
      </span>
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Comma-grouped integer (e.g. 4876 → "4,876"). */
function fmt(n: number): string {
  return n.toLocaleString();
}

/** One-line honest summary: bib refs · indexed papers (the count that
 *  resolves the "is it capped?" confusion — labels are distinct). */
function summarize(s: CatalogStats): string {
  const parts: string[] = [];
  parts.push(`${fmt(s.bibEntries)} references`);
  parts.push(`${fmt(s.indexed)} indexed papers`);
  if (s.unsorted > 0) parts.push(`${fmt(s.unsorted)} unsorted`);
  return parts.join(" · ");
}

/** Compact first-author surname for a palette row. Mirrors LeftListRow. */
function firstAuthor(entry: CatalogEntry, bib: BibEntry | undefined): string {
  let raw = "";
  let total = 0;
  if (bib?.fields.author) {
    const parts = bib.fields.author.split(" and ");
    raw = parts[0];
    total = parts.length;
  } else if (entry.authors && entry.authors.length > 0) {
    raw = entry.authors[0];
    total = entry.authors.length;
  }
  raw = raw.trim();
  if (!raw) return "";
  let surname: string;
  if (raw.includes(",")) surname = raw.split(",", 1)[0].trim();
  else {
    const words = raw.split(/\s+/);
    surname = words[words.length - 1];
  }
  return total > 1 ? `${surname} et al.` : surname;
}
