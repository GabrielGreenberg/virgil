"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { JSONContent } from "@tiptap/react";
import VirgilEditor, { EditorHandle } from "./Editor";
import MenuBar from "./MenuBar";
import { Editor } from "@tiptap/react";
import SuggestionPanel from "./SuggestionPanel";
import CommentPanel from "./CommentPanel";
import OutlinePanel from "./OutlinePanel";
import TodoPanel from "./TodoPanel";
import ArchivePanel from "./ArchivePanel";
import ArchiveConnectors from "./ArchiveConnectors";
import FootnotePanel from "./FootnotePanel";
import FootnoteConnectors from "./FootnoteConnectors";
import CitationConnectors from "./CitationConnectors";
import ViewToggle from "./ViewToggle";
import ProgressBar from "./ProgressBar";
import { useFiles } from "@/hooks/useFiles";
import { useDocument } from "@/hooks/useDocument";
import { useSuggestions } from "@/hooks/useSuggestions";
import { useComments } from "@/hooks/useComments";
import { useTodos } from "@/hooks/useTodos";
import { useArchive } from "@/hooks/useArchive";
import { useCitations } from "@/hooks/useCitations";
import CitationPanel from "./CitationPanel";
import { useViewPrefs, PanelId, Side } from "@/hooks/useViewPrefs";

