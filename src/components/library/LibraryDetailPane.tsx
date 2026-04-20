"use client";

import { useEffect, useState } from "react";
import { readItemMeta, readItemText } from "@/lib/library/library-item";
import type {
  LibraryIndexItem,
  LibraryItemMeta,
  LibraryText,
} from "@/lib/library/library-types";

interface Props {
  /** Library folder handle. Passed down so we don't re-resolve. */
  libraryHandle: FileSystemDirectoryHandle;
  /** The item to render — comes from the manifest. */
  item: LibraryIndexItem;
  /** Notes scoped to the current document. */
  notes: string;
  onNotesChange: (notes: string) => void;
  /** Invalidation key — bumps when the manifest revision changes so we
   *  re-read per-item files after Cowork writes updates. */
  revision: number;
}

export function LibraryDetailPane({
  libraryHandle,
  item,
  notes,
  onNotesChange,
  revision,
}: Props) {
  const [meta, setMeta] = useState<LibraryItemMeta | null>(null);
  const [text, setText] = useState<LibraryText | null>(null);
  const [textErr, setTextErr] = useState<string | null>(null);

  // Read per-item files whenever the selected item or the manifest
  // revision changes. For "not ready" items we don't bother reading
  // text.json; the status message will render instead.
  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setText(null);
    setTextErr(null);
    readItemMeta(libraryHandle, item.id)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {});
    if (item.status === "ready") {
      readItemText(libraryHandle, item.id)
        .then((t) => {
          if (cancelled) return;
          if (!t) setTextErr("text.json not found");
          else setText(t);
        })
        .catch((e) => {
          if (!cancelled) setTextErr(String(e));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [libraryHandle, item.id, item.status, revision]);

  const title = item.title || meta?.title || "Untitled";
  const authors = item.authors ?? meta?.authors ?? [];
  const year = item.year ?? meta?.year;
  const citekey = item.citekey ?? meta?.citekey;
  const doi = item.doi ?? meta?.doi;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-4 border-b border-edge-hover">
        <div className="text-base font-semibold text-ink-strong leading-snug">
          {title}
        </div>
        <div className="text-xs text-ink-muted mt-1">
          {authors.length > 0 ? authors.join(", ") : "Unknown author"}
          {year != null ? <> · {year}</> : null}
          {citekey ? <> · <span className="font-mono">{citekey}</span></> : null}
        </div>
        {doi ? (
          <div className="text-[11px] text-ink-muted mt-1">DOI {doi}</div>
        ) : null}
        {meta?.abstract ? (
          <p className="text-xs text-ink-body mt-2 leading-relaxed">
            {meta.abstract}
          </p>
        ) : null}
      </div>

      <div className="px-5 py-3 border-b border-edge-hover">
        <div className="text-[11px] text-ink-muted uppercase tracking-wide mb-1.5">
          Notes for this document
        </div>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Thoughts, reminders, or a brief for this source…"
          className="w-full text-xs bg-surface/50 border border-edge-hover rounded px-2 py-1.5 focus:outline-none focus:border-[var(--accent)] resize-y min-h-[64px] font-sans"
          rows={3}
        />
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {item.status !== "ready" ? (
          <ReadyState item={item} />
        ) : textErr ? (
          <div className="text-xs text-red-600">{textErr}</div>
        ) : !text ? (
          <div className="text-xs text-ink-muted">Loading text…</div>
        ) : (
          <LibraryTextPreview text={text} />
        )}
      </div>
    </div>
  );
}

function ReadyState({ item }: { item: LibraryIndexItem }) {
  switch (item.status) {
    case "pending":
      return (
        <p className="text-xs text-ink-muted">
          Waiting for Cowork to begin processing this PDF.
        </p>
      );
    case "extracting":
      return (
        <p className="text-xs text-ink-muted">
          Extracting text from the PDF…
        </p>
      );
    case "ocring":
      return (
        <p className="text-xs text-ink-muted">
          Running OCR on scanned pages…
        </p>
      );
    case "failed":
      return (
        <p className="text-xs text-red-600">
          Cowork couldn&apos;t process this file. Check its status.json for
          diagnostic details.
        </p>
      );
    default:
      return null;
  }
}

function LibraryTextPreview({ text }: { text: LibraryText }) {
  if (text.pages.length === 0) {
    return <div className="text-xs text-ink-muted">No pages extracted.</div>;
  }
  return (
    <div className="space-y-5 text-[13px] leading-relaxed text-ink-body font-serif">
      {text.pages.map((page, idx) => (
        <section key={`${page.pdfPage}-${idx}`} aria-label={`Page ${page.printPage}`}>
          <div className="sticky top-0 bg-[var(--background)]/95 backdrop-blur py-1 text-[10px] font-sans uppercase tracking-wider text-ink-muted border-b border-edge-hover/60 mb-2">
            Page {page.printPage}
            {page.printPageMissing ? (
              <span className="ml-2 normal-case tracking-normal text-[10px]">
                (pdf {page.pdfPage})
              </span>
            ) : null}
          </div>
          <div className="space-y-2">
            {page.paragraphs.map((p) => (
              <p
                key={p.id}
                className={
                  p.kind === "heading"
                    ? "font-semibold text-ink-strong"
                    : p.kind === "caption"
                      ? "text-[12px] text-ink-muted italic"
                      : p.kind === "footnote"
                        ? "text-[12px] text-ink-muted border-l-2 border-edge-hover pl-2"
                        : ""
                }
              >
                {p.text}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
