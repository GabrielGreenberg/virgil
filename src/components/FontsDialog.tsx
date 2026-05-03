"use client";

import { useEffect, useState, type ReactNode } from "react";
import FloatingPanel from "./FloatingPanel";
import FontPicker from "./FontPicker";
import SizeStepper from "./SizeStepper";
import type { EditorPreferences } from "@/hooks/usePreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  setPanelTypographyField,
} from "@/lib/panel-typography";
import { usePanelTypography } from "@/hooks/usePanelTypography";

interface FontsDialogProps {
  open: boolean;
  onClose: () => void;
  prefs: EditorPreferences;
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
}

function fontStack(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name;
}

/** Visual wrapper for a font category — generous spacing, soft pod look. */
function CategoryCard({
  label,
  children,
  onReset,
  resetDisabled,
}: {
  label: string;
  children: ReactNode;
  onReset: () => void;
  resetDisabled?: boolean;
}) {
  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: "var(--surface, #fff)",
        border: "1px solid var(--border-light, #c9c5c5)",
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</h3>
        <button
          type="button"
          onClick={onReset}
          disabled={resetDisabled}
          className="text-[11px] text-ink-muted hover:text-ink-body disabled:opacity-30 disabled:cursor-default"
          title="Reset to default"
        >
          Reset
        </button>
      </div>
      {children}
    </div>
  );
}

