"use client";

/**
 * A bibliography row, open (Gabriel, 2026-11-08: "more compact and more
 * intuitive"). Top to bottom:
 *
 *   ⌄ the reference, as it will print
 *     PDF ↗ (when the library holds the paper) · citekey ⧉ ·       ● Verified
 *   ─ Cited in                                                ‹ n / N ›
 *     §2  the citing sentence, the citation in bold   (current one tinted)
 *     Note: the entry's annotation
 *     Edit entry · Note · Check with Claude
 *
 * The citation stepping lives here, not on the row. The foot's three buttons
 * each open ONE part of the entry's own card (`BibEntryCard`'s `section`), so
 * the BibTeX fields stay out of sight until asked for. The sentences are read
 * from the live doc when the view opens; nothing here runs per keystroke.
 */

import { useMemo, useState, type ReactNode } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { BibEntry } from "@/lib/types";
import { Button } from "@/components/Button";
import { iconHint } from "@/components/Hint";
import { LibraryStatusWord } from "@/components/library/library-entry-status";
import { useLibraryItems } from "@/hooks/useLibrary";
import { useCopyFlash } from "@/hooks/useCopyFlash";
import { openLibraryPdf, type OpenPdfResult } from "@/lib/library/open-library-pdf";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { useCitationDisplayContextOrNull } from "../contexts/citation-display";
import { LeadingClose, Snippet } from "./GutterList";
import { readableInline } from "./gutter-rows";
import {
  sectionIndexAt,
  type GutterCardRef,
  type GutterCitation,
  type GutterListRow,
  type GutterSectionHead,
} from "./gutter-lists";

type Section = "fields" | "notes" | "review";

const SECTION_LABEL: Record<Section, string> = {
  fields: "Edit entry",
  notes: "Note",
  review: "Check with Claude",
};

const PDF_PROBLEM: Record<Exclude<OpenPdfResult, "opened">, string> = {
  missing: "The library has no PDF for this paper.",
  unreadable: "Couldn't read the PDF from the library folder.",
  blocked: "The browser blocked the new window.",
};

export interface BibOpenViewProps {
  row: GutterListRow;
  bibKey: string;
  close: () => void;
  citationIds: readonly string[];
  /** The citation the list is pointing at, by IDENTITY (null: none yet). Its
   *  position in `citationIds` is derived here from the live list, so an
   *  inserted or deleted cite cannot shift it onto another (task 1573). */
  current: string | null;
  /** Jump to citation `id` and make it current. */
  goTo: (id: string, el: HTMLElement | null) => void;
  cites: readonly GutterCitation[];
  bibEntries: readonly BibEntry[];
  sections: readonly GutterSectionHead[];
  /** The doc `cites` and `sections` were read from — ONE snapshot, never the
   *  live doc beside positions read earlier (task 1570). */
  doc: PMNode | null;
  annotation?: string;
  /** One part of the entry's own card. */
  renderSection: (card: GutterCardRef) => ReactNode;
}

