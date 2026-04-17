"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import MenuBar, { type MarginaliaType } from "./MenuBar";
import { Editor } from "@tiptap/react";
import SuggestionPanel from "./SuggestionPanel";
import RevisionsPanel from "./CommentPanel";
import NotesPanel, { NoteCard } from "./NotesPanel";
import OutlinePanel, { type SectionPathEntry, buildPerBlockCounts, sumIncludedWords, extractHeadings } from "./OutlinePanel";
import TodoPanel, { TodoRow } from "./TodoPanel";
import ArchivePanel, { ArchiveCard } from "./ArchivePanel";
import ArchiveConnectors from "./ArchiveConnectors";
import FootnotePanel from "./FootnotePanel";
import FootnoteConnectors from "./FootnoteConnectors";
import CitationConnectors from "./CitationConnectors";
import InTextConnectors from "./InTextConnectors";
import ViewToggle from "./ViewToggle";
import ProgressBar from "./ProgressBar";
import { useFiles } from "@/hooks/useFiles";
import { useDocument } from "@/hooks/useDocument";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useRevisions } from "@/hooks/useRevisions";
import { useTodos } from "@/hooks/useTodos";
import { useAiRequests } from "@/hooks/useAiRequests";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useBibSettings } from "@/hooks/useBibSettings";
import { useNotes } from "@/hooks/useNotes";
import { useQuotations } from "@/hooks/useQuotations";
import Marginalia from "./Marginalia";
import {
  isAnchorableNode,
  MIME_ARCHIVE,
  MIME_ARCHIVE_ANCHOR,
  type MarginaliaMarker,
} from "@/lib/marginalia";
import { generateEntityId } from "@/lib/uuid";
import dynamic from "next/dynamic";
import type { CodeEditorHandle } from "./CodeEditor";
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });
import CitationsPanel from "./CitationsPanel";
import BibliographyPanel from "./BibliographyPanel";
import QuotationsPanel from "./QuotationsPanel";
import SearchPanel from "./SearchPanel";
import OmniViewPanel, { type OmniItem, type OmniCategory, PANEL_TO_CATEGORY, DEFAULT_OMNI_CATEGORIES } from "./OmniViewPanel";
import { CitationCard } from "./CitationsPanel";
import { FootnoteCard, OrphanedFootnoteCard } from "./FootnotePanel";
import { QuotationGroupCard } from "./QuotationsPanel";
import EditorMirror from "./EditorMirror";
import { useDragGap } from "@/hooks/useDragGap";
import { useViewPrefs, PanelId, Side, Half } from "@/hooks/useViewPrefs";
import { HSplit } from "./panel-primitives";
import { usePreferences } from "@/hooks/usePreferences";
import { applyTransforms } from "@/lib/color-transforms";
import { PREF_TO_CSS, DERIVED_CSS } from "@/lib/preferences-tree";
import PreferencesModal from "./PreferencesModal";
import AIWindow, { aiRequestDotStatus } from "./AIWindow";
import { useConfirmDialog } from "./ConfirmDialog";
import LabelRefPopover, { type LabelInfo } from "./LabelRefPopover";
import TexFilePickerModal from "./TexFilePickerModal";
import { useWordCount } from "@/hooks/useWordCount";
import { useWordCountConfig } from "@/hooks/useWordCountConfig";
import WordCountPanel from "./WordCountPanel";
import { useFocusMode, sectionRange } from "@/hooks/useFocusMode";
import { serializeToLatex } from "@/lib/latex-serializer";
import pkg from "../../package.json";

const APP_VERSION = pkg.version;
import type { OrphanedFootnote } from "@/lib/types";
import { hasFsaSupport } from "@/lib/fsa-support";
import { queryRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { UnsupportedBrowserNotice } from "./UnsupportedBrowserNotice";
import { DocPermissionGate } from "./DocPermissionGate";

/**
 * Scroll a panel entry so its top aligns with the given viewport Y.
 * Walks up from the entry to find its nearest scrollable ancestor, then:
 *   1. Resets any previously-applied alignment padding.
 *   2. Adjusts scrollTop so the entry's top matches targetY.
 *   3. If the required scroll goes past either end of the scroll range,
 *      adds temporary top/bottom padding on the scroll container to make
 *      up the difference (so e.g. the first card can still be pushed
 *      down to match a citation near the bottom of the viewport).
 * The padding is marked with a data attribute so repeat clicks reset it
 * before re-measuring.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

// In in-text view the panel's scroll is yoked to the editor's via
// useInTextPositions. Mark the panel during programmatic scrolls so the
// panel→editor half of that sync sees the flag and skips — otherwise
// aligning a card would drag the main text along with it.
function suppressReverseSync(scrollEl: HTMLElement) {
  scrollEl.dataset.virgilSuppressReverseSync = "1";
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete scrollEl.dataset.virgilSuppressReverseSync;
    });
  });
}

function alignEntryToY(entry: HTMLElement, targetY: number) {
  // Find the nearest ancestor whose overflow-y is auto or scroll. We pick
  // the *declared* scroll container, not the nearest one that currently
  // overflows — the content may fit before we add alignment padding, but
  // the container is still where we need to scroll.
  const scrollEl = findScrollParent(entry);
  if (!scrollEl) {
    entry.scrollIntoView({ behavior: "instant", block: "nearest" });
    return;
  }

  suppressReverseSync(scrollEl);

  // Reset any prior alignment padding we applied so measurements are clean.
  if (scrollEl.dataset.virgilAlignPadding === "1") {
    scrollEl.style.paddingTop = "";
    scrollEl.style.paddingBottom = "";
    scrollEl.dataset.virgilAlignPadding = "0";
  }

  // First pass: move scrollTop so the entry lines up with targetY.
  const cardY1 = entry.getBoundingClientRect().top;
  const desired = scrollEl.scrollTop + (cardY1 - targetY);
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  if (desired < 0) scrollEl.scrollTop = 0;
  else if (desired > maxScroll) scrollEl.scrollTop = maxScroll;
  else scrollEl.scrollTop = desired;

  // Second pass: if we clamped, add padding to bridge the residual gap.
  // The inline style overrides whatever baseline padding the class sets,
  // so we add to the currently-computed value (otherwise we'd accidentally
  // wipe out the panel's natural py-2 and end up off by ~8px).
  const cardY2 = entry.getBoundingClientRect().top;
  const residual = cardY2 - targetY;
  if (residual > 0.5) {
    // Card is still below target — need more scroll room at the bottom.
    const baseBot = parseFloat(getComputedStyle(scrollEl).paddingBottom) || 0;
    scrollEl.style.paddingBottom = `${baseBot + residual}px`;
    scrollEl.scrollTop = scrollEl.scrollTop + residual;
    scrollEl.dataset.virgilAlignPadding = "1";
  } else if (residual < -0.5) {
    // Card is still above target — pad the top to push it down.
    const baseTop = parseFloat(getComputedStyle(scrollEl).paddingTop) || 0;
    scrollEl.style.paddingTop = `${baseTop + -residual}px`;
    // scrollTop is already 0 from the first-pass clamp.
    scrollEl.dataset.virgilAlignPadding = "1";
  }
}

// Wraps entry.scrollIntoView to suppress the panel→editor scroll sync
// (same reason as suppressReverseSync above).
function scrollEntryIntoView(
  entry: HTMLElement,
  opts?: ScrollIntoViewOptions,
) {
  const scrollEl = findScrollParent(entry);
  if (scrollEl) suppressReverseSync(scrollEl);
  entry.scrollIntoView(opts ?? { behavior: "instant", block: "nearest" });
}

// --- Icons ---
function IconNotes({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function IconRevisions({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconSuggestions({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// Outline icon: headline + two indented bullet+line sub-items
function IconOutline({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <rect x="5.5" y="10.5" width="3" height="3" rx="0.75" fill={c} stroke="none" />
      <path d="M11 12h9" />
      <rect x="5.5" y="17.5" width="3" height="3" rx="0.75" fill={c} stroke="none" />
      <path d="M11 19h7" />
    </svg>
  );
}

function IconArchive({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

// Footnote icon: "fn" in regular weight, larger
function IconFootnote({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill={c}>
      <text x="2" y="15.5" fontSize="15" fontWeight="600" fontFamily="system-ui, sans-serif">fn</text>
    </svg>
  );
}

// Citation icon: open book with bookmark ribbon
function IconCitation({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Page body */}
      <path d="M9 6h9l3 3v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      {/* Page fold */}
      <path d="M18 6v3h3" />
      {/* Arrow shaft going up-left off the page, base at mid-page */}
      <path d="M13 15L3 3" />
      {/* Arrow head — well clear of page */}
      <path d="M7 3H3v4" />
    </svg>
  );
}

function IconBibliography({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8" />
      <path d="M8 12h6" />
    </svg>
  );
}

// Todo icon: checkmarks with lines
function IconTodo({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l2.5 2.5L11 5" />
      <path d="M14 7h7" />
      <path d="M4 17l2.5 2.5L11 15" />
      <path d="M14 17h7" />
    </svg>
  );
}

function IconCutter({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88" />
      <path d="M14.47 14.48L20 20" />
      <path d="M8.12 8.12L12 12" />
    </svg>
  );
}

function IconQuotations({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Rounded box */}
      <rect x="2" y="2" width="20" height="20" rx="3" />
      {/* Quote marks — toolbar style, centered in box */}
      <path d="M8 9.5C8 11.5 9 13 10.5 13.5L9.5 15C8 14.5 6.5 12.8 6.5 10.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S10.5 11.2 9.2 11.2c-.4 0-.8-.1-1.2-.3v-1.4z" fill={c} stroke="none" />
      <path d="M15 9.5C15 11.5 16 13 17.5 13.5L16.5 15C15 14.5 13.5 12.8 13.5 10.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" fill={c} stroke="none" />
    </svg>
  );
}

function IconSearch({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function IconSplit({ active, focusedHalf }: { active?: boolean; focusedHalf?: "top" | "bottom" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Shaded half indicating which pane is focused */}
      {active && focusedHalf === "top" && (
        <rect x="4" y="4" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
      )}
      {active && focusedHalf === "bottom" && (
        <rect x="4" y="12" width="16" height="8" fill="currentColor" fillOpacity="0.35" stroke="none" rx="1" />
      )}
      {/* Outline + single divider line */}
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  );
}

function IconWordCount({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill={c}>
      <text x="3" y="15.5" fontSize="16" fontWeight="700" fontFamily="system-ui, sans-serif">#</text>
    </svg>
  );
}

// OmniView icon: rounded square with three equal-length horizontal
// lines inside, signaling "all panel content threaded together".
function IconBlank({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="1.5" />
    </svg>
  );
}

function IconOmni({ active }: { active?: boolean }) {
  const c = active ? "var(--accent)" : "currentColor";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c}
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="1.5" />
      <line x1="3.25" y1="4" x2="10.75" y2="4" />
      <line x1="3.25" y1="7" x2="10.75" y2="7" />
      <line x1="3.25" y1="10" x2="10.75" y2="10" />
    </svg>
  );
}

const PANEL_META: Record<PanelId, { label: string; icon: (active: boolean) => React.ReactNode }> = {
  outline: { label: "Outline", icon: (a) => <IconOutline active={a} /> },
  todo: { label: "Todo List", icon: (a) => <IconTodo active={a} /> },
  notes: { label: "Notes", icon: (a) => <IconNotes active={a} /> },
  revisions: { label: "Revisions", icon: (a) => <IconRevisions active={a} /> },
  archive: { label: "Archived Text", icon: (a) => <IconArchive active={a} /> },
  footnotes: { label: "Footnotes", icon: (a) => <IconFootnote active={a} /> },
  citations: { label: "Citations", icon: (a) => <IconCitation active={a} /> },
  bibliography: { label: "Bibliography", icon: (a) => <IconBibliography active={a} /> },
  suggestions: { label: "Suggestions", icon: (a) => <IconSuggestions active={a} /> },
  cutter: { label: "Cutter", icon: (a) => <IconCutter active={a} /> },
  quotations: { label: "Quotations", icon: (a) => <IconQuotations active={a} /> },
  search: { label: "Search", icon: (a) => <IconSearch active={a} /> },
  wordcount: { label: "Word Count", icon: (a) => <IconWordCount active={a} /> },
  blank: { label: "Blank", icon: () => null },
  omni: { label: "Omni-view", icon: (a) => <IconOmni active={a} /> },
};

function PlaceholderPanel({ title, hasViewToggle }: { title: string; hasViewToggle?: boolean }) {
  const [viewMode, setViewMode] = useState<import("./ViewToggle").ViewMode>("list");
  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <div className="px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 flex items-center justify-between bg-[var(--header-bg)]">
        <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
        {hasViewToggle && <ViewToggle mode={viewMode} onChange={setViewMode} />}
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-[var(--muted)] text-center">
          {title} panel — coming soon.
        </p>
      </div>
    </div>
  );
}

/**
 * Width-resizable column wrapper for sidebar panels. Supports a single
 * panel as a child OR a split: { top, bottom, ratio, onRatioChange }.
 */
