"use client";

import { memo, useState, useRef, useEffect, Fragment, type ReactNode } from "react";
import { Editor } from "@tiptap/react";
import type { HighlightType, MarginaliaType, DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";
import { type ToolbarOrientation } from "./editor-layout/floating-toolbar-shell";
// CHIP 5a: the BlockType dropdown's heading items route through the canonical
// `headingRun` (SET + numbered:true) in the action registry — the SAME `run()`
// the `\chapter`…`\subsubsection` slash commands call. The dropdown used to
// `toggleHeading` (clicking 'Section' on an existing level-2 heading reverted it
// to a paragraph); it now always SETs. Heading is pure ProseMirror (no React
// `cardCreation`), so the dropdown calls `run()` directly — no bridge.
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type BlockActionId,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";

export { type ToolbarOrientation };

// CHIP 5c: the example creators (`buildExampleTemplate` / `insertExampleAtCursor`
// / `handleExampleMenuPick`) were RETIRED here. The single canonical example
// creator is now `exampleRun` (wrap-if-selection-else-insert; one template, the
// `exampleItemList`-wrapped `multi` shape) in
// [src/lib/actions/action-registry.ts]; the grid `ex` cell + the slash `\ex`
// command both route through it. `insertExampleAtCursor` + `handleExampleMenuPick`
// had ZERO live callers (the Format-popover dropdown that once used them is gone),
// and `buildExampleTemplate`'s `multi` shape diverged from the schema (bare
// `exampleItem`s vs the serializer-correct `exampleItemList` wrapper) — that
// dormant divergence is resolved in the canonical builder.

// Types moved to useViewPrefs (the schema home for view-level prefs).
// Re-exported here for back-compat with existing consumers.
export type { MarginaliaType, DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";

const DIVIDER_LEVEL_LABELS: Record<DividerLevel, string> = {
  0: "Parts",
  1: "Chapters",
  2: "Sections",
  3: "Subsections",
  4: "Subsubsections",
  5: "Paragraph headings",
  6: "Subparagraph headings",
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
  onAddHighlight?: ActionToolbarCallback;
  onAddTodo?: ActionToolbarCallback;
  onCutSelection?: ActionToolbarCallback;
  onArchive?: ActionToolbarCallback;
  onCreateFootnote?: ActionToolbarCallback;
  onInsertCitation?: ActionToolbarCallback;
  onCreateBibEntry?: ActionToolbarCallback;
}

interface MenuBarProps extends ActionToolbarCallbacks {
  editor: Editor | null;
  showParTitles: boolean;
  onToggleParTitles: () => void;
  showLatexComments: boolean;
  onToggleLatexComments: () => void;
  showSectionIndicator: boolean;
  onToggleSectionIndicator: () => void;
  showHeadingLabels: boolean;
  onToggleHeadingLabels: () => void;
  onOpenPreferences?: () => void;
  editorSplit?: boolean;
  onToggleEditorSplit?: () => void;
  activeSplitPane?: "top" | "bottom";
  showMarginalia: boolean;
  onToggleMarginalia: () => void;
  hiddenMarginaliaTypes: Set<MarginaliaType>;
  onToggleMarginaliaType: (type: MarginaliaType) => void;
  showHighlights: boolean;
  onToggleHighlights: () => void;
  hiddenHighlightTypes: Set<HighlightType>;
  onToggleHighlightType: (type: HighlightType) => void;
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
  onOpenFontsDialog?: () => void;
  /** Enter the in-editor margin-edit mode — guides appear over the
   *  text column and Save/Cancel buttons appear in the docked toolbar. */
  onOpenMarginsMode?: () => void;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
  /** Optional collaborator-mode status pill, rendered at the start of
   *  the bar. Owned by the host (EditorLayout) so it can plug in
   *  per-doc collab state. */
  collabStatus?: ReactNode;
  /** When false, suppress edit-mutating items in the View menu (Fonts,
   *  Margins). View toggles (par titles, latex comments, dividers, etc.)
   *  remain visible. Defaults to true. EditorPane wires this from
   *  `chrome.showMenuBarEditItems`; the Library Reader's chrome sets it
   *  to false. */
  showEditItems?: boolean;
  /** When false, suppress the Formatting popover entirely. Defaults to
   *  true. EditorPane wires this from `chrome.showFormattingToolbar`. */
  showFormattingToolbar?: boolean;
}

const BLOCK_TYPES = [
  { value: "p", label: "Body text" },
  { value: "0", label: "Part" },
  { value: "1", label: "Chapter" },
  { value: "2", label: "Section" },
  { value: "3", label: "Subsection" },
  { value: "4", label: "Subsubsection" },
  { value: "5", label: "Paragraph heading" },
  { value: "6", label: "Subparagraph heading" },
];

/** The BlockType dropdown's heading levels that have a canonical registry row
 *  (CHIP 5a): \chapter(1)…\subsubsection(4). Levels 0 (Part), 5 (Paragraph
 *  heading) and 6 (Subparagraph heading) are out of the heading-alignment scope
 *  — they have no slash command + no registry row, so they keep a direct
 *  `setBlockType` (also SET + numbered, for consistency with the SET decision —
 *  never a toggle). */
const LEVEL_TO_HEADING_ACTION: Readonly<Record<string, BlockActionId>> = {
  "1": "heading-chapter",
  "2": "heading-section",
  "3": "heading-subsection",
  "4": "heading-subsubsection",
};

/**
 * Apply a heading conversion from the BlockType dropdown — always SET, never
 * toggle (CHIP 5a). Levels 1–4 route through the registry's canonical
 * `headingRun` (the SAME `run()` the slash commands call); the out-of-scope
 * levels (0/5/6) fall back to a direct SET `setBlockType` so the dropdown's
 * verb is uniformly "set" across every level.
 *
 * Pure ProseMirror — builds a minimal view-only `ActionContext` from
 * `editor.view` (the registry heading `run()` reads only `ctx.view`). No
 * bridge: heading needs no React-land `cardCreation`.
 */
function applyHeadingFromDropdown(editor: Editor, levelValue: string): void {
  const id = LEVEL_TO_HEADING_ACTION[levelValue];
  if (id) {
    const spec = VIRGIL_ACTION_REGISTRY[id];
    if (spec) {
      const view = editor.view;
      const pos = view.state.selection.head;
      const ctx: ActionContext = {
        editor,
        view,
        ref: {
          kind: "cursor",
          pos,
          paragraphId: paragraphUuidAt(view.state.doc, pos) ?? "",
        },
        surface: "lightning",
      };
      void spec.run(ctx);
      return;
    }
  }
  // Out-of-scope level (0/5/6, or a misconfigured value): SET directly +
  // numbered (NOT toggle — matches the SET decision for the whole dropdown).
  const level = parseInt(levelValue) as unknown as 1 | 2 | 3 | 4 | 5 | 6;
  editor.chain().focus().setNode("heading", { level, numbered: true }).run();
}

export function BlockTypeDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({});

  const current = editor.isActive("heading", { level: 0 })
    ? "0"
    : editor.isActive("heading", { level: 1 })
      ? "1"
      : editor.isActive("heading", { level: 2 })
        ? "2"
        : editor.isActive("heading", { level: 3 })
          ? "3"
          : editor.isActive("heading", { level: 4 })
            ? "4"
            : editor.isActive("heading", { level: 5 })
              ? "5"
              : editor.isActive("heading", { level: 6 })
                ? "6"
                : "p";

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
      // Popup height: 8 items × ~30px + 8px padding ≈ 248px. Flip up if below overflows.
      const POPUP_H = 250;
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
        data-hint="Block type"
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
                if (bt.value === "p") {
                  // 'Body' is the explicit way OUT of heading-hood — setParagraph,
                  // no toggle needed (CHIP 5a: the heading items no longer toggle
                  // off, so 'Body' is the canonical return-to-paragraph).
                  if (editor.isActive("heading")) editor.chain().focus().setParagraph().run();
                } else {
                  // CHIP 5a: SET (never toggle). Levels 1–4 route through the
                  // registry's canonical headingRun; 0/5/6 fall back to a direct
                  // SET. See applyHeadingFromDropdown.
                  applyHeadingFromDropdown(editor, bt.value);
                }
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-[var(--foreground)] hover-on-light flex items-center gap-2"
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

/** Viewport-aware dropdown — anchors to the right edge of its trigger and
 *  flips above when it would overflow the bottom of the viewport. */
function ViewMenu({
  showParTitles,
  onToggleParTitles,
  showLatexComments,
  onToggleLatexComments,
  showSectionIndicator,
  onToggleSectionIndicator,
  showHeadingLabels,
  onToggleHeadingLabels,
  onOpenPreferences,
  showMarginalia,
  onToggleMarginalia,
  hiddenMarginaliaTypes,
  onToggleMarginaliaType,
  showHighlights,
  onToggleHighlights,
  hiddenHighlightTypes,
  onToggleHighlightType,
  availableDividerLevels,
  dividerLevels,
  onToggleDividerLevel,
  dividerWidth,
  onSetDividerWidth,
  orientation,
  onSetOrientation,
  onCloseAllPanels,
  onOpenFontsDialog,
  onOpenMarginsMode,
}: Pick<MenuBarProps,
  | "showParTitles" | "onToggleParTitles"
  | "showLatexComments" | "onToggleLatexComments"
  | "showSectionIndicator" | "onToggleSectionIndicator"
  | "showHeadingLabels" | "onToggleHeadingLabels"
  | "onOpenPreferences"
  | "showMarginalia" | "onToggleMarginalia"
  | "hiddenMarginaliaTypes" | "onToggleMarginaliaType"
  | "showHighlights" | "onToggleHighlights"
  | "hiddenHighlightTypes" | "onToggleHighlightType"
  | "availableDividerLevels" | "dividerLevels" | "onToggleDividerLevel"
  | "dividerWidth" | "onSetDividerWidth"
  | "orientation" | "onSetOrientation"
  | "onCloseAllPanels"
  | "onOpenFontsDialog"
  | "onOpenMarginsMode"
>) {
  const [open, setOpen] = useState(false);
  const [marginaliaExpanded, setMarginaliaExpanded] = useState(false);
  const [highlightsExpanded, setHighlightsExpanded] = useState(false);
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
  }, [open, marginaliaExpanded, highlightsExpanded, dividersExpanded, dividerPrefsExpanded]);

  const dropdownClass = [
    "absolute bg-surface border border-[var(--border)] rounded-lg shadow-lg z-[55] w-52 py-1",
    placement.v === "below" ? "top-full mt-1.5" : "bottom-full mb-1.5",
    placement.h === "right" ? "right-0" : "left-0",
  ].join(" ");

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${open ? "bg-[var(--accent-light)] text-[var(--accent)]" : "text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
        data-hint="View options"
      >
        <svg
          width="3.69"
          height="16"
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
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-medium text-ink-muted uppercase tracking-wide">Display</div>
          <button
            onClick={() => { onToggleParTitles(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>Paragraph titles</span>
            <span className="text-[var(--accent)]">{showParTitles ? "\u2713" : ""}</span>
          </button>
          <button
            onClick={() => { onToggleLatexComments(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>% comments</span>
            <span className="text-[var(--accent)]">{showLatexComments ? "\u2713" : ""}</span>
          </button>
          <button
            onClick={() => { onToggleSectionIndicator(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>Current section</span>
            <span className="text-[var(--accent)]">{showSectionIndicator ? "\u2713" : ""}</span>
          </button>
          <button
            onClick={() => { onToggleHeadingLabels(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>Labels</span>
            <span className="text-[var(--accent)]">{showHeadingLabels ? "\u2713" : ""}</span>
          </button>
          <div className="my-1 border-t border-edge-subtle" />
          <button
            onClick={() => setMarginaliaExpanded((p) => !p)}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
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
                className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
              >
                <span>Show marginalia</span>
                <span className="text-[var(--accent)]">{showMarginalia ? "\u2713" : ""}</span>
              </button>
              {showMarginalia && (["note", "archive", "todo"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => onToggleMarginaliaType(type)}
                  className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                >
                  <span>{type === "note" ? "Notes" : type === "archive" ? "Archive" : "Todo"}</span>
                  <span className="text-[var(--accent)]">{!hiddenMarginaliaTypes.has(type) ? "\u2713" : ""}</span>
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => setHighlightsExpanded((p) => !p)}
            className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
          >
            <span>Highlights</span>
            <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: highlightsExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 1L5.5 4L2.5 7" />
            </svg>
          </button>
          {highlightsExpanded && (
            <>
              <button
                onClick={onToggleHighlights}
                className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
              >
                <span>Show highlights</span>
                <span className="text-[var(--accent)]">{showHighlights ? "\u2713" : ""}</span>
              </button>
              {showHighlights && (["note", "todo", "comment", "cut"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => onToggleHighlightType(type)}
                  className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                >
                  <span>{
                    type === "note" ? "Notes"
                      : type === "todo" ? "Todo"
                      : type === "comment" ? "Revisions"
                      : "Cuts"
                  }</span>
                  <span className="text-[var(--accent)]">{!hiddenHighlightTypes.has(type) ? "\u2713" : ""}</span>
                </button>
              ))}
            </>
          )}
          {availableDividerLevels.size > 0 && (
            <>
              <button
                onClick={() => setDividersExpanded((p) => !p)}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
              >
                <span>Show dividers for&hellip;</span>
                <svg className="w-3 h-3 text-ink-muted transition-transform" style={{ transform: dividersExpanded ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 1L5.5 4L2.5 7" />
                </svg>
              </button>
              {dividersExpanded && (
                <>
                  {([0, 1, 2, 3, 4, 5, 6] as const).filter((lvl) => availableDividerLevels.has(lvl)).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => onToggleDividerLevel(lvl)}
                      className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                    >
                      <span>{DIVIDER_LEVEL_LABELS[lvl]}</span>
                      <span className="text-[var(--accent)]">{dividerLevels.has(lvl) ? "\u2713" : ""}</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setDividerPrefsExpanded((p) => !p)}
                    className="w-full text-left pl-6 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
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
                      className="w-full text-left pl-9 pr-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
                    >
                      <span>{DIVIDER_WIDTH_LABELS[w]}</span>
                      <span className="text-[var(--accent)]">{dividerWidth === w ? "\u2713" : ""}</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          {/* Margins editor entry — opens an in-text drag mode with
              save/cancel buttons in the docked toolbar band. Sits in
              the same trailing block as Fonts… */}
          {onOpenMarginsMode ? (
            <>
              <div className="my-1 border-t border-edge-subtle" />
              <button
                onClick={() => { onOpenMarginsMode(); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center gap-3"
              >
                <span>Margins&hellip;</span>
              </button>
            </>
          ) : null}
          {/* Fonts dialog launcher — sits above the close-all action. */}
          {onOpenFontsDialog ? (
            <>
              {!onOpenMarginsMode && <div className="my-1 border-t border-edge-subtle" />}
              <button
                onClick={() => { onOpenFontsDialog(); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center gap-3"
              >
                <span>Fonts&hellip;</span>
              </button>
            </>
          ) : null}
          {onCloseAllPanels && (
            <>
              <div className="my-1 border-t border-edge-subtle" />
              <button
                onClick={() => { onCloseAllPanels(); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center gap-3"
              >
                <span>Close all panels</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared button row used by both the at-home MenuBar and the
 *  detached floating copies. Renders View menu + Format popover +
 *  Actions popover + paragraph nav + split. Orientation
 *  drives only the nav-button pair stacking; the popovers and single
 *  buttons are layout-agnostic. */
function MenuBarContent({
  editor,
  orientation,
  onAddComment, onArchive, onCreateFootnote, onAddNote, onAddHighlight, onAddTodo, onCutSelection, onInsertCitation,
  showParTitles, onToggleParTitles,
  showLatexComments, onToggleLatexComments,
  showSectionIndicator, onToggleSectionIndicator,
  showHeadingLabels, onToggleHeadingLabels,
  onOpenPreferences,
  editorSplit, onToggleEditorSplit, activeSplitPane,
  showMarginalia, onToggleMarginalia,
  hiddenMarginaliaTypes, onToggleMarginaliaType,
  showHighlights, onToggleHighlights,
  hiddenHighlightTypes, onToggleHighlightType,
  availableDividerLevels, dividerLevels, onToggleDividerLevel,
  dividerWidth, onSetDividerWidth,
  onParaNavBack, onParaNavForward, paraNavBackDisabled, paraNavForwardDisabled,
  onCloseAllPanels,
  onSetOrientation,
  onOpenFontsDialog,
  onOpenMarginsMode,
  showEditItems = true,
  showFormattingToolbar = true,
  kebabAtEnd = false,
  collabStatus,
}: {
  editor: Editor;
  orientation: ToolbarOrientation;
  onSetOrientation: (o: ToolbarOrientation) => void;
  /** When true, render the kebab/View menu after every other control
   *  instead of before. Used by the docked MenuBar above the editor. */
  kebabAtEnd?: boolean;
} & Omit<MenuBarProps, "editor" | "orientation" | "onSetOrientation">) {
  const isVert = orientation === "vertical";
  const viewMenu = (
    <ViewMenu
      showParTitles={showParTitles}
      onToggleParTitles={onToggleParTitles}
      showLatexComments={showLatexComments}
      onToggleLatexComments={onToggleLatexComments}
      showSectionIndicator={showSectionIndicator}
      onToggleSectionIndicator={onToggleSectionIndicator}
      showHeadingLabels={showHeadingLabels}
      onToggleHeadingLabels={onToggleHeadingLabels}
      onOpenPreferences={onOpenPreferences}
      showMarginalia={showMarginalia}
      onToggleMarginalia={onToggleMarginalia}
      hiddenMarginaliaTypes={hiddenMarginaliaTypes}
      onToggleMarginaliaType={onToggleMarginaliaType}
      showHighlights={showHighlights}
      onToggleHighlights={onToggleHighlights}
      hiddenHighlightTypes={hiddenHighlightTypes}
      onToggleHighlightType={onToggleHighlightType}
      availableDividerLevels={availableDividerLevels}
      dividerLevels={dividerLevels}
      onToggleDividerLevel={onToggleDividerLevel}
      dividerWidth={dividerWidth}
      onSetDividerWidth={onSetDividerWidth}
      orientation={orientation}
      onSetOrientation={onSetOrientation}
      onCloseAllPanels={onCloseAllPanels}
      onOpenFontsDialog={showEditItems ? onOpenFontsDialog : undefined}
      onOpenMarginsMode={showEditItems ? onOpenMarginsMode : undefined}
    />
  );
  return (
    <>
      {!kebabAtEnd && viewMenu}

      {/* Collaborator-mode status pill — at the bar's leading edge. */}
      {collabStatus}

      {/* Paragraph navigation — back/forward stacked along the main axis.
          The action menu is reached from the gutter SelectionActionsMenu
          trigger; no redundant strip copy lives here. */}
      {(onParaNavBack || onParaNavForward) && (
        <div className={`flex items-stretch gap-1 ${isVert ? "flex-col" : "flex-row"}`}>
          {onParaNavBack && (
            <button
              onClick={onParaNavBack}
              disabled={paraNavBackDisabled}
              data-hint="Go back"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 20, height: 16 } : { width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          {onParaNavForward && (
            <button
              onClick={onParaNavForward}
              disabled={paraNavForwardDisabled}
              data-hint="Go forward"
              className="flex items-center justify-center rounded transition-colors disabled:opacity-25 disabled:cursor-default text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"
              style={isVert ? { width: 20, height: 16 } : { width: 16, height: 20 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={isVert ? { transform: "rotate(90deg)" } : undefined}>
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Split toggle */}
      {onToggleEditorSplit && (
        <button
          onClick={onToggleEditorSplit}
          className={`p-1 rounded transition-colors ${editorSplit ? "text-[var(--accent)] bg-[var(--accent-light)]" : "text-[var(--ink-muted)] hover:bg-edge-subtle hover:text-ink-body"}`}
          data-hint="Split editor"
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

      {kebabAtEnd && viewMenu}
    </>
  );
}

/** Main MenuBar — docked at the top of the document, centered over
 *  the text window. Icons sit directly on the canvas background with
 *  no enclosing pod, mirroring the left tool strip's loose buttons.
 *  No grab handle, no tear-off; the kebab/View menu sits at the end. */
function MenuBar({ orientation: _o, onSetOrientation: _so, ...rest }: MenuBarProps) {
  if (!rest.editor) return null;
  return (
    <div className="flex flex-row items-center gap-0.5 h-[24px]">
      <MenuBarContent
        {...rest}
        editor={rest.editor}
        orientation="horizontal"
        onSetOrientation={() => {}}
        kebabAtEnd
      />
    </div>
  );
}

export default memo(MenuBar);
