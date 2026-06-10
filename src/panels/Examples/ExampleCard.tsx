"use client";

import { useEffect, useRef, useState } from "react";
import type { ExampleInfo } from "@/components/Editor";
import {
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { popKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { BorrowedMainText } from "@/components/BorrowedMainText";

export interface ExampleCardProps {
  example: ExampleInfo;
  isSelected: boolean;
  onSelect: () => void;
  onJump: (sourceEl: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  /** Replace the example's source. Returns false on parse failure so the
   *  card can keep the editor open and surface an error. */
  onUpdateLatex?: (latex: string) => boolean;
  /** Extra `data-*` attributes forwarded onto the card root. Omni-view
   *  uses this to attach `data-omni-entry` directly on the card so the
   *  global `[data-omni-entry] > :first-child { border-radius: inherit }`
   *  rule inherits from the card's own `rounded-lg` (rather than from
   *  an outer wrapper with no radius, which would zero out the corners). */
  extraDataAttrs?: Record<string, string>;
}

/** Panel card for a single `\ex` / `\pex` block. The body recreates the
 *  example's structure (number, body text, sub-items, label) and a footer
 *  exposes an Edit toggle (LaTeX source editor) and a "?" help popover. */
export function ExampleCard({
  example,
  isSelected,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
  onUpdateLatex,
  extraDataAttrs,
}: ExampleCardProps) {
  const theme = useCardTheme("example");
  const bodyStyle = usePanelBodyStyle("example");
  const popped = usePoppedCards();
  const cardKey = popKey("examples", example.exampleId);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const ac = useAnchoredCard({ kind: "example", id: example.exampleId });
  const isExpanded = ac.expanded;
  const isHaloed = ac.selected || isSelected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();

  const [isEditing, setIsEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [latexDraft, setLatexDraft] = useState(example.latex);
  const [editError, setEditError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>((e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      applyEdit();
    }
  });

  // Re-sync the draft when the underlying source changes (e.g. another
  // edit channel touches the example) — but only while the editor is
  // closed, so we don't blow away in-progress edits.
  useEffect(() => {
    if (!isEditing) setLatexDraft(example.latex);
  }, [example.latex, isEditing]);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const openEditor = () => {
    setLatexDraft(example.latex);
    setEditError(null);
    setIsEditing(true);
  };
  const cancelEdit = () => {
    setIsEditing(false);
    setEditError(null);
    setLatexDraft(example.latex);
  };
  const applyEdit = () => {
    if (!onUpdateLatex) {
      setIsEditing(false);
      return;
    }
    const ok = onUpdateLatex(latexDraft);
    if (ok) {
      setIsEditing(false);
      setEditError(null);
    } else {
      setEditError("Couldn't parse — check the \\ex … \\xe block and try again.");
    }
  };

  const card = (
    <PanelCard
      theme={theme}
      selected={isHaloed}
      onClick={(e) => {
        ac.onActivate();
        onSelect();
        onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      chromeless={isPoppedOut}
      cardKey={cardKey}
      isCollapsed={compressed}
      onToggleExpanded={ac.onToggleExpanded}
      data-link-card={`example:${example.exampleId}`}
      {...(extraDataAttrs ?? {})}
      kind="example"
      canJump
      onJump={(e) => onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null)}
    >
      {compressed ? (
        <div className="px-3 py-1.5 text-ink-body">
          <div style={{ fontFamily: "var(--font-serif), Georgia, serif", ...bodyStyle, ...compressedBodyStyle(compressedLines) }}>
            <span
              className="font-mono mr-2"
              style={{ color: theme.titleColor }}
            >
              ({example.number || "?"})
            </span>
            {(() => {
              const text = example.bodyText || example.items[0]?.text || "";
              const trimmed = text.replace(/\s+/g, " ").trim();
              if (trimmed) return trimmed;
              return <span className="italic text-ink-muted">empty</span>;
            })()}
          </div>
        </div>
      ) : (
      <>
      {/* ── Body — recreate the example structure ────────────────── */}
      <div
        className="px-3 py-2 text-xs text-ink-body"
        style={{ fontFamily: "var(--font-serif), Georgia, serif", ...bodyStyle }}
      >
        <div className="flex gap-2">
          <span
            className="font-mono shrink-0"
            style={{ color: theme.titleColor }}
          >
            ({example.number || "?"})
          </span>
          <div className="min-w-0 flex-1">
            {example.bodyContent ? (
              // BorrowedMainText renders the body with real inline atoms
              // (citation / \ref / inline math) instead of flattened text.
              <BorrowedMainText
                value={example.bodyContent}
                instanceKey={`example-body:${example.exampleId}`}
                variant="footnote"
                className="leading-snug break-words"
              />
            ) : (
              example.bodyText && (
                <div className="leading-snug whitespace-pre-wrap break-words">
                  {example.bodyText}
                </div>
              )
            )}
            {example.items.length > 0 && (
              <ol className="list-none m-0 p-0 mt-1 flex flex-col gap-0.5">
                {example.items.map((it, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span
                      className="shrink-0"
                      style={{ minWidth: "1.25rem", color: theme.titleColor }}
                    >
                      {it.subLabel || (idx + 1)}.
                    </span>
                    <div className="min-w-0 flex-1">
                      {it.content ? (
                        <BorrowedMainText
                          value={it.content}
                          instanceKey={`example-item:${example.exampleId}:${idx}`}
                          variant="footnote"
                          className="leading-snug break-words"
                        />
                      ) : (
                        <span className="leading-snug whitespace-pre-wrap break-words">
                          {it.text || (
                            <span className="italic text-ink-muted">empty</span>
                          )}
                        </span>
                      )}
                      {it.label && (
                        <span className="heading-annotation ml-2 align-middle">
                          ex.<span className="opacity-70">{"  ·  label: "}</span>
                          <span className="heading-label-text">{it.label}</span>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {example.label && (
              <div className="mt-1.5">
                <span className="heading-annotation">
                  ex.<span className="opacity-70">{"  ·  label: "}</span>
                  <span className="heading-label-text">{example.label}</span>
                </span>
              </div>
            )}
            {!example.bodyText && example.items.length === 0 && (
              <span className="italic text-ink-muted">Empty example</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Footer: Edit + Help ──────────────────────────────────── */}
      <div
        className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
      />
      <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-muted/30">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isEditing) cancelEdit();
            else openEditor();
          }}
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover-on-light hover:border-edge-hover flex-shrink-0"
          data-hint={isEditing ? "Close" : "Edit"}
          data-hint-pos="above"
          disabled={!onUpdateLatex && !isEditing}
        >
          {isEditing ? "Close" : "Edit"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowHelp((v) => !v);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover-on-light hover:border-edge-hover flex-shrink-0 font-semibold"
          data-hint={showHelp ? "Hide help" : "Help"}
          data-hint-pos="above"
        >
          ?
        </button>
        <div className="flex-1" />
      </div>

      {/* ── Edit panel: LaTeX source editor ──────────────────────── */}
      {isEditing && (
        <>
          <div
            className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
          />
          <div
            className="px-3 py-2 bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              ref={textareaRef}
              value={latexDraft}
              onChange={(e) => {
                setLatexDraft(e.target.value);
                if (editError) setEditError(null);
              }}
              onKeyDown={onTextareaKeyDown}
              spellCheck={false}
              rows={Math.max(4, Math.min(latexDraft.split("\n").length + 1, 16))}
              className="w-full text-[11px] font-mono text-ink-body bg-transparent border border-edge-subtle rounded p-1.5 outline-none focus:ring-1 focus:ring-edge-hover resize-y"
            />
            {editError && (
              <div className="text-[11px] text-danger mt-1">{editError}</div>
            )}
            <div className="flex items-center justify-end gap-1.5 mt-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover-on-light hover:border-edge-hover"
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); applyEdit(); }}
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-strong text-ink-body hover-on-light hover:border-edge-hover"
                data-hint="Apply (⌘⏎)"
              >
                Apply
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Help panel: brief expex explainer ────────────────────── */}
      {showHelp && (
        <>
          <div
            className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
          />
          <div
            className="px-3 py-2 text-[11px] leading-snug text-ink-body bg-amber-50/40"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1">
              <span className="font-mono">\expex</span> renders numbered linguistic examples.
            </p>
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              <li>
                <span className="font-mono">\ex … \xe</span> — a single numbered example.
              </li>
              <li>
                <span className="font-mono">\pex … \xe</span> — a multi-part example;
                use <span className="font-mono">\a</span> to introduce each sub-item
                (auto-labeled <span className="font-mono">a, b, c…</span>).
              </li>
              <li>
                <span className="font-mono">\label{"{"}name{"}"}</span> on either the
                top block or a <span className="font-mono">\a</span> item makes it
                referenceable with <span className="font-mono">\ref{"{"}name{"}"}</span>.
              </li>
              <li>
                <span className="font-mono">{"<tag>"}</span> right after
                <span className="font-mono"> \ex</span> /
                <span className="font-mono"> \a</span> sets a custom display tag
                (e.g. <span className="font-mono">\ex{"<*>"}</span> for an
                ungrammatical example).
              </li>
              <li>
                <span className="font-mono">\begingl … \endgl</span> with
                <span className="font-mono"> \gla / \glb / \glc</span> rows and a
                <span className="font-mono"> \glft</span> free-translation row
                produces an interlinear gloss.
              </li>
            </ul>
          </div>
        </>
      )}
      </>
      )}
    </PanelCard>
  );
  // When popped: wrap in FloatWindow (portals to body, draggable/resizable).
  // The panel-side render checks isPopped and skips itself so the card
  // mounts only once, in the float.
  if (popped?.isPopped(cardKey) && !isPoppedOut) return null;
  return card;
}
