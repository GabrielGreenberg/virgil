"use client";

import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Editor } from "@tiptap/react";

export type MarginaliaType = "quote" | "note" | "archive" | "todo";
export type DividerLevel = 1 | 2 | 3 | 4;
export type DividerWidth = "full" | "mid" | "text";
export type ToolbarOrientation = "horizontal" | "vertical";

const DIVIDER_LEVEL_LABELS: Record<DividerLevel, string> = {
  1: "Chapters",
  2: "Sections",
  3: "Subsections",
  4: "Subsubsections",
};

const DIVIDER_WIDTH_LABELS: Record<DividerWidth, string> = {
  full: "Full width",
  mid: "Mid width",
  text: "Text width",
};

interface MenuBarProps {
  editor: Editor | null;
  onAddComment?: () => void;
  onArchive?: () => void;
  onCreateFootnote?: () => void;
  onQuoteSelection?: () => void;
  onAddNote?: () => void;
  onCutSelection?: () => void;
  showParTitles: boolean;
  onToggleParTitles: () => void;
  showLatexComments: boolean;
  onToggleLatexComments: () => void;
  showSectionIndicator: boolean;
  onToggleSectionIndicator: () => void;
  onOpenPreferences?: () => void;
  editorSplit?: boolean;
  onToggleEditorSplit?: () => void;
  activeSplitPane?: "top" | "bottom";
  showMarginalia: boolean;
  onToggleMarginalia: () => void;
  hiddenMarginaliaTypes: Set<MarginaliaType>;
  onToggleMarginaliaType: (type: MarginaliaType) => void;
  alwaysShowLinkedText: boolean;
  onToggleAlwaysShowLinkedText: () => void;
  availableDividerLevels: Set<DividerLevel>;
  dividerLevels: Set<DividerLevel>;
  onToggleDividerLevel: (level: DividerLevel) => void;
  dividerWidth: DividerWidth;
  onSetDividerWidth: (width: DividerWidth) => void;
  onParaNavBack?: () => void;
  onParaNavForward?: () => void;
  paraNavBackDisabled?: boolean;
  paraNavForwardDisabled?: boolean;
  onExpandAllSections?: () => void;
  onCollapseAllSections?: () => void;
  onCloseAllPanels?: () => void;
  onGrabStart?: (e: React.MouseEvent<HTMLDivElement>) => void;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
}

/** Small outline-style icon button used both in the main floating toolbar
 *  and inside the Format/Actions popups. */