function PanelColumn({
  side,
  width,
  onWidthChange,
  children,
  split,
  collapsed,
  blank,
  focusedHalf,
  onFocusHalf,
  topPanelId,
  bottomPanelId,
}: {
  side: "left" | "right";
  width: number;
  onWidthChange: (w: number) => void;
  children?:
    | React.ReactNode
    | {
        top: React.ReactNode;
        bottom: React.ReactNode;
        ratio: number;
        onRatioChange: (r: number) => void;
      };
  split?: boolean;
  collapsed?: boolean;
  blank?: boolean;
  focusedHalf?: "top" | "bottom";
  onFocusHalf?: (half: "top" | "bottom") => void;
  topPanelId?: PanelId;
  bottomPanelId?: PanelId;
}) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const stackRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (e: MouseEvent) => {
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onWidthChange(Math.max(240, Math.min(600, startWidth.current + delta)));
    },
    [side, onWidthChange],
  );

  const { gapRef, onMouseDown: gapMouseDown } = useDragGap({
    cursor: "col-resize",
    onMove,
    deadzone: 3,
  });

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startWidth.current = width;
      gapMouseDown(e);
    },
    [width, gapMouseDown],
  );

  // Determine if children is a split spec or single ReactNode
  const isSplitChildren = (
    c: typeof children,
  ): c is {
    top: React.ReactNode;
    bottom: React.ReactNode;
    ratio: number;
    onRatioChange: (r: number) => void;
  } =>
    !!c && typeof c === "object" && !Array.isArray(c) && "top" in (c as object) && "bottom" in (c as object);

  const podRadius = 'var(--pod-radius)';

  return (
    <div className="relative flex shrink-0" style={{ width, paddingTop: 'var(--pod-gap)', paddingBottom: 'var(--pod-gap)', paddingLeft: 4, paddingRight: 4 }}>
      {/* Panel pod — partial rounding (flat against icon strip, rounded toward editor) */}
      {collapsed ? (
        /* Collapsed: empty placeholder preserving layout space */
        <div className={`flex-1 min-w-0 ${side === "left" ? "order-1" : "order-2"}`} />
      ) : split && isSplitChildren(children) ? (
        /* When split, each half is its own pod so the gap reveals the canvas */
        <div
          ref={stackRef}
          className={`flex-1 min-w-0 flex flex-col min-h-0 panel-container ${side === "left" ? "order-1" : "order-2"}`}
        >
          <div
            className="min-h-0 overflow-hidden"
            style={{ flex: `${children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("top")}
            data-panel-side={side}
            data-panel-id={topPanelId}
            data-panel-half="top"
          >
            {children!.top}
          </div>
          <HSplit
            ratio={children!.ratio}
            onRatioChange={children!.onRatioChange}
            containerRef={stackRef}
          />
          <div
            className="min-h-0 overflow-hidden"
            style={{ flex: `${1 - children!.ratio} 1 0`, minHeight: 0, background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
            onMouseDown={() => onFocusHalf?.("bottom")}
            data-panel-side={side}
            data-panel-id={bottomPanelId}
            data-panel-half="bottom"
          >
            {children!.bottom}
          </div>
        </div>
      ) : (
        <div
          className={`flex-1 min-w-0 panel-container ${blank ? "" : "overflow-hidden"} ${side === "left" ? "order-1" : "order-2"}`}
          style={blank ? undefined : { background: 'var(--pod-panel)', borderRadius: podRadius, border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow-light)' }}
          data-panel-side={side}
          data-panel-id={topPanelId}
        >
          {(children as React.ReactNode)}
        </div>
      )}
      {/* Drag gap — spans full gutter between panel pod and editor pod */}
      <div
        ref={gapRef}
        className={`drag-gap drag-gap-v shrink-0 ${side === "left" ? "order-2" : "order-1"}`}
        style={{ width: 'var(--pod-gap)' }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}


/**
 * Floating section-path lozenge that appears at the top of an editor pane
 * on scroll, then fades out after a short idle period.
 */
function SectionLozenge({ sectionPath }: { sectionPath: SectionPathEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const scrollEl = ref.current?.parentElement?.querySelector(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const onScroll = () => {
      setVisible(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), 1800);
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      clearTimeout(timerRef.current);
    };
  }, []);

  const show = visible && sectionPath.length > 0;

  return (
    <div
      ref={ref}
      className="absolute top-1 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      <div className="px-3 py-0.5 rounded-full text-[11px] font-medium backdrop-blur-sm shadow-sm whitespace-nowrap max-w-[320px] truncate" style={{ background: 'var(--background)', color: '#44403c', border: '1px solid var(--border-light)' }}>
        {sectionPath.map((entry, i) => (
          <span key={i}>
            {i > 0 && <span className="mx-1 opacity-50">›</span>}
            <span className={i === sectionPath.length - 1 ? "font-semibold" : "opacity-80"}>
              {entry.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Two-pane editor split: canonical TipTap view on the left, EditorMirror
 * on the right (sharing the same ProseMirror state). Vertical drag
 * divider sets the ratio. Each pane has its own X close button that
 * collapses the split.
 */
function SplitEditorPanes({
  editorInstance,
  canonical,
  ratio,
  onRatioChange,
  onClose,
  onMirrorFocus,
  onMirrorViewReady,
  sectionPath,
  mirrorSectionPath,
  showSectionIndicator,
}: {
  editorInstance: Editor | null;
  canonical: React.ReactNode;
  ratio: number;
  onRatioChange: (r: number) => void;
  onClose: () => void;
  onMirrorFocus?: () => void;
  onMirrorViewReady?: (view: import("prosemirror-view").EditorView | null) => void;
  sectionPath: SectionPathEntry[];
  mirrorSectionPath: SectionPathEntry[];
  showSectionIndicator: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback(
    (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const r = (ev.clientY - rect.top) / rect.height;
      onRatioChange(Math.max(0.15, Math.min(0.85, r)));
    },
    [onRatioChange],
  );

  const { gapRef: editorGapRef, onMouseDown } = useDragGap({ cursor: "row-resize", onMove });

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Top pane — own white pod */}
      <div
        className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${ratio} 1 0`, background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}
      >
        {canonical}
        {showSectionIndicator && <SectionLozenge sectionPath={sectionPath} />}
      </div>
      {/* Drag gap — canvas shows between the two editor pods */}
      <div className="relative shrink-0 z-10" style={{ height: 'var(--pod-gap)' }}>
        <div
          className="absolute inset-x-0 cursor-row-resize"
          style={{ top: -4, bottom: -4, background: "transparent" }}
          onMouseDown={onMouseDown}
        />
        <div
          ref={editorGapRef}
          className="drag-gap drag-gap-h w-full h-full"
          onMouseDown={onMouseDown}
        />
      </div>
      {/* Bottom pane — own white pod */}
      <div
        className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${1 - ratio} 1 0`, background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}
      >
        <EditorMirror
          editor={editorInstance}
          onClose={onClose}
          onFocus={onMirrorFocus}
          onViewReady={onMirrorViewReady}
        />
        {showSectionIndicator && <SectionLozenge sectionPath={mirrorSectionPath} />}
      </div>
    </div>
  );
}

// --- Draggable Icon Strip Button ---
// Uses pointer events. Drags an icon ghost. Supports cross-side moves
// (via viewport center) and same-side reordering (via Y position).
function StripButton({
  panelId,
  active,
  onClick,
  onMove,
  side,
  badge,
  stripRef,
}: {
  panelId: PanelId;
  active: boolean;
  onClick: () => void;
  onMove: (draggedId: PanelId, toSide: Side, toIndex?: number) => void;
  side: Side;
  badge?: boolean;
  stripRef: React.RefObject<HTMLDivElement | null>;
}) {
  const meta = PANEL_META[panelId as keyof typeof PANEL_META];
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!meta) return null;
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const handledByPointer = useRef(false);

  if (!meta) return null;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    handledByPointer.current = false;
  }, []);

  const indicatorRef = useRef<HTMLDivElement | null>(null);

  const updateDropIndicator = useCallback((clientX: number, clientY: number) => {
    // Find which strip we're hovering
    const centerX = window.innerWidth / 2;
    const targetSide = clientX < centerX ? "left" : "right";
    const strips = document.querySelectorAll("[data-strip-side]");
    const targetStrip = Array.from(strips).find(
      (el) => (el as HTMLElement).dataset.stripSide === targetSide
    ) as HTMLElement | undefined;

    if (!targetStrip) {
      indicatorRef.current?.remove();
      indicatorRef.current = null;
      return;
    }

    // Ensure indicator element exists
    if (!indicatorRef.current) {
      const ind = document.createElement("div");
      ind.id = "virgil-drop-indicator";
      ind.style.cssText = `
        position: fixed; z-index: 9998; pointer-events: none;
        height: 2px; background: var(--accent); border-radius: 1px;
        transition: top 0.1s ease, left 0.1s ease;
      `;
      document.body.appendChild(ind);
      indicatorRef.current = ind;
    }

    const allBtns = Array.from(targetStrip.querySelectorAll("[data-panel-id]"));
    const isSameSide = targetSide === side;
    // On same side, skip the dragged button so indicator matches movePanel's index
    const buttons = isSameSide
      ? allBtns.filter((el) => (el as HTMLElement).dataset.panelId !== panelId)
      : allBtns;
    const stripRect = targetStrip.getBoundingClientRect();
    const ind = indicatorRef.current;

    // Set horizontal position/width to match strip
    ind.style.left = `${stripRect.left + 4}px`;
    ind.style.width = `${stripRect.width - 8}px`;

    if (buttons.length === 0) {
      ind.style.top = `${stripRect.top + 12}px`;
      return;
    }

    // Find the gap the cursor is nearest to
    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        ind.style.top = `${rect.top - 2}px`;
        return;
      }
    }
    // After last button
    const lastRect = buttons[buttons.length - 1].getBoundingClientRect();
    ind.style.top = `${lastRect.bottom + 2}px`;
  }, [side, panelId]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    const dy = e.clientY - pointerStart.current.y;
    if (!isDragging.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      // Clone the icon as ghost
      const ghost = document.createElement("div");
      ghost.id = "virgil-drag-ghost";
      ghost.style.cssText = `
        position: fixed; z-index: 9999; pointer-events: none;
        padding: 8px; border-radius: 8px;
        background: white; border: 1px solid var(--border);
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        opacity: 0.95; display: flex; align-items: center; justify-content: center;
        color: var(--accent);
      `;
      // Copy the SVG from the button
      const svg = btnRef.current?.querySelector("svg");
      if (svg) {
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute("stroke", "var(--accent)");
        clone.setAttribute("width", "18");
        clone.setAttribute("height", "18");
        ghost.appendChild(clone);
      }
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
    }
    if (isDragging.current) {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${e.clientX - 18}px`;
        ghostRef.current.style.top = `${e.clientY - 18}px`;
      }
      updateDropIndicator(e.clientX, e.clientY);
    }
  }, [updateDropIndicator]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    ghostRef.current?.remove();
    ghostRef.current = null;
    indicatorRef.current?.remove();
    indicatorRef.current = null;

    if (isDragging.current) {
      const centerX = window.innerWidth / 2;
      const toSide: Side = e.clientX < centerX ? "left" : "right";

      // Determine drop index by finding which button the cursor is nearest
      const targetStripSide = toSide;
      // Find the strip container for the target side
      const strips = document.querySelectorAll("[data-strip-side]");
      const targetStrip = Array.from(strips).find(
        (el) => (el as HTMLElement).dataset.stripSide === targetStripSide
      ) as HTMLElement | undefined;

      let toIndex: number | undefined;
      if (targetStrip) {
        const allButtons = Array.from(targetStrip.querySelectorAll("[data-panel-id]"));
        const isSameSide = toSide === side;
        // When dropping on the same side, skip the dragged button to match
        // movePanel's index (it filters the item out before splicing).
        // When crossing sides, the dragged button isn't in the target strip.
        const buttons = isSameSide
          ? allButtons.filter((el) => (el as HTMLElement).dataset.panelId !== panelId)
          : allButtons;
        const dropY = e.clientY;
        toIndex = buttons.length; // default: end
        for (let i = 0; i < buttons.length; i++) {
          const rect = buttons[i].getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if (dropY < midY) {
            toIndex = i;
            break;
          }
        }
      }

      onMove(panelId, toSide, toIndex);
      isDragging.current = false;
      pointerStart.current = null;
      return;
    }

    pointerStart.current = null;
    handledByPointer.current = true;
    onClick();
  }, [side, onMove, panelId, onClick]);

  return (
    <button
      ref={btnRef}
      data-panel-id={panelId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={() => {
        if (!handledByPointer.current) {
          onClick();
        }
        handledByPointer.current = false;
      }}
      className={`p-2 rounded transition-colors relative select-none ${
        active ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
      }`}
      title={meta.label}
    >
      {meta.icon(active)}
      {badge && (
        <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
      )}
    </button>
  );
}

