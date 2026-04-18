"use client";

import { memo, useState, useRef, useEffect, useCallback } from "react";
import { Editor } from "@tiptap/react";

export type MarginaliaType = "quote" | "note" | "archive" | "todo";
export type DividerLevel = 1 | 2 | 3 | 4;

const DIVIDER_LEVEL_LABELS: Record<DividerLevel, string> = {
  1: "Chapters",
  2: "Sections",
  3: "Subsections",
  4: "Subsubsections",
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
  availableDividerLevels: Set<DividerLevel>;
  dividerLevels: Set<DividerLevel>;
  onToggleDividerLevel: (level: DividerLevel) => void;
  onParaNavBack?: () => void;
  onParaNavForward?: () => void;
  paraNavBackDisabled?: boolean;
  paraNavForwardDisabled?: boolean;
  onExpandAllSections?: () => void;
  onCollapseAllSections?: () => void;
}

function Btn({
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
      className={`px-2 py-1 rounded text-sm transition-colors ${
        active
          ? "bg-[var(--accent-light)] text-[var(--accent)] font-medium"
          : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700"
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
  const [pos, setPos] = useState({ top: 0, left: 0 });

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
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(!open);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        title="Block type"
        className="px-2 py-1 rounded text-sm transition-colors text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700 flex items-center gap-1"
      >
        <span style={{ fontSize: "15px", lineHeight: 1 }}>&#182;</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"><path d="M0 0l4 5 4-5z"/></svg>
      </button>
      {open && (
        <div className="fixed bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-50 min-w-[160px]" style={{ top: pos.top, left: pos.left }}>
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
              className="w-full text-left px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-stone-50 flex items-center gap-2"
            >
              <span className="w-4 text-center text-xs">
                {current === bt.value ? "✓" : ""}
              </span>
              {bt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MenuBar({ editor, onAddComment, onArchive, onCreateFootnote, onQuoteSelection, onAddNote, onCutSelection, showParTitles, onToggleParTitles, showLatexComments, onToggleLatexComments, showSectionIndicator, onToggleSectionIndicator, onOpenPreferences, editorSplit, onToggleEditorSplit, activeSplitPane, showMarginalia, onToggleMarginalia, hiddenMarginaliaTypes, onToggleMarginaliaType, availableDividerLevels, dividerLevels, onToggleDividerLevel, onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled, onExpandAllSections, onCollapseAllSections }: MenuBarProps) {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [marginaliaExpanded, setMarginaliaExpanded] = useState(false);
  const [dividersExpanded, setDividersExpanded] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollIndicators();
    el.addEventListener("scroll", updateScrollIndicators);
    const ro = new ResizeObserver(updateScrollIndicators);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollIndicators);
      ro.disconnect();
    };
  }, [updateScrollIndicators, editor]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [viewMenuOpen]);

  if (!editor) return null;

  return (
    <div className="flex items-center bg-[var(--pod-toolbar)] h-[var(--header-h)] min-w-0" style={{ borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
      {/* Pinned FAR-LEFT controls — section expand/collapse. These must
          always stay at the extreme left edge of the menubar. Even if the
          order of other toolbar items changes in future merges, these
          two buttons are anchored here; do not move them into the
          scrollable region or the right-hand pinned group. */}
      {(onExpandAllSections || onCollapseAllSections) && (
        <div className="shrink-0 flex items-center gap-1.5 pl-2 pr-1">
          {onExpandAllSections && (
            <button
              onClick={onExpandAllSections}
              className="text-stone-400 hover:text-stone-600 transition-colors"
              title="Expand all sections"
            >
              <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 1 L7 4.5 L12 1" />
                <path d="M2 6.5 L7 10 L12 6.5" />
              </svg>
            </button>
          )}
          {onCollapseAllSections && (
            <button
              onClick={onCollapseAllSections}
              className="text-stone-400 hover:text-stone-600 transition-colors"
              title="Collapse all sections"
              style={{ marginTop: "-2px" }}
            >
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5 L7 2 L12 5.5" />
                <path d="M2 9 L7 5.5 L12 9" />
              </svg>
            </button>
          )}
        </div>
      )}
      {/* Scrollable toolbar region */}
      <div className="relative flex-1 min-w-0">
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-[var(--pod-toolbar)] to-transparent z-10 pointer-events-none" />
        )}
        <div ref={scrollRef} className="flex items-center gap-1 overflow-x-auto px-3 toolbar-scroll [&>*]:shrink-0">
      {(onParaNavBack || onParaNavForward) && (
        <>
          {onParaNavBack && (
            <button
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              className="p-1 rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700"
              title="Go back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              className="p-1 rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-stone-100 hover:text-stone-700"
              title="Go forward"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          )}
          <div className="w-px h-4 bg-[var(--border)] mx-1" />
        </>
      )}
      <Btn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Cmd+B)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
          <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z"/>
        </svg>
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Cmd+I)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
          <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        </svg>
      </Btn>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <BlockTypeDropdown editor={editor} />

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <Btn
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
      </Btn>
      <Btn
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
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
          <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
        </svg>
      </Btn>

      <div className="w-px h-4 bg-[var(--border)] mx-1" />

      <Btn
        onClick={() => {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "inlineMath",
              attrs: { latex: "x" },
            })
            .run();
        }}
        title="Insert inline math"
      >
        $x$
      </Btn>
      <Btn
        onClick={() => {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "displayMath",
              attrs: { latex: "\\int f(x)\\,dx" },
            })
            .run();
        }}
        title="Insert display math"
      >
        $$
      </Btn>

      {onAddComment && (
        <>
          <div className="w-px h-4 bg-[var(--border)] mx-1" />
          <Btn onClick={onAddComment} title="Add revision on selection (Cmd+Shift+M)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2.5h12a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H4.5L2 13.5V3a.5.5 0 0 1 .5-.5z" />
              <line x1="8" y1="5.5" x2="8" y2="9" />
              <line x1="6.25" y1="7.25" x2="9.75" y2="7.25" />
            </svg>
          </Btn>
        </>
      )}
      {onAddNote && (
        <button
          onClick={onAddNote}
          title="Add note linked to selection"
          className="px-2 py-1 rounded text-sm transition-colors text-[#15803d] hover:bg-[#f0fdf4] hover:text-[#166534]"
        >
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "var(--font-sans), system-ui, sans-serif", lineHeight: 1 }}>N</span>
        </button>
      )}
      {onCutSelection && (
        <button
          onClick={onCutSelection}
          title="Cut selection into Cutter panel"
          className="px-2 py-1 rounded text-sm transition-colors text-[#b45757] hover:bg-[#fef2f2] hover:text-[#993d3d]"
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
          onClick={onArchive}
          title="Archive selected text"
          className="px-2 py-1 rounded text-sm transition-colors text-[#7191b0] hover:bg-[#f0f5fa] hover:text-[#5a7a99]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2.5" />
            <text x="8" y="11.2" textAnchor="middle" fontSize="9" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor" stroke="none">A</text>
          </svg>
        </button>
      )}
      {onCreateFootnote && (
        <button
          onClick={onCreateFootnote}
          title="Create footnote from selection"
          className="px-2 py-1 rounded text-sm transition-colors text-[#b45757] hover:bg-[#fef2f2] hover:text-[#993d3d]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <text x="3" y="12" fontSize="12" fontWeight="600" fontFamily="var(--font-sans), sans-serif" fill="currentColor">fn</text>
          </svg>
        </button>
      )}
      {onQuoteSelection && (
        <button
          onClick={onQuoteSelection}
          title="Create quotation from selection"
          className="px-2 py-1 rounded text-sm transition-colors text-[#a16207] hover:bg-[#fffbeb] hover:text-[#854d0e]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
            <path d="M10 3.5C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)"/>
          </svg>
        </button>
      )}

        </div>
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-[var(--pod-toolbar)] to-transparent z-10 pointer-events-none" />
        )}
      </div>

      {/* Pinned right-side controls — split toggle + view menu grouped
          together, flush against the right edge of the menubar. */}
      <div className="shrink-0 flex items-center pl-1 pr-2">
        {onToggleEditorSplit && (
          <button
            onClick={onToggleEditorSplit}
            className={`p-1.5 rounded transition-colors ${editorSplit ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"}`}
            title={editorSplit ? "Close split editor" : "Split editor"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {/* Shaded half indicating which pane is active */}
              {editorSplit && activeSplitPane === "top" && (
                <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
              )}
              {editorSplit && activeSplitPane === "bottom" && (
                <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
              )}
              {/* Outline + single divider line */}
              <rect x="4" y="4" width="16" height="16" rx="1.5" />
              <line x1="4" y1="12" x2="20" y2="12" />
            </svg>
          </button>
        )}
        <div className="relative" ref={viewMenuRef}>
          <button
            onClick={() => setViewMenuOpen(!viewMenuOpen)}
            className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="View options"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </button>
          {viewMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-[var(--border)] rounded-lg shadow-lg z-50 w-52 py-1">
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-stone-400 uppercase tracking-wide">Display</div>
              <button
                onClick={() => { onToggleParTitles(); setViewMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
              >
                <span>Paragraph titles</span>
                <span className="text-[var(--accent)]">{showParTitles ? "\u2713" : ""}</span>
              </button>
              <button
                onClick={() => { onToggleLatexComments(); setViewMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
              >
                <span>% comments</span>
                <span className="text-[var(--accent)]">{showLatexComments ? "\u2713" : ""}</span>
              </button>
              <button
                onClick={() => { onToggleSectionIndicator(); setViewMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
              >
                <span>Current section</span>
                <span className="text-[var(--accent)]">{showSectionIndicator ? "\u2713" : ""}</span>
              </button>
              <div className="my-1 border-t border-stone-200" />
              <button
                onClick={() => setMarginaliaExpanded((p) => !p)}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
              >
                <span>Marginalia</span>
                <svg className="w-3 h-3 text-stone-400 transition-transform" style={{ transform: marginaliaExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 1L5.5 4L2.5 7" />
                </svg>
              </button>
              {marginaliaExpanded && (
                <>
                  <button
                    onClick={() => onToggleMarginalia()}
                    className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center justify-between gap-3"
                  >
                    <span>Show marginalia</span>
                    <span className="text-[var(--accent)]">{showMarginalia ? "\u2713" : ""}</span>
                  </button>
                  {showMarginalia && (["quote", "note", "archive", "todo"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => onToggleMarginaliaType(type)}
                      className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center justify-between gap-3"
                    >
                      <span>{type === "quote" ? "Quotations" : type === "note" ? "Notes" : type === "archive" ? "Archive" : "Todo"}</span>
                      <span className="text-[var(--accent)]">{!hiddenMarginaliaTypes.has(type) ? "\u2713" : ""}</span>
                    </button>
                  ))}
                </>
              )}
              {availableDividerLevels.size > 0 && (
                <>
                  <button
                    onClick={() => setDividersExpanded((p) => !p)}
                    className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center justify-between gap-3"
                  >
                    <span>Show dividers for&hellip;</span>
                    <svg className="w-3 h-3 text-stone-400 transition-transform" style={{ transform: dividersExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 1L5.5 4L2.5 7" />
                    </svg>
                  </button>
                  {dividersExpanded && ([1, 2, 3, 4] as const).filter((lvl) => availableDividerLevels.has(lvl)).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => onToggleDividerLevel(lvl)}
                      className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 flex items-center justify-between gap-3"
                    >
                      <span>{DIVIDER_LEVEL_LABELS[lvl]}</span>
                      <span className="text-[var(--accent)]">{dividerLevels.has(lvl) ? "\u2713" : ""}</span>
                    </button>
                  ))}
                </>
              )}
              <div className="my-1 border-t border-stone-200" />
              <button
                onClick={() => { onOpenPreferences?.(); setViewMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-stone-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <circle cx="8" cy="8" r="2.5" />
                  <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.17 3.17l1.42 1.42M11.41 11.41l1.42 1.42M3.17 12.83l1.42-1.42M11.41 4.59l1.42-1.42" />
                </svg>
                Preferences&hellip;
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MenuBar);
