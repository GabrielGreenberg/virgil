"use client";

/**
 * RichTextField — a small Tiptap-powered editor used for footnote and note
 * bodies in the side panels. It speaks the same JSONContent dialect as the
 * main editor (citations, inline math, marks, lists), so dropped citation
 * commands become real Citation nodes and content survives a round trip
 * through the LaTeX serializer cleanly.
 *
 * Storage: the parent owns a JSONContent value and is notified via onChange.
 * The component is uncontrolled internally — we only re-sync from props when
 * the editor isn't focused, so debounced parent updates don't clobber the
 * caret while the user is typing.
 */

import { useEffect, useRef, useState, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  InlineMath,
  Citation,
  LatexCommandMark,
  TabIndent,
  DisplayMath,
  TexBlock,
  FigureBlock,
  GraphicsBlock,
  LatexComment,
} from "@/lib/tiptap-extensions";
import { normalizeRichContent } from "@/lib/footnote-content";
import { generateShortId } from "@/lib/uuid";
import { MIME_CITATION, MIME_NOTE, MIME_FOOTNOTE, MIME_ARCHIVE } from "@/lib/marginalia";
import type { PanelBodyKey } from "@/lib/panel-typography";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { registerDropTarget } from "@/components/drop-mode/target-registry";

interface RichTextFieldProps {
  /** Initial content. The editor remounts when `instanceKey` changes. */
  value: unknown;
  /** Stable identifier — change it to force a remount with new content. */
  instanceKey: string;
  onChange: (json: JSONContent) => void;
  /** Notified when the editor takes/loses focus (parent uses this to lock drag).
   *  When the editor gains focus the Tiptap instance is passed so parents can
   *  route toolbar commands to it. */
  onFocusChange?: (focused: boolean, editor?: ReturnType<typeof import("@tiptap/react").useEditor> | null) => void;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Visual variant — affects font + color. */
  variant?: "footnote" | "note";
  /** Whether the parent card is currently selected (controls toolbar styling). */
  selected?: boolean;
  /** Greyed-out display for orphaned items. */
  muted?: boolean;
  /** Called when an archive snippet is dropped — parent removes it from archive. */
  onArchiveConsumed?: (archiveId: string) => void;
  /**
   * Resolves a raw `\cite{...}` command into a human-readable display string
   * (e.g. "Abusch 2014"). Used both when rendering already-stored citation
   * nodes and when handling drop events. If omitted, the raw command is
   * shown — fine as a fallback but not what the user expects in prose.
   */
  getCitationDisplayText?: (command: string) => string;
  /** Called when the user creates a brand-new citation in this field via drop. */
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;
  /** When set, the format toolbar is portalled into this DOM element instead of
   *  rendering inline above the editor content. */
  toolbarPortalTarget?: HTMLElement | null;
  /** When true, suppress the FormatToolbar entirely (keyboard shortcuts still work). */
  hideToolbar?: boolean;
  /** Panel kind — when set, body text picks up the user's per-panel
   *  typography overrides (font family, size, color) from
   *  `panel-typography.ts`. Omit when the field isn't inside a themed panel. */
  panelKey?: PanelBodyKey;
  /** When false, the inner TipTap mounts read-only and ignores
   *  drop / paste / keyboard input. Used by the chrome-driven
   *  read-only-card mode (`chrome.editableCardKinds`) to suppress
   *  in-card editing for kinds that aren't in the whitelist. Default
   *  true. */
  editable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format toolbar (commands operate on the wrapped Tiptap editor)
// ─────────────────────────────────────────────────────────────────────────────

function FormatToolbar({
  editor,
  selected,
  inline,
}: {
  editor: ReturnType<typeof useEditor> | null;
  selected: boolean;
  inline?: boolean;
}) {
  if (!editor) return null;

  const btnClass = selected
    ? "w-6 h-6 flex items-center justify-center rounded text-xs text-white/80 hover-on-dark"
    : "w-6 h-6 flex items-center justify-center rounded text-xs text-ink-body hover-on-light";
  const dividerClass = selected
    ? "w-px h-4 bg-surface/20 mx-0.5"
    : "w-px h-4 bg-[var(--border-light)] mx-0.5";

  return (
    <div
      className={inline
        ? "flex items-center gap-0.5"
        : `flex items-center gap-0.5 px-1 py-0.5 mb-1 border-b ${
            selected ? "border-white/20" : "border-[var(--border-light)]"
          }`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
        className={`${btnClass} font-bold`}
        title="Bold"
      >B</button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={`${btnClass} italic`}
        title="Italic"
      >I</button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
        className={`${btnClass} underline`}
        title="Underline"
      >U</button>
      <div className={dividerClass} />
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
        className={btnClass}
        title="Bullet list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2" cy="4" r="1.5" />
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="8" r="1.5" />
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <circle cx="2" cy="12" r="1.5" />
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
        className={btnClass}
        title="Numbered list"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <text x="0" y="5.5" fontSize="5" fontWeight="600">1</text>
          <rect x="5" y="3" width="10" height="2" rx="0.5" />
          <text x="0" y="9.5" fontSize="5" fontWeight="600">2</text>
          <rect x="5" y="7" width="10" height="2" rx="0.5" />
          <text x="0" y="13.5" fontSize="5" fontWeight="600">3</text>
          <rect x="5" y="11" width="10" height="2" rx="0.5" />
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RichTextField
// ─────────────────────────────────────────────────────────────────────────────

function RichTextFieldImpl({
  value,
  instanceKey,
  onChange,
  onFocusChange,
  placeholder = "",
  variant = "footnote",
  selected = false,
  muted = false,
  onArchiveConsumed,
  getCitationDisplayText,
  onCitationCreated,
  toolbarPortalTarget,
  hideToolbar = false,
  panelKey,
  editable = true,
}: RichTextFieldProps) {
  const bodyStyle = usePanelBodyStyle(panelKey);
  const onChangeRef = useRef(onChange);
  const onFocusChangeRef = useRef(onFocusChange);
  const onArchiveConsumedRef = useRef(onArchiveConsumed);
  const getCitationDisplayTextRef = useRef(getCitationDisplayText);
  const onCitationCreatedRef = useRef(onCitationCreated);
  // Refs update in an effect so we don't write to refs during render
  // (the lint config flags that — refs are for stable identities, not state).
  useEffect(() => {
    onChangeRef.current = onChange;
    onFocusChangeRef.current = onFocusChange;
    onArchiveConsumedRef.current = onArchiveConsumed;
    getCitationDisplayTextRef.current = getCitationDisplayText;
    onCitationCreatedRef.current = onCitationCreated;
  });

  /**
   * Walk a JSONContent tree and rewrite citation nodes so their `displayText`
   * matches the current bibliography lookup. We do this both before mounting
   * the editor and again on every value sync — that way nodes loaded from
   * persisted JSON (which often saved displayText="") render with the
   * formatted name instead of the raw \cite command.
   */
  const refreshCitationDisplay = useCallback((doc: JSONContent): JSONContent => {
    const lookup = getCitationDisplayTextRef.current;
    if (!lookup) return doc;
    const resolve = lookup;
    function walk(node: JSONContent): JSONContent {
      if (node.type === "citation" && node.attrs) {
        const command = (node.attrs.command as string) || "";
        const desired = resolve(command) || command;
        if (node.attrs.displayText !== desired) {
          return { ...node, attrs: { ...node.attrs, displayText: desired } };
        }
        return node;
      }
      if (node.content) {
        return { ...node, content: node.content.map(walk) };
      }
      return node;
    }
    return walk(doc);
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isFocusedRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const initialContent = refreshCitationDisplay(normalizeRichContent(value));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable heading/blockquote/codeBlock — they make no sense in a
        // footnote / note body and would balloon the surface.
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        // StarterKit v3 already ships underline; we just want it on.
      }),
      InlineMath,
      Citation,
      LatexCommandMark,
      Placeholder.configure({ placeholder }),
      TabIndent,
      // Block-atom extensions in card-context mode. These mirror the
      // main editor's schema so JSONContent with block atoms (texBlock,
      // figureBlock, graphicsBlock, latexComment, displayMath) round-
      // trips into and out of cards without being silently stripped on
      // load. Each NodeView reads the `cardContext` flag and renders a
      // compact static preview instead of the full main-editor chrome.
      // If a new block-atom type is added to the main editor, also
      // register it here (or the same bug class will re-appear).
      TexBlock.configure({ cardContext: true }),
      FigureBlock.configure({ cardContext: true }),
      GraphicsBlock.configure({ cardContext: true }),
      LatexComment.configure({ cardContext: true }),
      DisplayMath,
    ],
    content: initialContent,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `rtf-content rtf-content-${variant} focus:outline-none ${
          selected ? "rtf-selected" : ""
        } ${muted ? "rtf-muted" : ""}`.trim(),
      },
      // (beforeinput interception is done in a capture-phase listener below,
      // attached directly to view.dom in a useEffect — bubble-phase via
      // handleDOMEvents fires too late to reliably suppress the browser's
      // native split behavior on empty paragraphs.)
      handleDrop(view, event) {
        // Citation drop — insert as a Citation node directly so the styling
        // and click handlers work the same as in the main editor. We always
        // resolve display text via the parent-supplied lookup, otherwise we
        // fall back to the raw \cite{} command.
        const citData = event.dataTransfer?.getData(MIME_CITATION);
        if (citData) {
          event.preventDefault();
          try {
            const { command, citationId } = JSON.parse(citData);
            const coords = { left: event.clientX, top: event.clientY };
            const pos = view.posAtCoords(coords);
            if (!pos) return true;

            // If the dropped citation didn't carry an existing id, this is a
            // brand-new reference — register it with the parent's citations
            // store so it shows up in the side panel and gets a stable id.
            let resolvedId = citationId;
            let displayText = getCitationDisplayTextRef.current?.(command) || command;
            if (!resolvedId && onCitationCreatedRef.current) {
              const created = onCitationCreatedRef.current(command);
              if (created) {
                resolvedId = created.id;
                if (created.displayText) displayText = created.displayText;
              }
            }
            if (!resolvedId) {
              const existing = new Set<string>();
              view.state.doc.descendants((n) => {
                if (n.type.name === "citation" && n.attrs.citationId) {
                  existing.add(n.attrs.citationId as string);
                }
                return true;
              });
              resolvedId = generateShortId(existing);
            }

            const node = view.state.schema.nodes.citation.create({
              citationId: resolvedId,
              command,
              displayText,
            });
            const tr = view.state.tr.insert(pos.pos, node);
            view.dispatch(tr);
          } catch { /* ignore bad data */ }
          return true;
        }

        // Note drop — splice the note's body inline at the drop point.
        const noteData = event.dataTransfer?.getData(MIME_NOTE);
        if (noteData) {
          event.preventDefault();
          try {
            const { content } = JSON.parse(noteData);
            if (!content) return true;
            const coords = { left: event.clientX, top: event.clientY };
            const posResult = view.posAtCoords(coords);
            if (!posResult) return true;
            const inlineJson: JSONContent[] = [];
            const walk = (n: JSONContent | undefined) => {
              if (!n) return;
              if (n.type === "paragraph") {
                if (inlineJson.length > 0) inlineJson.push({ type: "text", text: " " });
                (n.content || []).forEach((c) => inlineJson.push(c));
                return;
              }
              if (n.content) n.content.forEach(walk);
            };
            walk(content);
            if (inlineJson.length === 0) return true;
            const pmNodes = inlineJson
              .map((j) => {
                try { return PMNode.fromJSON(view.state.schema, j); }
                catch { return null; }
              })
              .filter(Boolean) as PMNode[];
            if (pmNodes.length > 0) {
              const tr = view.state.tr.insert(posResult.pos, pmNodes);
              view.dispatch(tr);
            }
          } catch { /* ignore bad data */ }
          return true;
        }

        // Footnote-into-footnote: refuse to avoid creating recursive nodes.
        if (event.dataTransfer?.types.includes(MIME_FOOTNOTE)) {
          event.preventDefault();
          return true;
        }

        // Archive snippet drop — insert as plain text and notify parent so
        // the archive panel removes the consumed snippet.
        const archiveId = event.dataTransfer?.getData(MIME_ARCHIVE);
        const text = event.dataTransfer?.getData("text/plain");
        if (archiveId && text) {
          event.preventDefault();
          const coords = { left: event.clientX, top: event.clientY };
          const pos = view.posAtCoords(coords);
          if (!pos) return true;
          const tr = view.state.tr.insertText(text, pos.pos);
          view.dispatch(tr);
          onArchiveConsumedRef.current?.(archiveId);
          return true;
        }

        // Plain text fallback — let Tiptap handle it.
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      // Debounce so we don't thrash the parent (and the persist call chain)
      // on every keystroke.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChangeRef.current(editor.getJSON());
      }, 250);
    },
    onFocus: ({ editor: ed }) => {
      isFocusedRef.current = true;
      onFocusChangeRef.current?.(true, ed);
    },
    onBlur: ({ editor }) => {
      isFocusedRef.current = false;
      // Flush any pending debounced update so the parent sees the final value
      // before we report the blur (which often triggers cleanup logic).
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = undefined;
        onChangeRef.current(editor.getJSON());
      }
      onFocusChangeRef.current?.(false, null);
    },
  // Re-create the editor when instanceKey changes (footnote/note ID changed
  // out from under us). This is the simplest way to keep state coherent
  // when the parent recycles a single component for many items.
  }, [instanceKey]);

  // External value sync — only when the editor isn't focused (otherwise we'd
  // wipe the caret on every debounced parent update). We also refresh
  // citation displayText here so that bibliography edits picked up by the
  // parent propagate into the mini editor.
  useEffect(() => {
    if (!editor) return;
    if (isFocusedRef.current) return;
    const desired = refreshCitationDisplay(normalizeRichContent(value));
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(desired)) {
      editor.commands.setContent(desired, { emitUpdate: false });
    }
  }, [editor, value, refreshCitationDisplay]);

  // Intercept beforeinput in the CAPTURE phase, before the browser commits
  // its native input handling and before PM's own bubble-phase handler
  // runs. Why: PM's default beforeinput handler is a no-op for insertText
  // (see prosemirror-view's `handlers.beforeinput`), so it lets the browser
  // mutate the DOM and reconciles via DOMObserver. When the user types
  // into an empty paragraph rendered as `<p class="is-empty"><br
  // class="ProseMirror-trailingBreak"></p>` (Placeholder + PM trailing
  // break), Chrome's native input splits the <p> into `<p>a</p><p><br></p>`
  // — and PM faithfully reconstructs that as a multi-paragraph slice,
  // i.e. one keystroke = one new paragraph.
  //
  // We sidestep the whole mess by intercepting the event at the earliest
  // possible point: dispatch our own `insertText` transaction (clean
  // text-only step, no split) and call preventDefault so the browser
  // never gets to do its split. Composition / multi-line inserts /
  // non-text inputs fall through to PM's default path.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== "insertText") return;
      if (e.isComposing) return;
      const data = e.data;
      if (data == null || data.length === 0) return;
      if (/[\r\n]/.test(data)) return;
      e.preventDefault();
      const { from, to } = editor.view.state.selection;
      editor.view.dispatch(
        editor.view.state.tr.insertText(data, from, to).scrollIntoView()
      );
    };
    dom.addEventListener("beforeinput", onBeforeInput, true);
    return () => {
      dom.removeEventListener("beforeinput", onBeforeInput, true);
    };
  }, [editor]);

  // Keep TipTap's `editable` flag in sync with the `editable` prop. The
  // initial value is set inside `useEditor`; this effect handles
  // changes (chrome flip, etc.). Mirrors the pattern in `Editor.tsx`.
  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // Register this nested editor with the drop-mode target registry, so
  // shift-drag can target card bodies in addition to the main editor.
  useEffect(() => {
    if (!editor) return;
    return registerDropTarget(editor);
  }, [editor]);

  // Sync per-panel body style (only overridden fields) onto the ProseMirror
  // DOM. Leaving a field unset lets the class-based defaults in globals.css
  // take over — so enabling `panelKey` by itself doesn't change anything
  // visually until the user actually overrides a field.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    if (panelKey) dom.setAttribute("data-panel-kind", panelKey);
    else dom.removeAttribute("data-panel-kind");
    if (bodyStyle.fontFamily) dom.style.fontFamily = String(bodyStyle.fontFamily);
    else dom.style.removeProperty("font-family");
    // Setting --editor-font-size (rather than just `font-size`) is required
    // because `.tiptap p` in globals.css resolves its own font-size from the
    // var, which would otherwise mask any inherited value coming from the
    // editor's inline style.
    if (bodyStyle.fontSize) {
      dom.style.fontSize = String(bodyStyle.fontSize);
      dom.style.setProperty("--editor-font-size", String(bodyStyle.fontSize));
    } else {
      dom.style.removeProperty("font-size");
      dom.style.removeProperty("--editor-font-size");
    }
    if (bodyStyle.color) dom.style.color = String(bodyStyle.color);
    else dom.style.removeProperty("color");
  }, [editor, panelKey, bodyStyle]);

  // Drop visual cue (handled at the wrapper, ProseMirror handles the actual drop)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MIME_FOOTNOTE)) return;
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MIME_ARCHIVE)
      ? "move"
      : "copy";
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={isDragOver ? "rtf-drop-target rounded" : undefined}
      // Prevent the parent card's draggable= true from picking up internal
      // text selection. The mini editor manages its own drag handling.
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      {!hideToolbar && (toolbarPortalTarget
        ? createPortal(<FormatToolbar editor={editor} selected={selected} inline />, toolbarPortalTarget)
        : <FormatToolbar editor={editor} selected={selected} />)}
      <EditorContent
        editor={editor}
        // Stop card-level click + key handlers from intercepting editor input.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

const RichTextField = memo(RichTextFieldImpl);
export default RichTextField;