// --- Icons ---
function IconComment({ active }: { active?: boolean }) {
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

// Outline icon: headline + two indented dot+line sub-items
function IconOutline({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16" />
      <circle cx="7" cy="12" r="1.2" fill={active ? "var(--accent)" : "currentColor"} stroke="none" />
      <path d="M10 12h10" />
      <circle cx="7" cy="19" r="1.2" fill={active ? "var(--accent)" : "currentColor"} stroke="none" />
      <path d="M10 19h8" />
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

function IconReference({ active }: { active?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--accent)" : "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

const PANEL_META: Record<PanelId, { label: string; icon: (active: boolean) => React.ReactNode }> = {
  outline: { label: "Outline", icon: (a) => <IconOutline active={a} /> },
  todo: { label: "Todo List", icon: (a) => <IconTodo active={a} /> },
  comments: { label: "Comments", icon: (a) => <IconComment active={a} /> },
  archive: { label: "Archived Text", icon: (a) => <IconArchive active={a} /> },
  footnotes: { label: "Footnotes", icon: (a) => <IconFootnote active={a} /> },
  references: { label: "Reference Notes", icon: (a) => <IconReference active={a} /> },
  suggestions: { label: "Suggestions", icon: (a) => <IconSuggestions active={a} /> },
  cutter: { label: "Cutter", icon: (a) => <IconCutter active={a} /> },
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
  onCollapse,
}: {
  children: React.ReactNode;
  side?: "left" | "right";
  width: number;
  onWidthChange: (w: number) => void;
  onCollapse: () => void;
}) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-collapse-btn]")) return;
    startX.current = e.clientX;
    startWidth.current = width;
    dragging.current = false; // only becomes true after movement

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
      if (!dragging.current) {
        // No drag happened — treat as click → collapse
        onCollapse();
      }
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [width, side, onWidthChange, onCollapse]);

  const chevronInward = side === "left" ? "left" : "right";

  return (
    <div className="relative flex shrink-0" style={{ width }}>
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
      {/* Protruding tab — vertically centered, flush with panel */}
      <div
        className={`absolute z-20 ${side === "left" ? "-right-[16px]" : "-left-[16px]"}`}
        style={{ top: "50%", transform: "translateY(-50%)" }}
      >
        <div
          className={`relative flex items-center justify-center cursor-col-resize group bg-[var(--background)] transition-colors hover:bg-stone-50 ${
            side === "left"
              ? "rounded-r-lg border-t border-r border-b border-[var(--border)]"
              : "rounded-l-lg border-t border-l border-b border-[var(--border)]"
          }`}
          style={{ width: 16, height: 72 }}
          onMouseDown={onMouseDown}
        >
          {/* Grip dots — true center */}
          <div className="flex flex-col gap-[4px] opacity-40 group-hover:opacity-60 transition-opacity">
            <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
            <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
            <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
          </div>
          {/* Chevron circle — pinned to bottom */}
          <button
            data-collapse-btn
            onClick={(e) => { e.stopPropagation(); onCollapse(); }}
            className="absolute bottom-[4px] flex items-center justify-center cursor-pointer opacity-35 hover:opacity-60 transition-opacity"
            title="Collapse panel"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#8a8580" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {chevronInward === "left"
                ? <path d="M5 1.5L2.5 4L5 6.5" />
                : <path d="M3 1.5L5.5 4L3 6.5" />
              }
            </svg>
          </button>
        </div>
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
  const meta = PANEL_META[panelId];
  const btnRef = useRef<HTMLButtonElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const handledByPointer = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    handledByPointer.current = false;
  }, []);

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
    if (isDragging.current && ghostRef.current) {
      ghostRef.current.style.left = `${e.clientX - 18}px`;
      ghostRef.current.style.top = `${e.clientY - 18}px`;
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    ghostRef.current?.remove();
    ghostRef.current = null;

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
        const buttons = Array.from(targetStrip.querySelectorAll("[data-panel-id]"));
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

  const { content, loading: docLoading, onUpdate, saveStatus } = useDocument(currentDocId);
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
    getDisplayText: getCitationDisplayText,
    getFormattedBib,
    syncFromEditor: syncCitationsFromEditor,
  } = useCitations(currentDocId);

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
  const [latestDoc, setLatestDoc] = useState<JSONContent | null>(null);
  const latestDocTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [commentHighlight, setCommentHighlight] = useState<string | null>(null);
  const [pendingCommentText, setPendingCommentText] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [selectedFootnoteId, setSelectedFootnoteId] = useState<string | null>(null);
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [pendingCitationCreate, setPendingCitationCreate] = useState<string | null>(null);

  // Derive citation order from editor state
  // Debounced citation order and editor citations (avoid recomputing on every keystroke)
  const [citationOrder, setCitationOrder] = useState<string[]>([]);
  const [allEditorCitations, setAllEditorCitations] = useState<Array<{ citationId: string; command: string; keys: string[] }>>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCitationOrder(editorRef.current?.getCitationOrder() ?? []);
      const cits = editorRef.current?.getCitations() ?? [];
      setAllEditorCitations(
        cits.map((c) => {
          const keyMatch = c.command.match(/\{([^}]+)\}/);
          const keys = keyMatch ? keyMatch[1].split(",").map((k: string) => k.trim()) : [];
          return { citationId: c.citationId, command: c.command, keys };
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
      if (hasPending) setActiveRight("suggestions");
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
  }, [archiveText, prefs.placements, setActiveLeft, setActiveRight]);

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
    editorRef.current?.deleteFootnote(id);
    editorRef.current?.renumberFootnotes();
    setSelectedFootnoteId(null);
  }, []);

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
          entry?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
          entry?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    };
    window.addEventListener("virgil-footnote-click", handler);
    return () => window.removeEventListener("virgil-footnote-click", handler);
  }, [setActiveLeft, setActiveRight]);

  // Listen for citation marker clicks from the editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.citationId) {
        setSelectedCitationId(detail.citationId);
        const p = prefsRef.current;
        const refPlacement = p.placements.find((pl) => pl.id === "references");
        if (refPlacement?.side === "left") {
          if (p.activeLeft !== "references") setActiveLeft("references");
        } else {
          if (p.activeRight !== "references") setActiveRight("references");
        }
        // Scroll the panel entry into view
        requestAnimationFrame(() => {
          const entry = document.querySelector(`[data-citation-entry="${detail.citationId}"]`);
          entry?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
        const refPlacement = p.placements.find((pl) => pl.id === "references");
        if (refPlacement?.side === "left") {
          if (p.activeLeft !== "references") setActiveLeft("references");
        } else {
          if (p.activeRight !== "references") setActiveRight("references");
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
    // Open comments panel on whichever side it's on
    const commentPlacement = prefs.placements.find((p) => p.id === "comments");
    if (commentPlacement?.side === "left") setActiveLeft("comments");
    else setActiveRight("comments");
  }, [prefs.placements, setActiveLeft, setActiveRight]);

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


  const handleMove = useCallback((draggedId: PanelId, toSide: Side) => {
    movePanel(draggedId, toSide);
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
  const commentsPanelActive = activeLeft === "comments" || activeRight === "comments";
  const archivePanelSide: "left" | "right" | null =
    activeLeft === "archive" ? "left" : activeRight === "archive" ? "right" : null;
  const footnotePanelSide: "left" | "right" | null =
    activeLeft === "footnotes" ? "left" : activeRight === "footnotes" ? "right" : null;
  const citationPanelSide: "left" | "right" | null =
    activeLeft === "references" ? "left" : activeRight === "references" ? "right" : null;

  // Render a panel by its ID
  function renderPanel(panelId: PanelId, side: Side) {
    const meta = PANEL_META[panelId];
    const width = getPanelWidth(side, panelId);
    const onWidthChange = (w: number) => setPanelWidth(side, panelId, w);
    const onCollapse = () => { if (side === "left") collapseLeft(); else collapseRight(); };

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
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
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
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
          <OutlinePanel
            content={latestDoc || content}
            onScrollTo={handleScrollToHeading}
          />
        </ResizablePanel>
      );
    }

    if (panelId === "comments") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
          <CommentPanel
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
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
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
          />
        </ResizablePanel>
      );
    }

    if (panelId === "footnotes") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
          <FootnotePanel
            footnotes={footnotes}
            selectedId={selectedFootnoteId}
            onSelect={setSelectedFootnoteId}
            onEdit={handleEditFootnote}
            onDelete={handleDeleteFootnote}
            onScrollToMarker={(id) => editorRef.current?.scrollToFootnote(id)}
          />
        </ResizablePanel>
      );
    }

    if (panelId === "references") {
      return (
        <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
          <CitationPanel
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
            onUpdateBibEntry={updateBibEntry}
            onSetStyle={setCitationStyle}
            onSetBibPackage={setBibPackage}
            getDisplayText={getCitationDisplayText}
            getFormattedBib={getFormattedBib}
            pendingCreate={pendingCitationCreate}
            onCreateCitation={(cmd) => {
              const ref = addCitation(cmd);
              return ref.id;
            }}
            onInsertCitation={(cmd, citId, display) => {
              editorRef.current?.insertCitation(cmd, citId, display);
            }}
            onClearPendingCreate={() => setPendingCitationCreate(null)}
            allEditorCitations={allEditorCitations}
          />
        </ResizablePanel>
      );
    }

    return (
      <ResizablePanel key={panelId} side={side} width={width} onWidthChange={onWidthChange} onCollapse={onCollapse}>
        <PlaceholderPanel title={meta.label} hasViewToggle={panelId === "cutter"} />
      </ResizablePanel>
    );
  }

  // Build strip icon list, filtering out suggestions if none exist
  const leftStripItems = leftItems.filter((p) => p.id !== "suggestions" || hasSuggestions);
  const rightStripItems = rightItems.filter((p) => p.id !== "suggestions" || hasSuggestions);

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
              style={{ fontFamily: "var(--font-display), Playfair Display, serif" }}
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

        <div className="shrink-0 w-2" />
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

      {/* Main area: left strip + tab + left panel + editor + right panel + tab + right strip */}
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
          />
        )}
        {/* Citation connector lines */}
        {citationPanelSide && selectedCitationId && (
          <CitationConnectors
            editor={editorInstance}
            selectedId={selectedCitationId}
            panelSide={citationPanelSide}
            mainRef={mainAreaRef}
          />
        )}

        {/* Left icon strip */}
        <div data-strip-side="left" className="flex flex-col items-center py-3 px-1.5 border-r border-[var(--border)] bg-stone-50/30 shrink-0 gap-1.5">
          {leftStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeLeft === p.id}
              onClick={() => togglePanel(p.id)}
              onMove={handleMove}
              side="left"
              badge={p.id === "comments" && activeComments.length > 0}
              stripRef={null as any}
            />
          ))}
        </div>

        {/* Left: collapsed tab or open panel */}
        {activeLeft && leftItems.some((p) => p.id === activeLeft)
          ? renderPanel(activeLeft, "left")
          : (
            /* Collapsed tab — just the protruding tab with expand chevron */
            <div className="relative shrink-0" style={{ width: 0 }}>
              <div
                className="absolute z-20 -right-[16px]"
                style={{ top: "50%", transform: "translateY(-50%)" }}
              >
                <div
                  className="relative flex items-center justify-center cursor-pointer group bg-[var(--background)] transition-colors hover:bg-stone-50 rounded-r-lg border-t border-r border-b border-[var(--border)]"
                  style={{ width: 16, height: 72 }}
                  onClick={() => expandLeft()}
                >
                  <div className="flex flex-col gap-[4px] opacity-40 group-hover:opacity-60 transition-opacity">
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                  </div>
                  <div className="absolute bottom-[4px] flex items-center justify-center opacity-35 group-hover:opacity-60 transition-opacity">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#8a8580" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 1.5L5.5 4L3 6.5" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* Editor column: toolbar + content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-x-hidden">
          <MenuBar editor={editorInstance} onAddComment={handleAddComment} onArchive={handleArchive} onCreateFootnote={handleCreateFootnote} />
          {currentDocId && content && !docLoading ? (
            <VirgilEditor
              ref={editorRef}
              initialContent={content}
              onUpdate={handleUpdate}
              highlightText={highlightText}
              onAddComment={handleAddComment}
              onArchive={handleArchive}
              onEditorReady={setEditorInstance}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
              {docLoading ? "Loading..." : ""}
            </div>
          )}
        </div>

        {/* Right: collapsed tab or open panel */}
        {activeRight && rightItems.some((p) => p.id === activeRight)
          ? renderPanel(activeRight, "right")
          : (
            <div className="relative shrink-0" style={{ width: 0 }}>
              <div
                className="absolute z-20 -left-[16px]"
                style={{ top: "50%", transform: "translateY(-50%)" }}
              >
                <div
                  className="relative flex items-center justify-center cursor-pointer group bg-[var(--background)] transition-colors hover:bg-stone-50 rounded-l-lg border-t border-l border-b border-[var(--border)]"
                  style={{ width: 16, height: 72 }}
                  onClick={() => expandRight()}
                >
                  <div className="flex flex-col gap-[4px] opacity-40 group-hover:opacity-60 transition-opacity">
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                    <div className="w-[4px] h-[4px] rounded-full bg-stone-400" />
                  </div>
                  <div className="absolute bottom-[4px] flex items-center justify-center opacity-35 group-hover:opacity-60 transition-opacity">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="#8a8580" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 1.5L2.5 4L5 6.5" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )
        }

        {/* Right icon strip */}
        <div data-strip-side="right" className="flex flex-col items-center py-3 px-1.5 border-l border-[var(--border)] bg-stone-50/30 shrink-0 gap-1.5">
          {rightStripItems.map((p) => (
            <StripButton
              key={p.id}
              panelId={p.id}
              active={activeRight === p.id}
              onClick={() => togglePanel(p.id)}
              onMove={handleMove}
              side="right"
              badge={p.id === "comments" && activeComments.length > 0}
              stripRef={null as any}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
