"use client";

/**
 * The expanded action menu — formatting grid + 9-row action list.
 * Mounted by whichever trigger opens it (the gutter button in
 * {@link SelectionActionsMenu}, the strip button in
 * {@link ActionsStripButton}). When this component is mounted, the
 * menu is open; the caller unmounts it to close.
 *
 * Owns:
 *  - Letter-key shortcuts (H/N/F/C/Q/T/E/X/A) + Escape.
 *  - Click-outside dismissal.
 *  - Color-palette state (persisted to localStorage) + the popover.
 *  - The formatting helpers (math wrap, example wrap, color apply).
 *  - The action dispatch into `useDragHandleMenu().dispatch`.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useDragHandleMenu } from "./editor-layout/card-actions/drag-handle-menu-context";
import { MENU_ENTRIES } from "./DragHandleMenu";
import { BlockTypeDropdown, buildExampleTemplate } from "./MenuBar";
import { insertTexBlock } from "@/lib/tiptap/tex-block";
import { SelectionColorPopover } from "./SelectionColorPopover";

const COLOR_PALETTE_KEY = "virgil:selection-menu-color-palette";
const DEFAULT_PALETTE = [
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // yellow
  "#16a34a", // green
  "#2563eb", // blue
  "#9333ea", // purple
  "#6b7280", // gray
];

function loadPalette(): string[] {
  if (typeof window === "undefined") return DEFAULT_PALETTE;
  try {
    const raw = window.localStorage.getItem(COLOR_PALETTE_KEY);
    if (!raw) return DEFAULT_PALETTE;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 7) return DEFAULT_PALETTE;
    if (!parsed.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))) {
      return DEFAULT_PALETTE;
    }
    return parsed as string[];
  } catch {
    return DEFAULT_PALETTE;
  }
}

const MENU_W = 170;
const MENU_PAD_Y = 6;
const ITEM_H = 28;
const FORMATTING_ROW_H = 34;

export interface ActionsMenuPanelProps {
  editor: Editor;
  /** Target paragraph for action dispatch. */
  paragraphUuid: string;
  /** Live selection range; used for `kind: "selection"` dispatch. */
  range: { from: number; to: number };
  /** "selection" → dispatch with `kind: "selection"` + range.
   *  "cursor" → dispatch with `kind: "paragraph"` and grey out Highlight. */
  mode: "selection" | "cursor";
  anchorLeft: number;
  anchorTop: number;
  onClose: () => void;
}