function PreviewPod({
  text,
  fontFamily,
  fontSizeRem,
  weight,
  multiline,
}: {
  text: string;
  fontFamily: string;
  fontSizeRem: number;
  weight?: number;
  multiline?: boolean;
}) {
  return (
    <div
      className="rounded-md px-4 py-3 mb-4"
      style={{
        background: "var(--background, #f8f3ed)",
        border: "1px solid var(--border-light, #c9c5c5)",
        fontFamily: fontStack(fontFamily),
        fontSize: `${fontSizeRem}rem`,
        fontWeight: weight,
        lineHeight: 1.4,
        color: "var(--editor-text-color, #2a2a2a)",
        minHeight: multiline ? "3em" : "2em",
        whiteSpace: multiline ? "normal" : "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <label className="text-xs text-ink-muted w-20 shrink-0">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function PinToggle({
  pinned,
  onChange,
  label = "Pin to body family",
}: {
  pinned: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!pinned)}
      className="flex items-center gap-2 text-[11px] text-ink-muted hover:text-ink-body mt-1.5"
    >
      <span
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded border ${pinned ? "bg-[var(--accent)] border-[var(--accent)]" : "border-edge-subtle bg-surface"}`}
      >
        {pinned && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4.5l1.8 1.8L7 3" />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function FontsDialog({ open, onClose, prefs, onUpdate }: FontsDialogProps) {
  const [pos, setPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (!open || pos) return;
    const w = 520;
    const h = Math.min(680, window.innerHeight - 80);
    setPos({
      x: Math.max(20, window.innerWidth - w - 60),
      y: 80,
      width: w,
      height: h,
    });
  }, [open, pos]);

  // Footnote driven through panel-typography (single source of truth).
  const footnoteTypo = usePanelTypography("footnote");
  const footnoteFamily = footnoteTypo?.fontFamily ?? DEFAULT_PANEL_TYPOGRAPHY.footnote.fontFamily;
  const footnoteSize = footnoteTypo?.fontSize ?? DEFAULT_PANEL_TYPOGRAPHY.footnote.fontSize;

  if (!open || !pos) return null;

  // Effective body family — used by every "pin to body" preview so the
  // user sees what pinning actually does.
  const bodyFamily = prefs.fontSerif;
  const sansFamily = prefs.fontSans;

  // Resolved per-category families (pinned → body).
  const titleFamily = prefs.fontMaketitleFamily ?? bodyFamily;
  const headersFamily = prefs.fontHeadersFamily ?? bodyFamily;
  const parTitleFamily = prefs.fontParTitleFamily ?? sansFamily;

  return (
    <FloatingPanel
      initialX={pos.x}
      initialY={pos.y}
      initialWidth={pos.width}
      initialHeight={pos.height}
      zIndex={70}
      onChange={setPos}
    >
      {/* Header — drag strip lives here (FloatingPanel's drag listener
          ignores buttons & inputs, so the close button still works). */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{
          background: "var(--pod-toolbar, #f5f3ef)",
          borderBottom: "1px solid var(--border-light, #c9c5c5)",
        }}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium text-ink-body">Fonts</h2>
          <span className="text-[11px] text-ink-muted">main text</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded hover:bg-edge-subtle text-ink-muted hover:text-ink-body flex items-center justify-center"
          title="Close"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-5 py-5 space-y-4"
        data-no-window-drag
        onMouseDown={(e) => e.stopPropagation()}
        style={{ background: "var(--pod-panel, #f3f0eb)" }}
      >
        {/* ── Editor body ───────────────────────────────────────────── */}
        <CategoryCard
          label="Editor body"
          onReset={() => {
            onUpdate("fontSerif", DEFAULT_PREFS.fontSerif);
            onUpdate("editorFontSize", DEFAULT_PREFS.editorFontSize);
          }}
          resetDisabled={prefs.fontSerif === DEFAULT_PREFS.fontSerif && prefs.editorFontSize === DEFAULT_PREFS.editorFontSize}
        >
          <PreviewPod
            text="The quick brown fox jumps over the lazy dog."
            fontFamily={bodyFamily}
            fontSizeRem={prefs.editorFontSize}
            multiline
          />
          <FieldRow label="Family">
            <FontPicker
              value={bodyFamily}
              onChange={(f) => onUpdate("fontSerif", f)}
              previewPhrase="The quick brown fox"
            />
          </FieldRow>
          <FieldRow label="Size">
            <SizeStepper
              value={prefs.editorFontSize}
              onChange={(v) => onUpdate("editorFontSize", v)}
              min={0.85} max={1.4} step={0.05} unit="rem"
            />
          </FieldRow>
        </CategoryCard>

        {/* ── Title block (\maketitle) ──────────────────────────────── */}
        <CategoryCard
          label="Title block (\maketitle)"
          onReset={() => {
            onUpdate("fontMaketitleFamily", DEFAULT_PREFS.fontMaketitleFamily);
            onUpdate("fontMaketitleTitleSize", DEFAULT_PREFS.fontMaketitleTitleSize);
            onUpdate("fontMaketitleMetaSize", DEFAULT_PREFS.fontMaketitleMetaSize);
          }}
          resetDisabled={
            prefs.fontMaketitleFamily === DEFAULT_PREFS.fontMaketitleFamily &&
            prefs.fontMaketitleTitleSize === DEFAULT_PREFS.fontMaketitleTitleSize &&
            prefs.fontMaketitleMetaSize === DEFAULT_PREFS.fontMaketitleMetaSize
          }
        >
          <PreviewPod
            text="On the History of Annotation"
            fontFamily={titleFamily}
            fontSizeRem={prefs.fontMaketitleTitleSize}
            weight={700}
          />
          <PreviewPod
            text="Jane Doe · 2026"
            fontFamily={titleFamily}
            fontSizeRem={prefs.fontMaketitleMetaSize}
          />
          <FieldRow label="Family">
            <FontPicker
              value={titleFamily}
              onChange={(f) => onUpdate("fontMaketitleFamily", f)}
              previewPhrase="On the History of Annotation"
              pinned={prefs.fontMaketitleFamily === null}
            />
          </FieldRow>
          <PinToggle
            pinned={prefs.fontMaketitleFamily === null}
            onChange={(v) => onUpdate("fontMaketitleFamily", v ? null : (prefs.fontMaketitleFamily ?? bodyFamily))}
          />
          <div className="mt-3" />
          <FieldRow label="Title size">
            <SizeStepper
              value={prefs.fontMaketitleTitleSize}
              onChange={(v) => onUpdate("fontMaketitleTitleSize", v)}
              min={1.1} max={3.5} step={0.05} unit="rem"
            />
          </FieldRow>
          <FieldRow label="Meta size">
            <SizeStepper
              value={prefs.fontMaketitleMetaSize}
              onChange={(v) => onUpdate("fontMaketitleMetaSize", v)}
              min={0.7} max={1.6} step={0.05} unit="rem"
            />
          </FieldRow>
        </CategoryCard>

        {/* ── Headers ───────────────────────────────────────────────── */}
        <CategoryCard
          label="Headers"
          onReset={() => {
            onUpdate("fontHeadersFamily", DEFAULT_PREFS.fontHeadersFamily);
            onUpdate("fontHeadersH1Size", DEFAULT_PREFS.fontHeadersH1Size);
            onUpdate("fontHeadersH2Size", DEFAULT_PREFS.fontHeadersH2Size);
            onUpdate("fontHeadersH3Size", DEFAULT_PREFS.fontHeadersH3Size);
          }}
          resetDisabled={
            prefs.fontHeadersFamily === DEFAULT_PREFS.fontHeadersFamily &&
            prefs.fontHeadersH1Size === DEFAULT_PREFS.fontHeadersH1Size &&
            prefs.fontHeadersH2Size === DEFAULT_PREFS.fontHeadersH2Size &&
            prefs.fontHeadersH3Size === DEFAULT_PREFS.fontHeadersH3Size
          }
        >
          <PreviewPod text="1 Introduction" fontFamily={headersFamily} fontSizeRem={prefs.fontHeadersH1Size} weight={700} />
          <PreviewPod text="1.1 Background" fontFamily={headersFamily} fontSizeRem={prefs.fontHeadersH2Size} weight={600} />
          <PreviewPod text="1.1.1 Prior work" fontFamily={headersFamily} fontSizeRem={prefs.fontHeadersH3Size} weight={600} />
          <FieldRow label="Family">
            <FontPicker
              value={headersFamily}
              onChange={(f) => onUpdate("fontHeadersFamily", f)}
              previewPhrase="1 Introduction"
              pinned={prefs.fontHeadersFamily === null}
            />
          </FieldRow>
          <PinToggle
            pinned={prefs.fontHeadersFamily === null}
            onChange={(v) => onUpdate("fontHeadersFamily", v ? null : (prefs.fontHeadersFamily ?? bodyFamily))}
          />
          <div className="mt-3" />
          <FieldRow label="H1 size">
            <SizeStepper value={prefs.fontHeadersH1Size} onChange={(v) => onUpdate("fontHeadersH1Size", v)} min={1.1} max={3.0} step={0.05} unit="rem" />
          </FieldRow>
          <FieldRow label="H2 size">
            <SizeStepper value={prefs.fontHeadersH2Size} onChange={(v) => onUpdate("fontHeadersH2Size", v)} min={0.95} max={2.4} step={0.05} unit="rem" />
          </FieldRow>
          <FieldRow label="H3 size">
            <SizeStepper value={prefs.fontHeadersH3Size} onChange={(v) => onUpdate("fontHeadersH3Size", v)} min={0.9} max={2.0} step={0.05} unit="rem" />
          </FieldRow>
        </CategoryCard>

        {/* ── Paragraph titles ──────────────────────────────────────── */}
        <CategoryCard
          label="Paragraph titles"
          onReset={() => {
            onUpdate("fontParTitleFamily", DEFAULT_PREFS.fontParTitleFamily);
            onUpdate("parTitleSize", DEFAULT_PREFS.parTitleSize);
          }}
          resetDisabled={
            prefs.fontParTitleFamily === DEFAULT_PREFS.fontParTitleFamily &&
            prefs.parTitleSize === DEFAULT_PREFS.parTitleSize
          }
        >
          <PreviewPod
            text="On marginalia"
            fontFamily={parTitleFamily}
            fontSizeRem={prefs.parTitleSize}
            weight={500}
          />
          <FieldRow label="Family">
            <FontPicker
              value={parTitleFamily}
              onChange={(f) => onUpdate("fontParTitleFamily", f)}
              previewPhrase="On marginalia"
              pinned={prefs.fontParTitleFamily === null}
              pinnedLabel="(matches UI sans)"
            />
          </FieldRow>
          <PinToggle
            pinned={prefs.fontParTitleFamily === null}
            onChange={(v) => onUpdate("fontParTitleFamily", v ? null : (prefs.fontParTitleFamily ?? sansFamily))}
            label="Pin to UI sans family"
          />
          <div className="mt-3" />
          <FieldRow label="Size">
            <SizeStepper
              value={prefs.parTitleSize}
              onChange={(v) => onUpdate("parTitleSize", v)}
              min={0.6} max={1.0} step={0.02} unit="rem"
            />
          </FieldRow>
        </CategoryCard>

        {/* ── Footnotes (panel typography registry) ─────────────────── */}
        <CategoryCard
          label="Footnotes"
          onReset={() => {
            setPanelTypographyField("footnote", "fontFamily", DEFAULT_PANEL_TYPOGRAPHY.footnote.fontFamily);
            setPanelTypographyField("footnote", "fontSize", DEFAULT_PANEL_TYPOGRAPHY.footnote.fontSize);
          }}
          resetDisabled={
            footnoteFamily === DEFAULT_PANEL_TYPOGRAPHY.footnote.fontFamily &&
            footnoteSize === DEFAULT_PANEL_TYPOGRAPHY.footnote.fontSize
          }
        >
          <PreviewPod
            text="See Smith (1998) for an earlier treatment of marginal annotation."
            fontFamily={footnoteFamily}
            fontSizeRem={footnoteSize / 16}
            multiline
          />
          <FieldRow label="Family">
            <FontPicker
              value={footnoteFamily}
              onChange={(f) => setPanelTypographyField("footnote", "fontFamily", f)}
              previewPhrase="See Smith (1998)"
            />
          </FieldRow>
          <FieldRow label="Size">
            <SizeStepper
              value={footnoteSize}
              onChange={(v) => setPanelTypographyField("footnote", "fontSize", Math.round(v))}
              min={9} max={24} step={1} unit="px" precision={0}
            />
          </FieldRow>
        </CategoryCard>
      </div>
    </FloatingPanel>
  );
}
