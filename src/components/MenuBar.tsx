"use client";

import { memo, useState, useRef, useEffect, Fragment, type ReactNode } from "react";
import { Editor } from "@tiptap/react";
import { generateShortId } from "@/lib/uuid";
import type { HighlightType, MarginaliaType, DividerLevel, DividerWidth } from "@/hooks/useViewPrefs";
import { TextSelection } from "@tiptap/pm/state";
import { type ToolbarOrientation } from "./editor-layout/floating-toolbar-shell";
import { ActionsStripButton } from "./ActionsStripButton";

export { type ToolbarOrientation };

/** Build a fresh example-block JSONContent template for insertion. The
 *  template includes a pre-assigned uuid so callers can locate the node
 *  after insertion to place the cursor inside its first paragraph. */
export function buildExampleTemplate(
  kind: "single" | "multi",
  existing?: Set<string>,
): {
  uuid: string;
  node: Record<string, unknown>;
} {
  const uuid = generateShortId(existing);
  if (kind === "single") {
    return {
      uuid,
      node: {
        type: "exampleBlock",
        attrs: {
          uuid,
          tag: "",
          label: "",
          kind: "single",
          exnoOverride: null,
          suppressSpace: false,
          number: 0,
        },
        content: [{ type: "paragraph" }],
      },
    };
  }
  return {
    uuid,
    node: {
      type: "exampleBlock",
      attrs: {
        uuid,
        tag: "",
        label: "",
        kind: "multi",
        exnoOverride: null,
        suppressSpace: false,
        number: 0,
      },
      content: [
        {
          type: "exampleItem",
          attrs: { tag: "", label: "", subLabel: "" },
          content: [{ type: "paragraph" }],
        },
        {
          type: "exampleItem",
          attrs: { tag: "", label: "", subLabel: "" },
          content: [{ type: "paragraph" }],
        },
        {
          type: "exampleGloss",
          attrs: { glossId: null, colCount: 1 },
          content: [
            {
              type: "alignedGlossRow",
              attrs: { tier: "gla" },
              content: [{ type: "glossCell", content: [] }],
            },
            {
              type: "proseGlossRow",
              attrs: { tier: "glft" },
              content: [],
            },
          ],
        },
      ],
    },
  };
}

/** Insert a blank example block at the cursor and move selection into
 *  its first editable paragraph. Shared by the Format popover button
 *  and the Action-toolbar button's host. */
export function insertExampleAtCursor(
  editor: Editor,
  kind: "single" | "multi",
): { uuid: string } {
  const existing = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.type.name === "exampleBlock" && n.attrs.uuid) {
      existing.add(n.attrs.uuid as string);
    }
    return true;
  });
  const { uuid, node } = buildExampleTemplate(kind, existing);
  editor.chain().focus().insertContent(node).run();
  let target = -1;
  editor.state.doc.descendants((nd, pos) => {
    if (nd.type.name === "exampleBlock" && nd.attrs.uuid === uuid) {
      nd.descendants((child, relPos) => {
        if (target >= 0) return false;
        if (child.type.name === "paragraph") {
          target = pos + 1 + relPos + 1;
          return false;
        }
        return true;
      });
      return false;
    }
    return true;
  });
  if (target >= 0) {
    editor.chain().focus().setTextSelection(target).scrollIntoView().run();
  }
  return { uuid };
}

/** Dispatch an "insert example" request from the Format-popover dropdown.
 *
 *  - If the cursor is already inside an `exampleBlock`, the "a." option
 *    extends that block in place: a new `\a` sub-item is appended, with
 *    the cursor parked inside it. If the host block was a single `\ex`,
 *    it's converted to a `\pex` first (existing paragraph content moves
 *    into the first `\a` item).
 *  - The "(1)" option, or either option from outside any example, inserts
 *    a fresh block at the cursor.
 *
 *  Returns true if the request was handled (so the popover can close). */
