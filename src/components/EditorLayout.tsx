"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import MenuBar from "./MenuBar";
import { Editor } from "@tiptap/react";
import SuggestionPanel from "./SuggestionPanel";
import RevisionsPanel from "./CommentPanel";
import NotesPanel from "./NotesPanel";
import OutlinePanel from "./OutlinePanel";
import TodoPanel from "./TodoPanel";
import ArchivePanel from "./ArchivePanel";
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
import { useComments } from "@/hooks/useComments";
import { useTodos } from "@/hooks/useTodos";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import { useAnnotations } from "@/hooks/useAnnotations";
import { useBibReview } from "@/hooks/useBibReview";
import { useNotes } from "@/hooks/useNotes";
import { useQuotations } from "@/hooks/useQuotations";
import NoteMarkers from "./NoteMarkers";
import dynamic from "next/dynamic";
import type { CodeEditorHandle } from "./CodeEditor";
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });
import CitationsPanel from "./CitationsPanel";
import BibliographyPanel from "./BibliographyPanel";
import QuotationsPanel from "./QuotationsPanel";
import { useViewPrefs, PanelId, Side } from "@/hooks/useViewPrefs";
import { serializeToLatex } from "@/lib/latex-serializer";
import type { OrphanedFootnote } from "@/lib/types";

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
  blank: { label: "Blank", icon: () => null },
};