function IconBtn({
  onClick,
  active,
  children,
  title,
  disabled,
  ...rest
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded transition-colors disabled:opacity-25 disabled:cursor-default ${
        active
          ? "bg-[var(--accent-light)] text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Small text button used inside the Format popup for textual glyphs
 *  (pilcrow, $x$, $$). */
function TextBtn({
  onClick,
  active,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded text-sm transition-colors ${
        active
          ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
          : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
      }`}
    >
      {children}
    </button>
  );
}

const BLOCK_TYPES = [
  { value: "0", label: "Body text" },
  { value: "1", label: "Chapter" },
  { value: "2", label: "Section" },
  { value: "3", label: "Subsection" },
  { value: "4", label: "Subsubsection" },
];

function BlockTypeDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});

  const current = editor.isActive("heading", { level: 1 })
    ? "1"
    : editor.isActive("heading", { level: 2 })
      ? "2"
      : editor.isActive("heading", { level: 3 })
        ? "3"
        : editor.isActive("heading", { level: 4 })
          ? "4"
          : "0";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      // Popup height: 5 items × ~30px + 8px padding ≈ 158px. Flip up if below overflows.
      const POPUP_H = 160;
      const POPUP_W = 160;
      const GAP = 4;
      const flipUp = r.bottom + GAP + POPUP_H > window.innerHeight && r.top > POPUP_H + GAP;
      const flipLeft = r.left + POPUP_W > window.innerWidth - 4 && window.innerWidth - r.right > POPUP_W;
      const vertical = flipUp ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP };
      const horizontal = flipLeft ? { right: window.innerWidth - r.right } : { left: r.left };
      setPos({ ...vertical, ...horizontal });
    }
    setOpen(!open);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        title="Block type"
        className="px-1.5 py-0.5 rounded text-sm transition-colors text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body flex items-center gap-1"
      >
        <span style={{ fontSize: "15px", lineHeight: 1 }}>&#182;</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><path d="M0 0l4 5 4-5z"/></svg>
      </button>
      {open && (
        <div className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[60] min-w-[160px]" style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}>
          {BLOCK_TYPES.map((bt) => (
            <button
              key={bt.value}
              onClick={() => {
                if (bt.value === "0") {
                  if (editor.isActive("heading")) editor.chain().focus().setParagraph().run();
                } else {
                  const level = parseInt(bt.value) as 1 | 2 | 3 | 4;
                  editor.chain().focus().toggleHeading({ level }).run();
                }
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-surface-muted flex items-center gap-2"
            >
              <span className="w-4 text-center text-xs">
                {current === bt.value ? "\u2713" : ""}
              </span>
              {bt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Attached popover — renders `anchor` button and, while open, shows
 *  `children` in a fixed-positioned pod anchored just below the button's
 *  right edge. Styled like a miniature version of the main toolbar. */
function AttachedPopover({
  anchor,
  children,
  title,
  active,
}: {
  anchor: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  title: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right?: number; left?: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      // Popup is a fixed-height horizontal row (var(--header-h) = 34px).
      // Flip above the trigger when it would overflow the viewport below.
      const POPUP_H = 34;
      const GAP = 6;
      const flipUp = r.bottom + GAP + POPUP_H > window.innerHeight && r.top > POPUP_H + GAP;
      // Popup width is estimated from its children (~5 × 28px ≈ 140–220px).
      // Flip to left-anchored when right-anchoring would push it off-screen left.
      const POPUP_W_EST = 240;
      const flipLeft = r.right - POPUP_W_EST < 4 && window.innerWidth - r.left > POPUP_W_EST;
      const vertical = flipUp
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP };
      const horizontal = flipLeft
        ? { left: r.left }
        : { right: window.innerWidth - r.right };
      setPos({ ...vertical, ...horizontal });
    }
    setOpen(!open);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        title={title}
        className={`p-1 rounded transition-colors ${
          open || active
            ? "bg-[var(--accent-light)] text-[var(--accent)]"
            : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
        }`}
      >
        {anchor}
      </button>
      {open && pos && (
        <div
          className="fixed flex items-center bg-[var(--pod-toolbar)] z-[55] px-2 gap-0.5"
          style={{
            top: pos.top,
            bottom: pos.bottom,
            right: pos.right,
            left: pos.left,
            height: 'var(--header-h)',
            borderRadius: 'var(--pod-radius)',
            border: 'var(--pod-border)',
            boxShadow: 'var(--pod-shadow)',
          }}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** Viewport-aware dropdown — anchors to the right edge of its trigger and
 *  flips above when it would overflow the bottom of the viewport. */
function ViewMenu({
  showParTitles,
  onToggleParTitles,
  showLatexComments,
  onToggleLatexComments,
  showSectionIndicator,
  onToggleSectionIndicator,
  onOpenPreferences,
  showMarginalia,
  onToggleMarginalia,
  hiddenMarginaliaTypes,
  onToggleMarginaliaType,
  alwaysShowLinkedText,
  onToggleAlwaysShowLinkedText,
  availableDividerLevels,
  dividerLevels,
  onToggleDividerLevel,
  dividerWidth,
  onSetDividerWidth,
  orientation,
  onSetOrientation,
}: Pick<MenuBarProps,
  | "showParTitles" | "onToggleParTitles"
  | "showLatexComments" | "onToggleLatexComments"
  | "showSectionIndicator" | "onToggleSectionIndicator"
  | "onOpenPreferences"
  | "showMarginalia" | "onToggleMarginalia"
  | "hiddenMarginaliaTypes" | "onToggleMarginaliaType"
  | "alwaysShowLinkedText" | "onToggleAlwaysShowLinkedText"
  | "availableDividerLevels" | "dividerLevels" | "onToggleDividerLevel"
  | "dividerWidth" | "onSetDividerWidth"
  | "orientation" | "onSetOrientation"
>) {
  const [open, setOpen] = useState(false);
  const [marginaliaExpanded, setMarginaliaExpanded] = useState(false);
  const [dividersExpanded, setDividersExpanded] = useState(false);
  const [dividerPrefsExpanded, setDividerPrefsExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ v: "below" | "above"; h: "right" | "left" }>({ v: "below", h: "right" });

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current || !dropdownRef.current) return;
    const tr = ref.current.getBoundingClientRect();
    const pr = dropdownRef.current.getBoundingClientRect();
    const GAP = 6;
    const v: "below" | "above" = tr.bottom + pr.height + GAP > window.innerHeight && tr.top > pr.height + GAP ? "above" : "below";
    const h: "right" | "left" = tr.right - pr.width < 4 && window.innerWidth - tr.left > pr.width ? "left" : "right";
    setPlacement((prev) => (prev.v === v && prev.h === h ? prev : { v, h }));
  }, [open, marginaliaExpanded, dividersExpanded, dividerPrefsExpanded]);

  const dropdownClass = [
    "absolute bg-surface border border-[var(--border)] rounded-lg shadow-lg z-[55] w-52 py-1",
    placement.v === "below" ? "top-full mt-1.5" : "bottom-full mb-1.5",
    placement.h === "right" ? "right-0" : "left-0",
  ].join(" ");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${open ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
        title="View options"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {open && (
        <div ref={dropdownRef} className={dropdownClass}>
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">Tool bar</div>
          {(["horizontal", "vertical"] as const).map((o) => (
            <button
              key={o}
              onClick={() => { onSetOrientation(o); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
            >
              <span>{o === "horizontal" ? "Horizontal" : "Vertical"}</span>
              <span className="text-[var(--accent)]">{orientation === o ? "\u2713" : ""}</span>
            </button>
          ))}
          <div className="my-1 border-t border-edge-subtle" />
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">Display</div>
          <button
            onClick={() => { onToggleParTitles(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
          >
            <span>Paragraph titles</span>
            <span className="text-[var(--accent)]">{showParTitles ? "\u2713" : ""}</span>
          </button>
          <button
            onClick={() => { onToggleLatexComments(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
          >
            <span>% comments</span>
            <span className="text-[var(--accent)]">{showLatexComments ? "\u2713" : ""}</span>
          </button>
          <button
            onClick={() => { onToggleSectionIndicator(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
          >
            <span>Current section</span>
            <span className="text-[var(--accent)]">{showSectionIndicator ? "\u2713" : ""}</span>
          </button>
          <div className="my-1 border-t border-edge-subtle" />
          <button
            onClick={() => setMarginaliaExpanded((p) => !p)}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
          >
            <span>Marginalia</span>
            <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: marginaliaExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 1L5.5 4L2.5 7" />
            </svg>
          </button>
          {marginaliaExpanded && (
            <>
              <button
                onClick={() => onToggleMarginalia()}
                className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
              >
                <span>Show marginalia</span>
                <span className="text-[var(--accent)]">{showMarginalia ? "\u2713" : ""}</span>
              </button>
              {showMarginalia && (["quote", "note", "archive", "todo"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => onToggleMarginaliaType(type)}
                  className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
                >
                  <span>{type === "quote" ? "Quotations" : type === "note" ? "Notes" : type === "archive" ? "Archive" : "Todo"}</span>
                  <span className="text-[var(--accent)]">{!hiddenMarginaliaTypes.has(type) ? "\u2713" : ""}</span>
                </button>
              ))}
              <button
                onClick={onToggleAlwaysShowLinkedText}
                title="Persistently highlight text ranges that are linked to notes, cuts, or revisions. When off, highlights appear only on hover or selection."
                className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
              >
                <span>Always show linked text</span>
                <span className="text-[var(--accent)]">{alwaysShowLinkedText ? "\u2713" : ""}</span>
              </button>
            </>
          )}
          {availableDividerLevels.size > 0 && (
            <>
              <button
                onClick={() => setDividersExpanded((p) => !p)}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
              >
                <span>Show dividers for&hellip;</span>
                <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: dividersExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 1L5.5 4L2.5 7" />
                </svg>
              </button>
              {dividersExpanded && (
                <>
                  {([1, 2, 3, 4] as const).filter((lvl) => availableDividerLevels.has(lvl)).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => onToggleDividerLevel(lvl)}
                      className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
                    >
                      <span>{DIVIDER_LEVEL_LABELS[lvl]}</span>
                      <span className="text-[var(--accent)]">{dividerLevels.has(lvl) ? "\u2713" : ""}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setDividerPrefsExpanded((p) => !p)}
                    className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
                  >
                    <span>Divider preferences</span>
                    <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: dividerPrefsExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 1L5.5 4L2.5 7" />
                    </svg>
                  </button>
                  {dividerPrefsExpanded && (["full", "mid", "text"] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => onSetDividerWidth(w)}
                      className="w-full text-left pl-9 pr-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted flex items-center justify-between gap-3"
                    >
                      <span>{DIVIDER_WIDTH_LABELS[w]}</span>
                      <span className="text-[var(--accent)]">{dividerWidth === w ? "\u2713" : ""}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuBar({ editor, onAddComment, onArchive, onCreateFootnote, onQuoteSelection, onAddNote, onCutSelection, showParTitles, onToggleParTitles, showLatexComments, onToggleLatexComments, showSectionIndicator, onToggleSectionIndicator, onOpenPreferences, editorSplit, onToggleEditorSplit, activeSplitPane, showMarginalia, onToggleMarginalia, hiddenMarginaliaTypes, onToggleMarginaliaType, alwaysShowLinkedText, onToggleAlwaysShowLinkedText, availableDividerLevels, dividerLevels, onToggleDividerLevel, dividerWidth, onSetDividerWidth, onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled, onExpandAllSections, onCollapseAllSections, onCloseAllPanels, onGrabStart, orientation, onSetOrientation }: MenuBarProps) {
  if (!editor) return null;

  // Track whether any formatting mark is active — the Format button
  // highlights when the cursor is inside styled content, making the
  // collapsed state still communicative.
  const formatActive =
    editor.isActive("bold") ||
    editor.isActive("italic") ||
    editor.isActive("bulletList") ||
    editor.isActive("orderedList") ||
    editor.isActive("blockquote") ||
    editor.isActive("heading");

  const isVert = orientation === "vertical";
  return (
    <div
      className={`flex items-center bg-[var(--pod-toolbar)] gap-0.5 ${isVert ? "flex-col w-[var(--header-h)] py-1.5" : "h-[var(--header-h)] px-1.5"}`}
      style={{
        borderRadius: 'var(--pod-radius)',
        border: 'var(--pod-border)',
        boxShadow: 'var(--pod-shadow)',
      }}
    >
      <ViewMenu
        showParTitles={showParTitles}
        onToggleParTitles={onToggleParTitles}
        showLatexComments={showLatexComments}
        onToggleLatexComments={onToggleLatexComments}
        showSectionIndicator={showSectionIndicator}
        onToggleSectionIndicator={onToggleSectionIndicator}
        onOpenPreferences={onOpenPreferences}
        showMarginalia={showMarginalia}
        onToggleMarginalia={onToggleMarginalia}
        hiddenMarginaliaTypes={hiddenMarginaliaTypes}
        onToggleMarginaliaType={onToggleMarginaliaType}
        alwaysShowLinkedText={alwaysShowLinkedText}
        onToggleAlwaysShowLinkedText={onToggleAlwaysShowLinkedText}
        availableDividerLevels={availableDividerLevels}
        dividerLevels={dividerLevels}
        onToggleDividerLevel={onToggleDividerLevel}
        dividerWidth={dividerWidth}
        onSetDividerWidth={onSetDividerWidth}
        orientation={orientation}
        onSetOrientation={onSetOrientation}
      />

      {/* Format popup — all text formatting (bold, italic, headings, lists, blockquote, math) */}
      <AttachedPopover
        title="Formatting"
        active={formatActive}
        anchor={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.5 2.5h7.5v2h-3v9h-2v-9h-2.5z" />
          </svg>
        }
      >
        {() => (
          <>
            <IconBtn
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive("bold")}
              title="Bold (Cmd+B)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z"/>
              </svg>
            </IconBtn>
            <IconBtn
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive("italic")}
              title="Italic (Cmd+I)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5"/>
              </svg>
            </IconBtn>
            <div className="w-px h-4 bg-[var(--border)] mx-1" />
            <BlockTypeDropdown editor={editor} />
            <div className="w-px h-4 bg-[var(--border)] mx-1" />
            <IconBtn
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive("bulletList")}
              title="Bullet List"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="3.5" cy="4" r="1.2" fill="currentColor" stroke="none"/>
                <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>
                <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none"/>
                <line x1="6.5" y1="4" x2="13" y2="4"/>
                <line x1="6.5" y1="8" x2="13" y2="8"/>
                <line x1="6.5" y1="12" x2="13" y2="12"/>
              </svg>
            </IconBtn>
            <IconBtn
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive("orderedList")}
              title="Numbered List"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                <text x="2" y="5.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">1</text>
                <text x="2" y="9.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">2</text>
                <text x="2" y="13.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">3</text>
                <line x1="6.5" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="6.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="6.5" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </IconBtn>
            <IconBtn
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              active={editor.isActive("blockquote")}
              title="Blockquote"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
              </svg>
            </IconBtn>
            <div className="w-px h-4 bg-[var(--border)] mx-1" />
            <TextBtn
              onClick={() => {
                editor.chain().focus().insertContent({ type: "inlineMath", attrs: { latex: "x" } }).run();
              }}
              title="Insert inline math"
            >
              $x$
            </TextBtn>
            <TextBtn
              onClick={() => {
                editor.chain().focus().insertContent({ type: "displayMath", attrs: { latex: "\\int f(x)\\,dx" } }).run();
              }}
              title="Insert display math"
            >
              $$
            </TextBtn>
          </>
        )}
      </AttachedPopover>

      {/* Actions popup — document-level actions the user can take against a
          selection (revision, note, cut, archive, footnote, quote), plus
          structural helpers (expand / collapse all sections). */}
      <AttachedPopover
        title="Actions"
        anchor={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2.2L9.6 5.9L13.6 6.3L10.6 9L11.5 13L8 10.9L4.5 13L5.4 9L2.4 6.3L6.4 5.9z" />
          </svg>
        }
      >
        {(close) => (
          <>
            {onAddComment && (
              <IconBtn
                onClick={() => { onAddComment(); close(); }}
                data-add-comment-button
                title="Add revision on selection (Cmd+Shift+M)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 2.5h12a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H4.5L2 13.5V3a.5.5 0 0 1 .5-.5z" />
                  <line x1="8" y1="5.5" x2="8" y2="9" />
                  <line x1="6.25" y1="7.25" x2="9.75" y2="7.25" />
                </svg>
              </IconBtn>
            )}
            {onAddNote && (
              <button
                onClick={() => { onAddNote(); close(); }}
                data-add-note-button
                title="Add note linked to selection"
                className="p-1 rounded text-sm transition-colors text-[#15803d] hover:bg-[#f0fdf4] hover:text-[#166534]"
              >
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-sans), system-ui, sans-serif", lineHeight: 1, display: "inline-block", width: 16, textAlign: "center" }}>N</span>
              </button>
            )}
            {onCutSelection && (
              <button
                onClick={() => { onCutSelection(); close(); }}
                data-cut-selection-button
                title="Cut selection into Cutter panel"
                className="p-1 rounded transition-colors text-[#b45757] hover:bg-[#fef2f2] hover:text-[#993d3d]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="4" cy="4" r="2" />
                  <circle cx="4" cy="12" r="2" />
                  <path d="M13 3L5.5 10.5" />
                  <path d="M9.5 9.5L13 13" />
                </svg>
              </button>
            )}
            {onArchive && (
              <button
                onClick={() => { onArchive(); close(); }}
                title="Archive selected text"
                className="p-1 rounded transition-colors text-[#7191b0] hover:bg-[#f0f5fa] hover:text-[#5a7a99]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="12" height="12" rx="2.5" />
                  <text x="8" y="11.2" textAnchor="middle" fontSize="9" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor" stroke="none">A</text>
                </svg>
              </button>
            )}
            {onCreateFootnote && (
              <button
                onClick={() => { onCreateFootnote(); close(); }}
                title="Create footnote from selection"
                className="p-1 rounded transition-colors text-[#b45757] hover:bg-[#fef2f2] hover:text-[#993d3d]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <text x="3" y="12" fontSize="12" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor">fn</text>
                </svg>
              </button>
            )}
            {onQuoteSelection && (
              <button
                onClick={() => { onQuoteSelection(); close(); }}
                title="Create quotation from selection"
                className="p-1 rounded transition-colors text-[#a16207] hover:bg-[#fffbeb] hover:text-[#854d0e]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
                  <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
                  <path d="M10 3.5C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
                </svg>
              </button>
            )}
            {(onExpandAllSections || onCollapseAllSections) && (
              <>
                <div className="w-px h-4 bg-[var(--border)] mx-1" />
                {onExpandAllSections && (
                  <IconBtn
                    onClick={() => { onExpandAllSections(); close(); }}
                    title="Expand all sections"
                  >
                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 1 L7 4.5 L12 1" />
                      <path d="M2 6.5 L7 10 L12 6.5" />
                    </svg>
                  </IconBtn>
                )}
                {onCollapseAllSections && (
                  <IconBtn
                    onClick={() => { onCollapseAllSections(); close(); }}
                    title="Collapse all sections"
                  >
                    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5.5 L7 2 L12 5.5" />
                      <path d="M2 9 L7 5.5 L12 9" />
                    </svg>
                  </IconBtn>
                )}
              </>
            )}
          </>
        )}
      </AttachedPopover>

      {/* Paragraph navigation — back/forward, kerned tight together */}
      {(onParaNavBack || onParaNavForward) && (
        <div className={`flex items-center${isVert ? " flex-col" : ""}`}>
          {onParaNavBack && (
            <button
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              title="Go back"
              className={`rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body ${isVert ? "px-1 pt-1 pb-0" : "py-1 pl-1 pr-0"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              title="Go forward"
              className={`rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body ${isVert ? "px-1 pt-0 pb-1" : "py-1 pl-0 pr-1"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Split toggle */}
      {onToggleEditorSplit && (
        <button
          onClick={onToggleEditorSplit}
          className={`p-1 rounded transition-colors ${editorSplit ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
          title={editorSplit ? "Close split editor" : "Split editor"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {editorSplit && activeSplitPane === "top" && (
              <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
            )}
            {editorSplit && activeSplitPane === "bottom" && (
              <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
            )}
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </button>
      )}

      {/* Blank — close every panel/window */}
      {onCloseAllPanels && (
        <IconBtn
          onClick={onCloseAllPanels}
          title="Close all panels and windows"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
          </svg>
        </IconBtn>
      )}

      {/* Grab handle — drag to reposition. Grey bar always visible,
          darkens to foreground on hover. Pulled tight against the
          view-options button. */}
      {onGrabStart && (
        <div
          onMouseDown={onGrabStart}
          title="Drag to reposition"
          className={`group/grab cursor-grab active:cursor-grabbing flex items-center ${isVert ? "-mt-0.5 px-1 pt-0 pb-1" : "-ml-0.5 py-1 pl-0 pr-1"}`}
          style={{ touchAction: "none", userSelect: "none" }}
        >
          <div className={`rounded-full bg-[var(--muted-light)] group-hover/grab:bg-[var(--foreground)] transition-colors duration-150 ${isVert ? "h-[3px] w-[18px]" : "w-[3px] h-[18px]"}`} />
        </div>
      )}
    </div>
  );
}

export default memo(MenuBar);
