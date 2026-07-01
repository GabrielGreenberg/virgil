"use client";

import { useState } from "react";
import type { PgmarkPages } from "@library/hooks/usePgmarkPages";

/** `[label] / count` printed-page selector — seeds the input with the current
 *  page label, jumps to the typed LABEL on Enter / go. Renders nothing for
 *  pgmark-less papers (DOCX / plain-tex). The page COUNT is `pages.length`; the
 *  input matches the literal printed-page LABEL (not a 1..N ordinal).
 *
 *  Two hosts render it, both fed the shared `PgmarkPages` derivation owned by
 *  RightDetail (F#11): PaperHeader col-3 (PDF mode) and the EditorPane in-card
 *  chrome band (text mode, threaded through `PaperReader` → EditorPane's generic
 *  `chromeHeaderTrailing` slot so the selector sits inline with the paragraph
 *  back/forward nav). `narrow` drops the leading "p." on tight panels. */
export default function PagePicker({
  pages,
  narrow = false,
}: {
  pages: PgmarkPages;
  narrow?: boolean;
}) {
  const { pages: marks, currentLabel, scrollToPage } = pages;
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // No anchors → nothing to pick.
  if (marks.length === 0) return null;

  const shown = editing ? (draft ?? "") : (currentLabel ?? "");
  const commit = () => {
    if (draft != null && draft.trim()) scrollToPage(draft.trim());
    setEditing(false);
    setDraft(null);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--muted)",
        flexShrink: 0,
      }}
      title="Jump to a printed page"
    >
      {!narrow && <span aria-hidden="true">p.</span>}
      <input
        type="text"
        value={shown}
        onFocus={() => {
          setEditing(true);
          setDraft(currentLabel ?? "");
        }}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(null);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label="Go to printed page"
        style={{
          width: 40,
          padding: "2px 4px",
          fontFamily: "var(--mono)",
          fontSize: 11,
          textAlign: "center",
          color: "var(--foreground)",
          background: "var(--surface)",
          border: "1px solid var(--border-light)",
          borderRadius: 4,
          outline: "none",
        }}
      />
      <span aria-hidden="true">/ {marks.length}</span>
    </div>
  );
}