export function BibOpenView(p: BibOpenViewProps) {
  const display = useCitationDisplayContextOrNull();
  const { items: libraryItems } = useLibraryItems();
  const lib = useMemo(() => libraryItems.find((i) => i.citekey === p.bibKey), [libraryItems, p.bibKey]);
  const hasPdf = !!lib && lib.indexTier !== undefined && lib.indexTier !== "bib-only";
  const { copied, copy } = useCopyFlash();
  const [section, setSection] = useState<Section | null>(null);
  const [pdfProblem, setPdfProblem] = useState<string | null>(null);

  const lines = useMemo(() => {
    if (!p.doc) return [];
    const posOf = new Map(p.cites.map((c) => [c.citationId, c.pos]));
    return p.citationIds.flatMap((id) => {
      const pos = posOf.get(id);
      if (pos == null) return [];
      const s = sectionIndexAt(p.sections, pos);
      const where = s < 0 ? "" : p.sections[s].number ? `§${p.sections[s].number}` : "";
      return [{ id, where, ...sentencePartsAt(p.doc!, pos, p.bibEntries, display?.getCitationDisplayText) }];
    });
  }, [p.doc, p.cites, p.citationIds, p.sections, p.bibEntries, display]);

  const n = p.citationIds.length;
  // −1 when nothing is current OR the current citation has since been deleted.
  const at = p.current === null ? -1 : p.citationIds.indexOf(p.current);
  const step = (delta: 1 | -1, el: HTMLElement | null) => {
    if (n === 0) return;
    const next = (((Math.max(at, delta === 1 ? -1 : 0) + delta) % n) + n) % n;
    p.goTo(p.citationIds[next], el);
  };

  const openPdf = async () => {
    setPdfProblem(null);
    const r = await openLibraryPdf(p.bibKey);
    if (r !== "opened") setPdfProblem(PDF_PROBLEM[r]);
  };

  return (
    <div className="gutter-bib-open" data-bib-open={p.bibKey}>
      <div className="gutter-bib-open-head">
        <LeadingClose onClose={p.close} />
        <span className="gutter-list-main">
          <Snippet snippet={p.row.snippet} />
        </span>
      </div>

      <div className="gutter-bib-open-meta">
        {hasPdf && (
          <Button variant="warm" size="sm" className="gutter-bib-pdf" onClick={openPdf} data-hint="Open the PDF in a new window">
            PDF ↗
          </Button>
        )}
        <code className="gutter-bib-key">{p.bibKey}</code>
        <button
          type="button"
          className="iconbtn-sm"
          onClick={() => void copy(p.bibKey)}
          {...iconHint({ label: copied ? "Copied" : "Copy citekey" })}
        >
          {copied ? <CheckGlyph /> : <CopyGlyph />}
        </button>
        <span className="gutter-bib-status">
          <LibraryStatusWord state={lib?.bibState} />
        </span>
      </div>
      {pdfProblem && (
        <p className="gutter-bib-problem" role="status">
          {pdfProblem}
        </p>
      )}

      {n > 0 && (
        <div className="gutter-bib-cited">
          <div className="gutter-bib-cited-head">
            <span>Cited in</span>
            {n > 1 && (
              <span className="gutter-bib-stepper">
                <button
                  type="button"
                  className="iconbtn-sm"
                  data-gutter-act="prev"
                  onClick={(e) => step(-1, e.currentTarget)}
                  {...iconHint({ label: "Previous citation" })}
                >
                  <Caret dir="left" />
                </button>
                <span className="gutter-bib-stepper-count">
                  {at >= 0 ? at + 1 : "–"} / {n}
                </span>
                <button
                  type="button"
                  className="iconbtn-sm"
                  data-gutter-act="next"
                  onClick={(e) => step(1, e.currentTarget)}
                  {...iconHint({ label: "Next citation" })}
                >
                  <Caret dir="right" />
                </button>
              </span>
            )}
          </div>
          <ul className="gutter-bib-cited-lines">
            {lines.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="gutter-bib-cited-line hover-on-light"
                  data-current={l.id === p.current ? "" : undefined}
                  onClick={(e) => p.goTo(l.id, e.currentTarget)}
                >
                  <span className="gutter-bib-cited-where">{l.where}</span>
                  <span className="gutter-bib-cited-text">
                    {l.lead}
                    {l.before}
                    <b>{l.cite}</b>
                    {l.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.annotation?.trim() && section !== "notes" && (
        <p className="gutter-bib-note">Note: {p.annotation.trim()}</p>
      )}

      <div className="gutter-bib-foot">
        {(Object.keys(SECTION_LABEL) as Section[]).map((s) => (
          <Button
            key={s}
            variant="ghost"
            size="sm"
            aria-pressed={section === s}
            data-bib-foot={s}
            onClick={() => setSection((cur) => (cur === s ? null : s))}
          >
            {SECTION_LABEL[s]}
          </Button>
        ))}
      </div>
      {section && <div className="gutter-bib-section">{p.renderSection({ kind: "bib", key: p.bibKey, section })}</div>}
    </div>
  );
}

/** The sentence around the citation at `pos`, split so the citation can be
 *  bold. A citation inside a footnote reads as the footnote's opening words. */
export function sentencePartsAt(
  doc: PMNode,
  pos: number,
  bibEntries: readonly BibEntry[],
  citeText?: (command: string) => string,
): { lead: string; before: string; cite: string; after: string } {
  // `pos` must come from the read `doc` came from (the reading lists'
  // snapshot, task 1570); one from any other revision is refused, not resolved.
  if (pos < 0 || pos >= doc.content.size) return { lead: "", before: "", cite: "", after: "" };
  const at = doc.nodeAt(pos);
  if (at?.type.name === "footnote") {
    const t = readableInline(richJsonToPlainText(at.attrs.content), bibEntries).replace(/\s+/g, " ").trim();
    return { lead: "Footnote: ", before: t, cite: "", after: "" };
  }
  const leaf = (node: PMNode) =>
    node.type.name === "citation"
      ? citeText?.(node.attrs.command as string) || (node.attrs.displayText as string) || "[cite]"
      : "";
  const $pos = doc.resolve(pos);
  const start = $pos.start();
  const end = start + $pos.parent.content.size;
  const isCite = at?.type.name === "citation";
  const cite = isCite ? leaf(at!) : "";
  const before = doc.textBetween(start, pos, " ", leaf);
  const after = doc.textBetween(isCite ? Math.min(end, pos + at!.nodeSize) : pos, end, " ", leaf);
  const head = (before.split(/(?<=[.!?])\s+/).pop() ?? before).replace(/\s+/g, " ").trimStart();
  const tail = (after.split(/(?<=[.!?])\s+/)[0] ?? after).replace(/\s+/g, " ").trimEnd();
  return { lead: "", before: head, cite, after: tail };
}

function Caret({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
