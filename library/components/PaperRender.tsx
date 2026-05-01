"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { readTextFile } from "@library/lib/library-storage";
import { parseLatex } from "@library/lib/latex-parser";
import {
  cancelPaperReview,
  cancelRichIndex,
  queueBibReview,
  queuePaperReview,
  queueRichIndex,
  readPaperReviewState,
  readRichIndexState,
} from "@library/lib/bib-edit";
import type { IndexedState } from "@library/lib/catalog";
import { AiNotePanel } from "./BibCard";
import {
  InlineMath,
  DisplayMath,
  Footnote,
  LatexComment,
  Citation,
  LabelRef,
  LatexCommandMark,
  TitleField,
  MaketitleMarker,
  EmptyParagraphTitleCleaner,
  LinkedAnchor,
  LinkedAnchorGuard,
  PgMarkChip,
} from "@library/tiptap";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
  indexedState: IndexedState;
}

type AiScope = "paper" | "bib";

export default function PaperRender({ handle, citekey, indexedState }: Props) {
  const [tex, setTex] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const isIndexed = indexedState === "indexed" || indexedState === "richIndexed";

  useEffect(() => {
    setTex(null);
    setParseError(null);
    if (!handle || !citekey || !isIndexed) return;
    let cancelled = false;
    (async () => {
      const t = await readTextFile(handle, `papers/${citekey}/main.tex`);
      if (!cancelled) setTex(t ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, citekey, isIndexed]);

  if (!citekey) return null;

  if (!isIndexed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <RichIndexCheckbox handle={handle} citekey={citekey} indexedState={indexedState} />
        <div
          style={{
            padding: 16,
            background: "var(--surface)",
            border: "var(--pod-border)",
            borderRadius: "var(--pod-radius)",
            color: "var(--muted)",
            fontStyle: "italic",
          }}
        >
          This paper hasn&apos;t been indexed yet. Run <code>/index-pending</code> in
          a Claude session to index queued papers.
        </div>
      </div>
    );
  }

  if (tex === null) {
    return (
      <div style={{ padding: 16, color: "var(--muted)" }}>
        Loading <code>papers/{citekey}/main.tex</code>…
      </div>
    );
  }

  if (tex === "") {
    return (
      <div style={{ padding: 16, color: "var(--muted)" }}>
        <code>papers/{citekey}/main.tex</code> is empty.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PaperAiRequestBar handle={handle} citekey={citekey} indexedState={indexedState} />
      <PaperEditor tex={tex} onParseError={setParseError} parseError={parseError} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// AI request bar — sits above the rendered paper. Lets the user file an
// AI request scoped to either the bib entry or the paper text itself.
// ────────────────────────────────────────────────────────────────────────

interface PaperAiRequestBarProps {
  handle: FileSystemDirectoryHandle | null;
  citekey: string;
  indexedState: IndexedState;
}

function PaperAiRequestBar({ handle, citekey, indexedState }: PaperAiRequestBarProps) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<AiScope>("paper");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [paperQueued, setPaperQueued] = useState(false);
  const [richQueued, setRichQueued] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const needsIndex = indexedState === "none" || indexedState === "failed";

  useEffect(() => {
    let cancelled = false;
    if (!handle) {
      setPaperQueued(false);
      setRichQueued(false);
      return;
    }
    (async () => {
      const [pr, ri] = await Promise.all([
        readPaperReviewState(handle, citekey),
        readRichIndexState(handle, citekey),
      ]);
      if (!cancelled) {
        setPaperQueued(!!pr);
        setRichQueued(!!ri);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, citekey]);

  const flashFor = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2400);
  };

  const handleClick = () => {
    if (busy || !handle) return;
    if (paperQueued) {
      void doCancel();
      return;
    }
    setNote("");
    setScope("paper");
    setOpen(true);
  };

  const doCancel = async () => {
    if (!handle) return;
    setBusy(true);
    try {
      await cancelPaperReview(handle, citekey);
      setPaperQueued(false);
      flashFor("cancelled");
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!handle || busy) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) {
      flashFor("note required");
      return;
    }
    setBusy(true);
    try {
      if (scope === "bib") {
        await queueBibReview(handle, citekey, trimmed);
      } else {
        await queuePaperReview(handle, citekey, trimmed);
        setPaperQueued(true);
      }
      setOpen(false);
      setNote("");
      flashFor("queued ✓");
    } catch (e) {
      flashFor(`failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleRichIndex = async () => {
    if (!handle || busy) return;
    setBusy(true);
    try {
      if (richQueued) {
        await cancelRichIndex(handle, citekey);
        setRichQueued(false);
        flashFor("cancelled");
      } else {
        await queueRichIndex(handle, citekey, undefined, needsIndex);
        setRichQueued(true);
        flashFor(needsIndex ? "queued (will index first)" : "queued");
      }
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = busy
    ? (paperQueued ? "Cancelling…" : "Submitting…")
    : paperQueued
      ? "AI request queued"
      : "AI request";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontFamily: "var(--sans, inherit)",
            cursor: !handle || busy ? "not-allowed" : "pointer",
            opacity: !handle || busy ? 0.6 : 1,
            color: richQueued ? "var(--accent)" : "var(--foreground)",
          }}
          title={
            richQueued
              ? "Click to cancel the queued rich-index request"
              : needsIndex
                ? "Queue rich indexing (will index first, then apply structural cleanup)"
                : "Queue rich indexing (structural cleanup of extracted text)"
          }
        >
          <input
            type="checkbox"
            checked={richQueued}
            onChange={toggleRichIndex}
            disabled={!handle || busy}
            style={{ accentColor: "var(--accent)" }}
          />
          Rich index{needsIndex && !richQueued ? " (will index first)" : ""}
        </label>
        <button
          type="button"
          onClick={handleClick}
          disabled={!handle || busy}
          aria-pressed={paperQueued}
          title={
            paperQueued
              ? "Click to cancel the queued paper-text AI request"
              : "Click to write a note and queue an AI request for this paper"
          }
          style={{
            background: paperQueued ? "var(--accent)" : "transparent",
            color: paperQueued ? "white" : "var(--foreground)",
            border: paperQueued ? "1px solid var(--accent)" : "1px solid var(--border-light)",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 11,
            fontFamily: "var(--sans, inherit)",
            cursor: !handle || busy ? "not-allowed" : "pointer",
            opacity: !handle || busy ? 0.6 : 1,
          }}
        >
          ★ {buttonLabel}
        </button>
        {flash && (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--accent, var(--muted))",
            }}
          >
            {flash}
          </span>
        )}
      </div>
      {open && (
        <AiNotePanel
          title={`AI request — ${scope === "bib" ? "bibliographic entry" : "paper text"}`}
          placeholder={
            scope === "bib"
              ? 'e.g. "Find the missing DOI", "Re-verify the publisher and year".'
              : 'e.g. "Section 3 was cut off mid-sentence — re-extract it", "Footnote 12 is attached to the wrong word", "Re-do the linearization, this paper has a two-column layout".'
          }
          value={note}
          onChange={setNote}
          onSubmit={doSubmit}
          onCancel={() => {
            setOpen(false);
            setNote("");
          }}
          busy={busy}
          extraHeader={
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                Scope:
              </span>
              <ScopePill active={scope === "paper"} onClick={() => setScope("paper")}>
                paper text
              </ScopePill>
              <ScopePill active={scope === "bib"} onClick={() => setScope("bib")}>
                bib entry
              </ScopePill>
            </div>
          }
        />
      )}
    </div>
  );
}

// Standalone rich-index checkbox for un-indexed papers (no AI request bar).
function RichIndexCheckbox({
  handle,
  citekey,
  indexedState,
}: {
  handle: FileSystemDirectoryHandle | null;
  citekey: string;
  indexedState: IndexedState;
}) {
  const [richQueued, setRichQueued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const needsIndex = indexedState === "none" || indexedState === "failed";

  useEffect(() => {
    let cancelled = false;
    if (!handle) { setRichQueued(false); return; }
    (async () => {
      const ri = await readRichIndexState(handle, citekey);
      if (!cancelled) setRichQueued(!!ri);
    })();
    return () => { cancelled = true; };
  }, [handle, citekey]);

  const flashFor = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2400);
  };

  const toggle = async () => {
    if (!handle || busy) return;
    setBusy(true);
    try {
      if (richQueued) {
        await cancelRichIndex(handle, citekey);
        setRichQueued(false);
        flashFor("cancelled");
      } else {
        await queueRichIndex(handle, citekey, undefined, needsIndex);
        setRichQueued(true);
        flashFor(needsIndex ? "queued (will index first)" : "queued");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          fontFamily: "var(--sans, inherit)",
          cursor: !handle || busy ? "not-allowed" : "pointer",
          opacity: !handle || busy ? 0.6 : 1,
          color: richQueued ? "var(--accent)" : "var(--foreground)",
        }}
        title={
          richQueued
            ? "Click to cancel the queued rich-index request"
            : "Queue rich indexing (will index first, then apply structural cleanup)"
        }
      >
        <input
          type="checkbox"
          checked={richQueued}
          onChange={toggle}
          disabled={!handle || busy}
          style={{ accentColor: "var(--accent)" }}
        />
        Rich index (will index first)
      </label>
      {flash && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--accent, var(--muted))",
          }}
        >
          {flash}
        </span>
      )}
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "white" : "var(--foreground)",
        border: active ? "1px solid var(--accent)" : "1px solid var(--border-light)",
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 11,
        fontFamily: "var(--sans, inherit)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

interface PaperEditorProps {
  tex: string;
  parseError: string | null;
  onParseError: (err: string | null) => void;
}

function PaperEditor({ tex, parseError, onParseError }: PaperEditorProps) {
  const [content, setContent] = useState<unknown>(null);

  useEffect(() => {
    try {
      const doc = parseLatex(tex);
      setContent(doc);
      onParseError(null);
    } catch (e) {
      onParseError(e instanceof Error ? e.message : String(e));
      setContent(null);
    }
  }, [tex, onParseError]);

  const editor = useEditor(
    {
      // Mirrors a subset of Virgil's Editor.tsx mount. Read-only for now;
      // editability of the indexed paper is a Phase 4+ concern.
      editable: false,
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          dropcursor: false,
        }),
        InlineMath,
        DisplayMath,
        Footnote,
        LatexComment,
        Citation,
        LabelRef,
        LatexCommandMark,
        TitleField,
        MaketitleMarker,
        EmptyParagraphTitleCleaner,
        LinkedAnchor,
        LinkedAnchorGuard,
        PgMarkChip,
      ],
      content: (content as never) ?? { type: "doc", content: [{ type: "paragraph" }] },
    },
    [content],
  );

  if (parseError) {
    return (
      <div
        style={{
          padding: 16,
          background: "var(--pill-red-bg)",
          color: "var(--pill-red-fg)",
          borderRadius: 6,
          fontFamily: "var(--mono)",
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        Parse error: {parseError}
      </div>
    );
  }

  if (!editor || !content) {
    return <div style={{ padding: 16, color: "var(--muted)" }}>Rendering…</div>;
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "var(--pod-border)",
        borderRadius: "var(--pod-radius)",
        boxShadow: "var(--pod-shadow)",
      }}
    >
      <EditorContent editor={editor} className="paper-render" />
    </div>
  );
}
