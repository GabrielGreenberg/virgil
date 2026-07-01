"use client";

/**
 * BibEntryChrome — the leaf-pure header stack for a library-backed
 * bibliography entry, lifted from the editor's `BibEntryCard` header
 * (`src/components/BibEntryCard.tsx`, the "text → libraries → status" layer
 * stack). It renders ONLY the header layers — no PanelCard, useCardTheme,
 * popout, AnnotationEditor, or atom plumbing — so it's pure and reusable.
 *
 * Three stacked layers (matching BibEntryCard top→bottom):
 *   1. Structured headline: `{author bold} · {year bold} · {title italic}`,
 *      with a subtle drag handle (grab cursor) and a "more"/"less" toggle that
 *      reveals the full APA-formatted citation.
 *   2. Library membership chips (`<LibraryMembershipChips>`) — renders nothing
 *      when empty.
 *   3. Status row (`<LibraryStatusRow>`) — the ✓Authenticated chip + the
 *      index-tier chip + the shared `<OpenEntryLink>` (the F#9 "open in a new
 *      tab" link, gated by `showOpenLink`).
 *
 * F#11 consumes this from `PaperHeader`; the editor Bibliography panel adopts
 * it as the single source in a later fast-follow (deferred).
 */

import { useState } from "react";
import type {
  LibraryBibState,
  LibraryIndexTier,
} from "@/lib/library/library-types";
import { LibraryStatusRow } from "./library-entry-status";
import {
  LibraryMembershipChips,
  type ProvenanceChip,
} from "./provenance-chips";
import { attachClampedDragGhost } from "@/lib/drag-ghost";
import {
  ENTRY_DT_TYPE,
  ENTRIES_DT_TYPE,
} from "@library/lib/dnd-types";

export interface BibEntryChromeProps {
  citekey: string;
  /** Structured headline parts. */
  author?: string;
  year?: string;
  title?: string;
  /** `formatBibliography(bib, "apa")` HTML — revealed under "more". When
   *  absent, the "more" toggle is hidden. Trusted the same way PaperHeader
   *  trusts it today (rendered via dangerouslySetInnerHTML into a
   *  `.library-bib-formatted` block). */
  apaHtml?: string;
  /** Processing tier (from `mapTier(entry.indexed.state)`). */
  indexTier?: LibraryIndexTier;
  /** Bib-auth state (= `entry.bib.state`). */
  bibState?: LibraryBibState;
  /** True for a real catalog entry — keeps the tier/✓ chips rendering. */
  inLibrary: boolean;
  /** Custom-library membership chips (from `membershipChipsFor(...)`). */
  membershipChips: ProvenanceChip[];
  /** Whether to surface the `<OpenEntryLink>` "open in a new tab" link.
   *  Hidden in the OUTER Virgil-bar tab (already a tab) — F#9. Defaults to
   *  true. Independent of `inLibrary` so the index-tier + ✓ chips still
   *  render in the outer tab; only the link is suppressed. */
  showOpenLink?: boolean;
  /** Whether to render the trailing `<LibraryStatusRow>` (index-tier chip +
   *  bib-auth chip + open link). Defaults to true (the historical behavior —
   *  every other caller keeps its status row). PaperHeader passes false: it
   *  surfaces those states full-phrase in a dedicated STATUS column, so the
   *  inline chips would be redundant. The membership chips + headline are
   *  unaffected. */
  showStatusRow?: boolean;
}

/** Subtle 6-dot grip — the drag affordance lean (grab cursor + subtle
 *  handle). Inlined (not CardDragHandle) so the hint reads "Drag to a
 *  library", not "Drag to pop out". */
function GripDots() {
  return (
    <span
      className="shrink-0 text-ink-faint"
      aria-hidden="true"
      style={{ display: "inline-flex" }}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </span>
  );
}

export function BibEntryChrome({
  citekey,
  author,
  year,
  title,
  apaHtml,
  indexTier,
  bibState,
  inLibrary,
  membershipChips,
  showOpenLink = true,
  showStatusRow = true,
}: BibEntryChromeProps) {
  const [expanded, setExpanded] = useState(false);
  const headerText = [author, year, title].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Layer 1 — structured headline, with a grab-draggable region. */}
      <div
        className="flex items-center gap-2 min-w-0 cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          // Additive add-to-library drag — mirrors LeftListRow. The source
          // header stays put (copy semantics); custom-library NavRows already
          // accept ENTRY_DT_TYPE / ENTRIES_DT_TYPE and route to membership.
          e.dataTransfer.setData(ENTRY_DT_TYPE, citekey);
          e.dataTransfer.setData(ENTRIES_DT_TYPE, JSON.stringify([citekey]));
          e.dataTransfer.effectAllowed = "copy";
          const rowEl = e.currentTarget as HTMLElement;
          const rect = rowEl.getBoundingClientRect();
          attachClampedDragGhost({
            dragStartEvent: e,
            buildGhost: () => {
              const ghost = document.createElement("div");
              ghost.textContent = headerText || citekey;
              ghost.style.cssText =
                "max-width:320px;padding:4px 10px;background:var(--surface,#ffffff);border:1px solid var(--border-light,#d5d3ce);box-shadow:0 4px 12px rgba(0,0,0,0.18);opacity:0.92;border-radius:3px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
              return ghost;
            },
            cursorOffsetX: e.clientX - rect.left,
            cursorOffsetY: e.clientY - rect.top,
          });
        }}
        data-hint="Drag into a custom library"
        data-citekey={citekey}
      >
        <GripDots />
        <div
          className="flex-1 min-w-0 leading-snug text-[13px]"
          style={{ overflowWrap: "anywhere" }}
          data-hint={headerText}
          aria-label={headerText}
        >
          {author && <span className="font-semibold">{author}</span>}
          {author && year && (
            <span className="text-ink-muted mx-1.5">&middot;</span>
          )}
          {year && <span className="font-semibold">{year}</span>}
          {(author || year) && title && (
            <span className="text-ink-muted mx-1.5">&middot;</span>
          )}
          {title && <span className="italic">{title}</span>}
        </div>
        {apaHtml ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            draggable={false}
            onDragStart={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide full citation" : "Show full citation"}
            className="shrink-0 text-[10px] text-ink-muted hover:text-ink-body transition-colors px-1"
          >
            {expanded ? "less" : "more"}
          </button>
        ) : null}
      </div>

      {/* Expanded APA citation — trusted formatBibliography output. */}
      {expanded && apaHtml ? (
        <div
          className="library-bib-formatted pl-[18px] text-[13px] leading-relaxed"
          style={{
            fontFamily: "var(--serif)",
            color: "var(--foreground)",
            wordBreak: "break-word",
          }}
          dangerouslySetInnerHTML={{ __html: apaHtml }}
        />
      ) : null}

      {/* Layers 2 + 3 — membership chips, then verification / tier / open. */}
      <div className="flex flex-col gap-1 pl-[18px]">
        <LibraryMembershipChips chips={membershipChips} />
        {showStatusRow && (
          <LibraryStatusRow
            indexTier={indexTier}
            bibState={bibState}
            citekey={citekey}
            inLibrary={inLibrary && showOpenLink}
          />
        )}
      </div>
    </div>
  );
}

export default BibEntryChrome;
