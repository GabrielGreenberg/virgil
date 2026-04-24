"use client";

import { memo, useState, useRef, useEffect, useCallback, Fragment } from "react";
import { Editor } from "@tiptap/react";
import {
  IconNotes,
  IconTodo,
  IconRevisions,
  IconCutter,
  IconArchive,
  IconFootnote,
  IconCitation,
  IconQuotations,
} from "./editor-layout/panel-icons";
import {
  FloatingToolbarShell,
  DetachedToolbar,
  PodGrabHandle,
  type ToolbarOrientation,
} from "./editor-layout/floating-toolbar-shell";

export { type ToolbarOrientation };

export type MarginaliaType = "quote" | "note" | "archive" | "todo";
export type DividerLevel = 1 | 2 | 3 | 4;
export type DividerWidth = "full" | "mid" | "text";

/** The tilted-star glyph used for every Actions affordance — toolbar
 *  anchor button, collapsed-pod single button, and anywhere else the
 *  actions toolbar's identity needs to show up. Size is controlled by
 *  CSS font/SVG width; width/height default match the toolbar size. */
function ActionsStarIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size * (19.64 / 18)} height={size} viewBox="-26.06 -24.2 175 160.4" fill="currentColor" fillRule="evenodd">
      <path stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" d="M109.28,19.61l12.21,9.88a3.77,3.77,0,0,1,.56,5.29l-5.46,6.75L98.53,26.93,104,20.17a3.79,3.79,0,0,1,5.29-.56ZM9.49,0H85.71A9.53,9.53,0,0,1,95.2,9.49v5.63l-4.48,5.53a9.81,9.81,0,0,0-1.18,1.85c-.24.19-.48.4-.71.62V9.49a3.14,3.14,0,0,0-3.12-3.13H9.49A3.14,3.14,0,0,0,6.36,9.49v93.06a3.16,3.16,0,0,0,.92,2.21,3.11,3.11,0,0,0,2.21.92H85.71a3.12,3.12,0,0,0,3.12-3.13V88.2l1.91-.81a10,10,0,0,0,4.34-3.13l.12-.14v18.43A9.54,9.54,0,0,1,85.71,112H9.49A9.51,9.51,0,0,1,0,102.55V9.49A9.53,9.53,0,0,1,9.49,0ZM87.25,78,74.43,83.47c-9.35,3.47-8.93,5.43-8-3.85L69.24,63.4h0l0,0,26.56-33,18,14.6L87.27,78ZM72.31,65.89l11.86,9.59-8.42,3.6c-6.6,2.83-6.42,4.23-5.27-2.53l1.83-10.66Z" />
      <path d="M21.07,30.81a3.18,3.18,0,0,1,0-6.36H74.12a3.18,3.18,0,0,1,0,6.36ZM21.07,87.6a3.19,3.19,0,0,1,0-6.37H56.19a37.1,37.1,0,0,0-.3,6.37Zm0-18.93a3.19,3.19,0,0,1,0-6.37H59.22l0,.27-1.05,6.1Zm0-18.93a3.18,3.18,0,0,1,0-6.36H72.44l-5.11,6.36Z" />
    </svg>
  );
}

/** The paragraph-symbol (¶) glyph used for the Formatting anchor. */
function FormatGlyphIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size * (17.53 / 18)} height={size} viewBox="-5.89 -6.385 37.31 38.30" fill="currentColor">
      <path d="M25.198,6.273c-0.014,0.23-0.045,0.389-0.087,0.467c-0.045,0.084-0.176,0.145-0.392,0.183c-0.469,0.104-0.781-0.074-0.935-0.533C23.239,4.7,22.59,3.578,21.84,3.016c-1.041-0.773-2.862-1.161-5.469-1.161c-1.054,0-1.633,0.115-1.734,0.343c-0.036,0.075-0.057,0.184-0.057,0.324v18.999c0,0.812,0.188,1.383,0.571,1.709c0.382,0.32,1.069,0.731,2.201,0.999c0.483,0.103,0.97,0.2,1.034,0.239c0.46,0,0.504,1.057-0.376,1.057c-0.025,0.016-10.375-0.008-10.375-0.008s-0.723-0.439-0.074-1.023c0.271-0.121,0.767-0.343,0.767-0.343s1.83-0.614,2.211-1.009c0.434-0.445,0.648-1.164,0.648-2.154V2.521c0-0.369-0.229-0.585-0.687-0.647c-0.049-0.015-0.425-0.02-1.122-0.02c-2.415,0-4.191,0.418-5.338,1.259C3.176,3.735,2.411,4.877,1.737,6.545C1.52,7.065,1.22,7.234,0.84,7.058C0.408,6.957,0.251,6.719,0.363,6.353c0.445-1.374,0.668-3.31,0.668-5.814c0-0.292,0.387-0.586,1.163-0.533L23.56,0.064c0.709-0.104,1.096,0.012,1.16,0.343C25.076,2.096,25.234,4.052,25.198,6.273z" />
    </svg>
  );
}

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

