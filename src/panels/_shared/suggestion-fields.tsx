"use client";

/**
 * Shared suggestion-card field vocabulary for the Cutter and Revisions
 * panels. Their suggestion cards (CutterSuggestionCard /
 * RevisionSuggestionCard) had byte-identical copies of the field maps,
 * `FieldBlock`, `AuthorChip`, and the status/author header trailing — the
 * only real difference being the per-panel body typography key. This module
 * is the single source of truth; both cards consume it (Cutter passes
 * `panelKey="cut"`, Revisions `panelKey="revision"`).
 *
 * `FieldTitleRow` / `CopyButton` live here too (CutterSuggestionCard re-exports
 * them for backward compatibility).
 */

import { useRef, useState, type ReactNode } from "react";
import { Button, Chevron } from "@/components/panel-primitives";
import { BorrowedMainText } from "@/components/BorrowedMainText";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { countWords } from "@/hooks/useWordCount";
import type { PendingChangeFamily } from "@/links/apply-suggestion";
import { usePendingChangeController } from "@/links/pending-change-controller";
import { usePreviewDir } from "@/links/pending-preview-store";
import { richLatexToJson } from "@/lib/footnote-content";
import type { PanelBodyKey } from "@/lib/panel-typography";
import type { PanelThemeKey } from "@/lib/panel-theme";
import type { CardKind } from "@/panels/_shared/types";

// The field vocabulary itself (the union, the grid order, the read-only set)
// is pure data and lives in its own leaf so non-UI code — notably the content
// model's derived guard — can read it without pulling the panel widgets in.
// Re-exported here so every existing call site keeps working.
export {
  FIELD_ORDER,
  READONLY_HUMAN_FIELDS,
  type SuggestionField,
} from "./suggestion-field-vocabulary";
import type { SuggestionField } from "./suggestion-field-vocabulary";

/** The two cards share a
 *  `"pending" | "applied" | "stale" | "accepted" | "rejected"` status union.
 *  `applied`/`stale` are flag-ON-only (pending-changes-flag). */
export type SuggestionStatus =
  | "pending"
  | "applied"
  | "stale"
  | "accepted"
  | "rejected";
export type SuggestionAuthor = "human" | "ai";

export const STATUS_DOT: Record<SuggestionStatus, string> = {
  pending: "bg-blue-400",
  applied: "bg-sky-300",
  stale: "bg-amber-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
};

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "Pending",
  applied: "Applied",
  stale: "Stale",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const FIELD_LABEL: Record<SuggestionField, string> = {
  original_text: "Original",
  suggested_text: "Suggested",
  explanation: "Explanation",
  user_text: "Your text",
  instructions: "Instructions",
};

export const FIELD_PLACEHOLDER: Record<SuggestionField, string> = {
  original_text: "Target text…",
  suggested_text: "Replacement text…",
  explanation: "Why this change…",
  user_text: "Your revision…",
  instructions: "Instructions for the AI…",
};

export const FIELD_TEXTAREA_CLASS: Record<SuggestionField, string> = {
  original_text:
    "w-full bg-danger-soft border border-red-200 rounded px-2 py-1.5 text-red-700 placeholder:text-red-300 focus:outline-none focus:border-red-400 resize-none min-h-[36px]",
  suggested_text:
    "w-full bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 text-emerald-800 placeholder:text-emerald-400 focus:outline-none focus:border-emerald-400 resize-none min-h-[36px]",
  explanation:
    "w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
  user_text:
    "w-full bg-surface-muted border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
  instructions:
    "w-full bg-surface-muted border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
};

// Per the design rule: substantive fields show a word count + copy button next
// to the section title. Explanation is meta and skips both.
export const FIELDS_WITH_WORD_COUNT: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
  "user_text",
  "instructions",
]);

/** Fields whose className already provides a deliberate color cue (red for
 *  original, green for suggested). At those textareas we apply only the
 *  registry's font family + size, not its color, so the visual cue is
 *  preserved. */
export const FIELDS_WITH_COLOR_CUE: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
]);

