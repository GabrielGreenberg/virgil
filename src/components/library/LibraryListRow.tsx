"use client";

import type {
  CitationAlignment,
  LibraryIndexItem,
} from "@/lib/library/library-types";

interface Props {
  item: LibraryIndexItem;
  selected: boolean;
  alignment: CitationAlignment;
  onSelect: () => void;
}

function statusLabel(status: LibraryIndexItem["status"]): string {
  switch (status) {
    case "ready":
      return "ready";
    case "pending":
      return "pending";
    case "extracting":
      return "extracting…";
    case "ocring":
      return "OCR…";
    case "failed":
      return "failed";
  }
}

function statusClass(status: LibraryIndexItem["status"]): string {
  switch (status) {
    case "ready":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    case "pending":
    case "extracting":
    case "ocring":
      return "bg-amber-50 text-amber-700 border-amber-200";
  }
}

function alignmentLabel(a: CitationAlignment): string {
  switch (a) {
    case "cited-here":
      return "cited here";
    case "not-in-bib":
      return "not in bib";
    case "unresolved":
      return "no citekey";
  }
}

function alignmentClass(a: CitationAlignment): string {
  switch (a) {
    case "cited-here":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "not-in-bib":
      return "bg-stone-50 text-ink-muted border-edge-hover";
    case "unresolved":
      return "bg-stone-50 text-ink-muted border-edge-hover";
  }
}

export function LibraryListRow({ item, selected, alignment, onSelect }: Props) {
  const title = item.title?.trim() || "Untitled";
  const authors =
    item.authors && item.authors.length > 0
      ? item.authors.length > 3
        ? `${item.authors.slice(0, 3).join(", ")} et al.`
        : item.authors.join(", ")
      : "Unknown author";
  const year = item.year ?? "—";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-library-item={item.id}
      className={`w-full text-left px-3 py-2 border-b border-edge-hover/60 transition-colors ${
        selected
          ? "bg-[var(--accent-light)] text-ink-strong"
          : "hover-on-dark text-ink-body"
      }`}
    >
      <div className="text-sm font-medium leading-snug line-clamp-2">
        {title}
      </div>
      <div className="text-[11px] text-ink-muted mt-0.5 truncate">
        {authors} · {year}
        {item.citekey ? <> · <span className="font-mono">{item.citekey}</span></> : null}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <span
          className={`text-[10px] px-1.5 py-[1px] rounded border ${statusClass(item.status)}`}
        >
          {statusLabel(item.status)}
        </span>
        <span
          className={`text-[10px] px-1.5 py-[1px] rounded border ${alignmentClass(alignment)}`}
        >
          {alignmentLabel(alignment)}
        </span>
      </div>
    </button>
  );
}