/** Callbacks wired to every button in the Actions toolbar. Shared by the
 *  attached popover in MenuBar and the detached floating toolbar rendered
 *  at the EditorLayout level. Every entry corresponds 1:1 to a side-panel
 *  whose "+" button creates a new item; the toolbar variant operates on
 *  the live editor selection when one exists, or creates a blank card
 *  otherwise — either way, a card popup spawns near the toolbar.
 *
 *  `anchorRect` is the bounding rect of the surrounding toolbar pod (the
 *  popover or the detached floater), captured at click time so the
 *  popup can spawn just below it (flipping above when near the viewport
 *  bottom). Handlers accept `null` as a safe fallback. */
export type ActionToolbarCallback = (anchorRect: DOMRect | null) => void;

export interface ActionToolbarCallbacks {
  onAddComment?: ActionToolbarCallback;
  onAddNote?: ActionToolbarCallback;
  onAddTodo?: ActionToolbarCallback;
  onCutSelection?: ActionToolbarCallback;
  onArchive?: ActionToolbarCallback;
  onCreateFootnote?: ActionToolbarCallback;
  onInsertCitation?: ActionToolbarCallback;
  onQuoteSelection?: ActionToolbarCallback;
}

interface MenuBarProps extends ActionToolbarCallbacks {
  editor: Editor | null;
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
  /* expand/collapse-all-sections intentionally absent: the Actions toolbar
     is reserved for "create new item" operations. */
  onCloseAllPanels?: () => void;
  onGrabStart?: (e: React.MouseEvent<HTMLDivElement>) => void;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
  /** Fired when the user mouseDowns on the Actions popover's grab bar.
   *  Receives the pod's bounding rect so the detached toolbar can spawn
   *  at the same spot, and the original mouse event so drag-to-move can
   *  continue without a pickup re-grip. Each grab spawns a new detached
   *  toolbar; the anchor button itself is a plain popover toggle. */
  onActionsDetach?: (e: React.MouseEvent<HTMLDivElement>, rect: DOMRect) => void;
  /** Same contract as `onActionsDetach`, for the Formatting popover.
   *  Each grab spawns a new detached Formatting toolbar. */
  onFormatDetach?: (e: React.MouseEvent<HTMLDivElement>, rect: DOMRect) => void;
  /** When true, the toolbar is docked in the Virgil top bar (its "home"):
   *  rotation knob and tab silhouette are hidden, orientation is locked
   *  horizontal, and the pod outlines with a uniform rounded radius. The
   *  grab bar stays visible so the user can drag the toolbar out. */
  atHome?: boolean;
  /** Fired when the user clicks the dock-up button (only rendered when
   *  !atHome) to return the toolbar to its Virgil-bar home. */
  onDockUp?: () => void;
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
 *  right edge. Styled like a miniature version of the main toolbar.
 *
 *  When `onGrabStart` is provided, a grab handle is drawn at the trailing
 *  end of the pod. MouseDown on that handle closes the popover and fires
 *  the callback with the pod's rect — the caller can then spawn a
 *  detached floating version that picks up the drag seamlessly. */
function AttachedPopover({
  anchor,
  children,
  title,
  active,
  onGrabStart,
}: {
  anchor: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  title: string;
  active?: boolean;
  onGrabStart?: (e: React.MouseEvent<HTMLDivElement>, rect: DOMRect) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right?: number; left?: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const podRef = useRef<HTMLDivElement>(null);

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

  const handleGrab = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onGrabStart || !podRef.current) return;
    const rect = podRef.current.getBoundingClientRect();
    setOpen(false);
    onGrabStart(e, rect);
  };

  return (
    <div ref={wrapRef} className="relative flex items-center">
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
          ref={podRef}
          data-action-pod
          className="fixed flex items-center bg-[var(--pod-toolbar)] z-[55] pl-2 gap-0.5"
          style={{
            top: pos.top,
            bottom: pos.bottom,
            right: pos.right,
            left: pos.left,
            height: 'var(--header-h)',
            borderRadius: 'var(--pod-radius)',
            border: 'var(--pod-border)',
            boxShadow: 'var(--pod-shadow)',
            paddingRight: onGrabStart ? 0 : 8,
          }}
        >
          {children(close)}
          {onGrabStart && <PodGrabHandle onMouseDown={handleGrab} title="Drag to detach toolbar" />}
        </div>
      )}
    </div>
  );
}