export function handleExampleMenuPick(
  editor: Editor,
  kind: "single" | "multi",
): boolean {
  const { state } = editor;
  const { $from } = state.selection;

  // Walk ancestors to find an enclosing exampleBlock.
  let blockDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "exampleBlock") {
      blockDepth = d;
      break;
    }
  }

  // Outside any example, or user picked "(1)": fall back to fresh insert.
  if (blockDepth < 0 || kind === "single") {
    insertExampleAtCursor(editor, kind);
    return true;
  }

  // Inside an example + "a." request: extend in place.
  const block = $from.node(blockDepth);
  const blockPos = $from.before(blockDepth);
  const itemType = state.schema.nodes.exampleItem;
  const paragraphType = state.schema.nodes.paragraph;
  if (!itemType || !paragraphType) return false;

  if (block.attrs.kind === "multi") {
    // Append a fresh `\a` item just after the last existing item so
    // sub-labels stay monotonic.
    const newItem = itemType.create(
      { tag: "", label: "", subLabel: "" },
      paragraphType.create(),
    );
    let insertPos = blockPos + 1; // start of block content
    let lastItemEndInContent = -1;
    block.forEach((child, offset) => {
      if (child.type.name === "exampleItem") {
        lastItemEndInContent = offset + child.nodeSize;
      }
    });
    if (lastItemEndInContent >= 0) {
      insertPos = blockPos + 1 + lastItemEndInContent;
    } else {
      insertPos = blockPos + block.nodeSize - 1;
    }
    const tr = state.tr.insert(insertPos, newItem);
    // Park cursor inside the new item's first paragraph:
    //   insertPos = start of the item → +1 steps into item → +1 steps into paragraph content.
    const cursorPos = insertPos + 2;
    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    editor.view.dispatch(tr);
    editor.view.focus();
    return true;
  }

  // Single `\ex` → convert to `\pex` with the existing content wrapped
  // as the first item and a blank second item for the user to type in.
  const blockType = state.schema.nodes.exampleBlock;
  if (!blockType) return false;
  const carriedChildren: import("@tiptap/pm/model").Node[] = [];
  const trailingChildren: import("@tiptap/pm/model").Node[] = [];
  block.forEach((child) => {
    if (child.type.name === "paragraph" || child.type.name === "exampleGloss") {
      carriedChildren.push(child);
    } else {
      trailingChildren.push(child);
    }
  });
  const firstItemContent =
    carriedChildren.length > 0 ? carriedChildren : [paragraphType.create()];
  const firstItem = itemType.create(
    { tag: "", label: "", subLabel: "" },
    firstItemContent,
  );
  const secondItem = itemType.create(
    { tag: "", label: "", subLabel: "" },
    paragraphType.create(),
  );
  const newBlockChildren = [firstItem, secondItem, ...trailingChildren];
  const newBlock = blockType.create(
    { ...block.attrs, kind: "multi" },
    newBlockChildren,
  );
  const tr = state.tr.replaceRangeWith(
    blockPos,
    blockPos + block.nodeSize,
    newBlock,
  );
  // Cursor into the second item's first paragraph:
  //   blockPos + 1 (into block) + firstItem.nodeSize (past first item)
  //   + 1 (into secondItem) + 1 (into its first paragraph content).
  const cursorPos = blockPos + 1 + firstItem.nodeSize + 2;
  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

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
                  if (editor.isActive("heading")) editor.chain().focus().setParagraph().run();
                } else {
                  // TipTap's Level type is 1..6; we widen to 0..6 for \part.
                  // The schema accepts integer levels regardless.
                  const level = parseInt(bt.value) as unknown as 1 | 2 | 3 | 4 | 5 | 6;
                  editor.chain().focus().toggleHeading({ level }).run();
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
          Action button leads the group as a stable always-visible trigger
          for the SelectionActionsMenu vocabulary. */}
      {(onParaNavBack || onParaNavForward) && (
        <div className={`flex items-stretch gap-1 ${isVert ? "flex-col" : "flex-row"}`}>
          <ActionsStripButton editor={editor} />
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
