"use client";

import { useState } from "react";
import type { BibEntry } from "@library/lib/types";
import {
  ANNOTATION_FIELDS,
  CORE_FIELDS,
  IDENTIFIER_FIELDS,
  PUBLICATION_FIELDS_BY_TYPE,
  knownFieldsForType,
} from "@library/lib/bib-edit";

interface Props {
  entry: BibEntry | null;
  citekey: string | null;
  /** Open the edit modal. Parent owns modal state. */
  onEdit?: () => void;
  /** Toggle the AI request: queue it (with optional user note) if not
   *  queued, cancel it if already queued. Resolves once the
   *  queue/<citekey>.json file has been written (or removed). */
  onAIReview?: (note?: string) => Promise<void>;
  /** Whether a pending AI request currently exists in the queue. */
  aiReviewQueued?: boolean;
}

type ActionFlash = { kind: "review" | "copy"; message: string } | null;

export default function BibCard({ entry, citekey, onEdit, onAIReview, aiReviewQueued = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [flash, setFlash] = useState<ActionFlash>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [noteText, setNoteText] = useState("");

  if (!entry) {
    return (
      <div
        style={{
          padding: 16,
          background: "var(--surface)",
          border: "var(--pod-border)",
          borderRadius: "var(--pod-radius)",
          color: "var(--muted)",
        }}
      >
        {citekey ? (
          <>No <code>{citekey}</code> in <code>master.bib</code>.</>
        ) : (
          <>Select a paper to see its bibliographic entry.</>
        )}
      </div>
    );
  }

  const { fields } = entry;

  const flashFor = (ms = 2400) => (kind: "review" | "copy", message: string) => {
    setFlash({ kind, message });
    window.setTimeout(() => {
      setFlash((cur) => (cur?.kind === kind ? null : cur));
    }, ms);
  };
  const flashOnce = flashFor();

  // Two paths through the AI request button:
  //  - Already queued → cancel (no note panel).
  //  - Not queued → open the note panel; queueing happens on Submit.
  const handleReviewButton = () => {
    if (!onAIReview || reviewBusy) return;
    if (aiReviewQueued) {
      void cancelReview();
      return;
    }
    setNoteText("");
    setNotePanelOpen(true);
  };

  const cancelReview = async () => {
    if (!onAIReview) return;
    setReviewBusy(true);
    try {
      await onAIReview();
      flashOnce("review", "cancelled");
    } catch (e) {
      flashOnce("review", `failed: ${(e as Error).message}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const submitReview = async () => {
    if (!onAIReview || reviewBusy) return;
    setReviewBusy(true);
    try {
      await onAIReview(noteText);
      setNotePanelOpen(false);
      setNoteText("");
      flashOnce("review", "queued ✓");
    } catch (e) {
      flashOnce("review", `failed: ${(e as Error).message}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const closeNotePanel = () => {
    setNotePanelOpen(false);
    setNoteText("");
  };

  const handleCopy = async () => {
    const raw = entry.raw && entry.raw.length > 0
      ? entry.raw
      : reconstructBibtex(entry);
    try {
      await navigator.clipboard.writeText(raw);
      flashOnce("copy", "copied ✓");
    } catch {
      flashOnce("copy", "copy failed");
    }
  };

  return (
    <div
      style={{
        padding: 16,
        background: "var(--surface)",
        border: "var(--pod-border)",
        borderRadius: "var(--pod-radius)",
        boxShadow: "var(--pod-shadow)",
        fontFamily: "var(--serif)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8 }}>
        <code style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>
          @{entry.type}{`{${entry.key}}`}
        </code>
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse bib entry" : "Expand bib entry"}
          style={{
            background: "transparent",
            border: "1px solid var(--border-light)",
            borderRadius: 4,
            padding: "2px 8px",
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {expanded ? "▾ less" : "▸ more"}
        </button>
      </div>

      <div style={{ fontSize: 18, lineHeight: 1.35, marginBottom: 8 }}>
        {fields.title ?? "(no title)"}
      </div>
      <div style={{ color: "var(--muted)", marginBottom: 4 }}>
        {fields.author ?? "(no author)"}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        {[fields.journal, fields.booktitle, fields.publisher, fields.year]
          .filter(Boolean)
          .join(" · ")}
        {fields.volume ? ` · vol. ${fields.volume}` : ""}
        {fields.pages ? ` · pp. ${fields.pages}` : ""}
      </div>
      {fields.doi && (
        <div style={{ marginTop: 8, fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted)" }}>
          doi:{fields.doi}
        </div>
      )}

      {expanded && <ExpandedFields entry={entry} />}

      <ActionRow
        flash={flash}
        reviewBusy={reviewBusy}
        reviewQueued={aiReviewQueued}
        canEdit={!!onEdit}
        canReview={!!onAIReview}
        onEdit={onEdit}
        onReview={handleReviewButton}
        onCopy={handleCopy}
      />
      {notePanelOpen && (
        <AiNotePanel
          title="AI request — bibliographic entry"
          placeholder="What would you like Claude to do? e.g. &quot;Find the missing DOI&quot;, &quot;Verify the year&quot;, &quot;Re-check the author list against Crossref&quot;."
          value={noteText}
          onChange={setNoteText}
          onSubmit={submitReview}
          onCancel={closeNotePanel}
          busy={reviewBusy}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// AI request note panel — shared between BibCard and PaperRender.
// ────────────────────────────────────────────────────────────────────────

export function AiNotePanel({
  title,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  extraHeader,
}: {
  title: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  extraHeader?: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "var(--background)",
        border: "1px solid var(--accent)",
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--accent)",
        }}
      >
        {title}
      </div>
      {extraHeader}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus
        rows={4}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid var(--border-light)",
          borderRadius: 4,
          background: "var(--surface)",
          fontFamily: "var(--sans, inherit)",
          fontSize: 13,
          lineHeight: 1.4,
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!busy) onSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ActionButton onClick={onSubmit} disabled={busy} pressed>
          {busy ? "Submitting…" : "Submit AI request"}
        </ActionButton>
        <ActionButton onClick={onCancel} disabled={busy}>
          Cancel
        </ActionButton>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--muted)",
          }}
        >
          ⌘↵ submits · esc cancels
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Expanded view
// ────────────────────────────────────────────────────────────────────────

export function ExpandedFields({ entry }: { entry: BibEntry }) {
  const { fields, type } = entry;
  const known = knownFieldsForType(type);
  const otherKeys = Object.keys(fields).filter((k) => !known.has(k) && k !== "title" && k !== "author");

  const sections: Array<{ label: string; keys: readonly string[] | string[] }> = [
    { label: "Core", keys: CORE_FIELDS },
    { label: "Publication", keys: PUBLICATION_FIELDS_BY_TYPE[type] ?? [] },
    { label: "Identifiers", keys: IDENTIFIER_FIELDS },
    { label: "Annotations", keys: ANNOTATION_FIELDS },
  ];

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: "1px dashed var(--border-light)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {sections.map((s) => {
        if (s.keys.length === 0) return null;
        return (
          <FieldGroup
            key={s.label}
            label={s.label}
            entries={s.keys.map((k) => [k, fields[k] ?? ""] as [string, string])}
          />
        );
      })}
      {otherKeys.length > 0 && (
        <FieldGroup
          label="Other"
          entries={otherKeys.map((k) => [k, fields[k] ?? ""] as [string, string])}
        />
      )}
    </div>
  );
}

function FieldGroup({
  label,
  entries,
}: {
  label: string;
  entries: Array<[string, string]>;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(80px, max-content) 1fr",
          columnGap: 10,
          rowGap: 2,
          fontSize: 13,
        }}
      >
        {entries.map(([k, v]) => (
          <FieldRow key={k} fieldKey={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function FieldRow({ fieldKey, value }: { fieldKey: string; value: string }) {
  const empty = !value || value.trim().length === 0;
  return (
    <>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--muted)",
          paddingTop: 1,
        }}
      >
        {fieldKey}
      </div>
      <div
        style={{
          color: empty ? "var(--muted)" : "var(--foreground)",
          fontStyle: empty ? "italic" : "normal",
          opacity: empty ? 0.55 : 1,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {empty ? "—" : value}
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Action row
// ────────────────────────────────────────────────────────────────────────

interface ActionRowProps {
  flash: ActionFlash;
  reviewBusy: boolean;
  reviewQueued: boolean;
  canEdit: boolean;
  canReview: boolean;
  onEdit?: () => void;
  onReview: () => void;
  onCopy: () => void;
}

function ActionRow({
  flash,
  reviewBusy,
  reviewQueued,
  canEdit,
  canReview,
  onEdit,
  onReview,
  onCopy,
}: ActionRowProps) {
  const reviewLabel = reviewBusy
    ? (reviewQueued ? "Cancelling…" : "Queueing…")
    : reviewQueued
      ? "AI request queued"
      : "AI request";
  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: "1px solid var(--border-light)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <ActionButton onClick={onEdit} disabled={!canEdit}>
        Edit
      </ActionButton>
      <ActionButton onClick={onCopy}>Copy BibTeX</ActionButton>

      {flash && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--accent, var(--muted))",
          }}
        >
          {flash.message}
        </span>
      )}

      {/* Push the AI request button to the far right of the row. */}
      <div style={{ marginLeft: "auto" }}>
        <ActionButton
          onClick={onReview}
          disabled={!canReview || reviewBusy}
          pressed={reviewQueued}
          ariaPressed={reviewQueued}
          title={
            reviewQueued
              ? "Click to cancel the queued AI request"
              : "Click to write a note and queue an AI request"
          }
        >
          {reviewLabel}
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  pressed = false,
  ariaPressed,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  ariaPressed?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={ariaPressed}
      style={{
        background: pressed ? "var(--accent)" : "transparent",
        color: pressed
          ? "white"
          : disabled
            ? "var(--muted)"
            : "var(--foreground)",
        border: pressed ? "1px solid var(--accent)" : "1px solid var(--border-light)",
        borderRadius: 4,
        padding: "4px 10px",
        fontSize: 12,
        fontFamily: "var(--sans, inherit)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: pressed ? "inset 0 1px 2px rgba(0,0,0,0.2)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function reconstructBibtex(entry: BibEntry): string {
  const lines = Object.entries(entry.fields)
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${entry.type}{${entry.key},\n${lines}\n}\n`;
}
