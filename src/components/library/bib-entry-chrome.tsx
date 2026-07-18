"use client";

/**
 * BibEntryChrome — the leaf-pure header stack for a library-backed
 * bibliography entry, lifted from the editor's `BibEntryCard` header
 * (`src/components/BibEntryCard.tsx`, the "text → libraries → status" layer
 * stack). It renders ONLY the header layers — no PanelCard, useCardTheme,
 * popout, AnnotationEditor, or atom plumbing — so it's pure and reusable.
 *
 * Three stacked layers (matching BibEntryCard top→bottom):
 *   1. Structured headline: author · year on the first line, the title on its
 *      own line beneath, with a subtle drag handle (grab cursor). The full
 *      APA-formatted citation is always shown beneath (when present).
 *   2. Library membership chips (`<LibraryMembershipChips>`) — renders nothing
 *      when empty or when `showMembershipChips` is false.
 *   3. Status row (`<LibraryStatusRow>`) — the ✓Authenticated chip + the
 *      index-tier chip + the shared `<OpenEntryLink>` (the F#9 "open in a new
 *      tab" link, gated by `showOpenLink`).
 *
 * F#11 consumes this from `PaperHeader`; the editor Bibliography panel adopts
 * it as the single source in a later fast-follow (deferred).
 */

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
  /** `formatBibliography(bib, "apa")` HTML — always rendered beneath the
   *  headline when present (no "more"/"less" toggle). Trusted the same way
   *  PaperHeader trusts it today (rendered via dangerouslySetInnerHTML into a
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
  /** Whether to render the library-membership chips (CENTRAL / custom). Defaults
   *  to true (historical behavior). PaperHeader passes false: it deliberately
   *  drops the lozenges from the paper header. */
  showMembershipChips?: boolean;
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
  /** Dedupe the headline against the APA citation. When true AND `apaHtml` is
   *  present, the structured author·year·title headline is dropped and the APA
   *  becomes the SOLE citation (the grab handle rides the APA row, so the
   *  drag-to-library affordance survives) — the APA already restates author,
   *  year, and title, so showing both repeats them. When there is no APA the
   *  structured headline still renders (there must always be a headline).
   *  Defaults to false (both are shown). */
  dedupeApaHeadline?: boolean;
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
  showMembershipChips = true,
  showOpenLink = true,
  showStatusRow = true,
  dedupeApaHeadline = false,
}: BibEntryChromeProps) {
  const headerText = [author, year, title].filter(Boolean).join(" · ");
  // When deduping and an APA citation exists, the APA IS the headline — the
  // structured author·year·title line would just repeat it.
  const apaOnly = dedupeApaHeadline && !!apaHtml;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Layer 1 — headline, with a grab-draggable region. Normally the
          structured author·year·title stack; in `apaOnly` mode the APA citation
          rides this row instead (so the drag handle stays attached to it). */}
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
                "max-width:320px;padding:4px 10px;background:var(--surface,#ffffff);border:1px solid var(--border-light,#d5d3ce);box-shadow:0 4px 12px rgba(0,0,0,0.18);opacity:0.92;border-radius:var(--radius-xs,3px);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
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
        {/* Structured author·year·title stack — or, in apaOnly mode, the APA
            citation itself, so it inherits this grab row. */}
        <div
          className="flex-1 min-w-0 leading-snug text-[13px]"
          style={{ overflowWrap: "anywhere" }}
          data-hint={headerText}
          aria-label={headerText}
        >
          {apaOnly ? (
            <div
              className="library-bib-formatted leading-relaxed"
              style={{
                fontFamily: "var(--serif)",
                color: "var(--foreground)",
                wordBreak: "break-word",
              }}
              dangerouslySetInnerHTML={{ __html: apaHtml! }}
            />
          ) : (
            <>
              {(author || year) && (
                <div className="min-w-0">
                  {author && <span className="font-semibold">{author}</span>}
                  {author && year && (
                    <span className="text-ink-muted mx-1.5">&middot;</span>
                  )}
                  {year && <span className="font-semibold">{year}</span>}
                </div>
              )}
              {title && <div className="min-w-0 italic">{title}</div>}
            </>
          )}
        </div>
      </div>

      {/* Full APA citation — trusted formatBibliography output. Rendered beneath
          the structured headline; SKIPPED in apaOnly mode, where it already
          rides Layer 1 above (else it would repeat). */}
      {!apaOnly && apaHtml ? (
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

      {/* Layers 2 + 3 — membership chips, then verification / tier / open.
          Skip the wrapper entirely when both are suppressed/empty (e.g. the
          PaperHeader passes showMembershipChips=false + showStatusRow=false)
          so no empty flex row is left behind. */}
      {((showMembershipChips && membershipChips.length > 0) || showStatusRow) && (
        <div className="flex flex-col gap-1 pl-[18px]">
          {showMembershipChips && <LibraryMembershipChips chips={membershipChips} />}
          {showStatusRow && (
            <LibraryStatusRow
              indexTier={indexTier}
              bibState={bibState}
              citekey={citekey}
              inLibrary={inLibrary && showOpenLink}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default BibEntryChrome;