export function AuthorChip({ author }: { author: SuggestionAuthor }) {
  const isAi = author === "ai";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${
        isAi
          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
          : "bg-surface-muted-strong text-ink-body"
      }`}
      data-hint={isAi ? "AI-authored" : "Human-authored"}
      aria-label={isAi ? "AI-authored" : "Human-authored"}
    >
      {isAi ? "AI" : "Human"}
    </span>
  );
}

/** Status dot + author chip + status label — the suggestion-card header
 *  trailing, shown docked and (via the `toFloatable` factory) in `FloatChrome`.
 *  Shared by both the cutter and revision suggestion cards. */
export function SuggestionTrailing({
  status,
  author,
}: {
  status: SuggestionStatus;
  author: SuggestionAuthor;
}) {
  return (
    <>
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`}
        data-hint={STATUS_LABEL[status]}
        aria-label={STATUS_LABEL[status]}
      />
      <AuthorChip author={author} />
      <span className="text-[10px] text-ink-muted">{STATUS_LABEL[status]}</span>
    </>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={handle}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={!text}
      data-hint="Copy"
      data-hint-pos="above"
      aria-label="Copy"
      className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer disabled:opacity-40 disabled:cursor-default"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function FieldTitleRow({
  label,
  kindHint,
  text,
  showCopy,
  showWordCount,
  folded,
  onToggleFold,
}: {
  label: string;
  kindHint?: string | null;
  text: string;
  showCopy: boolean;
  showWordCount: boolean;
  folded?: boolean;
  onToggleFold?: () => void;
}) {
  const words = countWords(text);
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleFold && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFold();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[var(--muted)] hover:text-ink-strong cursor-pointer flex items-center"
            data-hint="Toggle fold"
            data-hint-pos="above"
            aria-label={folded ? "Expand" : "Collapse"}
            aria-expanded={!folded}
          >
            <Chevron expanded={!folded} />
          </button>
        )}
        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
          {label}
        </span>
        {kindHint && (
          <span className="text-[10px] text-[var(--muted-light)] lowercase">
            {kindHint}
          </span>
        )}
      </div>
      {(showWordCount || showCopy) && (
        <div className="flex items-center gap-2 shrink-0">
          {showWordCount && (
            <span className="text-[10px] text-[var(--muted-light)] tabular-nums">
              {words} {words === 1 ? "word" : "words"}
            </span>
          )}
          {showCopy && <CopyButton text={text} />}
        </div>
      )}
    </div>
  );
}

/**
 * The captured-selection excerpt cue shared by the two comment cards
 * (`CutterCommentCard` / `RevisionRequestCard`). A comment anchored to a text
 * selection stores that span in `card.selectedText`; both cards surface it the
 * same way and must not drift (task 200 — the revision twin never grew this,
 * so it rendered no cue about which passage it targeted):
 *
 *  - `excerptBlock` — an "Original" section rendered ABOVE the body via
 *    `EditableCard`'s additive `aboveBody` slot, fold-toggleable, in the
 *    suggestion-card "Original" dialect (`FieldTitleRow` + red danger-soft
 *    block). Owns its own fold state.
 *  - `compressedExcerpt` — the red-italic quoted one-liner a collapsed card
 *    shows in place of the rich-text body summary.
 *
 * Both are `undefined` when there is no `selectedText`, so a card can fall
 * back to its body-derived summary. This is the single source of truth so the
 * two hand-forked comment cards can't diverge again.
 */
export function useExcerptCue({
  selectedText,
  kindHint,
  label = "Original",
}: {
  selectedText?: string | null;
  kindHint?: string | null;
  label?: string;
}): { excerptBlock: ReactNode | undefined; compressedExcerpt: ReactNode | undefined } {
  const [folded, setFolded] = useState(false);
  if (!selectedText) {
    return { excerptBlock: undefined, compressedExcerpt: undefined };
  }
  const excerptBlock = (
    <div className="mb-2">
      <FieldTitleRow
        label={label}
        kindHint={kindHint ?? null}
        text={selectedText}
        showCopy={true}
        showWordCount={true}
        folded={folded}
        onToggleFold={() => setFolded((f) => !f)}
      />
      {!folded && (
        <div className="bg-danger-soft border border-red-200 rounded px-2 py-1.5 text-xs text-red-700 whitespace-pre-wrap break-words">
          {selectedText}
        </div>
      )}
    </div>
  );
  const compressedExcerpt = (
    <span className="text-red-700/80 italic">
      &quot;{selectedText.replace(/\s+/g, " ").trim()}&quot;
    </span>
  );
  return { excerptBlock, compressedExcerpt };
}