export default function EditorLayout() {
  // In-app confirmation dialog — replaces native window.confirm for
  // workflows that benefit from a styled, app-themed modal (e.g.
  // confirming a footnote move on drop). Mount `confirmDialog` once at
  // the layout root so any descendant caller can await `confirm(...)`.
  const { confirm: runConfirm, dialog: confirmDialog } = useConfirmDialog();
  const confirmFootnoteMove = useCallback(
    () =>
      runConfirm({
        title: "Move footnote?",
        message:
          "This will move the footnote from its current position in the document to where you dropped it.",
        confirmLabel: "Move",
        cancelLabel: "Cancel",
        tone: "danger",
      }),
    [runConfirm],
  );

  const {
    docs,
    openTabs,
    currentDocId,
    currentDoc,
    loading: filesLoading,
    createFile,
    deleteFile,
    renameFile,
    openFile,
    closeTab,
    openExistingFile,
    pendingFolderPick,
    selectFileInFolder,
    cancelFolderPick,
  } = useFiles();

  // Per-doc permission gate state. We query (without prompting) when
  // the active doc changes; if it isn't already granted we show the
  // gate, which calls requestRW from inside its click handler.
  type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";
  const [docPermState, setDocPermState] = useState<DocPermState>("loading");
  const [activeDocHandle, setActiveDocHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Hooks read from disk, so we gate their docId on the permission
  // state. Until the active folder has been re-granted readwrite
  // permission for this session, every hook sees `null` and stays in
  // its empty state instead of crashing on NotAllowedError. The UI
  // (tab strip, path bar) keeps using the un-gated currentDocId.
  const docIdForHooks: string | null =
    docPermState === "granted" ? currentDocId : null;

  const { content, loading: docLoading, onUpdate, saveStatus, refetch: refetchDoc } = useDocument(docIdForHooks);
  const {
    state: suggestionsState,
    currentSuggestion,
    isComplete,
    actOnSuggestion,
    updateSuggestionField,
    jumpToSuggestion,
    clearSuggestions,
  } = useSuggestions(docIdForHooks);
  const {
    users: revisionUsers,
    activeUserId: activeRevisionUserId,
    generalRevisions,
    textRevisions,
    setActiveUser: setActiveRevisionUser,
    addUser: addRevisionUser,
    addGeneralRevision,
    addTextRevision,
    addTurn: addRevisionTurn,
    resolveRevision,
    reopenRevision,
    deleteRevision,
    refresh: refreshRevisions,
  } = useRevisions(docIdForHooks);
  const activeRevisionsCount =
    generalRevisions.filter((r) => !r.resolved).length +
    textRevisions.filter((r) => !r.resolved).length;
  const {
    notes,
    addNote,
    updateNote,
    updateNoteTitle,
    addNoteParagraphId,
    removeNoteParagraphId,
    deleteNote,
  } = useNotes(docIdForHooks);
  const {
    groups: quotationGroups,
    addGroup: addQuotationGroup,
    deleteGroup: deleteQuotationGroup,
    updateGroupTitle: updateQuotationGroupTitle,
    updateNotes: updateQuotationNotes,
    addParagraphId: addQuotationParagraphId,
    removeParagraphId: removeQuotationParagraphId,
    addReference: addQuotationReference,
    deleteReference: deleteQuotationReference,
    updateReferenceCiteKey: updateQuotationReferenceCiteKey,
    addQuote: addQuotationQuote,
    updateQuote: updateQuotationQuote,
    deleteQuote: deleteQuotationQuote,
  } = useQuotations(docIdForHooks);
  const {
    items: todoItems,
    addItem: addTodo,
    toggleItem: toggleTodo,
    updateItem: updateTodo,
    updateNotes: updateTodoNotes,
    deleteItem: deleteTodo,
    archiveDone: archiveTodos,
    addParagraphId: addTodoParagraphId,
    removeParagraphId: removeTodoParagraphId,
  } = useTodos(docIdForHooks);

  const {
    requests: aiRequests,
    addRequest: addAiRequest,
    updateRequestText: updateAiRequestText,
    deleteRequest: deleteAiRequest,
  } = useAiRequests(docIdForHooks);

  const {
    snippets: archiveSnippets,
    archiveContent,
    updateSnippet: updateArchiveSnippet,
    updateSnippetTitle: updateArchiveSnippetTitle,
    addParagraphId: addArchiveParagraphId,
    removeParagraphId: removeArchiveParagraphId,
    restoreSnippet,
    deleteSnippet,
  } = useArchive(docIdForHooks);

  const {
    citations,
    bibPath,
    citationStyle,
    bibPackage,
    bibEntries,
    addCitation,
    updateCitation,
    deleteCitation,
    setStyle: setCitationStyle,
    setBibPackage,
    addBibEntry,
    updateBibEntry,
    updateBibKeyAndType,
    getDisplayText: getCitationDisplayText,
    getFormattedBib,
    syncFromEditor: syncCitationsFromEditor,
  } = useCitations(docIdForHooks);

  const { getAnnotation, setAnnotation } = useAnnotations(docIdForHooks);
  const {
    requests: bibReviewRequests,
    requestReview: requestBibReview,
    cancelRequest: cancelBibReview,
    getRequestStatus: getBibReviewStatus,
    refresh: refreshBibReview,
  } = useBibReview(docIdForHooks);
  const {
    generalBibPath,
    entryRequests,
    setGeneralBibPath,
    addEntryRequest,
    removeEntryRequest,
    refresh: refreshBibSettings,
  } = useBibSettings(docIdForHooks);

  const {
    prefs,
    leftItems,
    rightItems,
    togglePanel,
    movePanel,
    setPanelWidth,
    getPanelWidth,
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    setActiveLeft,
    setActiveRight,
    setActiveHalf,
    toggleSplit,
    setSplitRatio,
    setEditorSplit,
    setEditorSplitRatio,
  } = useViewPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const editorSplit = prefs.editorSplit;
  const editorSplitRatio = prefs.editorSplitRatio;

  // Which half (top or bottom) is currently focused on each side. Used to
  // route strip-icon clicks when the side is split. Session-only state.
  const [focusedHalfLeft, setFocusedHalfLeft] = useState<Half>("top");
  const [focusedHalfRight, setFocusedHalfRight] = useState<Half>("top");
  // Which pane last received focus — used to route panel interactions
  // (outline clicks, note jumps, etc.) to the pane the user is in.
  const [activeSplitPane, setActiveSplitPane] = useState<"top" | "bottom">("top");
  const mirrorViewRef = useRef<import("prosemirror-view").EditorView | null>(null);

  const editorRef = useRef<EditorHandle>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  // When a panel mini-editor (e.g. footnote RichTextField) is focused,
  // the main toolbar should route commands to it instead of the main editor.
  const [overrideEditor, setOverrideEditor] = useState<Editor | null>(null);
  const { counts: wordCounts, selection: wordSelection } = useWordCount(editorInstance);
  const focusMode = useFocusMode();
  const { config: focusWcConfig } = useWordCountConfig();
  const [showParTitles, setShowParTitles] = useState(true);
  const [showLatexComments, setShowLatexComments] = useState(true);

  // Marginalia visibility — persisted
  const [showMarginalia, setShowMarginalia] = useState(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("virgil-show-marginalia"); return v !== "false"; } catch { return true; }
  });
  const [hiddenMarginaliaTypes, setHiddenMarginaliaTypes] = useState<Set<MarginaliaType>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("virgil-hidden-marginalia-types");
      return raw ? new Set(JSON.parse(raw) as MarginaliaType[]) : new Set();
    } catch { return new Set(); }
  });
  const toggleMarginalia = useCallback(() => {
    setShowMarginalia((prev) => {
      const next = !prev;
      try { localStorage.setItem("virgil-show-marginalia", String(next)); } catch {}
      return next;
    });
  }, []);
  const toggleMarginaliaType = useCallback((type: MarginaliaType) => {
    setHiddenMarginaliaTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      try { localStorage.setItem("virgil-hidden-marginalia-types", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  // Section indicator lozenge visibility — persisted
  const [showSectionIndicator, setShowSectionIndicator] = useState(() => {
    if (typeof window === "undefined") return true;
    try { const v = localStorage.getItem("virgil-show-section-indicator"); return v !== "false"; } catch { return true; }
  });
  const toggleSectionIndicator = useCallback(() => {
    setShowSectionIndicator((prev) => {
      const next = !prev;
      try { localStorage.setItem("virgil-show-section-indicator", String(next)); } catch {}
      return next;
    });
  }, []);

  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aiWindowOpen, setAiWindowOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);

  useEffect(() => {
    if (!versionOpen) return;
    const close = () => setVersionOpen(false);
    const id = window.setTimeout(() => window.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("click", close);
    };
  }, [versionOpen]);
  const aiDot = useMemo(() => aiRequestDotStatus({
    bibReviewRequests,
    bibEntryRequests: entryRequests,
    generalRevisions,
    textRevisions,
    panelAiRequests: aiRequests,
  }), [bibReviewRequests, entryRequests, generalRevisions, textRevisions, aiRequests]);
  const { prefs: editorPrefs, transforms: editorTransforms, presets: editorPresets, updatePref, updateTransform, resetAll: resetPrefs, savePreset, loadPreset, deletePreset } = usePreferences();
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const latestDocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedQuotationGroupId, setSelectedQuotationGroupId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [selectedFootnoteId, setSelectedFootnoteId] = useState<string | null>(null);
  const [orphanedFootnotes, setOrphanedFootnotes] = useState<OrphanedFootnote[]>([]);
  const suppressOrphanRef = useRef<Set<string>>(new Set());
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);

  // ── LabelRef popover state ──
  const [activeRefLabel, setActiveRefLabel] = useState<string | null>(null);
  const [activeRefRect, setActiveRefRect] = useState<DOMRect | null>(null);
  const [bibActiveCitationId, setBibActiveCitationId] = useState<string | null>(null);
  const [pendingCitationCreate, setPendingCitationCreate] = useState<string | null>(null);
  // Whether the in-flight pending create should be inserted into the
  // editor on save ("anchored", from the \cite typing rule) or kept as
  // a panel-only card the user can later drag into the document
  // ("unanchored", from the panel + button).
  const [pendingCitationMode, setPendingCitationMode] = useState<"anchored" | "unanchored">("anchored");
  const [searchHighlightRange, setSearchHighlightRange] = useState<{ from: number; to: number } | null>(null);

  // Lifted view modes — persist across panel re-mounts and across sessions
  const [panelViewModes, setPanelViewModes] = useState<Record<string, "list" | "in-text">>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("virgil-panel-view-modes");
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const getPanelViewMode = useCallback((panelId: string) => panelViewModes[panelId] || "list", [panelViewModes]);
  const setPanelViewMode = useCallback((panelId: string, mode: "list" | "in-text") => {
    setPanelViewModes((prev) => {
      const next = { ...prev, [panelId]: mode };
      try { localStorage.setItem("virgil-panel-view-modes", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Persisted omni-view category preferences per side
  const [omniCategories, setOmniCategories] = useState<Record<"left" | "right", OmniCategory[]>>(() => {
    if (typeof window === "undefined") return DEFAULT_OMNI_CATEGORIES;
    try {
      const raw = localStorage.getItem("virgil-omni-categories");
      if (!raw) return DEFAULT_OMNI_CATEGORIES;
      const parsed = JSON.parse(raw);
      return {
        left: Array.isArray(parsed.left) ? parsed.left : DEFAULT_OMNI_CATEGORIES.left,
        right: Array.isArray(parsed.right) ? parsed.right : DEFAULT_OMNI_CATEGORIES.right,
      };
    } catch { return DEFAULT_OMNI_CATEGORIES; }
  });
  const getOmniEnabled = useCallback((side: "left" | "right") => new Set(omniCategories[side]), [omniCategories]);
  const toggleOmniCategory = useCallback((side: "left" | "right", cat: OmniCategory) => {
    setOmniCategories((prev) => {
      const list = prev[side];
      const next = list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat];
      const updated = { ...prev, [side]: next };
      try { localStorage.setItem("virgil-omni-categories", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  // Derive which strip side each category's native panel lives on
  const categorySides = useMemo(() => {
    const result = {} as Record<OmniCategory, "left" | "right">;
    for (const p of prefs.placements) {
      const cat = PANEL_TO_CATEGORY[p.id];
      if (cat) result[cat] = p.side;
    }
    // Ensure all categories have a side (fallback to defaults)
    for (const [, cat] of Object.entries(PANEL_TO_CATEGORY)) {
      if (!(cat in result)) {
        result[cat] = DEFAULT_OMNI_CATEGORIES.left.includes(cat) ? "left" : "right";
      }
    }
    return result;
  }, [prefs.placements]);

  // Inject editor preferences as CSS custom properties (with global transforms)
  useEffect(() => {
    const s = document.documentElement.style;
    for (const entry of PREF_TO_CSS) {
      const raw = editorPrefs[entry.key];
      let value: string;
      if (entry.isColor && typeof raw === "string") {
        value = applyTransforms(raw, editorTransforms);
      } else if (entry.transform) {
        value = entry.transform(raw);
      } else {
        value = String(raw);
      }
      s.setProperty(entry.cssVar, value);
    }
    for (const entry of DERIVED_CSS) {
      s.setProperty(entry.cssVar, entry.compute(editorPrefs));
    }
    // Update browser theme-color meta tag
    const tc = applyTransforms(editorPrefs.themeColor, editorTransforms);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tc);
  }, [editorPrefs, editorTransforms]);

  const [codeView, setCodeView] = useState(false);
  const [codeViewLine, setCodeViewLine] = useState<number | undefined>(undefined);
  const [codeViewParagraphId, setCodeViewParagraphId] = useState<string | null>(null);
  const codeEditorHandleRef = useRef<CodeEditorHandle | null>(null);
  const pendingScrollText = useRef<string | null>(null);
  const pendingParagraphId = useRef<string | null>(null);

  // Paragraph navigation history (back/forward) — ref-based to avoid stale closures
  const paraHistoryRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const currentParaRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const [paraNavVersion, setParaNavVersion] = useState(0); // bump to re-render toolbar

  // Scroll TipTap to position after returning from code view
  useEffect(() => {
    if (!editorInstance) return;

    // Prefer paragraph UUID for scroll sync
    const paraId = pendingParagraphId.current;
    if (paraId) {
      pendingParagraphId.current = null;
      pendingScrollText.current = null; // clear text fallback
      const doScroll = () => {
        try {
          editorRef.current?.scrollToParagraphId(paraId);
        } catch { /* ignore */ }
      };
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 500);
      return;
    }

    // Fallback: text-based matching (for edge cases where UUID isn't available)
    if (!pendingScrollText.current) return;
    const snippet = pendingScrollText.current;
    pendingScrollText.current = null;

    // Extract meaningful words from the LaTeX lines — strip all commands/braces
    const cleaned = snippet
      .replace(/\\[a-zA-Z]+\*?/g, " ")     // strip command names
      .replace(/\[[^\]]*\]/g, " ")          // strip optional args
      .replace(/[{}\\$~^_&%#]/g, " ")       // strip special chars
      .replace(/\s+/g, " ")
      .trim();

    // Get words long enough to be meaningful (avoid matching "the", "and", etc.)
    const words = cleaned.split(" ").filter((w) => w.length > 3);
    if (words.length < 2) return;

    const docText = editorInstance.state.doc.textBetween(
      0, editorInstance.state.doc.content.size, "\n"
    );

    // Use regex with .*? between words — same approach as V→C (tolerates formatting differences)
    let matchIdx = -1;
    for (let len = Math.min(words.length, 6); len >= 2; len--) {
      // Escape regex special chars in each word
      const escaped = words.slice(0, len).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = escaped.join("[\\s\\S]{0,30}");
      try {
        const re = new RegExp(pattern);
        const match = re.exec(docText);
        if (match) {
          matchIdx = match.index;
          break;
        }
      } catch { /* invalid regex — try shorter */ }
    }

    if (matchIdx < 0) return;

    // Convert text offset to ProseMirror doc position
    let pos = 0;
    let textOffset = 0;
    editorInstance.state.doc.descendants((node, nodePos) => {
      if (pos > 0) return false;
      if (node.isText) {
        const len = (node.text || "").length;
        if (textOffset + len > matchIdx) {
          pos = nodePos + (matchIdx - textOffset);
          return false;
        }
        textOffset += len;
      } else if (node.isBlock && textOffset > 0) {
        textOffset += 1; // \n separator
      }
      return true;
    });

    if (pos > 0) {
      const doScroll = () => {
        try {
          editorInstance.commands.setTextSelection(pos);
          const coords = editorInstance.view.coordsAtPos(pos);
          const scrollEl = editorInstance.view.dom.closest(".overflow-y-auto");
          if (scrollEl && coords) {
            const scrollRect = scrollEl.getBoundingClientRect();
            const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 150;
            scrollEl.scrollTop = Math.max(0, targetY);
          }
        } catch { /* pos out of range */ }
      };
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 500);
    }
  }, [editorInstance]);

  // Track active paragraph and build navigation history
  // Model: stack always includes current position, idx points to where we are now.
  // Back: idx--, Forward: idx++, New position: truncate forward + push.
  useEffect(() => {
    if (!editorInstance && !codeView) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const checkParagraph = () => {
      if (navigatingRef.current) return;
      let paraId: string | null = null;
      if (codeView) {
        paraId = codeEditorHandleRef.current?.getActiveParagraphId() ?? null;
      } else if (editorRef.current) {
        paraId = editorRef.current.getActiveParagraphId();
      }
      if (!paraId || paraId === currentParaRef.current) return;
      currentParaRef.current = paraId;
      const h = paraHistoryRef.current;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(paraId);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
      setParaNavVersion((v) => v + 1);
    };

    const debouncedCheck = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(checkParagraph, 1000);
    };

    if (!codeView && editorInstance) {
      const scrollEl = editorInstance.view.dom.closest(".overflow-y-auto");
      scrollEl?.addEventListener("scroll", debouncedCheck, { passive: true });
      const interval = setInterval(debouncedCheck, 2000);
      return () => {
        scrollEl?.removeEventListener("scroll", debouncedCheck);
        clearInterval(interval);
        if (timerId) clearTimeout(timerId);
      };
    } else if (codeView) {
      const interval = setInterval(debouncedCheck, 2000);
      return () => {
        clearInterval(interval);
        if (timerId) clearTimeout(timerId);
      };
    }
  }, [editorInstance, codeView]);

  // Clear history on document change
  useEffect(() => {
    paraHistoryRef.current = { stack: [], idx: -1 };
    currentParaRef.current = null;
    setParaNavVersion((v) => v + 1);
  }, [currentDocId]);

  const scrollToParagraph = useCallback((uuid: string) => {
    // Sentinel for document top / title area
    if (uuid === "__DOC_TOP__") {
      editorRef.current?.scrollToHeading(-1);
      return;
    }
    if (codeView) {
      codeEditorHandleRef.current?.scrollToParagraphId?.(uuid);
    } else {
      editorRef.current?.scrollToParagraphId(uuid);
    }
  }, [codeView]);

  const paraNavBack = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    setParaNavVersion((v) => v + 1);
    setTimeout(() => { navigatingRef.current = false; }, 1500);
  }, [scrollToParagraph]);

  const paraNavForward = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    setParaNavVersion((v) => v + 1);
    setTimeout(() => { navigatingRef.current = false; }, 1500);
  }, [scrollToParagraph]);

  // Derive citation order from editor state
  // Debounced citation order and editor citations (avoid recomputing on every keystroke)
  const [citationOrder, setCitationOrder] = useState<string[]>([]);
  const [allEditorCitations, setAllEditorCitations] = useState<Array<{ citationId: string; command: string; keys: string[]; pos: number }>>([]);
  const citationPositionMap = useMemo(
    () => new Map(allEditorCitations.map((c) => [c.citationId, c.pos])),
    [allEditorCitations]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setCitationOrder(editorRef.current?.getCitationOrder() ?? []);
      const cits = editorRef.current?.getCitations() ?? [];
      setAllEditorCitations(
        cits.map((c) => {
          // Match all {key} groups — handles \cites{a}{b}{c} and \citep{a,b,c}
          const allMatches = [...c.command.matchAll(/\{([^}]+)\}/g)];
          const keys = allMatches.flatMap((m) => m[1].split(",").map((k: string) => k.trim()));
          return { citationId: c.citationId, command: c.command, keys, pos: c.pos };
        })
      );
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

  // Update citation display text when bib entries or style changes
  useEffect(() => {
    if (!editorInstance || bibEntries.length === 0) return;
    const cits = editorRef.current?.getCitations() ?? [];
    for (const c of cits) {
      const display = getCitationDisplayText(c.command);
      if (display !== c.displayText) {
        editorRef.current?.updateCitationDisplay(c.citationId, display);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bibEntries, editorInstance, getCitationDisplayText]);

  // Sync citation nodes from editor into citations state on load.
  // Editor is source of truth (IDs are regenerated each parse), so we
  // always run sync — even when there are zero editor citations — so
  // stale anchored ids from a previous session get dropped (only
  // explicitly-unanchored entries survive the merge).
  useEffect(() => {
    if (!editorInstance) return;
    const editorCits = editorRef.current?.getCitations() ?? [];
    syncCitationsFromEditor(editorCits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorInstance]);

  // Highlight citation nodes in editor when a bib key is selected in Bibliography panel
  useEffect(() => {
    if (!selectedBibKey) return;
    // Find all citation nodes whose keys include the selected bib key
    const matching = allEditorCitations.filter((c) => c.keys.includes(selectedBibKey));
    const els: HTMLElement[] = [];
    for (const c of matching) {
      const el = document.querySelector(`[data-citation-id="${c.citationId}"]`) as HTMLElement | null;
      if (el) {
        el.classList.add("citation-highlight-bib");
        els.push(el);
      }
    }
    return () => {
      for (const el of els) el.classList.remove("citation-highlight-bib");
    };
  }, [selectedBibKey, allEditorCitations]);

  // Persistent highlight sync: whenever a citation card is selected in
  // the Citations panel or OmniView, mirror that selection onto the
  // citation node(s) in the editor with the `citation-highlight-bib`
  // class. The highlight stays on until a different citation is
  // selected or the selection is cleared. There can be multiple DOM
  // nodes for the same citation id if the editor is split.
  useEffect(() => {
    if (!selectedCitationId) return;
    const els = Array.from(
      document.querySelectorAll(
        `[data-citation-id="${selectedCitationId}"]`,
      ),
    ) as HTMLElement[];
    for (const el of els) el.classList.add("citation-highlight-bib");
    return () => {
      for (const el of els) el.classList.remove("citation-highlight-bib");
    };
  }, [selectedCitationId, allEditorCitations]);

  // Persistent highlight sync for footnotes: mirrors the citation
  // pattern above, adding `footnote-highlight-marker` to the inline
  // footnote marker in the editor when its card is selected.
  useEffect(() => {
    if (!selectedFootnoteId) return;
    const els = Array.from(
      document.querySelectorAll(
        `[data-footnote-id="${selectedFootnoteId}"]`,
      ),
    ) as HTMLElement[];
    for (const el of els) el.classList.add("footnote-highlight-marker");
    return () => {
      for (const el of els) el.classList.remove("footnote-highlight-marker");
    };
  }, [selectedFootnoteId]);

  // Clear the toolbar-override editor when the main editor regains focus,
  // so the MenuBar switches back to controlling the document editor.
  useEffect(() => {
    if (!editorInstance) return;
    const clearOverride = () => setOverrideEditor(null);
    editorInstance.on("focus", clearOverride);
    return () => { editorInstance.off("focus", clearOverride); };
  }, [editorInstance]);

  // ── Focus mode: inject a <style> tag to hide/dim editor blocks ───
  // ProseMirror's DOM reconciliation strips classes and inline styles
  // from its managed nodes. A <style> tag with nth-child selectors is
  // immune to this since PM doesn't touch <style> elements.
  const focusStyleRef = useRef<HTMLStyleElement | null>(null);
  const focusStateRef = useRef(focusMode.state);
  focusStateRef.current = focusMode.state;

  useEffect(() => {
    const fs = focusMode.state;

    // Remove previous style tag
    if (focusStyleRef.current) {
      focusStyleRef.current.remove();
      focusStyleRef.current = null;
    }

    if (!fs.active || !editorInstance) return;

    const style = document.createElement("style");
    style.setAttribute("data-virgil-focus", "true");

    // Build CSS rules using nth-child to target blocks outside the range
    const rules: string[] = [];
    const selector = ".tiptap > *";
    const totalChildren = editorInstance.view.dom.children.length;

    for (let i = 0; i < totalChildren; i++) {
      const outside = i < fs.startBlockIndex || i > fs.endBlockIndex;
      if (outside) {
        const nth = i + 1; // nth-child is 1-based
        if (fs.locked) {
          rules.push(`.tiptap > :nth-child(${nth}) { display: none !important; }`);
        } else {
          rules.push(`.tiptap > :nth-child(${nth}) { opacity: 0.25 !important; pointer-events: none !important; }`);
        }
      }
    }

    style.textContent = rules.join("\n");
    document.head.appendChild(style);
    focusStyleRef.current = style;

    // When locking, move cursor into visible range if needed
    if (fs.locked) {
      const doc = editorInstance.view.state.doc;
      const { from } = editorInstance.view.state.selection;
      let firstVisiblePos = 0;
      let selBlockIdx = 0;
      let needsMove = false;
      doc.forEach((node, offset) => {
        if (selBlockIdx === fs.startBlockIndex) firstVisiblePos = offset + 1;
        if (from >= offset && from < offset + node.nodeSize) {
          if (selBlockIdx < fs.startBlockIndex || selBlockIdx > fs.endBlockIndex) needsMove = true;
        }
        selBlockIdx++;
      });
      if (needsMove) {
        try { editorInstance.commands.setTextSelection(firstVisiblePos); } catch {}
      }
    }

    return () => {
      if (focusStyleRef.current) {
        focusStyleRef.current.remove();
        focusStyleRef.current = null;
      }
    };
  }, [editorInstance, focusMode.state]);

  // Current-section breadcrumb: tracks the heading chain of whatever
  // the reader is currently looking at — i.e., the topmost heading
  // above the visible viewport. Headings are collected from the doc,
  // their viewport-relative positions are measured, and we pick the
  // last one whose top is above (or at) a reference line just below
  // the toolbar. Recomputes on scroll, doc change, and resize.
  const [currentSectionPath, setCurrentSectionPath] = useState<SectionPathEntry[]>([]);
  // Top-level block index of the paragraph/list whose parTitle the
  // reader has most recently scrolled past within the current section.
  // Resets whenever a new heading is crossed. null when none.
  const [currentParTitleIndex, setCurrentParTitleIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!editorInstance) return;
    const view = editorInstance.view;
    const scrollEl = view.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const compute = () => {
      const doc = editorInstance.state.doc;
      // Collect all top-level headings with their text + level + DOM top
      const scrollRect = scrollEl.getBoundingClientRect();
      // Reference line: the vertical middle of the editor viewport. A
      // heading/parTitle becomes "active" once it has scrolled past
      // this midline. Using the middle (instead of just under the top)
      // matches the natural reading focus and makes click-to-scroll
      // align cleanly: scrollToHeading uses block:"center", so the
      // jumped-to heading lands on the reference line and the dot
      // animates straight to it.
      const referenceY = scrollRect.top + scrollRect.height / 2;

      const stack: { level: number; text: string; index: number }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number }[] = [];
      // Track the last parTitle paragraph whose top has scrolled past
      // the reference line, within the current section scope. Reset
      // whenever a heading is crossed.
      let activeParTitleIdx: number | null = null;

      // When focus is locked, skip blocks outside the focus range — their
      // DOM nodes are hidden and would report bogus viewport positions.
      const fs = focusStateRef.current;
      const skipHidden = fs.active && fs.locked;

      doc.forEach((node, offset, index) => {
        if (skipHidden && (index < fs.startBlockIndex || index > fs.endBlockIndex)) return;

        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          // Measure where this heading is on screen
          let headingTop: number | null = null;
          try {
            const coords = view.coordsAtPos(offset + 1);
            headingTop = coords.top;
          } catch {
            headingTop = null;
          }
          if (headingTop == null) return;

          // If the heading has scrolled past the reference line (its
          // top is above the reference), include it in the active
          // stack. Otherwise stop scanning — later headings haven't
          // been reached yet.
          if (headingTop <= referenceY) {
            while (stack.length > 0 && stack[stack.length - 1].level >= level) {
              stack.pop();
            }
            stack.push({ level, text: node.textContent || "Untitled", index });
            lastCrossedStack = [...stack];
            // New section scope — clear any active parTitle from the
            // previous section so we re-scan within this one.
            activeParTitleIdx = null;
          }
          return;
        }

        // Paragraph/list with a parTitle — track the most recent one
        // above the reference line inside the current section.
        if (
          (node.type.name === "paragraph" ||
            node.type.name === "bulletList" ||
            node.type.name === "orderedList") &&
          node.attrs?.parTitle
        ) {
          let top: number | null = null;
          try {
            const coords = view.coordsAtPos(offset + 1);
            top = coords.top;
          } catch {
            top = null;
          }
          if (top == null) return;
          if (top <= referenceY) {
            activeParTitleIdx = index;
          }
        }
      });

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index }));
      setCurrentSectionPath((prev) => {
        if (prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index)) {
          return prev;
        }
        return path;
      });
      setCurrentParTitleIndex((prev) =>
        prev === activeParTitleIdx ? prev : activeParTitleIdx,
      );
    };

    // Initial + event-driven recompute. Throttle scroll via RAF.
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editorInstance.on("update", schedule);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance.off("update", schedule);
    };
  }, [editorInstance]);

  // Mirror (second pane) position tracking — same logic as above but
  // scoped to the mirror ProseMirror view's scroll container.
  const [mirrorSectionPath, setMirrorSectionPath] = useState<SectionPathEntry[]>([]);
  const [mirrorParTitleIndex, setMirrorParTitleIndex] = useState<number | null>(null);
  // Re-run when the mirror view is (re)created: we store a generation
  // counter that bumps whenever onMirrorViewReady fires.
  const [mirrorViewGen, setMirrorViewGen] = useState(0);
  useEffect(() => {
    const mirrorView = mirrorViewRef.current;
    if (!editorSplit || !mirrorView) {
      setMirrorSectionPath([]);
      setMirrorParTitleIndex(null);
      return;
    }
    const scrollEl = mirrorView.dom.closest(".overflow-y-auto") as HTMLElement | null;
    if (!scrollEl) return;

    const compute = () => {
      const doc = mirrorView.state.doc;
      const scrollRect = scrollEl.getBoundingClientRect();
      const referenceY = scrollRect.top + scrollRect.height / 2;

      const stack: { level: number; text: string; index: number }[] = [];
      let lastCrossedStack: { level: number; text: string; index: number }[] = [];
      let activeParTitleIdx: number | null = null;

      doc.forEach((node, offset, index) => {
        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          let headingTop: number | null = null;
          try { headingTop = mirrorView.coordsAtPos(offset + 1).top; } catch { headingTop = null; }
          if (headingTop == null) return;
          if (headingTop <= referenceY) {
            while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
            stack.push({ level, text: node.textContent || "Untitled", index });
            lastCrossedStack = [...stack];
            activeParTitleIdx = null;
          }
          return;
        }
        if (
          (node.type.name === "paragraph" || node.type.name === "bulletList" || node.type.name === "orderedList") &&
          node.attrs?.parTitle
        ) {
          let top: number | null = null;
          try { top = mirrorView.coordsAtPos(offset + 1).top; } catch { top = null; }
          if (top != null && top <= referenceY) activeParTitleIdx = index;
        }
      });

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({ text: s.text, index: s.index }));
      setMirrorSectionPath((prev) =>
        prev.length === path.length && prev.every((v, i) => v.text === path[i].text && v.index === path[i].index) ? prev : path,
      );
      setMirrorParTitleIndex((prev) => (prev === activeParTitleIdx ? prev : activeParTitleIdx));
    };

    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Re-compute when the doc changes (shared state with main editor).
    editorInstance?.on("update", schedule);
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editorInstance?.off("update", schedule);
    };
  }, [editorSplit, mirrorViewGen, editorInstance]);

  // Derive footnotes list from editor state (sorted by document position)
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

  // Set of archive snippet IDs that have at least one paragraph anchor
  const anchoredIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const s of archiveSnippets) {
      if (s.paragraphIds.length > 0) ids.add(s.id);
    }
    return ids;
  }, [archiveSnippets]);

  // Snippets sorted: anchored first (by paragraph position in doc), orphaned after
  const sortedArchiveSnippets = useMemo(() => {
    // Build a paragraph-order map from the editor doc
    const paragraphOrder = new Map<string, number>();
    const ed = editorRef.current?.getEditor();
    if (ed) {
      let idx = 0;
      ed.state.doc.descendants((node) => {
        if (isAnchorableNode(node.type) && node.attrs?.uuid) {
          paragraphOrder.set(node.attrs.uuid as string, idx++);
        }
        return true;
      });
    }
    return [...archiveSnippets].sort((a, b) => {
      const aPos = a.paragraphIds.length > 0 ? paragraphOrder.get(a.paragraphIds[0]) : undefined;
      const bPos = b.paragraphIds.length > 0 ? paragraphOrder.get(b.paragraphIds[0]) : undefined;
      if (aPos != null && bPos != null) return aPos - bPos;
      if (aPos != null) return -1;
      if (bPos != null) return 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveSnippets, latestDoc, editorInstance]);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  // New-doc name input shown when the user clicks +. We can't use
  // window.prompt() here because it consumes the user gesture, and
  // showDirectoryPicker() requires a fresh activation. Pressing Enter
  // in this inline input is itself a real user gesture, which is what
  // lets the picker open.
  const [newDocName, setNewDocName] = useState<string | null>(null);
  const newDocInputRef = useRef<HTMLInputElement>(null);

  // FSA browser support — defaults to true for SSR/initial render to
  // avoid a flash, then re-checks after mount.
  const [fsaSupported, setFsaSupported] = useState(true);
  useEffect(() => {
    setFsaSupported(hasFsaSupport());
  }, []);
  const nameInputRef = useRef<HTMLInputElement>(null);


  const hasSuggestions = suggestionsState.suggestions.length > 0;

  // Auto-show suggestions panel when suggestions load
  useEffect(() => {
    if (hasSuggestions) {
      const hasPending = suggestionsState.suggestions.some((s) => s.status === "pending");
      if (hasPending && prefsRef.current.activeRight !== "suggestions") setActiveRight("suggestions");
    }
  }, [suggestionsState.suggestions.length, hasSuggestions, setActiveRight]);

  useEffect(() => {
    if (editingTabId) nameInputRef.current?.focus();
  }, [editingTabId]);

  useEffect(() => {
    if (newDocName !== null) newDocInputRef.current?.focus();
  }, [newDocName]);

  // Whenever the active doc changes, look up its handle in idb and
  // query (don't request) readwrite permission. The result drives the
  // gate vs editor render decision below.
  // In dev-storage mode we skip the FSA permission dance entirely.
  useEffect(() => {
    if (!currentDocId) {
      setDocPermState("no-handle");
      setActiveDocHandle(null);
      return;
    }
    if (process.env.NEXT_PUBLIC_DEV_STORAGE) {
      setDocPermState("granted");
      return;
    }
    let cancelled = false;
    setDocPermState("loading");
    (async () => {
      try {
        const handle = await getDocHandle(currentDocId);
        if (cancelled) return;
        if (!handle) {
          setActiveDocHandle(null);
          setDocPermState("no-handle");
          return;
        }
        setActiveDocHandle(handle);
        const state = await queryRW(handle);
        if (cancelled) return;
        setDocPermState(state === "granted" ? "granted" : "needs-grant");
      } catch (err) {
        console.error("Failed to query doc permission:", err);
        if (!cancelled) setDocPermState("needs-grant");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentDocId]);

  const handleDocPermissionGranted = useCallback(() => {
    setDocPermState("granted");
    refetchDoc();
  }, [refetchDoc]);

  const handleUpdate = useCallback(
    (doc: JSONContent) => {
      onUpdate(doc);
      if (latestDocTimerRef.current) clearTimeout(latestDocTimerRef.current);
      latestDocTimerRef.current = setTimeout(() => setLatestDoc(doc), 300);
    },
    [onUpdate]
  );

  // ── Focus mode helpers ─────────────────────────────────────────────
  const docForOutline = latestDoc || content;
  const outlineHeadings = useMemo(() => extractHeadings(docForOutline).headings, [docForOutline]);
  const outlineTotalBlocks = useMemo(() => docForOutline?.content?.length ?? 0, [docForOutline]);

  const handleFocusActivate = useCallback(() => {
    focusMode.activate(outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusMoveTo = useCallback((blockIndex: number) => {
    focusMode.moveTo(blockIndex, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusExpandTo = useCallback((blockIndex: number) => {
    focusMode.expandTo(blockIndex, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  const handleFocusSnapBoundary = useCallback((edge: "top" | "bottom", blockIndex: number) => {
    focusMode.snapBoundary(edge, blockIndex, outlineHeadings, outlineTotalBlocks);
  }, [focusMode, outlineHeadings, outlineTotalBlocks]);

  // Focus word count: sum per-block counts within the focused range
  const focusWordCount = useMemo(() => {
    if (!focusMode.state.active) return null;
    const perBlock = buildPerBlockCounts(docForOutline);
    const words = sumIncludedWords(perBlock, focusMode.state.startBlockIndex, focusMode.state.endBlockIndex + 1, focusWcConfig.include);
    return { words };
  }, [focusMode.state, docForOutline, focusWcConfig.include]);

  const handleScrollToHeading = useCallback((blockIndex: number) => {
    // If the split is open and the bottom pane is active, scroll the mirror
    // view; otherwise fall back to the canonical editor's scroll behavior.
    const mirrorView = mirrorViewRef.current;
    if (editorSplit && activeSplitPane === "bottom" && mirrorView) {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      if (blockIndex === -1) {
        editor.commands.setTextSelection(1);
        const scrollEl = mirrorView.dom.closest(".overflow-y-auto") as HTMLElement | null;
        if (scrollEl) scrollEl.scrollTop = 0;
        return;
      }
      let pos = 0;
      let idx = 0;
      editor.state.doc.forEach((_node, offset) => {
        if (idx === blockIndex) pos = offset + 1;
        idx++;
      });
      if (pos > 0) {
        editor.commands.setTextSelection(pos);
        try {
          const domAtPos = mirrorView.domAtPos(pos);
          const el = domAtPos.node instanceof HTMLElement
            ? domAtPos.node
            : domAtPos.node.parentElement;
          el?.scrollIntoView({ behavior: "instant", block: "center" });
        } catch { /* noop */ }
      }
      return;
    }
    editorRef.current?.scrollToHeading(blockIndex);
  }, [editorSplit, activeSplitPane]);

  // Scroll `pos` into view in whichever pane is currently active.
  const handleScrollToPos = useCallback((pos: number) => {
    const mirrorView = mirrorViewRef.current;
    if (editorSplit && activeSplitPane === "bottom" && mirrorView) {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const clamped = Math.max(0, Math.min(pos, editor.state.doc.content.size));
      try {
        editor.commands.setTextSelection(clamped);
        const coords = mirrorView.coordsAtPos(clamped);
        const scrollEl = mirrorView.dom.closest(".overflow-y-auto") as HTMLElement | null;
        if (scrollEl && coords) {
          const scrollRect = scrollEl.getBoundingClientRect();
          const targetY = coords.top - scrollRect.top + scrollEl.scrollTop - 100;
          scrollEl.scrollTop = Math.max(0, targetY);
        }
      } catch { /* pos out of range */ }
      return;
    }
    editorRef.current?.scrollToPos(pos);
  }, [editorSplit, activeSplitPane]);

  const handleReorderBlocks = useCallback((fromIndex: number, count: number, toIndex: number) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const doc = editor.state.doc;
    // Collect absolute positions of each top-level block
    const positions: { from: number; to: number }[] = [];
    doc.forEach((node, offset) => {
      positions.push({ from: offset, to: offset + node.nodeSize });
    });
    if (fromIndex < 0 || fromIndex + count > positions.length || toIndex < 0 || toIndex > positions.length) return;
    if (toIndex >= fromIndex && toIndex <= fromIndex + count) return; // no-op

    const sliceFrom = positions[fromIndex].from;
    const sliceTo = positions[fromIndex + count - 1].to;
    const slice = doc.slice(sliceFrom, sliceTo);

    let tr = editor.state.tr;
    if (toIndex < fromIndex) {
      // Moving upward: insert first, then delete (positions shift correctly)
      const insertPos = positions[toIndex].from;
      tr = tr.insert(insertPos, slice.content);
      // After insert, the original range shifted by slice size
      const shift = slice.content.size;
      tr = tr.delete(sliceFrom + shift, sliceTo + shift);
    } else {
      // Moving downward: delete first, then insert
      tr = tr.delete(sliceFrom, sliceTo);
      // After delete, positions above the deleted range shifted
      const shift = sliceTo - sliceFrom;
      const insertPos = toIndex >= positions.length
        ? positions[positions.length - 1].to - shift
        : positions[toIndex].from - shift;
      tr = tr.insert(insertPos, slice.content);
    }
    editor.view.dispatch(tr);
  }, []);

  const handleRenameHeading = useCallback((blockIndex: number, newText: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    let idx = 0;
    editor.state.doc.forEach((node, offset) => {
      if (idx === blockIndex && node.type.name === "heading") {
        const from = offset + 1; // inside the heading node
        const to = offset + node.nodeSize - 1; // end of heading content
        const tr = editor.state.tr.delete(from, to).insertText(newText, from);
        editor.view.dispatch(tr);
      }
      idx++;
    });
  }, []);

  const handleUpdateLabel = useCallback((blockIndex: number, newLabel: string | null) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    let idx = 0;
    editor.state.doc.forEach((node, offset) => {
      if (idx === blockIndex && node.type.name === "heading") {
        const tr = editor.state.tr.setNodeMarkup(offset, undefined, {
          ...node.attrs,
          label: newLabel && newLabel.trim() ? newLabel.trim() : null,
        });
        editor.view.dispatch(tr);
      }
      idx++;
    });
  }, []);

  const handleRenameParTitle = useCallback((blockIndex: number, newTitle: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    let idx = 0;
    editor.state.doc.forEach((node, offset) => {
      if (idx === blockIndex) {
        const tr = editor.state.tr.setNodeMarkup(offset, undefined, { ...node.attrs, parTitle: newTitle });
        editor.view.dispatch(tr);
      }
      idx++;
    });
  }, []);

  const handleAct = useCallback(
    (id: string, action: "accepted" | "rejected" | "skipped") => {
      if (action === "accepted" && currentSuggestion && currentSuggestion.id === id) {
        const replacement = currentSuggestion.revision || currentSuggestion.suggested_text;
        editorRef.current?.replaceText(currentSuggestion.original_text, replacement);
      }
      actOnSuggestion(id, action);
    },
    [actOnSuggestion, currentSuggestion]
  );

  const handleArchive = useCallback(() => {
    if (!editorRef.current) return;
    const selectedText = editorRef.current.getSelectedText();
    if (!selectedText || !selectedText.trim()) return;
    // Create snippet with plain text to get an ID
    const snippet = archiveContent(selectedText);
    // archiveSelection deletes the selection and returns rich content + paragraphId
    const result = editorRef.current.archiveSelection(snippet.id);
    if (result) {
      if (result.content) updateArchiveSnippet(snippet.id, result.content);
      if (result.paragraphId) addArchiveParagraphId(snippet.id, result.paragraphId);
    }
    // Ensure archive panel is open
    const archivePlacement = prefs.placements.find((p) => p.id === "archive");
    if (archivePlacement?.side === "left") {
      if (prefs.activeLeft !== "archive") setActiveLeft("archive");
    } else {
      if (prefs.activeRight !== "archive") setActiveRight("archive");
    }
  }, [archiveContent, updateArchiveSnippet, addArchiveParagraphId, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  const insertingRef = useRef(false);
  const handleInsertArchive = useCallback((id: string) => {
    if (insertingRef.current) return;
    insertingRef.current = true;
    const found = archiveSnippets.find((s) => s.id === id);
    if (found && editorRef.current) {
      editorRef.current.restoreArchive(found.content);
      deleteSnippet(id);
      setSelectedArchiveId(null);
    }
    requestAnimationFrame(() => { insertingRef.current = false; });
  }, [archiveSnippets, deleteSnippet]);

  const handleRestoreArchive = useCallback((id: string) => {
    const snippet = restoreSnippet(id);
    if (snippet) {
      editorRef.current?.restoreArchive(snippet.content);
    }
    setSelectedArchiveId(null);
  }, [restoreSnippet]);

  const handleDeleteArchive = useCallback((id: string) => {
    deleteSnippet(id);
    setSelectedArchiveId(null);
  }, [deleteSnippet]);

  // --- Footnote handlers ---
  const handleCreateFootnote = useCallback(() => {
    if (!editorRef.current) return;
    const result = editorRef.current.createFootnoteFromSelection();
    if (!result) return;
    editorRef.current.renumberFootnotes();
    // Open footnotes panel
    const fnPlacement = prefs.placements.find((p) => p.id === "footnotes");
    if (fnPlacement?.side === "left") {
      if (prefs.activeLeft !== "footnotes") setActiveLeft("footnotes");
    } else {
      if (prefs.activeRight !== "footnotes") setActiveRight("footnotes");
    }
    setSelectedFootnoteId(result.footnoteId);
  }, [prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  // --- Quotation handlers ---
  const handleQuoteSelection = useCallback(() => {
    if (!editorRef.current) return;
    const ed = editorRef.current.getEditor();
    if (!ed) return;
    const { from, to } = ed.state.selection;
    if (from === to) return; // nothing selected
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    const paragraphId = editorRef.current.ensureParagraphUuid(from);
    const group = addQuotationGroup({ text, paragraphId });
    // Open quotations panel
    const placement = prefs.placements.find((p) => p.id === "quotations");
    if (placement?.side === "left") {
      if (prefs.activeLeft !== "quotations") setActiveLeft("quotations");
    } else {
      if (prefs.activeRight !== "quotations") setActiveRight("quotations");
    }
    setSelectedQuotationGroupId(group.id);
  }, [
    addQuotationGroup,
    prefs.placements,
    prefs.activeLeft,
    prefs.activeRight,
    setActiveLeft,
    setActiveRight,
  ]);

  // Listen for quotation drops onto paragraphs (dispatched by Editor.tsx handleDrop)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.groupId && detail?.paragraphId) {
        addQuotationParagraphId(detail.groupId, detail.paragraphId);
        setSelectedQuotationGroupId(detail.groupId);
      }
    };
    window.addEventListener("virgil-quotation-drop", handler);
    return () => window.removeEventListener("virgil-quotation-drop", handler);
  }, [addQuotationParagraphId]);

  // Listen for todo drops onto paragraphs (dispatched by Editor.tsx handleDrop)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.todoId && detail?.paragraphId) {
        addTodoParagraphId(detail.todoId, detail.paragraphId);
        setSelectedTodoId(detail.todoId);
      }
    };
    window.addEventListener("virgil-todo-drop", handler);
    return () => window.removeEventListener("virgil-todo-drop", handler);
  }, [addTodoParagraphId]);

  // Listen for note drops onto paragraphs — anchor the note to the paragraph UUID.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.noteId && detail?.paragraphId) {
        addNoteParagraphId(detail.noteId, detail.paragraphId);
        setSelectedNoteId(detail.noteId);
      }
    };
    window.addEventListener("virgil-note-drop", handler);
    return () => window.removeEventListener("virgil-note-drop", handler);
  }, [addNoteParagraphId]);

  // Listen for marginalia reanchor events (dragging a gutter icon to a new paragraph)
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, entityId, oldParagraphId, newParagraphId } = (e as CustomEvent).detail;
      if (!type || !entityId || !newParagraphId) return;

      if (type === "quote") {
        removeQuotationParagraphId(entityId, oldParagraphId);
        addQuotationParagraphId(entityId, newParagraphId);
      } else if (type === "todo") {
        removeTodoParagraphId(entityId, oldParagraphId);
        addTodoParagraphId(entityId, newParagraphId);
      } else if (type === "note") {
        removeNoteParagraphId(entityId, oldParagraphId);
        addNoteParagraphId(entityId, newParagraphId);
      } else if (type === "archive") {
        removeArchiveParagraphId(entityId, oldParagraphId);
        addArchiveParagraphId(entityId, newParagraphId);
      }
    };
    window.addEventListener("virgil-marginalia-reanchor", handler);
    return () => window.removeEventListener("virgil-marginalia-reanchor", handler);
  }, [addQuotationParagraphId, removeQuotationParagraphId, addNoteParagraphId, removeNoteParagraphId, addTodoParagraphId, removeTodoParagraphId, addArchiveParagraphId, removeArchiveParagraphId]);

  // When the user clicks a linking element in the editor, route the
  // scroll target based on whether OmniView is currently visible. If a
  // card with `data-omni-entry="${key}"` exists in the DOM, OmniView is
  // active AND displaying this kind of pod — scroll there. Otherwise
  // the caller falls back to the specialized panel.
  //
  // This is purely a DOM presence check, so it automatically handles
  // every case (left omni, right omni, both, neither) without the
  // callers needing to know about panel placement.
  const tryScrollOmniEntry = useCallback(
    (key: string, targetY?: number): boolean => {
      // Use starts-with selector so multi-paragraph instances (e.g. "nt:id@0")
      // are found when searching for the base key ("nt:id").
      const entry = document.querySelector(
        `[data-omni-entry="${key}"], [data-omni-entry^="${key}@"]`,
      ) as HTMLElement | null;
      if (!entry) return false;
      requestAnimationFrame(() => {
        if (typeof targetY === "number") {
          alignEntryToY(entry, targetY);
        } else {
          scrollEntryIntoView(entry);
        }
      });
      return true;
    },
    [],
  );

  const handleQuotationMarkerClick = useCallback(
    (groupId: string) => {
      setSelectedQuotationGroupId(groupId);
      // Route to OmniView if it has a card for this group
      if (tryScrollOmniEntry(`qu:${groupId}`)) return;
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "quotations");
      if (placement?.side === "left") {
        if (p.activeLeft !== "quotations") setActiveLeft("quotations");
      } else {
        if (p.activeRight !== "quotations") setActiveRight("quotations");
      }
    },
    [setActiveLeft, setActiveRight, tryScrollOmniEntry]
  );

  const handleNoteMarkerClick = useCallback(
    (noteId: string) => {
      const nextSelected = selectedNoteId === noteId ? null : noteId;
      setSelectedNoteId(nextSelected);
      // Route to OmniView if selecting (not deselecting) and it has a card
      if (nextSelected && tryScrollOmniEntry(`nt:${noteId}`)) return;
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "notes");
      if (placement?.side === "left") {
        if (p.activeLeft !== "notes") setActiveLeft("notes");
      } else {
        if (p.activeRight !== "notes") setActiveRight("notes");
      }
    },
    [setActiveLeft, setActiveRight, selectedNoteId, tryScrollOmniEntry]
  );

  const handleTodoMarkerClick = useCallback(
    (todoId: string) => {
      const nextSelected = selectedTodoId === todoId ? null : todoId;
      setSelectedTodoId(nextSelected);
      if (nextSelected && tryScrollOmniEntry(`td:${todoId}`)) return;
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "todo");
      if (placement?.side === "left") {
        if (p.activeLeft !== "todo") setActiveLeft("todo");
      } else {
        if (p.activeRight !== "todo") setActiveRight("todo");
      }
    },
    [setActiveLeft, setActiveRight, selectedTodoId, tryScrollOmniEntry]
  );

  const handleEditFootnote = useCallback((id: string, newContent: JSONContent) => {
    editorRef.current?.updateFootnoteContent(id, newContent);
  }, []);

  const handleEditFootnoteTitle = useCallback((id: string, title: string) => {
    editorRef.current?.updateFootnoteTitle(id, title);
  }, []);

  // Used by the footnote/note rich-text panels when the user drops a brand-new
  // citation. Mirrors the main editor's onCitationDrop: register the
  // command in the citations store so it shows up in the side panel and
  // gets a stable id, then return the resolved id + display text for the
  // mini-editor to attach to the new Citation node.
  const handleCitationCreated = useCallback(
    (command: string) => {
      const display = getCitationDisplayText(command);
      const ref = addCitation(command);
      return { id: ref.id, displayText: display };
    },
    [getCitationDisplayText, addCitation],
  );

  // Citation drop into the main editor. Two flavours:
  //  • new citation (no id, or id already anchored elsewhere) → mint a
  //    fresh ref and insert
  //  • dragging an unanchored citation card from the panel → reuse its
  //    existing id so the panel card transitions to "anchored" instead
  //    of leaving a duplicate behind
  const handleCitationDrop = useCallback(
    (command: string, citationId?: string) => {
      const display = getCitationDisplayText(command);
      let targetId: string | undefined;
      if (citationId) {
        const editorCits = editorRef.current?.getCitations() ?? [];
        const alreadyAnchored = editorCits.some(
          (c) => c.citationId === citationId,
        );
        if (!alreadyAnchored) targetId = citationId;
      }
      const ref = addCitation(command, targetId);
      return { id: ref.id, displayText: display };
    },
    [getCitationDisplayText, addCitation],
  );

  const handleDeleteFootnote = useCallback((id: string) => {
    suppressOrphanRef.current.add(id);
    editorRef.current?.deleteFootnote(id);
    setSelectedFootnoteId(null);
  }, []);

  const handleAddFootnote = useCallback(() => {
    const id = generateEntityId();
    setOrphanedFootnotes((prev) => [
      ...prev,
      {
        footnoteId: id,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        orphanedAt: new Date().toISOString(),
      },
    ]);
    return id;
  }, []);

  const handleDeleteOrphan = useCallback((id: string) => {
    setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== id));
  }, []);

  const handleEditOrphan = useCallback((id: string, newContent: unknown) => {
    setOrphanedFootnotes((prev) => prev.map((o) =>
      o.footnoteId === id ? { ...o, content: newContent } : o
    ));
  }, []);

  const handleEditOrphanTitle = useCallback((id: string, title: string) => {
    setOrphanedFootnotes((prev) => prev.map((o) =>
      o.footnoteId === id ? { ...o, title } : o
    ));
  }, []);

  // Listen for archive marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.archiveId) {
        setSelectedArchiveId(detail.archiveId);
        // Route to OmniView if it has a card for this archive snippet
        if (tryScrollOmniEntry(`ar:${detail.archiveId}`)) return;
        // Force-open archive panel (don't toggle if already open)
        const p = prefsRef.current;
        const archivePlacement = p.placements.find((pl) => pl.id === "archive");
        if (archivePlacement?.side === "left") {
          if (p.activeLeft !== "archive") setActiveLeft("archive");
        } else {
          if (p.activeRight !== "archive") setActiveRight("archive");
        }
        // Scroll the archive entry into view
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-archive-entry="${detail.archiveId}"]`,
          ) as HTMLElement | null;
          if (entry) scrollEntryIntoView(entry);
        });
      }
    };
    window.addEventListener("virgil-archive-click", handler);
    return () => window.removeEventListener("virgil-archive-click", handler);
  }, [setActiveLeft, setActiveRight, tryScrollOmniEntry]);

  // Listen for footnote marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.footnoteId) {
        setSelectedFootnoteId(detail.footnoteId);
        // Route to OmniView if it has a card for this footnote
        if (tryScrollOmniEntry(`fn:${detail.footnoteId}`)) return;
        const p = prefsRef.current;
        const fnPlacement = p.placements.find((pl) => pl.id === "footnotes");
        if (fnPlacement?.side === "left") {
          if (p.activeLeft !== "footnotes") setActiveLeft("footnotes");
        } else {
          if (p.activeRight !== "footnotes") setActiveRight("footnotes");
        }
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-footnote-entry="${detail.footnoteId}"]`,
          ) as HTMLElement | null;
          if (entry) scrollEntryIntoView(entry);
        });
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [setActiveLeft, setActiveRight, tryScrollOmniEntry]);

  // Listen for orphaned footnotes (deleted from editor but preserved in panel)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (suppressOrphanRef.current.has(detail.footnoteId)) {
        suppressOrphanRef.current.delete(detail.footnoteId);
        return;
      }
      setOrphanedFootnotes((prev) => {
        if (prev.some((o) => o.footnoteId === detail.footnoteId)) return prev;
        return [...prev, {
          footnoteId: detail.footnoteId,
          content: detail.content,
          orphanedAt: new Date().toISOString(),
        }];
      });
    };
    window.addEventListener("virgil-footnote-orphaned", handler);
    return () => window.removeEventListener("virgil-footnote-orphaned", handler);
  }, []);

  // Listen for footnote panel drops (clean up orphan state)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.footnoteId) return;
      if (detail.isOrphan) {
        setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== detail.footnoteId));
      }
    };
    window.addEventListener("virgil-footnote-panel-dropped", handler);
    return () => window.removeEventListener("virgil-footnote-panel-dropped", handler);
  }, []);

  // Footnote panel drop targets consume archive snippets — remove the marker
  // and the archive entry on success.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const archiveId = detail?.archiveId;
      if (!archiveId) return;
      deleteSnippet(archiveId);
    };
    window.addEventListener("virgil-footnote-consumed-archive", handler);
    return () => window.removeEventListener("virgil-footnote-consumed-archive", handler);
  }, [deleteSnippet]);

  // Listen for citation marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.citationId) {
        setSelectedCitationId(detail.citationId);
        const targetY: number | undefined =
          typeof detail.clickY === "number" ? detail.clickY : undefined;
        // Route to OmniView if it has a card for this citation
        if (tryScrollOmniEntry(`ci:${detail.citationId}`, targetY)) return;
        const p = prefsRef.current;
        const citPlacement = p.placements.find((pl) => pl.id === "citations");
        const targetSide: Side = citPlacement?.side ?? "left";
        const sourceSide = detail.sourceSide as Side | undefined;
        const sourcePanelId = detail.sourcePanelId as PanelId | undefined;
        const sourceHalf = detail.sourceHalf as Half | undefined;

        // If the click came from inside the citations panel itself, don't
        // re-route — just let the scroll logic below bring the entry into view.
        if (sourcePanelId !== "citations") {
          if (sourceSide && sourceSide === targetSide && sourcePanelId) {
            // Same side as citations' home → open as a split so the source
            // panel stays visible alongside citations.
            const isSplit =
              targetSide === "left"
                ? p.activeLeftBottom != null
                : p.activeRightBottom != null;
            if (!isSplit) {
              // Not split yet: pin source to top, open citations in bottom.
              setActiveHalf(targetSide, "top", sourcePanelId);
              setActiveHalf(targetSide, "bottom", "citations");
            } else {
              // Already split: put citations in the half opposite the source.
              const oppHalf: Half = sourceHalf === "bottom" ? "top" : "bottom";
              setActiveHalf(targetSide, oppHalf, "citations");
            }
          } else {
            // From main text or from a panel on the opposite side — just
            // activate citations on its home side.
            if (targetSide === "left") {
              if (p.activeLeft !== "citations") setActiveLeft("citations");
            } else {
              if (p.activeRight !== "citations") setActiveRight("citations");
            }
          }
        }
        // Scroll the panel entry into view, aligning it vertically with
        // the clicked citation when we have its Y position.
        requestAnimationFrame(() => {
          const entry = document.querySelector(
            `[data-citation-entry="${detail.citationId}"]`,
          ) as HTMLElement | null;
          if (!entry) return;
          if (typeof targetY === "number") {
            alignEntryToY(entry, targetY);
          } else {
            scrollEntryIntoView(entry);
          }
        });
      }
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [setActiveLeft, setActiveRight, setActiveHalf, tryScrollOmniEntry]);

  // Listen for \ref node clicks → open the LabelRef popover
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.label) return;
      const el = document.querySelector(
        `.label-ref-node[data-label="${detail.label}"]`,
      ) as HTMLElement | null;
      if (el) {
        setActiveRefLabel(detail.label);
        setActiveRefRect(el.getBoundingClientRect());
      }
    };
    window.addEventListener("virgil-label-ref-click", handler);
    return () => window.removeEventListener("virgil-label-ref-click", handler);
  }, []);

  // Highlight the active \ref node with yellow while the popover is open
  useEffect(() => {
    if (!activeRefLabel) return;
    const els = document.querySelectorAll(
      `.label-ref-node[data-label="${activeRefLabel}"]`,
    );
    for (const el of els) el.classList.add("label-ref-active");
    return () => {
      for (const el of els) el.classList.remove("label-ref-active");
    };
  }, [activeRefLabel]);

  // ── LabelRef popover helpers ──
  const gatherLabels = useCallback((): LabelInfo[] => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return [];
    const result: LabelInfo[] = [];
    editor.state.doc.descendants((nd) => {
      if (nd.type.name === "heading" && nd.attrs.label) {
        const titleParts: string[] = [];
        nd.content.forEach((child) => {
          if (child.isText && child.text) titleParts.push(child.text);
        });
        result.push({
          label: nd.attrs.label,
          title: titleParts.join("") || "(untitled)",
          sectionNumber: nd.attrs.sectionNumber || "?",
          level: nd.attrs.level,
        });
      }
    });
    return result;
  }, []);

  const handleRefChangeLabel = useCallback(
    (oldLabel: string, newLabel: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      editor.state.doc.descendants((nd, pos) => {
        if (nd.type.name === "labelRef" && nd.attrs.label === oldLabel) {
          let display = "??";
          editor.state.doc.descendants((h) => {
            if (h.type.name === "heading" && h.attrs.label === newLabel && h.attrs.sectionNumber) {
              display = h.attrs.sectionNumber;
            }
          });
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...nd.attrs,
            label: newLabel,
            displayText: display,
          });
          editor.view.dispatch(tr);
          return false;
        }
        return true;
      });
      setActiveRefLabel(newLabel);
    },
    [],
  );

  const handleRefJump = useCallback((label: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    let targetPos = -1;
    editor.state.doc.descendants((nd, pos) => {
      if (nd.type.name === "heading" && nd.attrs.label === label) {
        targetPos = pos + 1;
        return false;
      }
      return true;
    });
    if (targetPos >= 0) {
      editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
    }
  }, []);

  const handleInsertRef = useCallback((newLabel: string) => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    // Resolve display text from heading labels
    let display = "??";
    editor.state.doc.descendants((h) => {
      if (h.type.name === "heading" && h.attrs.label === newLabel && h.attrs.sectionNumber) {
        display = h.attrs.sectionNumber;
      }
    });
    editor.chain().focus().insertContent({
      type: "labelRef",
      attrs: { label: newLabel, displayText: display },
    }).run();
  }, []);

  // Click on empty editor space → deselect all panel items.
  // Marker click handlers call stopPropagation(), so this only fires
  // for non-marker clicks (regular text, whitespace, etc.).
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;
    const handler = () => {
      setSelectedCommentId(null);
      setSelectedNoteId(null);
      setSelectedQuotationGroupId(null);
      setSelectedArchiveId(null);
      setSelectedTodoId(null);
      setSelectedFootnoteId(null);
      setSelectedCitationId(null);
      setSelectedBibKey(null);
    };
    editorDom.addEventListener("click", handler);
    return () => editorDom.removeEventListener("click", handler);
  }, [editorInstance]);

  // Listen for bare \cite input rule → open panel with new-cite form
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.partial) {
        setPendingCitationMode("anchored");
        setPendingCitationCreate(detail.partial);
        const p = prefsRef.current;
        const citPlacement = p.placements.find((pl) => pl.id === "citations");
        if (citPlacement?.side === "left") {
          if (p.activeLeft !== "citations") setActiveLeft("citations");
        } else {
          if (p.activeRight !== "citations") setActiveRight("citations");
        }
      }
    };
    window.addEventListener("virgil-citation-create", handler);
    return () => window.removeEventListener("virgil-citation-create", handler);
  }, [setActiveLeft, setActiveRight]);

  // Listen for \ref command → open ref-create popover at cursor
  useEffect(() => {
    const handler = () => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      // Get the cursor position in screen coords for the popover
      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      const rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      setActiveRefLabel(""); // empty label = new ref, triggers popover in create mode
      setActiveRefRect(rect);
    };
    window.addEventListener("virgil-ref-create", handler);
    return () => window.removeEventListener("virgil-ref-create", handler);
  }, []);

  // Listen for \footnote command → create empty footnote at cursor
  useEffect(() => {
    const handler = () => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const footnoteId = generateEntityId();
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      editor
        .chain()
        .focus()
        .insertContent({ type: "footnote", attrs: { footnoteId, content, number: 0 } })
        .run();
      // Renumber all footnotes
      editorRef.current?.renumberFootnotes();
      // Open footnotes panel and select the new one
      const p = prefsRef.current;
      const fnPlacement = p.placements.find((pl) => pl.id === "footnotes");
      if (fnPlacement?.side === "left") {
        if (p.activeLeft !== "footnotes") setActiveLeft("footnotes");
      } else {
        if (p.activeRight !== "footnotes") setActiveRight("footnotes");
      }
      setSelectedFootnoteId(footnoteId);
      window.dispatchEvent(
        new CustomEvent("virgil-footnote-created", { detail: { footnoteId, content } }),
      );
    };
    window.addEventListener("virgil-footnote-input", handler);
    return () => window.removeEventListener("virgil-footnote-input", handler);
  }, [setActiveLeft, setActiveRight]);

  // Handle drag-and-drop of archive snippets into the editor.
  // - "card" drag (application/x-virgil-archive-id): ProseMirror inserts the
  //   text from text/plain; we then delete the snippet from archive.
  // - "anchor" drag (application/x-virgil-archive-anchor-id): re-anchor an
  //   orphaned snippet by setting its paragraphId to the drop paragraph.
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;

    const handleDragOver = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return;
      if (types.includes(MIME_ARCHIVE_ANCHOR)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        editorDom.classList.add("virgil-archive-drop-target");
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      const related = e.relatedTarget as Node | null;
      if (!related || !editorDom.contains(related)) {
        editorDom.classList.remove("virgil-archive-drop-target");
      }
    };

    const handleDrop = (e: DragEvent) => {
      editorDom.classList.remove("virgil-archive-drop-target");
      const anchorData = e.dataTransfer?.getData(MIME_ARCHIVE_ANCHOR);
      if (anchorData) {
        // Re-anchor: resolve drop position to a paragraph UUID
        e.preventDefault();
        e.stopPropagation();
        try {
          const { archiveId } = JSON.parse(anchorData);
          if (!archiveId) return;
          const paragraphId = editorRef.current?.ensureParagraphUuidAtCoords(e.clientX, e.clientY);
          if (paragraphId) {
            addArchiveParagraphId(archiveId, paragraphId);
          }
        } catch { /* ignore */ }
        return;
      }
      const archiveId = e.dataTransfer?.getData(MIME_ARCHIVE);
      if (archiveId) {
        // Let ProseMirror handle the text insertion; just clean up archive
        setTimeout(() => {
          deleteSnippet(archiveId);
        }, 0);
      }
    };

    editorDom.addEventListener("dragover", handleDragOver);
    editorDom.addEventListener("dragleave", handleDragLeave);
    editorDom.addEventListener("drop", handleDrop);
    return () => {
      editorDom.removeEventListener("dragover", handleDragOver);
      editorDom.removeEventListener("dragleave", handleDragLeave);
      editorDom.removeEventListener("drop", handleDrop);
    };
  }, [editorInstance, deleteSnippet, addArchiveParagraphId]);

  const pendingRevisionAnchorRef = useRef<number>(0);

  const handleAddComment = useCallback(() => {
    const selectedText = editorRef.current?.getSelectedText();
    if (!selectedText || selectedText.trim().length === 0) return;
    pendingRevisionAnchorRef.current = editorInstance?.state?.selection?.from ?? 0;
    setPendingCommentText(selectedText);
    // Ensure revisions panel is open (setActiveLeft/Right are toggles, so only call if not already active)
    const revPlacement = prefs.placements.find((p) => p.id === "revisions");
    if (revPlacement?.side === "left") {
      if (prefs.activeLeft !== "revisions") setActiveLeft("revisions");
    } else {
      if (prefs.activeRight !== "revisions") setActiveRight("revisions");
    }
  }, [prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight, editorInstance]);

  const handleSubmitComment = useCallback(
    (comment: string) => {
      if (pendingCommentText && comment.trim()) {
        addTextRevision(pendingCommentText, pendingRevisionAnchorRef.current, comment.trim());
      }
      setPendingCommentText(null);
    },
    [addTextRevision, pendingCommentText]
  );

  const handleCancelComment = useCallback(() => {
    setPendingCommentText(null);
  }, []);

  const startRename = (id: string, name: string) => {
    setNameInput(name);
    setEditingTabId(id);
  };

  const finishRename = () => {
    if (editingTabId && nameInput.trim()) {
      renameFile(editingTabId, nameInput.trim());
    }
    setEditingTabId(null);
  };

  const handleNativeOpen = useCallback(async () => {
    try {
      await openExistingFile();
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [openExistingFile]);

  const handleNewDocStart = useCallback(() => {
    setNewDocName("");
  }, []);

  const handleNewDocSubmit = useCallback(async () => {
    const name = (newDocName ?? "").trim();
    if (!name) {
      setNewDocName(null);
      return;
    }
    try {
      const meta = await createFile(name);
      if (meta) setNewDocName(null);
    } catch (err) {
      console.error("Failed to create new paper:", err);
      // Keep the input open so the user can retry or cancel.
    }
  }, [newDocName, createFile]);

  const handleNewDocCancel = useCallback(() => {
    setNewDocName(null);
  }, []);


  const switchToCodeView = useCallback(() => {
    // Get the active paragraph UUID using rules 1-3
    const paraId = editorRef.current?.getActiveParagraphId() ?? null;
    setCodeViewParagraphId(paraId);

    // Fallback: compute line number from text matching
    let line: number | undefined;
    if (!paraId) {
      try {
        const editor = editorRef.current?.getEditor();
        if (editor && content) {
          const scrollEl = editor.view.dom.closest(".overflow-y-auto") as HTMLElement | null;
          const topPos = editor.view.posAtCoords({
            left: editor.view.dom.getBoundingClientRect().left + 50,
            top: (scrollEl?.getBoundingClientRect().top ?? 0) + 20,
          });
          const pos = topPos?.pos ?? editor.state.selection.from;
          const start = Math.max(0, pos - 10);
          const end = Math.min(editor.state.doc.content.size, pos + 60);
          const snippet = editor.state.doc.textBetween(start, end, " ").trim();
          const words = snippet.split(/\s+/).filter((w) => w.length > 3);
          if (words.length >= 2) {
            const latex = serializeToLatex(content);
            for (let len = Math.min(words.length, 6); len >= 2; len--) {
              const phrase = words.slice(0, len).join(".*?");
              const re = new RegExp(phrase, "s");
              const match = re.exec(latex);
              if (match) {
                line = latex.substring(0, match.index).split("\n").length;
                break;
              }
            }
          }
        }
      } catch { /* fallback: no line */ }
    }
    setCodeViewLine(line);
    setEditorInstance(null);
    setCodeView(true);
  }, [content]);

  const switchToVisualView = useCallback(() => {
    // Capture text around visible area before destroying code editor
    const handle = codeEditorHandleRef.current;
    if (handle) {
      // Prefer paragraph UUID; fall back to text matching
      const paraId = handle.getActiveParagraphId();
      if (paraId) {
        pendingParagraphId.current = paraId;
        pendingScrollText.current = null;
      } else {
        pendingScrollText.current = handle.getTextAroundCursor();
        pendingParagraphId.current = null;
      }
    }
    codeEditorHandleRef.current = null;
    setCodeView(false);
    refetchDoc();
  }, [refetchDoc]);

  const handleMove = useCallback((draggedId: PanelId, toSide: Side, toIndex?: number) => {
    movePanel(draggedId, toSide, toIndex);
  }, [movePanel]);

  // Strip-icon click handler — routes to the focused half when the side
  // is split, otherwise behaves like the original togglePanel.
  const handleStripClick = useCallback(
    (id: PanelId, side: Side) => {
      const split =
        side === "left" ? prefs.activeLeftBottom != null : prefs.activeRightBottom != null;
      if (!split) {
        togglePanel(id);
        return;
      }
      const focused = side === "left" ? focusedHalfLeft : focusedHalfRight;
      const currentInFocus =
        side === "left"
          ? focused === "top"
            ? prefs.activeLeft
            : prefs.activeLeftBottom
          : focused === "top"
            ? prefs.activeRight
            : prefs.activeRightBottom;
      // Toggling: clicking the icon for what's already in the focused half
      // closes it (sets that half to "blank" — we never want a null half
      // when split).
      const next: PanelId = currentInFocus === id ? "blank" : id;
      setActiveHalf(side, focused, next);
    },
    [
      togglePanel,
      setActiveHalf,
      prefs.activeLeft,
      prefs.activeRight,
      prefs.activeLeftBottom,
      prefs.activeRightBottom,
      focusedHalfLeft,
      focusedHalfRight,
    ],
  );

  // Clear search highlight when the search panel is no longer visible
  const searchPanelOpen = prefs.activeLeft === "search" || prefs.activeRight === "search";
  useEffect(() => {
    if (!searchPanelOpen) setSearchHighlightRange(null);
  }, [searchPanelOpen]);

  // --- Marginalia: build the marker list and side map ---
  // (Hooks must run on every render — placed before any early returns.)
  // OmniView aggregates several panels on one side, so when omni is
  // active the child panels count as "on that side" for marginalia too.
  const marginaliaPanelSides = useMemo(() => {
    const omniLeft = prefs.activeLeft === "omni";
    const omniRight = prefs.activeRight === "omni";
    // Quotations is a left-side child of OmniView
    const quotationsSide: "left" | "right" | null =
      prefs.activeLeft === "quotations" || omniLeft
        ? "left"
        : prefs.activeRight === "quotations"
          ? "right"
          : null;
    // Notes, archive, revisions, cutter are right-side children of OmniView
    const notesSide: "left" | "right" | null =
      prefs.activeLeft === "notes"
        ? "left"
        : prefs.activeRight === "notes" || omniRight
          ? "right"
          : null;
    const archiveSide: "left" | "right" | null =
      prefs.activeLeft === "archive"
        ? "left"
        : prefs.activeRight === "archive" || omniRight
          ? "right"
          : null;
    const revisionsSide: "left" | "right" | null =
      prefs.activeLeft === "revisions"
        ? "left"
        : prefs.activeRight === "revisions" || omniRight
          ? "right"
          : null;
    const cutterSide: "left" | "right" | null =
      prefs.activeLeft === "cutter"
        ? "left"
        : prefs.activeRight === "cutter" || omniRight
          ? "right"
          : null;
    const todoSide: "left" | "right" | null =
      prefs.activeLeft === "todo"
        ? "left"
        : prefs.activeRight === "todo" || omniRight
          ? "right"
          : null;
    return {
      quotations: quotationsSide,
      notes: notesSide,
      archive: archiveSide,
      revisions: revisionsSide,
      cutter: cutterSide,
      todo: todoSide,
    };
  }, [prefs.activeLeft, prefs.activeRight]);

  // Bump a version counter on editor updates so marginalia markers recompute
  // (quotation/archive/todo markers depend on paragraph visibility metrics).
  const [editorDocVersion, setEditorDocVersion] = useState(0);
  useEffect(() => {
    if (!editorInstance) return;
    const bump = () => setEditorDocVersion((v) => v + 1);
    editorInstance.on("update", bump);
    return () => {
      editorInstance.off("update", bump);
    };
  }, [editorInstance]);

  // Track focus on the canonical editor — interactions with the top pane
  // mark it active so panels route their jumps there.
  useEffect(() => {
    if (!editorInstance) return;
    const dom = editorInstance.view.dom as HTMLElement;
    const mark = () => setActiveSplitPane("top");
    dom.addEventListener("focusin", mark);
    dom.addEventListener("mousedown", mark);
    return () => {
      dom.removeEventListener("focusin", mark);
      dom.removeEventListener("mousedown", mark);
    };
  }, [editorInstance]);

  // Reset to the top pane whenever the split closes.
  useEffect(() => {
    if (!editorSplit) setActiveSplitPane("top");
  }, [editorSplit]);

  const marginaliaMarkers = useMemo<MarginaliaMarker[]>(() => {
    // Touch editorDocVersion so this memo recomputes when the doc changes
    void editorDocVersion;
    const result: MarginaliaMarker[] = [];

    // Quotation markers — one marker per paragraphId
    for (const g of quotationGroups) {
      if (g.paragraphIds.length === 0) continue;
      for (const pid of g.paragraphIds) {
        result.push({
          id: `${g.id}:${pid}`,
          entityId: g.id,
          type: "quote",
          paragraphId: pid,
          selected: selectedQuotationGroupId === g.id,
          title: g.title || g.references[0]?.citeKey || "Quotation",
          onClick: () => handleQuotationMarkerClick(g.id),
          onDelete: () => removeQuotationParagraphId(g.id, pid),
        });
      }
    }

    // Note markers — one marker per paragraphId (same pattern as quotations)
    for (const n of notes) {
      if (n.paragraphIds.length === 0) continue;
      for (const pid of n.paragraphIds) {
        result.push({
          id: `${n.id}:${pid}`,
          entityId: n.id,
          type: "note",
          paragraphId: pid,
          selected: selectedNoteId === n.id,
          title: n.title || "Note",
          onClick: () => handleNoteMarkerClick(n.id),
          onDelete: () => removeNoteParagraphId(n.id, pid),
        });
      }
    }

    // Archive markers — one marker per paragraphId
    for (const snippet of archiveSnippets) {
      if (!snippet.paragraphIds || snippet.paragraphIds.length === 0) continue;
      for (const pid of snippet.paragraphIds) {
        result.push({
          id: `${snippet.id}:${pid}`,
          entityId: snippet.id,
          type: "archive",
          paragraphId: pid,
          selected: selectedArchiveId === snippet.id,
          title: "Archived snippet",
          onClick: () => {
            setSelectedArchiveId(snippet.id);
            editorRef.current?.scrollToParagraphId(pid);
          },
          onDelete: () => removeArchiveParagraphId(snippet.id, pid),
        });
      }
    }

    // Todo markers — one marker per paragraphId
    for (const item of todoItems) {
      if (!item.paragraphIds || item.paragraphIds.length === 0) continue;
      for (const pid of item.paragraphIds) {
        result.push({
          id: `${item.id}:${pid}`,
          entityId: item.id,
          type: "todo",
          paragraphId: pid,
          selected: selectedTodoId === item.id,
          title: item.text || "Todo",
          muted: item.done,
          onClick: () => handleTodoMarkerClick(item.id),
          onDelete: () => removeTodoParagraphId(item.id, pid),
        });
      }
    }

    return result;
  }, [
    quotationGroups,
    selectedQuotationGroupId,
    removeQuotationParagraphId,
    notes,
    selectedNoteId,
    removeNoteParagraphId,
    archiveSnippets,
    selectedArchiveId,
    removeArchiveParagraphId,
    todoItems,
    selectedTodoId,
    removeTodoParagraphId,
    editorDocVersion,
    handleQuotationMarkerClick,
    handleNoteMarkerClick,
    handleTodoMarkerClick,
  ]);

  // Filter marginalia by visibility settings
  const visibleMarginaliaMarkers = useMemo(() => {
    if (!showMarginalia) return [];
    if (hiddenMarginaliaTypes.size === 0) return marginaliaMarkers;
    return marginaliaMarkers.filter((m) => !hiddenMarginaliaTypes.has(m.type as MarginaliaType));
  }, [marginaliaMarkers, showMarginalia, hiddenMarginaliaTypes]);

  // Compute the set of paragraph UUIDs that have marginalia anchored to them,
  // used by MarginaliaAnchorGuard to preserve paragraphs on deletion.
  // Use the full unfiltered list so hiding markers doesn't lose anchors.
  const anchoredUuidsRef = useRef(new Set<string>());
  useMemo(() => {
    const set = new Set<string>();
    for (const m of marginaliaMarkers) set.add(m.paragraphId);
    anchoredUuidsRef.current = set;
  }, [marginaliaMarkers]);

  // Loading
  if (filesLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--background)] text-[var(--muted)]">
        Loading...
      </div>
    );
  }

  const activeLeft = prefs.activeLeft;
  const activeRight = prefs.activeRight;

  // Search range highlight takes priority — skip text-based highlight when active
  const highlightText = searchHighlightRange
    ? null
    : pendingCommentText
      ? pendingCommentText
      : commentHighlight
        ? commentHighlight
        : (activeLeft === "suggestions" || activeRight === "suggestions") && currentSuggestion
          ? currentSuggestion.original_text
          : null;

  const saveLabel =
    saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "";

  const suggestionPanelVisible = (activeLeft === "suggestions" || activeRight === "suggestions") && hasSuggestions;
  const revisionsPanelActive =
    activeLeft === "revisions" ||
    activeRight === "revisions" ||
    activeRight === "omni";
  // OmniView aggregates several child panels on one side; when omni is
  // active, the side-of-panel lookups must include its children so
  // connector lines render from the correct side.
  //   Left omni children:  footnotes, citations, quotations
  //   Right omni children: notes, revisions, cutter, archive
  const omniLeftActive = activeLeft === "omni";
  const omniRightActive = activeRight === "omni";
  const notesPanelSide: "left" | "right" | null =
    activeLeft === "notes" ? "left" : activeRight === "notes" || omniRightActive ? "right" : null;
  const quotationsPanelSide: "left" | "right" | null =
    activeLeft === "quotations" || omniLeftActive ? "left" : activeRight === "quotations" ? "right" : null;
  const archivePanelSide: "left" | "right" | null =
    activeLeft === "archive" ? "left" : activeRight === "archive" || omniRightActive ? "right" : null;
  const footnotePanelSide: "left" | "right" | null =
    activeLeft === "footnotes" || omniLeftActive ? "left" : activeRight === "footnotes" ? "right" : null;
  const citationPanelSide: "left" | "right" | null =
    activeLeft === "citations" || omniLeftActive ? "left" : activeRight === "citations" ? "right" : null;
  const bibliographyPanelSide: "left" | "right" | null =
    activeLeft === "bibliography" ? "left" : activeRight === "bibliography" ? "right" : null;

  // Render the inner JSX for a panel by id, without any column wrapper.
  // The caller is responsible for wrapping in <PanelColumn> (or rendering
  // it inside a split half). The "suggestions" panel is special-cased
  // because it manages its own layout.
  function renderPanelInner(panelId: PanelId, side: Side): React.ReactNode {
    const meta = PANEL_META[panelId as keyof typeof PANEL_META];
    if (!meta) return null;

    if (panelId === "blank") {
      return <div className="w-full h-full bg-[var(--background)]" />;
    }

    if (panelId === "suggestions" && hasSuggestions) {
      return (
        <SuggestionPanel
          suggestion={currentSuggestion}
          isComplete={isComplete}
          onAct={handleAct}
          onUpdateField={updateSuggestionField}
          onClose={() => {
            if (side === "left") setActiveLeft("blank");
            else setActiveRight("blank");
            clearSuggestions();
          }}
          visible={true}
        />
      );
    }

    if (panelId === "todo") {
      return (
        <TodoPanel
          items={todoItems}
          onAdd={addTodo}
          onToggle={toggleTodo}
          onUpdate={updateTodo}
          onUpdateNotes={updateTodoNotes}
          onDelete={deleteTodo}
          onArchiveDone={archiveTodos}
          selectedTodoId={selectedTodoId}
          onSelectTodo={setSelectedTodoId}
          onScrollToMarker={(id) => {
            const item = todoItems.find((t) => t.id === id);
            const pid = item?.paragraphIds[0];
            if (pid) editorRef.current?.scrollToParagraphId(pid);
          }}
          aiRequests={aiRequests}
          onAddAiRequest={() => addAiRequest("todo")}
          onUpdateAiRequestText={updateAiRequestText}
          onDeleteAiRequest={deleteAiRequest}
        />
      );
    }

    if (panelId === "outline") {
      return (
        <OutlinePanel
          content={latestDoc || content}
          onScrollTo={handleScrollToHeading}
          onReorderBlocks={handleReorderBlocks}
          onRenameHeading={handleRenameHeading}
          onRenameParTitle={handleRenameParTitle}
          onUpdateLabel={handleUpdateLabel}
          activeSectionPath={currentSectionPath}
          activeParTitleIndex={currentParTitleIndex}
          editorSplit={editorSplit}
          mirrorSectionPath={mirrorSectionPath}
          mirrorParTitleIndex={mirrorParTitleIndex}
          focusState={focusMode.state}
          onFocusActivate={handleFocusActivate}
          onFocusDeactivate={focusMode.deactivate}
          onFocusToggleLock={focusMode.toggleLock}
          onFocusMoveTo={handleFocusMoveTo}
          onFocusExpandTo={handleFocusExpandTo}
          onFocusSnapBoundary={handleFocusSnapBoundary}
        />
      );
    }

    if (panelId === "notes") {
      return (
        <NotesPanel
          notes={notes}
          onAdd={() => addNote(null)}
          onUpdate={updateNote}
          onUpdateTitle={updateNoteTitle}
          onDelete={deleteNote}
          onSelectNote={setSelectedNoteId}
          selectedNoteId={selectedNoteId}
          onScrollToParagraphId={(uuid) => editorRef.current?.scrollToParagraphId(uuid)}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={handleCitationCreated}
          aiRequests={aiRequests}
          onAddAiRequest={() => addAiRequest("note")}
          onUpdateAiRequestText={updateAiRequestText}
          onDeleteAiRequest={deleteAiRequest}
          onEditorFocus={setOverrideEditor}
        />
      );
    }

    if (panelId === "revisions") {
      return (
        <RevisionsPanel
          users={revisionUsers}
          activeUserId={activeRevisionUserId}
          generalRevisions={generalRevisions}
          textRevisions={textRevisions}
          onSetActiveUser={setActiveRevisionUser}
          onAddUser={addRevisionUser}
          onAddGeneral={(text) => { addGeneralRevision(text); }}
          onAddTurn={addRevisionTurn}
          onResolve={resolveRevision}
          onReopen={reopenRevision}
          onDelete={deleteRevision}
          visible={true}
          pendingSelectedText={pendingCommentText}
          onSubmitNew={handleSubmitComment}
          onCancelNew={handleCancelComment}
          selectedRevisionId={selectedCommentId}
          onSelectRevision={setSelectedCommentId}
          onHighlight={setCommentHighlight}
        />
      );
    }

    if (panelId === "archive") {
      return (
        <ArchivePanel
          snippets={sortedArchiveSnippets}
          selectedId={selectedArchiveId}
          onSelect={setSelectedArchiveId}
          onEdit={(id, content) => updateArchiveSnippet(id, content)}
          onUpdateTitle={updateArchiveSnippetTitle}
          onInsert={handleInsertArchive}
          onRestore={handleRestoreArchive}
          onDelete={handleDeleteArchive}
          onScrollToMarker={(id) => {
            const snippet = archiveSnippets.find((s) => s.id === id);
            const pid = snippet?.paragraphIds[0];
            if (pid) editorRef.current?.scrollToParagraphId(pid);
          }}
          anchoredIds={anchoredIds}
          editor={editorInstance}
          panelSide={side}
          viewMode={getPanelViewMode("archive")}
          onViewModeChange={(m) => setPanelViewMode("archive", m)}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={handleCitationCreated}
          onEditorFocus={setOverrideEditor}
        />
      );
    }

    if (panelId === "footnotes") {
      return (
        <FootnotePanel
          footnotes={footnotes}
          selectedId={selectedFootnoteId}
          onSelect={setSelectedFootnoteId}
          onEdit={handleEditFootnote}
          onDelete={handleDeleteFootnote}
          onScrollToMarker={(id) => editorRef.current?.scrollToFootnote(id)}
          editor={editorInstance}
          panelSide={side}
          viewMode={getPanelViewMode("footnotes")}
          onViewModeChange={(m) => setPanelViewMode("footnotes", m)}
          orphanedFootnotes={orphanedFootnotes}
          onDeleteOrphan={handleDeleteOrphan}
          onEditOrphan={handleEditOrphan}
          onEditOrphanTitle={handleEditOrphanTitle}
          onAdd={handleAddFootnote}
          getCitationDisplayText={getCitationDisplayText}
          onCitationCreated={handleCitationCreated}
          aiRequests={aiRequests}
          onAddAiRequest={() => addAiRequest("footnote")}
          onUpdateAiRequestText={updateAiRequestText}
          onDeleteAiRequest={deleteAiRequest}
          onEditTitle={handleEditFootnoteTitle}
          onEditorFocus={setOverrideEditor}
        />
      );
    }

    if (panelId === "citations") {
      return (
        <CitationsPanel
          citations={citations}
          bibEntries={bibEntries}
          citationStyle={citationStyle}
          bibPackage={bibPackage}
          bibPath={bibPath}
          selectedId={selectedCitationId}
          citationOrder={citationOrder}
          onSelect={setSelectedCitationId}
          onScrollToMarker={(id) => editorRef.current?.scrollToCitation(id)}
          onUpdateCitation={updateCitation}
          onDeleteCitation={deleteCitation}
          onSetStyle={setCitationStyle}
          onSetBibPackage={setBibPackage}
          getDisplayText={getCitationDisplayText}
          pendingCreate={pendingCitationCreate}
          pendingCreateMode={pendingCitationMode}
          onCreateCitation={(cmd) => {
            const ref = addCitation(
              cmd,
              undefined,
              pendingCitationMode === "unanchored",
            );
            return ref.id;
          }}
          onInsertCitation={(cmd, citId, display) => {
            editorRef.current?.insertCitation(cmd, citId, display);
          }}
          onClearPendingCreate={() => setPendingCitationCreate(null)}
          onStartCreate={() => {
            // Panel + button creates an unanchored citation; user can
            // drag it into the editor later to anchor it.
            setPendingCitationMode("unanchored");
            setPendingCitationCreate("\\cite");
          }}
          editor={editorInstance}
          panelSide={side}
          citationPositions={citationPositionMap}
          viewMode={getPanelViewMode("citations")}
          onViewModeChange={(m) => setPanelViewMode("citations", m)}
          getFormattedBib={getFormattedBib}
          getAnnotation={getAnnotation}
          setAnnotation={setAnnotation}
          onRequestReview={requestBibReview}
          onCancelReview={cancelBibReview}
          getReviewStatus={getBibReviewStatus}
          onUpdateBibEntry={updateBibEntry}
          onUpdateBibKeyAndType={updateBibKeyAndType}
          aiRequests={aiRequests}
          onAddAiRequest={() => addAiRequest("citation")}
          onUpdateAiRequestText={updateAiRequestText}
          onDeleteAiRequest={deleteAiRequest}
        />
      );
    }

    if (panelId === "bibliography") {
      return (
        <BibliographyPanel
          citations={citations}
          bibEntries={bibEntries}
          selectedBibKey={selectedBibKey}
          onSelectBibKey={setSelectedBibKey}
          onUpdateBibEntry={updateBibEntry}
          onUpdateBibKeyAndType={updateBibKeyAndType}
          getFormattedBib={getFormattedBib}
          getAnnotation={getAnnotation}
          setAnnotation={setAnnotation}
          onRequestReview={requestBibReview}
          onCancelReview={cancelBibReview}
          getReviewStatus={getBibReviewStatus}
          allEditorCitations={allEditorCitations}
          onScrollToCitation={(id) => editorRef.current?.scrollToCitation(id)}
          onActiveCitationChange={setBibActiveCitationId}
          bibPackage={bibPackage}
          onAddBibEntry={addBibEntry}
          docId={currentDocId}
          generalBibPath={generalBibPath}
          onSetGeneralBibPath={setGeneralBibPath}
          entryRequests={entryRequests}
          onAddEntryRequest={addEntryRequest}
          onRemoveEntryRequest={removeEntryRequest}
        />
      );
    }

    if (panelId === "wordcount") {
      return <WordCountPanel counts={wordCounts} selection={wordSelection} focusCounts={focusWordCount} />;
    }

    if (panelId === "quotations") {
      return (
        <QuotationsPanel
          groups={quotationGroups}
          bibEntries={bibEntries}
          bibPackage={bibPackage}
          citationStyle={citationStyle}
          onAddGroup={addQuotationGroup}
          onDeleteGroup={deleteQuotationGroup}
          onUpdateGroupTitle={updateQuotationGroupTitle}
          onAddReference={addQuotationReference}
          onDeleteReference={deleteQuotationReference}
          onUpdateReferenceCiteKey={updateQuotationReferenceCiteKey}
          onAddQuote={addQuotationQuote}
          onUpdateQuote={updateQuotationQuote}
          onDeleteQuote={deleteQuotationQuote}
          onUpdateNotes={updateQuotationNotes}
          selectedGroupId={selectedQuotationGroupId}
          onSelectGroup={setSelectedQuotationGroupId}
          onScrollToParagraph={(uuid) => editorRef.current?.scrollToParagraphId(uuid)}
          aiRequests={aiRequests}
          onAddAiRequest={() => addAiRequest("quotation")}
          onUpdateAiRequestText={updateAiRequestText}
          onDeleteAiRequest={deleteAiRequest}
        />
      );
    }

    if (panelId === "search") {
      return <SearchPanel editor={editorInstance} onHighlightRange={setSearchHighlightRange} />;
    }

    if (panelId === "omni") {
      // OmniView — threads pods from several panels into one unified
      // list. Each card is rendered by instantiating the actual panel
      // card component (CitationCard, FootnoteCard, etc.) so it looks
      // and behaves identically to the native panel. In in-text mode
      // each card is positioned by its doc location.
      const items: OmniItem[] = [];

      // Resolve a paragraph UUID to its doc position (used by
      // quotation groups, which anchor by paragraphId not pos).
      const findParagraphPos = (uuid: string | null): number | null => {
        if (!uuid || !editorInstance) return null;
        let result: number | null = null;
        editorInstance.state.doc.descendants((node, pos) => {
          if (result != null) return false;
          if (node.attrs?.uuid === uuid) {
            result = pos;
            return false;
          }
          return true;
        });
        return result;
      };

      // --- Footnotes (fn) — single-position items from the editor node ---
      {
        for (const fn of footnotes) {
          const isSelected = selectedFootnoteId === fn.footnoteId;
          items.push({
            id: `fn:${fn.footnoteId}`,
            pos: fn.pos,
            content: (
              <FootnoteCard
                key={`fn:${fn.footnoteId}`}
                footnote={fn}
                isSelected={isSelected}
                onSelect={() =>
                  setSelectedFootnoteId(isSelected ? null : fn.footnoteId)
                }
                onJump={() => editorRef.current?.scrollToFootnote(fn.footnoteId)}
                onEdit={(json) => handleEditFootnote(fn.footnoteId, json)}
                onDelete={() => handleDeleteFootnote(fn.footnoteId)}
                onEditTitle={(title) => handleEditFootnoteTitle(fn.footnoteId, title)}
                onEditorFocus={setOverrideEditor}
                getCitationDisplayText={getCitationDisplayText}
                onCitationCreated={handleCitationCreated}
                extraDataAttrs={{ "data-omni-entry": `fn:${fn.footnoteId}` }}
              />
            ),
          });
        }
        // Orphaned footnotes (no doc anchor)
        for (const orphan of orphanedFootnotes) {
          items.push({
            id: `fn:${orphan.footnoteId}`,
            pos: null,
            content: (
              <OrphanedFootnoteCard
                key={`fn:${orphan.footnoteId}`}
                orphan={orphan}
                isSelected={selectedFootnoteId === orphan.footnoteId}
                onSelect={() => setSelectedFootnoteId(selectedFootnoteId === orphan.footnoteId ? null : orphan.footnoteId)}
                onEdit={(json) => handleEditOrphan(orphan.footnoteId, json)}
                onDelete={() => handleDeleteOrphan(orphan.footnoteId)}
                onEditTitle={(title) => handleEditOrphanTitle(orphan.footnoteId, title)}
                onEditorFocus={setOverrideEditor}
                getCitationDisplayText={getCitationDisplayText}
                onCitationCreated={handleCitationCreated}
                extraDataAttrs={{ "data-omni-entry": `fn:${orphan.footnoteId}` }}
              />
            ),
          });
        }
      }

      // --- Citations (ci) — single-position items ---
      {
        for (const cit of citations) {
          const pos = citationPositionMap.get(cit.id) ?? null;
          const isSelected = selectedCitationId === cit.id;
          items.push({
            id: `ci:${cit.id}`,
            pos,
            content: (
              <CitationCard
                key={`ci:${cit.id}`}
                citation={cit}
                isSelected={isSelected}
                isAnchored={pos !== null}
                bibEntries={bibEntries}
                bibPackage={bibPackage}
                getDisplayText={getCitationDisplayText}
                onSelect={() =>
                  setSelectedCitationId(isSelected ? null : cit.id)
                }
                onJump={() => {
                  setSelectedCitationId(cit.id);
                  editorRef.current?.scrollToCitation(cit.id);
                }}
                onUpdateCitation={updateCitation}
                getFormattedBib={getFormattedBib}
                getAnnotation={getAnnotation}
                setAnnotation={setAnnotation}
                onRequestReview={requestBibReview}
                onCancelReview={cancelBibReview}
                getReviewStatus={getBibReviewStatus}
                onUpdateBibEntry={updateBibEntry}
                onUpdateBibKeyAndType={updateBibKeyAndType}
                extraDataAttrs={{ "data-omni-entry": `ci:${cit.id}` }}
              />
            ),
          });
        }
      }

      // --- Quotation groups (qu) — multi-paragraph: one item per paragraphId ---
      {
        for (const group of quotationGroups) {
          const pids = group.paragraphIds;
          const isSelected = selectedQuotationGroupId === group.id;
          if (pids.length === 0) {
            items.push({
              id: `qu:${group.id}`,
              pos: null,
              content: (
                <div key={`qu:${group.id}`} data-omni-entry={`qu:${group.id}`}>
                  <QuotationGroupCard
                    group={group}
                    bibEntries={bibEntries}
                    bibPackage={bibPackage}
                    selected={isSelected}
                    onSelect={() => setSelectedQuotationGroupId(isSelected ? null : group.id)}
                    onDelete={() => deleteQuotationGroup(group.id)}
                    onUpdateGroupTitle={updateQuotationGroupTitle}
                    onAddReference={addQuotationReference}
                    onDeleteReference={deleteQuotationReference}
                    onUpdateReferenceCiteKey={updateQuotationReferenceCiteKey}
                    onAddQuote={addQuotationQuote}
                    onUpdateQuote={updateQuotationQuote}
                    onDeleteQuote={deleteQuotationQuote}
                    onUpdateNotes={updateQuotationNotes}
                  />
                </div>
              ),
            });
          } else {
            for (let pi = 0; pi < pids.length; pi++) {
              const pid = pids[pi];
              const pos = findParagraphPos(pid);
              const suffix = pids.length > 1 ? `@${pi}` : "";
              const omniId = `qu:${group.id}${suffix}`;
              items.push({
                id: omniId,
                pos,
                content: (
                  <div key={omniId} data-omni-entry={omniId}>
                    <QuotationGroupCard
                      group={group}
                      bibEntries={bibEntries}
                      bibPackage={bibPackage}
                      selected={isSelected}
                      onSelect={() => setSelectedQuotationGroupId(isSelected ? null : group.id)}
                      onDelete={() => deleteQuotationGroup(group.id)}
                      onJump={() => editorRef.current?.scrollToParagraphId(pid)}
                      onUpdateGroupTitle={updateQuotationGroupTitle}
                      onAddReference={addQuotationReference}
                      onDeleteReference={deleteQuotationReference}
                      onUpdateReferenceCiteKey={updateQuotationReferenceCiteKey}
                      onAddQuote={addQuotationQuote}
                      onUpdateQuote={updateQuotationQuote}
                      onDeleteQuote={deleteQuotationQuote}
                      onUpdateNotes={updateQuotationNotes}
                    />
                  </div>
                ),
              });
            }
          }
        }
      }

      // --- Notes (nt) — multi-paragraph: one item per paragraphId ---
      {
        for (const note of notes) {
          const pids = note.paragraphIds;
          const isSelected = selectedNoteId === note.id;
          if (pids.length === 0) {
            items.push({
              id: `nt:${note.id}`,
              pos: null,
              content: (
                <NoteCard
                  key={`nt:${note.id}`}
                  note={note}
                  selected={isSelected}
                  onUpdate={updateNote}
                  onUpdateTitle={updateNoteTitle}
                  onDelete={deleteNote}
                  onSelect={setSelectedNoteId}
                  onEditorFocus={setOverrideEditor}
                  getCitationDisplayText={getCitationDisplayText}
                  onCitationCreated={handleCitationCreated}
                  extraDataAttrs={{ "data-omni-entry": `nt:${note.id}` }}
                />
              ),
            });
          } else {
            for (let pi = 0; pi < pids.length; pi++) {
              const pid = pids[pi];
              const pos = findParagraphPos(pid);
              const suffix = pids.length > 1 ? `@${pi}` : "";
              const omniId = `nt:${note.id}${suffix}`;
              items.push({
                id: omniId,
                pos,
                content: (
                  <NoteCard
                    key={omniId}
                    note={note}
                    selected={isSelected}
                    onUpdate={updateNote}
                    onUpdateTitle={updateNoteTitle}
                    onDelete={deleteNote}
                    onSelect={setSelectedNoteId}
                    onJump={() => editorRef.current?.scrollToParagraphId(pid)}
                    onEditorFocus={setOverrideEditor}
                    getCitationDisplayText={getCitationDisplayText}
                    onCitationCreated={handleCitationCreated}
                    extraDataAttrs={{ "data-omni-entry": omniId }}
                  />
                ),
              });
            }
          }
        }
      }

      // --- Archive snippets (ar) — multi-paragraph: one item per paragraphId ---
      {
        for (const snippet of sortedArchiveSnippets) {
          const orphaned = anchoredIds && !anchoredIds.has(snippet.id);
          const isSelected = selectedArchiveId === snippet.id;
          const pids = snippet.paragraphIds ?? [];
          if (orphaned || pids.length === 0) {
            items.push({
              id: `ar:${snippet.id}`,
              pos: null,
              content: (
                <ArchiveCard
                  key={`ar:${snippet.id}`}
                  snippet={snippet}
                  selected={isSelected}
                  orphaned={orphaned}
                  onSelect={setSelectedArchiveId}
                  onEdit={(id, content) => updateArchiveSnippet(id, content)}
                  onUpdateTitle={updateArchiveSnippetTitle}
                  onDelete={handleDeleteArchive}
                  onEditorFocus={setOverrideEditor}
                  getCitationDisplayText={getCitationDisplayText}
                  onCitationCreated={handleCitationCreated}
                  extraDataAttrs={{ "data-omni-entry": `ar:${snippet.id}` }}
                />
              ),
            });
          } else {
            for (let pi = 0; pi < pids.length; pi++) {
              const pid = pids[pi];
              const pos = findParagraphPos(pid);
              const suffix = pids.length > 1 ? `@${pi}` : "";
              const omniId = `ar:${snippet.id}${suffix}`;
              items.push({
                id: omniId,
                pos,
                content: (
                  <ArchiveCard
                    key={omniId}
                    snippet={snippet}
                    selected={isSelected}
                    onSelect={setSelectedArchiveId}
                    onEdit={(id, content) => updateArchiveSnippet(id, content)}
                    onUpdateTitle={updateArchiveSnippetTitle}
                    onDelete={handleDeleteArchive}
                    onScrollToMarker={() => editorRef.current?.scrollToParagraphId(pid)}
                    onEditorFocus={setOverrideEditor}
                    getCitationDisplayText={getCitationDisplayText}
                    onCitationCreated={handleCitationCreated}
                    extraDataAttrs={{ "data-omni-entry": omniId }}
                  />
                ),
              });
            }
          }
        }
      }

      // --- Todo items (td) — multi-paragraph: one item per paragraphId ---
      {
        for (const item of todoItems) {
          const pids = item.paragraphIds;
          const isAnchored = pids.length > 0;
          const isSelected = selectedTodoId === item.id;
          if (!isAnchored) {
            items.push({
              id: `td:${item.id}`,
              pos: null,
              content: (
                <TodoRow
                  key={`td:${item.id}`}
                  item={item}
                  selected={isSelected}
                  onToggle={toggleTodo}
                  onUpdate={updateTodo}
                  onUpdateNotes={updateTodoNotes}
                  onDelete={deleteTodo}
                  onSelect={setSelectedTodoId}
                  isAnchored={false}
                  extraDataAttrs={{ "data-omni-entry": `td:${item.id}` }}
                />
              ),
            });
          } else {
            for (let pi = 0; pi < pids.length; pi++) {
              const pid = pids[pi];
              const pos = findParagraphPos(pid);
              const suffix = pids.length > 1 ? `@${pi}` : "";
              const omniId = `td:${item.id}${suffix}`;
              items.push({
                id: omniId,
                pos,
                content: (
                  <TodoRow
                    key={omniId}
                    item={item}
                    selected={isSelected}
                    onToggle={toggleTodo}
                    onUpdate={updateTodo}
                    onUpdateNotes={updateTodoNotes}
                    onDelete={deleteTodo}
                    onSelect={setSelectedTodoId}
                    isAnchored={true}
                    onJump={() => editorRef.current?.scrollToParagraphId(pid)}
                    extraDataAttrs={{ "data-omni-entry": omniId }}
                  />
                ),
              });
            }
          }
        }
      }

      return (
        <OmniViewPanel
          side={side}
          items={items}
          editor={editorInstance}
          enabledCategories={getOmniEnabled(side)}
          onToggleCategory={(cat) => toggleOmniCategory(side, cat)}
          categorySides={categorySides}
        />
      );
    }

    return <PlaceholderPanel title={meta.label} hasViewToggle={panelId === "cutter"} />;
  }

  // Render a side's panel column. Always returns a PanelColumn so the
  // editor's flex context never changes — collapsed slots reserve space.
  function renderPanelColumn(side: Side): React.ReactNode {
    const top = side === "left" ? activeLeft : activeRight;
    const bottom = side === "left" ? prefs.activeLeftBottom : prefs.activeRightBottom;
    const ratio = side === "left" ? prefs.splitLeftRatio : prefs.splitRightRatio;
    const focused = side === "left" ? focusedHalfLeft : focusedHalfRight;
    const setFocused = side === "left" ? setFocusedHalfLeft : setFocusedHalfRight;

    const width = getPanelWidth(side, top ?? "blank");
    const onWidthChange = (w: number) => setPanelWidth(side, top ?? "blank", w);

    if (!top && !bottom) {
      // Fully collapsed — column gone, text extends to strip edge
      return null;
    }

    if (bottom != null) {
      // Split mode
      return (
        <PanelColumn
          side={side}
          width={width}
          onWidthChange={onWidthChange}
          split
          focusedHalf={focused}
          onFocusHalf={setFocused}
          topPanelId={top ?? "blank"}
          bottomPanelId={bottom}
        >
          {{
            top: top ? renderPanelInner(top, side) : <div className="w-full h-full bg-[var(--background)]" />,
            bottom: renderPanelInner(bottom, side),
            ratio,
            onRatioChange: (r: number) => setSplitRatio(side, r),
          }}
        </PanelColumn>
      );
    }

    // Single mode. Omni-view renders chromeless — no pod background/border —
    // so its cards float directly on the blank canvas behind the panels.
    return (
      <PanelColumn side={side} width={width} onWidthChange={onWidthChange} blank={top === "blank" || top === "omni"} topPanelId={top ?? undefined}>

        {renderPanelInner(top!, side)}
      </PanelColumn>
    );
  }

  // Build strip icon list, filtering out suggestions if none exist
  const leftStripItems = leftItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));
  const rightStripItems = rightItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));

  if (!fsaSupported) {
    return <UnsupportedBrowserNotice />;
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--background)]">
      {/* Progress bar */}
      {suggestionPanelVisible && (
        <ProgressBar
          suggestions={suggestionsState.suggestions}
          currentIndex={suggestionsState.currentIndex}
          onJump={jumpToSuggestion}
        />
      )}

      {/* Top bar: logo + tabs */}
      <div className={`flex items-center relative bg-[var(--topbar-bg)] top-bar-border ${
        suggestionPanelVisible ? "mt-10" : ""
      }`}>
        {/* Logo + file buttons + tabs — all bottom-aligned */}
        <div className="flex items-end flex-1 min-w-0 overflow-clip gap-0.5 px-2 self-end" style={{ overflowClipMargin: '0px 0px 1px 0px' }}>
          {/* VIRGIL + file icons as first "tab-like" items */}
          <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 shrink-0">
            <h1
              className="text-[var(--accent)] text-base font-semibold tracking-widest mr-1"
              style={{ fontFamily: "var(--font-logo), Cinzel, serif" }}
            >
              VIRGIL
            </h1>
            <button
              onClick={handleNativeOpen}
              className="p-1 rounded text-stone-500 hover:bg-white/30 hover:text-[var(--accent)] transition-colors"
              title="Open .tex file"
            >
              <IconFolder />
            </button>
            <button
              onClick={handleNewDocStart}
              className="p-1 rounded text-stone-500 hover:bg-white/30 hover:text-[var(--accent)] transition-colors"
              title="New document"
            >
              <IconPlus />
            </button>
            {newDocName !== null && (
              <input
                ref={newDocInputRef}
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewDocSubmit();
                  else if (e.key === "Escape") handleNewDocCancel();
                }}
                onBlur={handleNewDocCancel}
                placeholder="Paper name…"
                className="ml-1 px-2 py-0.5 text-xs border border-[var(--border)] rounded bg-white/70 focus:outline-none focus:border-[var(--accent)]"
              />
            )}
          </div>
          {openTabs.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-center gap-1.5 pl-3.5 pr-2 pt-[1px] pb-0 text-sm cursor-default shrink-0 transition-all rounded-t-[10px] relative ${
                doc.id === currentDocId
                  ? "browser-tab-swoop bg-[var(--background)] text-stone-800 -mb-px z-10"
                  : "border border-[var(--topbar-border,#d5d3ce)] text-stone-500 hover:bg-white/30 hover:text-stone-700"
              }`}
              onClick={() => { if (doc.id !== currentDocId) openFile(doc.id); }}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-sm leading-none truncate pt-[3px]" title={doc.folderName}>
                  {doc.folderName}
                </span>
                <span className="text-[10px] leading-none text-stone-400 truncate mt-[2px]" title={doc.texFilename}>
                  {doc.texFilename}
                </span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(doc.id); }}
                className="p-0.5 rounded text-stone-500 hover:text-stone-700 hover:bg-white/40 transition-all"
                title="Close tab"
              >
                <IconX />
              </button>
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center px-2 gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setVersionOpen((v) => !v); }}
            className="relative p-1 rounded transition-colors text-stone-500 hover:bg-white/30 hover:text-[var(--accent)]"
            title={`Virgil v${APP_VERSION}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {versionOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded shadow-md text-xs text-stone-700 px-3 py-2 whitespace-nowrap text-left"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="font-medium text-stone-600 mb-0.5">Version</div>
                <div>Virgil v{APP_VERSION}</div>
              </div>
            )}
          </button>
          {/* AI request — sun-star: eight equal-length rays meeting
              at the center. Cardinal lines span 20 units (2→22);
              diagonals span ~20 units using 12 ± 7.07 ≈ 4.93/19.07. */}
          <button
            onClick={() => setAiWindowOpen(true)}
            className={`relative p-1 rounded transition-colors ${aiWindowOpen ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-stone-500 hover:bg-sky-50/50 hover:text-sky-600"}`}
            title="AI requests"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <g transform="rotate(15 12 12)">
                {/* Cardinals */}
                <line x1="12" y1="2" x2="12" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                {/* Diagonals (length 10 each half = matches cardinals) */}
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
              </g>
            </svg>
            {aiDot && (
              <span
                className="absolute top-0 right-0 w-2 h-2 rounded-full"
                style={{ backgroundColor: aiDot === "red" ? "#ef4444" : "#22c55e" }}
              />
            )}
          </button>
          <button
            onClick={codeView ? switchToVisualView : switchToCodeView}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-stone-500 hover:bg-white/30 hover:text-[var(--accent)] transition-colors"
            title={codeView ? "Visual Editor" : "Code Editor"}
          >
            {codeView ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Visual
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                Code
              </>
            )}
          </button>
        </div>
      </div>

      {/* Per-doc permission gate. When the active doc's folder handle
          needs a fresh readwrite grant, we replace everything below the
          tab strip with the gate so the user clicks once and the editor
          mounts. The tabs themselves stay visible so the user can still
          switch papers. */}
      {currentDoc && docPermState === "needs-grant" && activeDocHandle && (
        <DocPermissionGate
          docName={currentDoc.name}
          handle={activeDocHandle}
          onGranted={handleDocPermissionGranted}
        />
      )}

      {/* Path bar removed — podification */}

      {/* Main area */}
      {currentDoc && docPermState !== "granted" ? null : codeView && currentDocId ? (
        <div className="flex flex-1 overflow-hidden">
          <CodeEditor
            docId={currentDocId!}
            initialLine={codeViewLine}
            initialParagraphId={codeViewParagraphId}
            onReady={(handle) => { codeEditorHandleRef.current = handle; }}
          />
        </div>
      ) : (
      <div ref={mainAreaRef} className="flex flex-1 overflow-hidden relative">
        {/* ── Linking lines suppressed (may re-enable later) ──
        {archivePanelSide && selectedArchiveId && anchoredIds.has(selectedArchiveId) && (
          <ArchiveConnectors
            editor={editorInstance}
            selectedId={selectedArchiveId}
            panelSide={archivePanelSide}
            mainRef={mainAreaRef}
          />
        )}
        {footnotePanelSide && selectedFootnoteId && (
          <FootnoteConnectors
            editor={editorInstance}
            selectedId={selectedFootnoteId}
            panelSide={footnotePanelSide}
            mainRef={mainAreaRef}
            docVersion={latestDoc}
          />
        )}
        {citationPanelSide && selectedCitationId && (
          <CitationConnectors
            editor={editorInstance}
            selectedId={selectedCitationId}
            panelSide={citationPanelSide}
            mainRef={mainAreaRef}
          />
        )}
        {citationPanelSide && getPanelViewMode("citations") === "in-text" && selectedCitationId && (
          <InTextConnectors
            editor={editorInstance}
            selectedId={selectedCitationId}
            panelSide={citationPanelSide}
            mainRef={mainAreaRef}
            markerAttr="data-citation-id"
            entryAttr="data-citation-entry"
          />
        )}
        {bibliographyPanelSide && bibActiveCitationId && selectedBibKey && (
          <CitationConnectors
            editor={editorInstance}
            selectedId={bibActiveCitationId}
            panelSide={bibliographyPanelSide}
            mainRef={mainAreaRef}
            panelEntrySelector={`[data-bib-entry="${selectedBibKey}"]`}
          />
        )}
        ── end suppressed linking lines ── */}


        {/* Left icon strip */}
        <div data-strip-side="left" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-white/70 border border-stone-300">
            {/* Double chevron toggle: points left (close) when open, right (open) when closed */}
            <button
              onClick={() => { activeLeft ? collapseLeft() : expandLeft(); }}
              className="p-1.5 rounded transition-colors text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
              title={activeLeft ? "Collapse panel" : "Expand panel"}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {activeLeft
                  ? <><path d="M8 3L4.5 7L8 11" /><path d="M12 3L8.5 7L12 11" /></>
                  : <><path d="M6 3L9.5 7L6 11" /><path d="M2 3L5.5 7L2 11" /></>
                }
              </svg>
            </button>
            {/* Blank — panel column stays (reserving space) but shows no content */}
            <button
              onClick={() => { if (activeLeft !== "blank") expandLeft(); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeLeft === "blank" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title="Blank — reserve panel space without content"
            >
              <IconBlank active={activeLeft === "blank"} />
            </button>
            {/* OmniView — square like Blank, but with lines inside.
                Shows all left-side elements (footnotes, citations, quotes). */}
            <button
              onClick={() => { setActiveLeft(activeLeft === "omni" ? "blank" : "omni"); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeLeft === "omni" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title="Omni-view — show all left panels"
            >
              <IconOmni active={activeLeft === "omni"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("left")}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${prefs.activeLeftBottom != null ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title={prefs.activeLeftBottom != null ? "Unsplit panel" : "Split panel horizontally"}
            >
              <IconSplit
                active={prefs.activeLeftBottom != null}
                focusedHalf={prefs.activeLeftBottom != null ? focusedHalfLeft : undefined}
              />
            </button>
          </div>
          {leftStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeLeft === p.id || prefs.activeLeftBottom === p.id}
              onClick={() => handleStripClick(p.id, "left")}
              onMove={handleMove}
              side="left"
              badge={p.id === "revisions" && activeRevisionsCount > 0}
              stripRef={null as any}
            />
          ))}
        </div>

        {/* Left panel column (always present; collapsed when inactive) */}
        {renderPanelColumn("left")}

        {/* Editor column: toolbar pod + gap + editor pod + breadcrumb.
            Panel slots are always present in the flex layout (collapsed or not),
            so the editor's position never changes. */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-x-hidden relative${showParTitles ? "" : " hide-par-titles"}${showLatexComments ? "" : " hide-latex-comments"}`} style={{
          paddingTop: 'var(--pod-gap)',
          paddingBottom: 'var(--pod-gap)',
          paddingLeft: 4,
          paddingRight: 4,
        }}>
          {/* Toolbar pod */}
          <MenuBar
            editor={overrideEditor ?? editorInstance}
            onAddComment={handleAddComment}
            onArchive={handleArchive}
            onCreateFootnote={handleCreateFootnote}
            onQuoteSelection={handleQuoteSelection}
            showParTitles={showParTitles}
            onToggleParTitles={() => setShowParTitles((p) => !p)}
            showLatexComments={showLatexComments}
            onToggleLatexComments={() => setShowLatexComments((p) => !p)}
            showSectionIndicator={showSectionIndicator}
            onToggleSectionIndicator={toggleSectionIndicator}
            onOpenPreferences={() => setPreferencesOpen(true)}
            editorSplit={editorSplit}
            onToggleEditorSplit={() => setEditorSplit((s) => !s)}
            activeSplitPane={editorSplit ? activeSplitPane : undefined}
            showMarginalia={showMarginalia}
            onToggleMarginalia={toggleMarginalia}
            hiddenMarginaliaTypes={hiddenMarginaliaTypes}
            onToggleMarginaliaType={toggleMarginaliaType}
            onParaNavBack={paraNavBack}
            onParaNavForward={paraNavForward}
            paraNavBackDisabled={paraHistoryRef.current.idx <= 0}
            paraNavForwardDisabled={paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1}
          />
          {/* Gap between toolbar pod and editor pod */}
          <div className="shrink-0" style={{ height: 'var(--pod-gap)' }} />
          {currentDocId && content && !docLoading ? (
            editorSplit ? (
              /* When split, each pane is its own pod so the gap reveals the canvas */
              <SplitEditorPanes
                editorInstance={editorInstance}
                ratio={editorSplitRatio}
                onRatioChange={setEditorSplitRatio}
                onClose={() => setEditorSplit(false)}
                onMirrorFocus={() => setActiveSplitPane("bottom")}
                onMirrorViewReady={(v) => { mirrorViewRef.current = v; setMirrorViewGen((n) => n + 1); }}
                sectionPath={currentSectionPath}
                mirrorSectionPath={mirrorSectionPath}
                showSectionIndicator={showSectionIndicator}
                canonical={
                  <>
                    <VirgilEditor
                      ref={editorRef}
                      initialContent={content}
                      onUpdate={handleUpdate}
                      highlightText={highlightText}
                      highlightRange={searchHighlightRange}
                      onAddComment={handleAddComment}
                      onArchive={handleArchive}
                      onEditorReady={setEditorInstance}
                      onCitationDrop={handleCitationDrop}
                      onConfirmFootnoteMove={confirmFootnoteMove}
                      anchoredUuidsRef={anchoredUuidsRef}
                    />
                    <Marginalia
                      editor={editorInstance}
                      markers={visibleMarginaliaMarkers}
                      panelSides={marginaliaPanelSides}
                    />
                  </>
                }
              />
            ) : (
              /* Single editor — one white pod */
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" style={{ background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
                <VirgilEditor
                  ref={editorRef}
                  initialContent={content}
                  onUpdate={handleUpdate}
                  highlightText={highlightText}
                  highlightRange={searchHighlightRange}
                  onAddComment={handleAddComment}
                  onArchive={handleArchive}
                  onEditorReady={setEditorInstance}
                  onCitationDrop={handleCitationDrop}
                  onConfirmFootnoteMove={confirmFootnoteMove}
                />
                <Marginalia
                  editor={editorInstance}
                  markers={visibleMarginaliaMarkers}
                  panelSides={marginaliaPanelSides}
                />
                {showSectionIndicator && <SectionLozenge sectionPath={currentSectionPath} />}
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}>
              <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
                {docLoading ? "Loading..." : ""}
              </div>
            </div>
          )}
        </div>

        {/* Right panel column (always present; collapsed when inactive) */}
        {renderPanelColumn("right")}

        {/* Right icon strip */}
        <div data-strip-side="right" className="flex flex-col items-center pt-2 pb-3 px-1.5 bg-[var(--background)] shrink-0 gap-1.5">
          {/* Presentation-tools pod: collapse/expand, blank, split — grouped as view controls */}
          <div className="flex flex-col items-center gap-0.5 p-1 rounded-md bg-white/70 border border-stone-300">
            {/* Double chevron toggle: points right (close) when open, left (open) when closed */}
            <button
              onClick={() => { activeRight ? collapseRight() : expandRight(); }}
              className="p-1.5 rounded transition-colors text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
              title={activeRight ? "Collapse panel" : "Expand panel"}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {activeRight
                  ? <><path d="M6 3L9.5 7L6 11" /><path d="M2 3L5.5 7L2 11" /></>
                  : <><path d="M8 3L4.5 7L8 11" /><path d="M12 3L8.5 7L12 11" /></>
                }
              </svg>
            </button>
            {/* Blank — panel column stays (reserving space) but shows no content */}
            <button
              onClick={() => { if (activeRight !== "blank") expandRight(); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeRight === "blank" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title="Blank — reserve panel space without content"
            >
              <IconBlank active={activeRight === "blank"} />
            </button>
            {/* OmniView — square like Blank, but with lines inside.
                Shows all right-side elements (notes, revisions, cuts, archive). */}
            <button
              onClick={() => { setActiveRight(activeRight === "omni" ? "blank" : "omni"); }}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${activeRight === "omni" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title="Omni-view — show all right panels"
            >
              <IconOmni active={activeRight === "omni"} />
            </button>
            {/* Split panel toggle — shaded half reflects which pane is focused */}
            <button
              onClick={() => toggleSplit("right")}
              className={`p-1.5 rounded transition-colors flex items-center justify-center ${prefs.activeRightBottom != null ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
              title={prefs.activeRightBottom != null ? "Unsplit panel" : "Split panel horizontally"}
            >
              <IconSplit
                active={prefs.activeRightBottom != null}
                focusedHalf={prefs.activeRightBottom != null ? focusedHalfRight : undefined}
              />
            </button>
          </div>
          {rightStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeRight === p.id || prefs.activeRightBottom === p.id}
              onClick={() => handleStripClick(p.id, "right")}
              onMove={handleMove}
              side="right"
              badge={p.id === "revisions" && activeRevisionsCount > 0}
              stripRef={null as any}
            />
          ))}
        </div>
      </div>
      )}
      {preferencesOpen && (
        <PreferencesModal
          prefs={editorPrefs}
          transforms={editorTransforms}
          presets={editorPresets}
          onUpdate={updatePref}
          onUpdateTransform={updateTransform}
          onReset={resetPrefs}
          onClose={() => setPreferencesOpen(false)}
          onSavePreset={savePreset}
          onLoadPreset={loadPreset}
          onDeletePreset={deletePreset}
        />
      )}
      <AIWindow
        open={aiWindowOpen}
        onClose={() => setAiWindowOpen(false)}
        bibReviewRequests={bibReviewRequests}
        bibEntryRequests={entryRequests}
        generalRevisions={generalRevisions}
        textRevisions={textRevisions}
        users={revisionUsers}
        bibEntries={bibEntries}
        panelAiRequests={aiRequests}
        addPanelAiRequest={addAiRequest}
        deletePanelAiRequest={deleteAiRequest}
        requestBibReview={requestBibReview}
        cancelBibReview={cancelBibReview}
        addEntryRequest={addEntryRequest}
        removeEntryRequest={removeEntryRequest}
        addGeneralRevision={addGeneralRevision}
        refreshAll={() => {
          refreshBibReview();
          refreshBibSettings();
          refreshRevisions();
        }}
      />
      {confirmDialog}
      {activeRefLabel != null && activeRefRect && (
        <LabelRefPopover
          label={activeRefLabel}
          anchorRect={activeRefRect}
          labels={gatherLabels()}
          onChangeLabel={handleRefChangeLabel}
          onJumpToLabel={handleRefJump}
          onInsertRef={handleInsertRef}
          onClose={() => {
            setActiveRefLabel(null);
            setActiveRefRect(null);
          }}
        />
      )}
      {pendingFolderPick && (
        <TexFilePickerModal
          folderName={pendingFolderPick.folderName}
          texFiles={pendingFolderPick.texFiles}
          onSelect={selectFileInFolder}
          onCancel={cancelFolderPick}
        />
      )}
    </div>
  );
}