/** A single action button. Uses the panel's own icon (from
 *  panel-icons.tsx), tinted to the panel's default color
 *  (DEFAULT_PANEL_COLORS in panel-theme.ts). The icon inherits the
 *  button's text color via `currentColor`, so one prop drives both
 *  stroke and hover text. `hoverBg` is a light-tinted chip background
 *  keyed to each panel's color family.
 *
 *  On click, the button resolves the surrounding toolbar pod rect
 *  (looking for the nearest `[data-action-pod]` ancestor) and passes
 *  it to the callback. The handler uses that rect to spawn a popup
 *  card directly below (or above) the pod. */
export function ActionButton({
  onClick,
  title,
  color,
  hoverBg,
  hoverColor,
  icon,
}: {
  onClick: ActionToolbarCallback;
  title: string;
  color: string;
  hoverBg: string;
  hoverColor: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        const pod = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-action-pod]");
        onClick(pod?.getBoundingClientRect() ?? null);
      }}
      title={title}
      className="p-1 rounded transition-colors"
      style={{ color }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoverBg;
        e.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
        e.currentTarget.style.color = color;
      }}
    >
      {icon}
    </button>
  );
}

/** Static registry for every user-creatable item surfaced by the Actions
 *  toolbar. Each entry pairs a callback key with its source panel (used
 *  to look up side placement in viewPrefs) and its visual identity.
 *  Shared by `ActionButtonsRow` (main + detached) and `MarginActionToolbar`.
 *  Order is the display order in the main toolbar. `dataAttr` keeps the
 *  existing test/e2e hooks that some callers rely on. */
export interface ActionButtonDef {
  callbackKey: keyof ActionToolbarCallbacks;
  panelId: "revisions" | "notes" | "todo" | "cutter" | "archive" | "footnotes" | "citations" | "quotations";
  title: string;
  color: string;
  hoverBg: string;
  hoverColor: string;
  icon: React.ReactNode;
  dataAttr?: string;
}

export const ACTION_BUTTON_DEFS: ActionButtonDef[] = [
  { callbackKey: "onAddComment", panelId: "revisions", title: "Add revision", color: "#9333ea", hoverBg: "#faf5ff", hoverColor: "#7e22ce", icon: <IconRevisions size={16} />, dataAttr: "data-add-comment-button" },
  { callbackKey: "onAddNote", panelId: "notes", title: "Add note", color: "#15803d", hoverBg: "#f0fdf4", hoverColor: "#166534", icon: <IconNotes size={16} />, dataAttr: "data-add-note-button" },
  { callbackKey: "onAddTodo", panelId: "todo", title: "Add todo", color: "#44403c", hoverBg: "#f5f4f1", hoverColor: "#1c1917", icon: <IconTodo size={16} />, dataAttr: "data-add-todo-button" },
  { callbackKey: "onCutSelection", panelId: "cutter", title: "Add cut", color: "#b45757", hoverBg: "#fef2f2", hoverColor: "#993d3d", icon: <IconCutter size={16} />, dataAttr: "data-cut-selection-button" },
  { callbackKey: "onArchive", panelId: "archive", title: "Add archive", color: "#7191b0", hoverBg: "#f0f5fa", hoverColor: "#5a7a99", icon: <IconArchive size={16} /> },
  { callbackKey: "onCreateFootnote", panelId: "footnotes", title: "Add footnote", color: "#b45757", hoverBg: "#fef2f2", hoverColor: "#993d3d", icon: <IconFootnote /> },
  { callbackKey: "onInsertCitation", panelId: "citations", title: "Add citation", color: "#d4a843", hoverBg: "#fdf8e1", hoverColor: "#a07d26", icon: <IconCitation />, dataAttr: "data-insert-citation-button" },
  { callbackKey: "onQuoteSelection", panelId: "quotations", title: "Add quotation", color: "#a16207", hoverBg: "#fffbeb", hoverColor: "#854d0e", icon: <IconQuotations size={16} /> },
];

/** Renders the full row of Actions buttons shared by the attached
 *  popover (in MenuBar) and the detached floating toolbar (in
 *  EditorLayout). `close` is the popover-close callback when rendered
 *  inside AttachedPopover; it's a no-op when rendered detached.
 *
 *  Each button mirrors the corresponding side-panel's icon tinted to
 *  that panel's color, so the toolbar reads as a color-coded index of
 *  the panels it feeds. */