/** A single labelled suggestion field (title row + textarea). `panelKey`
 *  selects the per-panel body typography ("cut" or "revision"); everything
 *  else is shared. */
export function FieldBlock({
  field,
  value,
  onChange,
  readOnly,
  kindHint,
  panelKey,
}: {
  field: SuggestionField;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  kindHint?: string | null;
  panelKey: PanelBodyKey;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [folded, setFolded] = useState(false);
  const bodyStyle = usePanelBodyStyle(panelKey);
  const textareaStyle: React.CSSProperties = FIELDS_WITH_COLOR_CUE.has(field)
    ? { fontFamily: bodyStyle.fontFamily, fontSize: bodyStyle.fontSize }
    : bodyStyle;

  const isSubstantive = FIELDS_WITH_WORD_COUNT.has(field);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <FieldTitleRow
        label={FIELD_LABEL[field]}
        kindHint={kindHint}
        text={value}
        showCopy={isSubstantive}
        showWordCount={isSubstantive}
        folded={folded}
        onToggleFold={() => setFolded((f) => !f)}
      />
      {!folded && (
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={readOnly ? undefined : onTextareaKeyDown}
          placeholder={readOnly ? "" : FIELD_PLACEHOLDER[field]}
          style={textareaStyle}
          className={`${FIELD_TEXTAREA_CLASS[field]}${readOnly ? " cursor-default" : ""}`}
          rows={2}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Pending-changes (flag-ON) shared UI. These render only when the
// pending-changes flag is on; the cards gate on `isPendingChangesOn()` before
// using them, so flag-OFF callers never reach this code (and the legacy
// Accept/Reject path stays byte-identical).
// ───────────────────────────────────────────────────────────────────────────

/** The `pending`-status action row under the flag: a single primary "Apply"
 *  button (replaces Accept/Reject). Phase 2 will auto-apply; for now it's a
 *  manual button so the mechanics are testable. */
export function ApplyActionRow({
  id,
  onApply,
}: {
  id: string;
  onApply: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5 pt-1 pr-7">
      <Button
        variant="warm"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onApply(id);
        }}
      >
        Apply
      </Button>
    </div>
  );
}

/** A check (Keep) / cross (Dismiss) glyph for the applied-card commit icons. */
function CommitGlyph({ kind }: { kind: "check" | "cross" }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      aria-hidden
    >
      {kind === "check" ? (
        <polyline points="20 6 9 17 4 12" />
      ) : (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      )}
    </svg>
  );
}

/** One segment of the Original / Suggested preview toggle. */
function PreviewSegment({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Preview ${label.toLowerCase()}`}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`px-2 h-6 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        active
          ? "bg-accent-light text-accent"
          : "bg-transparent text-ink-subtle hover:bg-surface-muted-strong hover:text-ink-body"
      }`}
    >
      {label}
    </button>
  );
}

/** The body of an `applied`-status card — the SURVIVING ORIGINAL-RECORD, now a
 *  3-axis control surface. Renders identically docked, in omni, and in a float,
 *  as stacked rows:
 *    1. actions — a NON-committing Original / Suggested preview toggle (flips the
 *       LIVE doc text in place, no commit) + a Check (keep) / Cross (dismiss)
 *       icon pair (the two commit decisions).
 *    2. explanation — the card's `explanation` ("what Claude did and why"),
 *       ALWAYS visible when present (omitted when empty).
 *    3. an "Original text" label + chevron disclosure (collapsed by default).
 *    4. only when expanded — the original paragraph rendered as bare read-only
 *       main-text (`richLatexToJson` → `BorrowedMainText`).
 *
 *  Every action routes through the `PendingChangeController` context (not
 *  per-mount callbacks), so the SAME card works on every surface — omni/float no
 *  longer fall back to the legacy field-view. When no controller is present or
 *  it's off, the controls render disabled (defensive). The active preview segment
 *  reflects `usePreviewDir(id)` (a transient store, never persisted). `panelKey`
 *  picks the per-panel body typography; `family` tags every action so the
 *  controller tokens the right in-text mark. (`cardKind`/`themeKey` remain in the
 *  prop type for call-site compatibility but the bare renderer needs neither.) */
export function AppliedRecordBody({
  id,
  originalText,
  explanation,
  family,
}: {
  id: string;
  originalText: string;
  /** The card's `explanation` — "what Claude did and why". Rendered always-on
   *  above the Original foldout; omitted when empty/whitespace. */
  explanation?: string;
  cardKind: CardKind;
  panelKey: PanelBodyKey;
  themeKey: PanelThemeKey;
  family: PendingChangeFamily;
}) {
  const controller = usePendingChangeController();
  const previewDir = usePreviewDir(id);
  const [showOriginal, setShowOriginal] = useState(false);
  const disabled = !controller || !controller.isOn;
  // The original renders with the FOOTNOTE typography (per the footnote styling
  // guide) — same as footnote/archive card bodies — not the revision panel body.
  const bodyStyle = usePanelBodyStyle("footnote");
  const hasExplanation = !!explanation && explanation.trim().length > 0;
  return (
    <div
      className="px-3 pt-2 pb-2 space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Row 1 — actions: the preview toggle (left) + Check / Cross commit icons
          (right), with a thin divider beneath. */}
      <div className="flex items-center gap-1.5 pb-1.5 border-b border-[var(--border)]">
        {/* NON-committing Original / Suggested preview toggle (flips the LIVE
            doc text so you can compare in place; never commits). */}
        <div
          role="group"
          aria-label="Preview toggle"
          className="inline-flex rounded-md border border-[var(--border)] overflow-hidden"
        >
          <PreviewSegment
            label="Original"
            active={previewDir === "original"}
            disabled={disabled}
            onClick={() => controller?.previewOriginal(family, id)}
          />
          <PreviewSegment
            label="Suggested"
            active={previewDir === "suggested"}
            disabled={disabled}
            onClick={() => controller?.previewSuggested(family, id)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          {/* Check — keep (finalize the suggested text). */}
          <button
            type="button"
            aria-label="Keep change"
            title="Keep"
            disabled={disabled}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              controller?.keep(family, id);
            }}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <CommitGlyph kind="check" />
          </button>
          {/* Cross — dismiss (restore the original + archive; never deletes). */}
          <button
            type="button"
            aria-label="Dismiss change"
            title="Dismiss (restores original, archives the card)"
            disabled={disabled}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              controller?.dismiss(family, id);
            }}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-ink-subtle hover:bg-danger-soft hover:text-danger disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <CommitGlyph kind="cross" />
          </button>
        </div>
      </div>
      {/* Row 2 — explanation (what Claude did and why), always visible when
          present, positioned under the actions and above the Original foldout. */}
      {hasExplanation && (
        <div
          data-applied-explanation
          className="break-words text-ink-body"
          style={bodyStyle}
        >
          {explanation}
        </div>
      )}
      {/* Row 3 — "Original text" label + chevron disclosure. */}
      <button
        type="button"
        aria-expanded={showOriginal}
        aria-label={showOriginal ? "Hide original text" : "Show original text"}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setShowOriginal((v) => !v);
        }}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-[var(--muted)] hover:text-ink-strong cursor-pointer"
      >
        <span>Original text</span> <Chevron expanded={showOriginal} />
      </button>
      {/* Row 4 — the original paragraph, bare, as it reads in the main text. */}
      {showOriginal && (
        <BorrowedMainText
          value={richLatexToJson(originalText)}
          instanceKey={`applied-original:${id}`}
          variant="footnote"
          className="break-words"
          bodyStyle={bodyStyle}
        />
      )}
    </div>
  );
}

/** The body of a `pending`-status AI suggestion card — the RETIRED-4-FIELD
 *  replacement. An AI card never shows the editable `original_text` /
 *  `suggested_text` / `explanation` / `user_text` grid (that grid is the
 *  legitimate composition surface for a HUMAN draft only). Instead this mirrors
 *  {@link AppliedRecordBody}'s minimal read-only shape — an "Insert below" action
 *  row, the always-on `explanation`, and the Original-text foldout — carrying the
 *  ONE verb an un-appliable AI suggestion needs: drop `suggested_text` as a new
 *  paragraph below the anchor.
 *
 *  Every action routes through the shared `PendingChangeController` context (like
 *  AppliedRecordBody), so the SAME card renders on every surface (docked / omni /
 *  float) without per-mount callbacks. Insert-below is hidden when there's no
 *  `suggested_text` to insert (a cutter/delete cut, or an empty revision) — a
 *  quiet notice takes its place. When no controller is present or it's off, the
 *  button renders disabled (defensive). */
export function PendingAiRecordBody({
  id,
  originalText,
  suggestedText,
  explanation,
  family,
}: {
  id: string;
  originalText: string;
  /** The card's `suggested_text` — what Insert-below drops as a new paragraph.
   *  Blank (a delete/empty cut) → the action is replaced by a quiet notice. */
  suggestedText: string;
  /** The card's `explanation` — "what Claude drafted and why". Always-on above
   *  the Original foldout; omitted when empty/whitespace. */
  explanation?: string;
  family: PendingChangeFamily;
}) {
  const controller = usePendingChangeController();
  const [showOriginal, setShowOriginal] = useState(false);
  const disabled = !controller || !controller.isOn;
  // Original renders with the FOOTNOTE typography (per the footnote styling
  // guide) — matching AppliedRecordBody.
  const bodyStyle = usePanelBodyStyle("footnote");
  const hasExplanation = !!explanation && explanation.trim().length > 0;
  const canInsert = suggestedText.trim().length > 0;
  return (
    <div
      className="px-3 pt-2 pb-2 space-y-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Row 1 — action: Insert below (right), thin divider beneath. When there
          is nothing to insert (delete/empty cut), a quiet notice stands in. */}
      <div className="flex items-center gap-1.5 pb-1.5 border-b border-[var(--border)] min-h-[28px]">
        {canInsert ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="warm"
              size="sm"
              disabled={disabled}
              data-hint="Insert the suggestion as a new paragraph below"
              data-hint-pos="above"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                controller?.insertBelow(family, id);
              }}
            >
              Insert below
            </Button>
          </div>
        ) : (
          <span className="text-[11px] text-ink-subtle italic">
            No replacement text to insert.
          </span>
        )}
      </div>
      {/* Row 2 — explanation (what Claude drafted and why), always visible when
          present, above the Original foldout. */}
      {hasExplanation && (
        <div
          data-applied-explanation
          className="break-words text-ink-body"
          style={bodyStyle}
        >
          {explanation}
        </div>
      )}
      {/* Row 3 — "Original text" label + chevron disclosure (collapsed default). */}
      <button
        type="button"
        aria-expanded={showOriginal}
        aria-label={showOriginal ? "Hide original text" : "Show original text"}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setShowOriginal((v) => !v);
        }}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-[var(--muted)] hover:text-ink-strong cursor-pointer"
      >
        <span>Original text</span> <Chevron expanded={showOriginal} />
      </button>
      {/* Row 4 — the original paragraph, bare, as it reads in the main text. */}
      {showOriginal && (
        <BorrowedMainText
          value={richLatexToJson(originalText)}
          instanceKey={`pending-ai-original:${id}`}
          variant="footnote"
          className="break-words"
          bodyStyle={bodyStyle}
        />
      )}
    </div>
  );
}

/** The body of a `stale`-status card: a quiet notice that the paragraph drifted
 *  since the suggestion was drafted, with Dismiss (delete) and a disabled
 *  "Re-draft" affordance (a later phase will re-draft). No doc mutation. */
export function StaleNotice({
  id,
  onDismiss,
}: {
  id: string;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="px-3 pt-2 pb-2 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[12px] text-ink-subtle">
        This paragraph changed since the suggestion was drafted, so it can no
        longer be applied as-is.
      </p>
      <div className="flex gap-1.5 pt-1 pr-7">
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(id);
          }}
        >
          Dismiss
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled
          data-hint="Re-drafting arrives in a later phase"
        >
          Re-draft
        </Button>
      </div>
    </div>
  );
}