export function ActionsMenuPanel({
  editor,
  paragraphUuid,
  range,
  mode,
  anchorLeft,
  anchorTop,
  onClose,
}: ActionsMenuPanelProps) {
  const dragHandleMenu = useDragHandleMenu();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Color palette state (MRU-first, 7 slots).
  const [palette, setPalette] = useState<string[]>(() => loadPalette());
  const lastAppliedColor = palette[0] ?? DEFAULT_PALETTE[0];
  const persistPalette = (next: string[]) => {
    setPalette(next);
    try {
      window.localStorage.setItem(COLOR_PALETTE_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / private-mode errors */
    }
  };
  const bumpColorToFront = (color: string) => {
    const without = palette.filter((c) => c !== color);
    const next = palette.includes(color)
      ? [color, ...without]
      : [color, ...without.slice(0, 6)];
    persistPalette(next.slice(0, 7));
  };
  const [colorPopoverAnchor, setColorPopoverAnchor] = useState<DOMRect | null>(null);
  // Stash the selection range so the color popover can re-apply it after
  // the native color picker steals focus.
  const stashedRangeRef = useRef<{ from: number; to: number } | null>(null);

  const runAction = (action: (typeof MENU_ENTRIES)[number]["action"]) => {
    if (!dragHandleMenu) return;
    const passage =
      mode === "cursor"
        ? { kind: "paragraph" as const, paragraphId: paragraphUuid }
        : {
            kind: "selection" as const,
            paragraphId: paragraphUuid,
            from: range.from,
            to: range.to,
          };
    dragHandleMenu.dispatch(action, passage);
    onClose();
  };

  const runFormat = (
    cmd: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>,
  ) => {
    cmd(editor.chain().focus()).run();
  };

  const wrapSelectionInMath = (kind: "inline" | "display") => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ");
    const latex = text || (kind === "inline" ? "x" : "\\int f(x)\\,dx");
    const type = kind === "inline" ? "inlineMath" : "displayMath";
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent({ type, attrs: { latex } })
      .run();
  };

  const wrapSelectionInExample = () => {
    const { from, to } = editor.state.selection;
    let inlineContent: unknown[] = [];
    try {
      const slice = editor.state.doc.slice(from, to);
      inlineContent = slice.content.toJSON() as unknown[];
    } catch {
      /* fall through with empty content */
    }
    const existing = new Set<string>();
    editor.state.doc.descendants((n) => {
      if (n.type.name === "exampleBlock" && n.attrs.uuid) {
        existing.add(n.attrs.uuid as string);
      }
      return true;
    });
    const { node } = buildExampleTemplate("single", existing);
    const content = node.content as Array<{ type: string; content?: unknown[] }>;
    if (content[0] && content[0].type === "paragraph" && inlineContent.length) {
      content[0].content = inlineContent;
    }
    editor.chain().focus().deleteSelection().insertContent(node).run();
  };

  const applyColor = (color: string) => {
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.setTextColor(color).run();
    bumpColorToFront(color);
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  const clearColor = () => {
    const stashed = stashedRangeRef.current;
    const chain = editor.chain().focus();
    if (stashed) chain.setTextSelection(stashed);
    chain.unsetTextColor().run();
    setColorPopoverAnchor(null);
    stashedRangeRef.current = null;
  };

  const openColorPopover = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { from, to } = editor.state.selection;
    if (from !== to) stashedRangeRef.current = { from, to };
    setColorPopoverAnchor(e.currentTarget.getBoundingClientRect());
  };

  // Letter-key shortcuts. Escape closes the panel. Capture-phase +
  // preventDefault + stopPropagation keeps the letter from also typing
  // into the prose if focus is in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const letter = e.key.toUpperCase();
      const hit = MENU_ENTRIES.find((m) => m.letter === letter);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (hit.action === "highlight" && mode === "cursor") return;
      runAction(hit.action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // runAction reads props/refs at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Click-outside dismissal. Deferred one tick so the mousedown that
  // opened the panel (the trigger button click) doesn't immediately close
  // it. The color popover handles its own dismissal.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      const colorPopover = document.querySelector('div[aria-label="Text color"]');
      if (colorPopover?.contains(target)) return;
      onClose();
    };
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onMouseDown, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return null;

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  const menuPortal = createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Selection actions"
      className="selection-actions-menu"
      style={{
        position: "fixed",
        left: anchorLeft,
        top: anchorTop,
        width: MENU_W,
        zIndex: 2000,
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
        padding: `${MENU_PAD_Y}px 0`,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Formatting icon grid (4 cols × 4 rows) ─────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 2,
          padding: "0 4px",
        }}
      >
        <FmtBtn
          title="Bold (⌘B)"
          active={isActive("bold")}
          onClick={() => runFormat((c) => c.toggleBold())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.5h4.5c1.93 0 3 1.07 3 2.5 0 1.05-.55 1.8-1.4 2.15C11.25 7.5 12 8.4 12 9.5c0 1.6-1.2 2.75-3.25 2.75H4V2.5zm2 1.5v2.75h2.25c.97 0 1.5-.5 1.5-1.38 0-.87-.53-1.37-1.5-1.37H6zm0 4.25V10.75h2.5c1.05 0 1.6-.53 1.6-1.5 0-.93-.6-1.5-1.6-1.5H6z" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Italic (⌘I)"
          active={isActive("italic")}
          onClick={() => runFormat((c) => c.toggleItalic())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6.5 2.5h5M4.5 13.5h5M9.5 2.5L6.5 13.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Strikethrough"
          active={isActive("strike")}
          onClick={() => runFormat((c) => c.toggleStrike())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <path d="M11 4.5c-.5-1.2-1.7-2-3-2-1.8 0-3 1-3 2.4 0 1 .6 1.7 1.6 2.1M5 11.5c.5 1.2 1.7 2 3 2 1.8 0 3-1 3-2.4 0-.6-.2-1.1-.6-1.5" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Inline code"
          active={isActive("code")}
          onClick={() => runFormat((c) => c.toggleCode())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5,4 1.5,8 5,12" />
            <polyline points="11,4 14.5,8 11,12" />
          </svg>
        </FmtBtn>

        <div
          className="flex items-center justify-center"
          style={{ height: FORMATTING_ROW_H }}
        >
          <BlockTypeDropdown editor={editor} />
        </div>
        <FmtBtn
          title="Bullet list"
          active={isActive("bulletList")}
          onClick={() => runFormat((c) => c.toggleBulletList())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="3.5" cy="4" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <line x1="6.5" y1="4" x2="13" y2="4" />
            <line x1="6.5" y1="8" x2="13" y2="8" />
            <line x1="6.5" y1="12" x2="13" y2="12" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Numbered list"
          active={isActive("orderedList")}
          onClick={() => runFormat((c) => c.toggleOrderedList())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <text x="2" y="5.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">1</text>
            <text x="2" y="9.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">2</text>
            <text x="2" y="13.5" fontSize="5" fontWeight="600" fontFamily="sans-serif">3</text>
            <line x1="6.5" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="6.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="6.5" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </FmtBtn>
        <FmtBtn
          title="Blockquote"
          active={isActive("blockquote")}
          onClick={() => runFormat((c) => c.toggleBlockquote())}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" stroke="none">
            <path d="M3 3.5C3 5.5 4 7 5.5 7.5L4.5 9C3 8.5 1.5 6.8 1.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1S5.5 5.2 4.2 5.2c-.4 0-.8-.1-1.2-.3v-1.4zm7 0C10 5.5 11 7 12.5 7.5L11.5 9C10 8.5 8.5 6.8 8.5 4.2c0-2 1.2-3.2 2.8-3.2 1.3 0 2.2.9 2.2 2.1s-1 2.1-2.3 2.1c-.4 0-.8-.1-1.2-.3v-1.4z" transform="translate(0, 3)" />
          </svg>
        </FmtBtn>

        <FmtBtn
          title="Wrap selection in example block"
          onClick={() => wrapSelectionInExample()}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>ex</span>
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in inline math"
          onClick={() => wrapSelectionInMath("inline")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13 }}>
            $x$
          </span>
        </FmtBtn>
        <FmtBtn
          title="Wrap selection in display math"
          onClick={() => wrapSelectionInMath("display")}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontSize: 13, letterSpacing: -0.5 }}>
            $$
          </span>
        </FmtBtn>
        <button
          type="button"
          title="Text color"
          onClick={openColorPopover}
          className="flex flex-col items-center justify-center rounded transition-colors hover-on-light"
          style={{
            height: FORMATTING_ROW_H,
            background: "transparent",
            color: "var(--ink-strong)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          <span style={{ fontFamily: "var(--font-serif, serif)", fontWeight: 600, fontSize: 14 }}>
            A
          </span>
          <span
            aria-hidden
            style={{
              display: "block",
              width: 14,
              height: 3,
              marginTop: 1,
              background: lastAppliedColor,
              borderRadius: 1,
            }}
          />
        </button>

        <FmtBtn
          title="Insert raw LaTeX block"
          onClick={() => insertTexBlock(editor)}
        >
          <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
            \tex
          </span>
        </FmtBtn>
        <div />
        <div />
        <div />
      </div>

      <div
        aria-hidden
        style={{
          height: 1,
          margin: "6px 8px",
          background: "var(--edge-hover)",
          opacity: 0.5,
        }}
      />

      {MENU_ENTRIES.map((entry) => {
        const disabled = mode === "cursor" && entry.action === "highlight";
        return (
          <div key={entry.action}>
            {entry.separator && (
              <div
                aria-hidden
                style={{
                  height: 1,
                  margin: "4px 8px",
                  background: "var(--edge-hover)",
                  opacity: 0.5,
                }}
              />
            )}
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                runAction(entry.action);
              }}
              className={`w-full flex items-center gap-2 px-2.5 text-left ${disabled ? "" : "hover-on-light"}`}
              style={{
                height: ITEM_H,
                fontSize: 13,
                color: entry.destructive ? "var(--danger, #b45757)" : "var(--ink-strong)",
                background: "transparent",
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 16, height: 16 }}
              >
                {entry.icon}
              </span>
              <span className="flex-1">{entry.label}</span>
              <span className="tabular-nums" style={{ fontSize: 11, color: "var(--ink-subtle)" }}>
                {entry.letter}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );

  return (
    <>
      {menuPortal}
      {colorPopoverAnchor && (
        <SelectionColorPopover
          editor={editor}
          anchorRect={colorPopoverAnchor}
          palette={palette}
          onApply={applyColor}
          onClear={clearColor}
          onPickCustom={applyColor}
          onClose={() => {
            setColorPopoverAnchor(null);
            stashedRangeRef.current = null;
          }}
        />
      )}
    </>
  );
}

function FmtBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center justify-center rounded transition-colors hover-on-light"
      style={{
        height: FORMATTING_ROW_H,
        background: active ? "var(--surface-muted-strong, rgba(0,0,0,0.08))" : "transparent",
        color: active ? "var(--ink-strong)" : "var(--ink-muted)",
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