export function ActionButtonsRow({
  close,
  ...callbacks
}: { close: () => void } & ActionToolbarCallbacks) {
  return (
    <>
      {ACTION_BUTTON_DEFS.map((def) => {
        const cb = callbacks[def.callbackKey];
        if (!cb) return null;
        const button = (
          <ActionButton
            onClick={(rect) => cb(rect)}
            title={def.title}
            color={def.color}
            hoverBg={def.hoverBg}
            hoverColor={def.hoverColor}
            icon={def.icon}
          />
        );
        if (def.dataAttr) {
          return (
            <span key={def.callbackKey} {...{ [def.dataAttr]: "" }}>
              {button}
            </span>
          );
        }
        return <Fragment key={def.callbackKey}>{button}</Fragment>;
      })}
    </>
  );
}

/** Renders the full row of Formatting buttons — shared by the attached
 *  popover (inside MenuBar) and the detached Formatting toolbar
 *  (rendered at EditorLayout root once the user tears the popover off). */
export function FormatButtonsRow({ editor }: { editor: Editor }) {
  return (
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
  );
}

/** Free-floating "detached" Actions toolbar rendered at the EditorLayout
 *  root once the user tears the Actions popover off its grab bar. Thin
 *  wrapper around the shared `DetachedToolbar` primitive — all the
 *  shell / rotate / collapse / knob-pivot plumbing lives there. */
export function DetachedActionsToolbar({
  actions,
  onGrabStart,
  onReattach,
  pos,
  onSetPos,
}: {
  actions: ActionToolbarCallbacks;
  onGrabStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  onReattach: () => void;
  pos: { left: number; top: number };
  onSetPos: (pos: { left: number; top: number }) => void;
}) {
  return (
    <DetachedToolbar
      pos={pos}
      onSetPos={onSetPos}
      onGrabStart={onGrabStart}
      onReattach={onReattach}
      reattachTitle="Re-dock actions toolbar"
      collapseTitle="Collapse actions toolbar"
      expandTitle="Expand actions toolbar"
      collapsedGlyph={{ icon: <ActionsStarIcon />, title: "Actions" }}
      podDataAttr="data-action-pod"
    >
      <ActionButtonsRow close={() => {}} {...actions} />
    </DetachedToolbar>
  );
}

/** Free-floating "detached" Formatting toolbar. Same shell as the
 *  Actions toolbar — different contents. */
