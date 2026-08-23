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
import { useEditor, useEditorState, EditorContent, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  TabIndent,
  starterKitConfigForScope,
  buildCardBodySchema,
  type CardBodySchemaScope,
} from "@/lib/tiptap-extensions";
import { normalizeRichContent } from "@/lib/footnote-content";
import { registerEditorMount } from "@/lib/editor-census-probe";
import { generateShortId } from "@/lib/uuid";
import { MIME_CITATION, MIME_FOOTNOTE, MIME_ARCHIVE } from "@/lib/marginalia";
import type { PanelBodyKey } from "@/lib/panel-typography";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { registerDropTarget } from "@/components/drop-mode/target-registry";
import { useCitationDisplayContextOrNull } from "@/components/editor-layout/contexts/citation-display";
import { iconHint } from "@/components/Hint";
import { posHostsInlineAtom } from "@/text-objects/text-object-registry";
import { wrapperSafeInState } from "@/lib/tiptap/wrapper-gate";

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
  /** Which body vocabulary to mount (task 308). Defaults to `"card"` — the
   *  narrow authored-prose surface (no heading / blockquote / codeBlock /
   *  horizontalRule / expex / highlight / textColor). `"excerpt"` mounts the
   *  full main-document vocabulary, for a body holding a verbatim document
   *  slice. `EditableCard` derives it from the card kind and passes the SAME
   *  value here and to the compressed `BorrowedMainText`. */
  schemaScope?: CardBodySchemaScope;
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
  // Task 427: the two list buttons are the card-body twin of the lightning
  // grid's wrapper cells, so they read the SAME wrapper door (identity +
  // container) for their `disabled` AND guard the click — a card body mounts the
  // block atoms and `codeBlock`, so a non-listable block is reachable here. The
  // selector is O(depth) per transaction (one `blockRange` + one
  // `findWrapping`) and packs two booleans into one primitive so React bails
  // the re-render on every keystroke that leaves the verdict unchanged.
  const wrapperBits = useEditorState({
    editor,
    selector: ({ editor: ed }) =>
      ed
        ? (wrapperSafeInState(ed.state, "bulletList") ? 1 : 0) |
          (wrapperSafeInState(ed.state, "orderedList") ? 2 : 0)
        : 3,
  });
  if (!editor) return null;
  const bulletOk = ((wrapperBits ?? 3) & 1) !== 0;
  const orderedOk = ((wrapperBits ?? 3) & 2) !== 0;
  const runWrapper = (name: "bulletList" | "orderedList") => {
    if (!wrapperSafeInState(editor.state, name)) return;
    const chain = editor.chain().focus();
    (name === "bulletList" ? chain.toggleBulletList() : chain.toggleOrderedList()).run();
  };

  const btnClass = selected
    ? "w-6 h-6 flex items-center justify-center rounded text-xs text-white/80 hover-on-dark focus-ring disabled:opacity-40 disabled:cursor-default"
    : "w-6 h-6 flex items-center justify-center rounded text-xs text-ink-body hover-on-light focus-ring disabled:opacity-40 disabled:cursor-default";
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
        data-hint="Bold"
      >B</button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
        className={`${btnClass} italic`}
        data-hint="Italic"
      >I</button>
      <button
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }}
        className={`${btnClass} underline`}
        data-hint="Underline"
      >U</button>
      <div className={dividerClass} />
      <button
        onMouseDown={(e) => { e.preventDefault(); runWrapper("bulletList"); }}
        className={btnClass}
        disabled={!bulletOk}
        {...iconHint({ label: "Bullet list" })}
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
        onMouseDown={(e) => { e.preventDefault(); runWrapper("orderedList"); }}
        className={btnClass}
        disabled={!orderedOk}
        data-hint="Numbered list" aria-label="Numbered list"
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
  schemaScope = "card",
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
  // labelRef display resolver — the sibling of `getCitationDisplayText`, taken
  // from the same CitationDisplayContext that already feeds these mini-editors.
  // It resolves a `\ref`'s number against the MAIN doc (a footnote/note body
  // owns no headings/examples/figures, and the doc-level ref-display pass can't
  // recurse into a footnote's opaque sub-doc), so a freshly-RELOADED nested ref
  // shows its number instead of "??". Null outside a provider (tests / reader
  // floats with no host) — then we leave the persisted displayText untouched.
  const citationDisplayCtx = useCitationDisplayContextOrNull();
  const getRefDisplayText = citationDisplayCtx?.getRefDisplayText;
  const onChangeRef = useRef(onChange);
  const onFocusChangeRef = useRef(onFocusChange);
  const onArchiveConsumedRef = useRef(onArchiveConsumed);
  const getCitationDisplayTextRef = useRef(getCitationDisplayText);
  const onCitationCreatedRef = useRef(onCitationCreated);
  const getRefDisplayTextRef = useRef(getRefDisplayText);
  // Refs update in an effect so we don't write to refs during render
  // (the lint config flags that — refs are for stable identities, not state).
  useEffect(() => {
    onChangeRef.current = onChange;
    onFocusChangeRef.current = onFocusChange;
    onArchiveConsumedRef.current = onArchiveConsumed;
    getCitationDisplayTextRef.current = getCitationDisplayText;
    onCitationCreatedRef.current = onCitationCreated;
    getRefDisplayTextRef.current = getRefDisplayText;
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

  /**
   * The labelRef sibling of `refreshCitationDisplay`. A footnote/note-nested
   * `\ref` gets its `displayText` resolved at INSERT time (handleInsertRef reads
   * MAIN — correct in-session), but on RELOAD `richLatexToJson` re-parses it
   * with `displayText: ""`, and the doc-level ref-display pass can't reach a
   * footnote's opaque sub-doc — so the NodeView would show `displayText || "??"`
   * = "??". Resolve each labelRef's number against MAIN here (via the context
   * resolver) so the reloaded ref shows its number, mirroring the citation path.
   * When the resolver yields "??"/empty we KEEP the persisted displayText (e.g.
   * a transient unresolved label) rather than overwriting a good value with "??".
   */
  const refreshRefDisplay = useCallback((doc: JSONContent): JSONContent => {
    const resolve = getRefDisplayTextRef.current;
    if (!resolve) return doc;
    function walk(node: JSONContent): JSONContent {
      if (node.type === "labelRef" && node.attrs) {
        const label = (node.attrs.label as string) || "";
        const refCommand = (node.attrs.refCommand as string) || "ref";
        const resolved = resolve!(label, refCommand);
        // Only adopt a real resolution; "??"/"" means MAIN couldn't place the
        // label — don't clobber whatever displayText we already had.
        if (resolved && resolved !== "??" && node.attrs.displayText !== resolved) {
          return { ...node, attrs: { ...node.attrs, displayText: resolved } };
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

  // Compose both atom-display refreshes (citation + labelRef) into one pass —
  // applied identically before mount and on each external value sync.
  const refreshAtomDisplay = useCallback(
    (doc: JSONContent): JSONContent => refreshRefDisplay(refreshCitationDisplay(doc)),
    [refreshCitationDisplay, refreshRefDisplay],
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isFocusedRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const initialContent = refreshAtomDisplay(normalizeRichContent(value));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Scope-resolved card-body StarterKit config. At `"card"` scope
        // heading/blockquote/codeBlock/horizontalRule are disabled — they make
        // no sense in a footnote / note body and would balloon the surface. At
        // `"excerpt"` scope they stay ON, because that body holds a verbatim
        // slice of the document and must be able to represent whatever the user
        // excised (task 308). SSOT in borrowed-schema.ts so RichTextField +
        // BorrowedMainText can't drift on it.
        ...starterKitConfigForScope(schemaScope),
        // StarterKit v3 already ships underline; we just want it on.
      }),
      Placeholder.configure({ placeholder }),
      TabIndent,
      // Shared card-context inline-atom + block-atom-preview sub-schema
      // (borrowed-schema.ts — backlog #11). The block atoms render compact
      // cardContext previews; the inline atoms (math, citation, labelRef,
      // latexCommand, displayMath) round-trip without being stripped. Adding a
      // new atom kind there surfaces it here automatically (the contract test
      // gates the main editor too).
      //
      // CHIP 5: `includeLabelRef` adds the `\ref` (LabelRef) node so a
      // cross-reference CREATED while editing inside a footnote (the lightning
      // 'Cross-ref' cell routes the create to THIS focused editor — see the
      // owning-editor threading in atom-create) has a schema node to insert
      // into and survives the JSON↔LaTeX round-trip. The nested-`footnote`
      // marker stays omitted — footnotes can't nest.
      //
      // At `"excerpt"` scope this ALSO forces the nested `footnote` marker in
      // (and the rest of the document block vocabulary). That asymmetry was a
      // live bug: `BorrowedMainText` registered `footnote` and RichTextField did
      // not, so an archived paragraph carrying a `\footnote` marker rendered
      // fine collapsed and went BLANK on expand (task 308).
      ...buildCardBodySchema(schemaScope, { includeLabelRef: true }),
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
            const citType = view.state.schema.nodes.citation;
            // CONTAINER GATE (task 396) — the card-body twin of `Editor.tsx`'s
            // citation drop, and like it the gate runs BEFORE the mint below
            // (`onCitationCreated` → `addCitation`, which persists a card).
            // `latexComment` is registered in EVERY card-body scope and
            // `codeBlock` rides `EXCERPT_STARTER_KIT_CONFIG`, so both
            // `content: "text*"` blocks genuinely exist here: a bare
            // `posAtCoords` drop truncates one and ejects its tail as live prose.
            if (!posHostsInlineAtom(view.state.doc, pos.pos, citType)) return true;

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

            const node = citType.create({
              citationId: resolvedId,
              command,
              displayText,
            });
            const tr = view.state.tr.insert(pos.pos, node);
            view.dispatch(tr);
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
  // when the parent recycles a single component for many items. `schemaScope`
  // joins it because it selects the SCHEMA, which the extension array reads once
  // at construction — a scope change without a remount would silently leave the
  // body on the old vocabulary.
  }, [instanceKey, schemaScope]);

  // Editor-census probe (__editorCensus): one live-instance tick per mount.
  useEffect(() => registerEditorMount("rich-text-field"), []);

  // External value sync — only when the editor isn't focused (otherwise we'd
  // wipe the caret on every debounced parent update). We also refresh
  // citation + ref displayText here so that bibliography edits / newly-numbered
  // sections picked up by the parent propagate into the mini editor.
  useEffect(() => {
    if (!editor) return;
    if (isFocusedRef.current) return;
    const desired = refreshAtomDisplay(normalizeRichContent(value));
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(desired)) {
      editor.commands.setContent(desired, { emitUpdate: false });
    }
  }, [editor, value, refreshAtomDisplay]);

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
  // drop-mode can target card bodies in addition to the main editor.
  useEffect(() => {
    if (!editor) return;
    return registerDropTarget(editor);
  }, [editor]);

  // Sync the per-panel body style onto the ProseMirror DOM. NOTE:
  // `usePanelBodyStyle` returns the FULL effective typography (registry
  // default ⊕ user override), so with `panelKey` set the inline write always
  // applies — it shadows the `.rtf-content-{variant}` class for family/size/
  // color. The class still carries non-typography styling and the no-panelKey
  // fallback.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    if (panelKey) dom.setAttribute("data-panel-kind", panelKey);
    else dom.removeAttribute("data-panel-kind");
    // We mutate the live ProseMirror DOM node's inline style, not the `editor`
    // hook value — React Compiler's `react-hooks/immutability` rule can't tell
    // the two apart and flags `editor cannot be modified`. See BorrowedMainText.tsx,
    // which documents and suppresses this same error on its identical panel-typography effect.
    /* eslint-disable react-hooks/immutability */
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
    /* eslint-enable react-hooks/immutability */
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