function PlaceholderPanel({ title, hasViewToggle }: { title: string; hasViewToggle?: boolean }) {
  const [viewMode, setViewMode] = useState<import("./ViewToggle").ViewMode>("list");
  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
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

function ResizablePanel({
  children,
  side = "right",
  width,
  onWidthChange,
}: {
  children: React.ReactNode;
  side?: "left" | "right";
  width: number;
  onWidthChange: (w: number) => void;
}) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    startX.current = e.clientX;
    startWidth.current = width;
    dragging.current = false;

    const onMouseMove = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - startX.current);
      if (!dragging.current && dx > 3) {
        dragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }
      if (!dragging.current) return;
      const delta = side === "right"
        ? startX.current - e.clientX
        : e.clientX - startX.current;
      onWidthChange(Math.max(240, Math.min(600, startWidth.current + delta)));
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [width, side, onWidthChange]);

  return (
    <div className="relative flex shrink-0 h-full" style={{ width }}>
      {/* Panel content */}
      <div className={`flex-1 min-w-0 overflow-hidden ${side === "left" ? "order-1" : "order-2"}`}>
        {children}
      </div>
      {/* Edge border — continuous line */}
      <div
        className={`shrink-0 cursor-col-resize ${side === "left" ? "order-2" : "order-1"}`}
        style={{ width: 1, background: "#e5e2dd" }}
        onMouseDown={onMouseDown}
      />
      {/* Oval drag handle — centered on the border line */}
      <div
        className={`absolute z-20 ${side === "left" ? "-right-[4px]" : "-left-[4px]"}`}
        style={{ top: "50%", transform: "translateY(-50%)" }}
      >
        <div
          className="cursor-col-resize bg-white border border-[var(--border)] hover:border-stone-400 transition-colors"
          style={{ width: 8, height: 40, borderRadius: 4 }}
          onMouseDown={onMouseDown}
        />
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
    openByPath,
  } = useFiles();

  const { content, loading: docLoading, onUpdate, saveStatus, refetch: refetchDoc } = useDocument(currentDocId);
  const {
    state: suggestionsState,
    currentSuggestion,
    isComplete,
    actOnSuggestion,
    updateSuggestionField,
    jumpToSuggestion,
    clearSuggestions,
  } = useSuggestions(currentDocId);
  const {
    comments,
    activeComments,
    resolvedComments,
    addComment,
    updateComment,
    resolveComment,
    deleteComment,
  } = useComments(currentDocId);
  const {
    notes,
    addNote,
    updateNote,
    updateNotePosition,
    deleteNote,
  } = useNotes(currentDocId);
  const {
    groups: quotationGroups,
    addGroup: addQuotationGroup,
    deleteGroup: deleteQuotationGroup,
    updateGroupTitle: updateQuotationGroupTitle,
    addQuotation: addQuotationToGroup,
    updateQuotation,
    deleteQuotation,
    updateCiteKey: updateQuotationCiteKey,
    updateNotes: updateQuotationNotes,
  } = useQuotations(currentDocId);
  const {
    items: todoItems,
    addItem: addTodo,
    toggleItem: toggleTodo,
    updateItem: updateTodo,
    updateNotes: updateTodoNotes,
    deleteItem: deleteTodo,
    archiveDone: archiveTodos,
  } = useTodos(currentDocId);

  const {
    snippets: archiveSnippets,
    archiveText,
    restoreSnippet,
    deleteSnippet,
  } = useArchive(currentDocId);

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
    updateBibEntry,
    updateBibKeyAndType,
    getDisplayText: getCitationDisplayText,
    getFormattedBib,
    syncFromEditor: syncCitationsFromEditor,
  } = useCitations(currentDocId);

  const { getAnnotation, setAnnotation } = useAnnotations(currentDocId);
  const { requestReview: requestBibReview, cancelRequest: cancelBibReview, getRequestStatus: getBibReviewStatus } = useBibReview(currentDocId);

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
  } = useViewPrefs();

  const editorRef = useRef<EditorHandle>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [showParTitles, setShowParTitles] = useState(true);
  const [showLatexComments, setShowLatexComments] = useState(true);
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const latestDocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedFootnoteId, setSelectedFootnoteId] = useState<string | null>(null);
  const [orphanedFootnotes, setOrphanedFootnotes] = useState<OrphanedFootnote[]>([]);
  const suppressOrphanRef = useRef<Set<string>>(new Set());
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [selectedBibKey, setSelectedBibKey] = useState<string | null>(null);
  const [bibActiveCitationId, setBibActiveCitationId] = useState<string | null>(null);
  const [pendingCitationCreate, setPendingCitationCreate] = useState<string | null>(null);

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
  // Editor is source of truth (IDs are regenerated each parse).
  useEffect(() => {
    if (!editorInstance) return;
    const editorCits = editorRef.current?.getCitations() ?? [];
    if (editorCits.length > 0) {
      syncCitationsFromEditor(editorCits);
    }
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

  // Derive footnotes list from editor state (sorted by document position)
  const footnotes = useMemo(() => {
    return editorRef.current?.getFootnotes() ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

  // Set of archive marker IDs present in the current document
  const anchoredIds = useMemo<Set<string>>(() => {
    return editorRef.current?.getMarkerIds() ?? new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDoc, editorInstance]);

  // Snippets sorted by marker position in document (anchored first in doc order, orphaned after)
  const sortedArchiveSnippets = useMemo(() => {
    const markerOrder = editorRef.current?.getMarkerOrder() ?? [];
    const orderMap = new Map(markerOrder.map((id, i) => [id, i]));
    return [...archiveSnippets].sort((a, b) => {
      const aIdx = orderMap.get(a.id);
      const bIdx = orderMap.get(b.id);
      if (aIdx != null && bIdx != null) return aIdx - bIdx;
      if (aIdx != null) return -1;
      if (bIdx != null) return 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveSnippets, latestDoc, editorInstance]);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
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

  const handleUpdate = useCallback(
    (doc: JSONContent) => {
      onUpdate(doc);
      if (latestDocTimerRef.current) clearTimeout(latestDocTimerRef.current);
      latestDocTimerRef.current = setTimeout(() => setLatestDoc(doc), 300);
    },
    [onUpdate]
  );

  const handleScrollToHeading = useCallback((blockIndex: number) => {
    editorRef.current?.scrollToHeading(blockIndex);
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
    const snippet = archiveText(selectedText);
    editorRef.current.archiveSelection(snippet.id);
    // Ensure archive panel is open (setActiveLeft/Right are toggles, so only call if not already active)
    const archivePlacement = prefs.placements.find((p) => p.id === "archive");
    if (archivePlacement?.side === "left") {
      if (prefs.activeLeft !== "archive") setActiveLeft("archive");
    } else {
      if (prefs.activeRight !== "archive") setActiveRight("archive");
    }
  }, [archiveText, prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  const insertingRef = useRef(false);
  const handleInsertArchive = useCallback((id: string) => {
    if (insertingRef.current) return;
    insertingRef.current = true;
    const found = archiveSnippets.find((s) => s.id === id);
    if (found && editorRef.current) {
      const editor = editorRef.current.getEditor();
      if (editor) {
        const { from, to } = editor.state.selection;
        const tr = editor.state.tr.insertText(found.text, from, to);
        editor.view.dispatch(tr);
        editor.view.focus();
      }
      editorRef.current.removeArchiveMarker(id);
      deleteSnippet(id);
      setSelectedArchiveId(null);
    }
    requestAnimationFrame(() => { insertingRef.current = false; });
  }, [archiveSnippets, deleteSnippet]);

  const handleRestoreArchive = useCallback((id: string) => {
    const snippet = restoreSnippet(id);
    if (snippet) {
      editorRef.current?.restoreArchive(id, snippet.text);
    }
    setSelectedArchiveId(null);
  }, [restoreSnippet]);

  const handleDeleteArchive = useCallback((id: string) => {
    editorRef.current?.removeArchiveMarker(id);
    deleteSnippet(id);
    setSelectedArchiveId(null);
  }, [deleteSnippet]);

  const handleReanchor = useCallback((id: string) => {
    const snippet = archiveSnippets.find((s) => s.id === id);
    if (!snippet || !editorRef.current) return;
    const editor = editorRef.current.getEditor();
    if (!editor) return;
    const preview = snippet.text.slice(0, 30);
    editor.chain().focus().insertContent({
      type: "archiveMarker",
      attrs: { archiveId: id, preview },
    }).run();
  }, [archiveSnippets]);

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

  const handleEditFootnote = useCallback((id: string, newContent: string) => {
    editorRef.current?.updateFootnoteContent(id, newContent);
  }, []);

  const handleDeleteFootnote = useCallback((id: string) => {
    suppressOrphanRef.current.add(id);
    editorRef.current?.deleteFootnote(id);
    setSelectedFootnoteId(null);
  }, []);

  const handleDeleteOrphan = useCallback((id: string) => {
    setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== id));
  }, []);

  const handleEditOrphan = useCallback((id: string, newContent: string) => {
    setOrphanedFootnotes((prev) => prev.map((o) =>
      o.footnoteId === id ? { ...o, content: newContent } : o
    ));
  }, []);

  const handleReanchorFootnote = useCallback((id: string) => {
    const orphan = orphanedFootnotes.find((o) => o.footnoteId === id);
    if (!orphan || !editorRef.current) return;
    const ed = editorRef.current.getEditor();
    if (!ed) return;
    ed.chain().focus().insertContent({
      type: "footnote",
      attrs: { footnoteId: orphan.footnoteId, content: orphan.content, number: 0 },
    }).run();
    setOrphanedFootnotes((prev) => prev.filter((o) => o.footnoteId !== id));
    setSelectedFootnoteId(id);
  }, [orphanedFootnotes]);

  // Listen for archive marker clicks from the editor
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.archiveId) {
        setSelectedArchiveId(detail.archiveId);
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
          const entry = document.querySelector(`[data-archive-entry="${detail.archiveId}"]`);
          entry?.scrollIntoView({ behavior: "instant", block: "nearest" });
        });
      }
    };
    window.addEventListener("virgil-archive-click", handler);
    return () => window.removeEventListener("virgil-archive-click", handler);
  }, [setActiveLeft, setActiveRight]);

  // Listen for footnote marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.footnoteId) {
        setSelectedFootnoteId(detail.footnoteId);
        const p = prefsRef.current;
        const fnPlacement = p.placements.find((pl) => pl.id === "footnotes");
        if (fnPlacement?.side === "left") {
          if (p.activeLeft !== "footnotes") setActiveLeft("footnotes");
        } else {
          if (p.activeRight !== "footnotes") setActiveRight("footnotes");
        }
        requestAnimationFrame(() => {
          const entry = document.querySelector(`[data-footnote-entry="${detail.footnoteId}"]`);
          entry?.scrollIntoView({ behavior: "instant", block: "nearest" });
        });
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [setActiveLeft, setActiveRight]);

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

  // Listen for citation marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.citationId) {
        setSelectedCitationId(detail.citationId);
        const p = prefsRef.current;
        const citPlacement = p.placements.find((pl) => pl.id === "citations");
        if (citPlacement?.side === "left") {
          if (p.activeLeft !== "citations") setActiveLeft("citations");
        } else {
          if (p.activeRight !== "citations") setActiveRight("citations");
        }
        // Scroll the panel entry into view
        requestAnimationFrame(() => {
          const entry = document.querySelector(`[data-citation-entry="${detail.citationId}"]`);
          entry?.scrollIntoView({ behavior: "instant", block: "nearest" });
        });
      }
    };
    window.addEventListener("virgil-citation-click", handler);
    return () => window.removeEventListener("virgil-citation-click", handler);
  }, [setActiveLeft, setActiveRight]);

  // Listen for bare \cite input rule → open panel with new-cite form
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.partial) {
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

  // Handle drag-and-drop of archive snippets into the editor.
  // ProseMirror handles the text insertion from text/plain automatically;
  // we just need to remove the snippet from archive after the drop.
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;
    const editorDom = editor.view.dom;

    const handleDrop = (e: DragEvent) => {
      const archiveId = e.dataTransfer?.getData("application/x-virgil-archive-id");
      if (archiveId) {
        // Let ProseMirror handle the text insertion; just clean up archive and marker
        setTimeout(() => {
          editorRef.current?.removeArchiveMarker(archiveId);
          deleteSnippet(archiveId);
        }, 0);
      }
    };

    editorDom.addEventListener("drop", handleDrop);
    return () => {
      editorDom.removeEventListener("drop", handleDrop);
    };
  }, [editorInstance, deleteSnippet]);

  const handleAddComment = useCallback(() => {
    const selectedText = editorRef.current?.getSelectedText();
    if (!selectedText || selectedText.trim().length === 0) return;
    setPendingCommentText(selectedText);
    // Ensure revisions panel is open (setActiveLeft/Right are toggles, so only call if not already active)
    const revPlacement = prefs.placements.find((p) => p.id === "revisions");
    if (revPlacement?.side === "left") {
      if (prefs.activeLeft !== "revisions") setActiveLeft("revisions");
    } else {
      if (prefs.activeRight !== "revisions") setActiveRight("revisions");
    }
  }, [prefs.placements, prefs.activeLeft, prefs.activeRight, setActiveLeft, setActiveRight]);

  const handleSubmitComment = useCallback(
    (comment: string) => {
      if (pendingCommentText && comment.trim()) {
        addComment(pendingCommentText, comment.trim());
      }
      setPendingCommentText(null);
    },
    [addComment, pendingCommentText]
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
      const res = await fetch("/api/files/pick", { method: "POST" });
      const data = await res.json();
      if (data.cancelled || !data.filePath) return;
      await openByPath(data.filePath);
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [openByPath]);


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

  const highlightText = pendingCommentText
    ? pendingCommentText
    : commentHighlight
      ? commentHighlight
      : (activeLeft === "suggestions" || activeRight === "suggestions") && currentSuggestion
        ? currentSuggestion.original_text
        : null;

  const saveLabel =
    saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "";

  const suggestionPanelVisible = (activeLeft === "suggestions" || activeRight === "suggestions") && hasSuggestions;
  const revisionsPanelActive = activeLeft === "revisions" || activeRight === "revisions";
  const notesPanelSide: "left" | "right" | null =
    activeLeft === "notes" ? "left" : activeRight === "notes" ? "right" : null;
  const archivePanelSide: "left" | "right" | null =
    activeLeft === "archive" ? "left" : activeRight === "archive" ? "right" : null;
  const footnotePanelSide: "left" | "right" | null =
    activeLeft === "footnotes" ? "left" : activeRight === "footnotes" ? "right" : null;
  const citationPanelSide: "left" | "right" | null =
    activeLeft === "citations" ? "left" : activeRight === "citations" ? "right" : null;
  const bibliographyPanelSide: "left" | "right" | null =
    activeLeft === "bibliography" ? "left" : activeRight === "bibliography" ? "right" : null;

  // Render a panel by its ID
  function renderPanel(panelId: PanelId, side: Side) {
    const meta = PANEL_META[panelId as keyof typeof PANEL_META];
    const width = getPanelWidth(side, panelId);
    const onWidthChange = (w: number) => setPanelWidth(side, panelId, w);
    if (!meta) return null;
    if (panelId === "blank") {
      return (
        <ResizablePanel key={`blank-${side}`} side={side} width={width} onWidthChange={onWidthChange}>
          <div className="w-full h-full bg-[var(--background)]" />
        </ResizablePanel>
      );
    }

    if (panelId === "suggestions" && hasSuggestions) {
      return (
        <SuggestionPanel
          key={panelId}
          suggestion={currentSuggestion}
          isComplete={isComplete}
          onAct={handleAct}
          onUpdateField={updateSuggestionField}
          onClose={() => {
            if (side === "left") setActiveLeft(null);
            else setActiveRight(null);
            clearSuggestions();
          }}
          visible={true}
        />
      );
    }

    if (panelId === "todo") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <TodoPanel
              items={todoItems}
              onAdd={addTodo}
              onToggle={toggleTodo}
              onUpdate={updateTodo}
              onUpdateNotes={updateTodoNotes}
              onDelete={deleteTodo}
              onArchiveDone={archiveTodos}
            />
        </ResizablePanel>
      );
    }

    if (panelId === "outline") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <OutlinePanel
              content={latestDoc || content}
              onScrollTo={handleScrollToHeading}
            />
        </ResizablePanel>
      );
    }

    if (panelId === "notes") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <NotesPanel
              notes={notes}
              onAdd={addNote}
              onUpdate={updateNote}
              onDelete={deleteNote}
              onSelectNote={setSelectedNoteId}
              selectedNoteId={selectedNoteId}
              cursorPos={editorInstance?.state?.selection?.from ?? 0}
            />
        </ResizablePanel>
      );
    }

    if (panelId === "revisions") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <RevisionsPanel
              comments={comments}
              activeComments={activeComments}
              resolvedComments={resolvedComments}
              onResolve={resolveComment}
              onDelete={deleteComment}
              onUpdate={updateComment}
              onHighlight={setCommentHighlight}
              visible={true}
              pendingSelectedText={pendingCommentText}
              onSubmitNew={handleSubmitComment}
              onCancelNew={handleCancelComment}
              selectedCommentId={selectedCommentId}
              onSelectComment={setSelectedCommentId}
              editor={editorInstance}
              panelSide={side}
              viewMode={getPanelViewMode("revisions")}
              onViewModeChange={(m) => setPanelViewMode("revisions", m)}

              onClose={() => {
                if (side === "left") setActiveLeft(null);
                else setActiveRight(null);
              }}
            />
        </ResizablePanel>
      );
    }

    if (panelId === "archive") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <ArchivePanel
              snippets={sortedArchiveSnippets}
              selectedId={selectedArchiveId}
              onSelect={setSelectedArchiveId}
              onInsert={handleInsertArchive}
              onRestore={handleRestoreArchive}
              onDelete={handleDeleteArchive}
              onReanchor={handleReanchor}
              onScrollToMarker={(id) => editorRef.current?.scrollToArchiveMarker(id)}
              anchoredIds={anchoredIds}
              editor={editorInstance}
              panelSide={side}
              viewMode={getPanelViewMode("archive")}
              onViewModeChange={(m) => setPanelViewMode("archive", m)}

            />
        </ResizablePanel>
      );
    }

    if (panelId === "footnotes") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
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
              onReanchor={handleReanchorFootnote}
            />
        </ResizablePanel>
      );
    }

    if (panelId === "citations") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
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
              onCreateCitation={(cmd) => {
                const ref = addCitation(cmd);
                return ref.id;
              }}
              onInsertCitation={(cmd, citId, display) => {
                editorRef.current?.insertCitation(cmd, citId, display);
              }}
              onClearPendingCreate={() => setPendingCitationCreate(null)}
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
            />
        </ResizablePanel>
      );
    }

    if (panelId === "bibliography") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
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
            />
        </ResizablePanel>
      );
    }

    if (panelId === "quotations") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
          <QuotationsPanel
            groups={quotationGroups}
            bibEntries={bibEntries}
            citationStyle={citationStyle}
            onAddGroup={addQuotationGroup}
            onDeleteGroup={deleteQuotationGroup}
            onUpdateGroupTitle={updateQuotationGroupTitle}
            onAddQuotation={addQuotationToGroup}
            onUpdateQuotation={updateQuotation}
            onDeleteQuotation={deleteQuotation}
            onUpdateCiteKey={updateQuotationCiteKey}
            onUpdateNotes={updateQuotationNotes}
          />
        </ResizablePanel>
      );
    }

    return (
      <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange}>
        <PlaceholderPanel title={meta.label} hasViewToggle={panelId === "cutter"} />
      </ResizablePanel>
    );
  }

  // Build strip icon list, filtering out suggestions if none exist
  const leftStripItems = leftItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));
  const rightStripItems = rightItems.filter((p) => p.id !== "blank" && (p.id !== "suggestions" || hasSuggestions));

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
      <div className={`flex items-center border-b border-[var(--border)] bg-[var(--background)] ${
        suggestionPanelVisible ? "mt-10" : ""
      }`}>
        {/* Logo + file buttons + tabs — all bottom-aligned */}
        <div className="flex items-end flex-1 min-w-0 overflow-hidden gap-0.5 px-2 self-end">
          {/* VIRGIL + file icons as first "tab-like" items */}
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 shrink-0">
            <h1
              className="text-[var(--accent)] text-base font-semibold tracking-widest mr-1"
              style={{ fontFamily: "var(--font-logo), Cinzel, serif" }}
            >
              VIRGIL
            </h1>
            <button
              onClick={handleNativeOpen}
              className="p-1 rounded text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600 transition-colors"
              title="Open .tex file"
            >
              <IconFolder />
            </button>
            <button
              onClick={() => createFile()}
              className="p-1 rounded text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600 transition-colors"
              title="New document"
            >
              <IconPlus />
            </button>
          </div>
          {openTabs.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-center gap-1.5 pl-3.5 pr-2 pt-2 pb-1.5 text-sm cursor-default shrink-0 transition-all rounded-t-lg relative ${
                doc.id === currentDocId
                  ? "bg-white text-stone-800 border border-[var(--border)] border-b-white -mb-px z-10"
                  : "bg-stone-100/60 text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
              }`}
              onClick={() => { if (doc.id !== currentDocId) openFile(doc.id); }}
            >
              {editingTabId === doc.id ? (
                <input
                  ref={nameInputRef}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); finishRename(); }
                    if (e.key === "Escape") setEditingTabId(null);
                  }}
                  size={Math.max(1, nameInput.length)}
                  className="text-sm bg-transparent border-b border-[var(--accent)] outline-none py-0 px-0"
                  style={{ width: `${Math.max(20, nameInput.length * 7.5 + 8)}px` }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="cursor-text"
                  title={doc.name}
                  onClick={(e) => { e.stopPropagation(); openFile(doc.id); startRename(doc.id, doc.name); }}
                >
                  {doc.name}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(doc.id); }}
                className="p-0.5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-300/50 transition-all"
                title="Close tab"
              >
                <IconX />
              </button>
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center px-2 gap-1">
          {paraHistoryRef.current.stack.length > 1 && (
            <>
              <button
                onClick={paraNavBack}
                disabled={paraHistoryRef.current.idx <= 0}
                className="p-1 rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
                title="Go back"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </button>
              <button
                onClick={paraNavForward}
                disabled={paraHistoryRef.current.idx >= paraHistoryRef.current.stack.length - 1}
                className="p-1 rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"
                title="Go forward"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </button>
            </>
          )}
          <button
            onClick={codeView ? switchToVisualView : switchToCodeView}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600 transition-colors"
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

      {/* Path bar */}
      {currentDoc && (
        <div className="flex items-center px-3 py-0.5 border-b border-[var(--border)] bg-stone-50/40">
          <span className="text-[11px] text-[var(--muted-light)] truncate">
            {(() => {
              const p = currentDoc.sourcePath;
              const parts = p.replace(/\\/g, "/").split("/");
              const filename = parts[parts.length - 1];
              const parentDir = parts[parts.length - 2] || "";
              const prefix = parts.slice(0, -2).join("/") + "/";
              return (
                <>
                  {prefix}<span className="font-semibold text-[var(--muted)]">{parentDir}</span>/{filename}
                </>
              );
            })()}
          </span>
          {saveLabel && (
            <span className="ml-auto text-[11px] text-[var(--muted-light)] shrink-0">{saveLabel}</span>
          )}
        </div>
      )}

      {/* Main area */}
      {codeView && currentDocId ? (
        <div className="flex flex-1 overflow-hidden">
          <CodeEditor
            docId={currentDocId}
            initialLine={codeViewLine}
            initialParagraphId={codeViewParagraphId}
            onReady={(handle) => { codeEditorHandleRef.current = handle; }}
          />
        </div>
      ) : (
      <div ref={mainAreaRef} className="flex flex-1 overflow-hidden relative">
        {/* Archive connector lines */}
        {archivePanelSide && selectedArchiveId && anchoredIds.has(selectedArchiveId) && (
          <ArchiveConnectors
            editor={editorInstance}
            selectedId={selectedArchiveId}
            panelSide={archivePanelSide}
            mainRef={mainAreaRef}
          />
        )}
        {/* Footnote connector lines */}
        {footnotePanelSide && selectedFootnoteId && (
          <FootnoteConnectors
            editor={editorInstance}
            selectedId={selectedFootnoteId}
            panelSide={footnotePanelSide}
            mainRef={mainAreaRef}
            docVersion={latestDoc}
          />
        )}
        {/* Citation connector lines (list mode: curved, page view: straight) */}
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
        {/* Bibliography connector line — points to the active occurrence */}
        {bibliographyPanelSide && bibActiveCitationId && selectedBibKey && (
          <CitationConnectors
            editor={editorInstance}
            selectedId={bibActiveCitationId}
            panelSide={bibliographyPanelSide}
            mainRef={mainAreaRef}
            panelEntrySelector={`[data-bib-entry="${selectedBibKey}"]`}
          />
        )}


        {/* Left icon strip */}
        <div data-strip-side="left" className="flex flex-col items-center py-3 px-1.5 border-r border-[var(--border)] bg-stone-50/30 shrink-0 gap-1.5">
          {/* Double chevron toggle: points left (close) when open, right (open) when closed */}
          <button
            onClick={() => { activeLeft ? collapseLeft() : expandLeft(); }}
            className="p-1.5 rounded transition-colors text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600 mb-0.5"
            title={activeLeft ? "Collapse panel" : "Expand panel"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {activeLeft
                ? <><path d="M8 3L4.5 7L8 11" /><path d="M12 3L8.5 7L12 11" /></>
                : <><path d="M6 3L9.5 7L6 11" /><path d="M2 3L5.5 7L2 11" /></>
              }
            </svg>
          </button>
          <button
            onClick={() => { if (activeLeft !== "blank") setActiveLeft("blank"); }}
            className={`p-2 rounded transition-colors flex items-center justify-center ${activeLeft === "blank" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
            title="Blank panel"
          >
            <div className="w-[14px] h-[14px] rounded-[2px] border-[1.5px] border-current" />
          </button>
          {/* Separator between fixed tools and movable tools */}
          <div className="self-stretch -mx-1 border-t border-[var(--border)] my-0.5" />
          {leftStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeLeft === p.id}
              onClick={() => togglePanel(p.id)}
              onMove={handleMove}
              side="left"
              badge={p.id === "revisions" && activeComments.length > 0}
              stripRef={null as any}
            />
          ))}
        </div>

        {/* Left panel (only rendered when active) */}
        {activeLeft && (activeLeft === "blank" || leftItems.some((p) => p.id === activeLeft)) &&
          renderPanel(activeLeft, "left")
        }

        {/* Editor column: toolbar + content */}
        <div className={`flex-1 flex flex-col min-w-0 min-h-0 overflow-x-hidden relative${showParTitles ? "" : " hide-par-titles"}${showLatexComments ? "" : " hide-latex-comments"}`}>
          <MenuBar editor={editorInstance} onAddComment={handleAddComment} onArchive={handleArchive} onCreateFootnote={handleCreateFootnote} showParTitles={showParTitles} onToggleParTitles={() => setShowParTitles((p) => !p)} showLatexComments={showLatexComments} onToggleLatexComments={() => setShowLatexComments((p) => !p)} />
          {currentDocId && content && !docLoading ? (
            <>
              <VirgilEditor
                ref={editorRef}
                initialContent={content}
                onUpdate={handleUpdate}
                highlightText={highlightText}
                onAddComment={handleAddComment}
                onArchive={handleArchive}
                onEditorReady={setEditorInstance}
                onCitationDrop={(command) => {
                  const display = getCitationDisplayText(command);
                  const ref = addCitation(command);
                  return { id: ref.id, displayText: display };
                }}
              />
              <NoteMarkers
                editor={editorInstance}
                notes={notes}
                panelSide={notesPanelSide}
                selectedNoteId={selectedNoteId}
                onSelectNote={setSelectedNoteId}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
              {docLoading ? "Loading..." : ""}
            </div>
          )}
        </div>

        {/* Right panel (only rendered when active) */}
        {activeRight && (activeRight === "blank" || rightItems.some((p) => p.id === activeRight)) &&
          renderPanel(activeRight, "right")
        }

        {/* Right icon strip */}
        <div data-strip-side="right" className="flex flex-col items-center py-3 px-1.5 border-l border-[var(--border)] bg-stone-50/30 shrink-0 gap-1.5">
          {/* Double chevron toggle: points right (close) when open, left (open) when closed */}
          <button
            onClick={() => { activeRight ? collapseRight() : expandRight(); }}
            className="p-1.5 rounded transition-colors text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600 mb-0.5"
            title={activeRight ? "Collapse panel" : "Expand panel"}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {activeRight
                ? <><path d="M6 3L9.5 7L6 11" /><path d="M2 3L5.5 7L2 11" /></>
                : <><path d="M8 3L4.5 7L8 11" /><path d="M12 3L8.5 7L12 11" /></>
              }
            </svg>
          </button>
          <button
            onClick={() => { if (activeRight !== "blank") setActiveRight("blank"); }}
            className={`p-2 rounded transition-colors flex items-center justify-center ${activeRight === "blank" ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--muted)] hover:bg-stone-100 hover:text-stone-600"}`}
            title="Blank panel"
          >
            <div className="w-[14px] h-[14px] rounded-[2px] border-[1.5px] border-current" />
          </button>
          {/* Separator between fixed tools and movable tools */}
          <div className="self-stretch -mx-1 border-t border-[var(--border)] my-0.5" />
          {rightStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeRight === p.id}
              onClick={() => togglePanel(p.id)}
              onMove={handleMove}
              side="right"
              badge={p.id === "revisions" && activeComments.length > 0}
              stripRef={null as any}
            />
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