export function DetachedFormattingToolbar({
  editor,
  onGrabStart,
  onReattach,
  pos,
  onSetPos,
}: {
  editor: Editor;
  onGrabStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  onReattach: () => void;
  pos: { left: number; top: number };
  onSetPos: (pos: { left: number; top: number }) => void;
}) {
  return (
    <DetachedToolbar
      pos={pos}
      onSetPos={onSetPos}
      onGrabStart={onGrabStart}
      onReattach={onReattach}
      reattachTitle="Re-dock formatting toolbar"
      collapseTitle="Collapse formatting toolbar"
      expandTitle="Expand formatting toolbar"
      collapsedGlyph={{ icon: <FormatGlyphIcon />, title: "Formatting" }}
    >
      <FormatButtonsRow editor={editor} />
    </DetachedToolbar>
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
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${open ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
        title="View options"
      >
        <svg
          width="4.15"
          height="18"
          viewBox="5.75 -1.75 4.5 19.5"
          fill="currentColor"
          style={orientation === "vertical" ? { transform: "rotate(90deg)" } : undefined}
        >
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

/** Shared button row used by both the at-home MenuBar and the
 *  detached floating copies. Renders View menu + Format popover +
 *  Actions popover + paragraph nav + split + close-all. Orientation
 *  drives only the nav-button pair stacking; the popovers and single
 *  buttons are layout-agnostic. */
function MenuBarContent({
  editor,
  orientation,
  onAddComment, onArchive, onCreateFootnote, onQuoteSelection, onAddNote, onAddTodo, onCutSelection, onInsertCitation,
  showParTitles, onToggleParTitles,
  showLatexComments, onToggleLatexComments,
  showSectionIndicator, onToggleSectionIndicator,
  onOpenPreferences,
  editorSplit, onToggleEditorSplit, activeSplitPane,
  showMarginalia, onToggleMarginalia,
  hiddenMarginaliaTypes, onToggleMarginaliaType,
  alwaysShowLinkedText, onToggleAlwaysShowLinkedText,
  availableDividerLevels, dividerLevels, onToggleDividerLevel,
  dividerWidth, onSetDividerWidth,
  onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled,
  onCloseAllPanels,
  onActionsDetach, onFormatDetach,
  onSetOrientation,
}: {
  editor: Editor;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
} & Omit<MenuBarProps, "editor" | "orientation" | "onSetOrientation" | "onGrabStart" | "atHome" | "onDockUp">) {
  const isVert = orientation === "vertical";
  return (
    <>
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

      {/* Format popup — each grab spawns a detached Formatting toolbar. */}
      <AttachedPopover
        title="Formatting"
        onGrabStart={onFormatDetach}
        anchor={<FormatGlyphIcon />}
      >
        {() => <FormatButtonsRow editor={editor} />}
      </AttachedPopover>

      {/* Actions popup — each grab spawns a detached Actions toolbar. */}
      <AttachedPopover
        title="Actions"
        onGrabStart={onActionsDetach}
        anchor={<ActionsStarIcon />}
      >
        {(close) => (
          <ActionButtonsRow
            close={close}
            onAddComment={onAddComment}
            onAddNote={onAddNote}
            onAddTodo={onAddTodo}
            onCutSelection={onCutSelection}
            onArchive={onArchive}
            onCreateFootnote={onCreateFootnote}
            onInsertCitation={onInsertCitation}
            onQuoteSelection={onQuoteSelection}
          />
        )}
      </AttachedPopover>

      {/* Paragraph navigation — back/forward stacked along the main axis. */}
      {(onParaNavBack || onParaNavForward) && (
        <div className={`flex items-stretch ${isVert ? "flex-col" : "flex-row"}`}>
          {onParaNavBack && (
            <button
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              title="Go back"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 22, height: 11 } : { width: 11, height: 22 }}
            >
              <svg width="9" height="18" viewBox="7.5 3 9 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              title="Go forward"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 22, height: 11 } : { width: 11, height: 22 }}
            >
              <svg width="9" height="18" viewBox="7.5 3 9 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1.5" />
            <line x1="9" y1="9" x2="15" y2="15" />
            <line x1="15" y1="9" x2="9" y2="15" />
          </svg>
        </IconBtn>
      )}
    </>
  );
}

/** Main MenuBar — always lives at home (docked in the Virgil top bar).
 *  Grabbing its trailing grab bar spawns a new `DetachedMenuToolbar`
 *  copy rather than moving the bar itself; the home-docked bar stays
 *  put. Each grab spawns an additional copy, matching the tear-off
 *  semantics of the Actions and Formatting popovers. */
function MenuBar({ orientation: _o, onSetOrientation: _so, atHome: _ah, onDockUp: _du, onGrabStart, ...rest }: MenuBarProps) {
  if (!rest.editor) return null;
  // MenuBar is always home-docked: a compact lozenge that fits inside
  // the Virgil top bar, horizontal, with no tab, knob, or shadow.
  return (
    <FloatingToolbarShell orientation="horizontal" atHome podClassName="gap-0.5 h-[26px] px-1.5">
      <MenuBarContent {...rest} editor={rest.editor} orientation="horizontal" onSetOrientation={() => {}} />
      {onGrabStart && (
        <PodGrabHandle
          onMouseDown={onGrabStart}
          title="Drag to spawn a floating copy"
          orientation="horizontal"
        />
      )}
    </FloatingToolbarShell>
  );
}

/** Free-floating "detached" MenuBar — spawned when the user tears the
 *  home-docked bar off by its grab bar. Same content row as home;
 *  wrapped in the shared `DetachedToolbar` shell for rotate / collapse
 *  / knob-pivot / grab / close affordances. Multi-instance: every tear
 *  spawns a new copy. */
export function DetachedMenuToolbar({
  menuProps,
  onGrabStart,
  onReattach,
  pos,
  onSetPos,
}: {
  menuProps: Omit<MenuBarProps, "editor" | "orientation" | "onSetOrientation" | "onGrabStart" | "atHome" | "onDockUp"> & { editor: Editor };
  onGrabStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  onReattach: () => void;
  pos: { left: number; top: number };
  onSetPos: (pos: { left: number; top: number }) => void;
}) {
  return (
    <DetachedToolbar
      pos={pos}
      onSetPos={onSetPos}
      onGrabStart={onGrabStart}
      onReattach={onReattach}
      reattachTitle="Close floating menu"
      collapsible={false}
    >
      {({ orientation }) => (
        <MenuBarContent
          {...menuProps}
          orientation={orientation}
          onSetOrientation={() => {}}
        />
      )}
    </DetachedToolbar>
  );
}

export default memo(MenuBar);
