"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { search, highlightSelectionMatches } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { readTex } from "@/lib/storage";
import { getRanges } from "@/lib/code-position-map";
import {
  extractPreambleAndPostamble,
} from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import {
  createCodePaneBridge,
  type CodePaneBridge,
} from "@/lib/code-pane-bridge";
import { codeBandField } from "@/lib/code-band";
import CodeEditorLogDrawer from "./CodeEditorLogDrawer";

const virgilTheme = EditorView.theme({
  "&": {
    fontSize: "13.5px",
    fontFamily: "var(--font-mono), 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "var(--background)",
  },
  ".cm-content": {
    padding: "16px 0",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0 24px",
  },
  ".cm-gutters": {
    backgroundColor: "#f5f3f0",
    color: "var(--muted-light)",
    border: "none",
    borderRight: "1px solid var(--border)",
    fontFamily: "var(--font-mono), 'SF Mono', monospace",
    fontSize: "12px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#eae7e3",
    color: "var(--muted)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(124, 94, 60, 0.04)",
  },
  ".cm-virgil-band": {
    backgroundColor: "rgba(220, 38, 38, 0.09)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.15) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(124, 94, 60, 0.2)",
    outline: "1px solid rgba(124, 94, 60, 0.4)",
  },
});

export interface CodeEditorHandle {
  getCurrentLine(): number;
  getTextAroundCursor(): string;
  getActiveParagraphId(): string | null;
  scrollToParagraphId(uuid: string): void;
  scrollToLine(line: number, column?: number): void;
  /** Manual align: move the CODE pane to match the TEXT cursor. */
  moveCodeToTextCursor(): void;
  /** Manual align: move the TEXT pane to match the CODE cursor. */
  moveTextToCodeCursor(): void;
}

interface CodeEditorProps {
  docId: string;
  /**
   * The live TipTap editor instance. Required: in the split-pane code
   * view, TipTap is the canonical in-memory source and the bridge
   * keeps CodeMirror reflected against it. There is no longer a
   * "code-only" mode that writes `.tex` directly.
   */
  editor: TipTapEditor;
  initialLine?: number;
  initialParagraphId?: string | null;
  onReady?: (handle: CodeEditorHandle) => void;
  /** Emit the current LaTeX text whenever it changes (and once on load).
   *  Wire this to `useLatexLint`. */
  onTextChange?: (text: string) => void;
  /** Compile log + status to render in the bottom drawer. */
  compileLog?: string | null;
  compileStatus?: number | null;
  isCompiling?: boolean;
}

export default function CodeEditor({
  docId,
  editor,
  initialLine,
  initialParagraphId,
  onReady,
  onTextChange,
  compileLog = null,
  compileStatus = null,
  isCompiling = false,
}: CodeEditorProps) {
  const [value, setValue] = useState<string | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const bridgeRef = useRef<CodePaneBridge | null>(null);
  const preambleRef = useRef<string | undefined>(undefined);
  const postambleRef = useRef<string | undefined>(undefined);
  const scrolledRef = useRef(false);
  const [parseError, setParseError] = useState<string | null>(null);
  // Flipped to true by `onCreateEditor` once CodeMirror hands us its
  // view. Gates the bridge-construction effect so we don't try to
  // attach to a not-yet-existent view (React effect-vs-CM-effect
  // ordering is undefined).
  const [viewReady, setViewReady] = useState(false);

  // On mount, read `.tex` from disk to grab the user's preamble +
  // postamble (so we can show the full source, including preamble).
  // The initial *body* comes from the live TipTap state, not disk —
  // that way unsaved edits sitting in the autosave debounce are
  // visible in code view immediately.
  useEffect(() => {
    let cancelled = false;
    readTex(docId)
      .then((diskText) => {
        if (cancelled) return;
        const extracted = extractPreambleAndPostamble(diskText);
        preambleRef.current = extracted?.preamble;
        postambleRef.current = extracted?.postamble;
        const initial = serializeToLatex(editor.getJSON(), {
          preamble: preambleRef.current,
          postamble: postambleRef.current,
        });
        setValue(initial);
        onTextChange?.(initial);
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to a serialize with default preamble.
        const fallback = serializeToLatex(editor.getJSON());
        setValue(fallback);
        onTextChange?.(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [docId, editor, onTextChange]);

  // Scroll to initial position once editor + content are ready
  // Prefer paragraph UUID; fall back to line number
  useEffect(() => {
    if (scrolledRef.current || value === null) return;
    if (!initialParagraphId && !initialLine) return;

    const tryScroll = () => {
      const view = editorViewRef.current;
      if (!view) return false;
      try {
        let targetLine: number | undefined;

        // Prefer paragraph UUID
        if (initialParagraphId) {
          const paras = getRanges(view);
          const found = paras.find((p) => p.uuid === initialParagraphId);
          if (found) targetLine = found.startLine;
        }

        // Fall back to line number
        if (!targetLine && initialLine) targetLine = initialLine;
        if (!targetLine) return false;

        const line = Math.min(targetLine, view.state.doc.lines);
        const pos = view.state.doc.line(Math.max(1, line)).from;
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 80 }),
          selection: { anchor: pos },
        });
        scrolledRef.current = true;
        return true;
      } catch {
        return false;
      }
    };

    // Try immediately, then retry a few times if view isn't ready
    if (!tryScroll()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryScroll() || attempts > 10) clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [value, initialLine, initialParagraphId]);

  // CodeMirror updateListener — relays user-driven updates to the
  // bridge (which short-circuits on its own sync-annotation
  // dispatches) and forwards the live text to the lint integration on
  // doc changes. The extension is created once and reads the bridge
  // via ref so we don't re-mount the editor on bridge swaps. The
  // bridge handles both doc-change and selection-only updates.
  const updateListener = useMemo(
    () =>
      EditorView.updateListener.of((u) => {
        bridgeRef.current?.onCodeMirrorUpdate(u);
        if (u.docChanged) onTextChange?.(u.state.doc.toString());
      }),
    [onTextChange],
  );

  // Construct the bridge when the CM view and TipTap editor are both
  // ready (and tear it down on unmount or editor swap). The bridge
  // owns its own TipTap-side listener; we install the CM-side listener
  // via the extensions array above.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !viewReady) return;
    const bridge = createCodePaneBridge({
      editor,
      view,
      initialPreamble: preambleRef.current,
      initialPostamble: postambleRef.current,
      onParseError: (err) => setParseError(err ? err.message : null),
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [docId, editor, viewReady]);

  if (value === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {parseError && (
        <div
          className="absolute top-2 left-4 right-4 z-10 text-[11px] px-3 py-1.5 rounded border"
          style={{
            background: "rgba(217, 119, 6, 0.08)",
            borderColor: "rgba(217, 119, 6, 0.3)",
            color: "var(--ink-body, #4a3a1f)",
          }}
          data-hint={parseError}
        >
          Edits paused — LaTeX parse error. Fix the source to resume sync.
        </div>
      )}
      <CodeMirror
        value={value}
        extensions={[
          latex(),
          search(),
          highlightSelectionMatches(),
          virgilTheme,
          codeBandField,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          updateListener,
        ]}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          foldGutter: true,
          indentOnInput: true,
          closeBrackets: true,
          autocompletion: false,
        }}
        height="100%"
        style={{ flex: 1, overflow: "hidden" }}
        onCreateEditor={(view) => {
          editorViewRef.current = view;
          setViewReady(true);
          onReady?.({
            getCurrentLine() {
              const v = editorViewRef.current;
              if (!v) return 1;
              // Use the top visible line, not cursor — more reliable
              const topPos = v.lineBlockAtHeight(v.scrollDOM.scrollTop).from;
              return v.state.doc.lineAt(topPos).number;
            },
            getTextAroundCursor() {
              const v = editorViewRef.current;
              if (!v) return "";
              // Get non-comment content lines from the visible area
              const topPos = v.lineBlockAtHeight(v.scrollDOM.scrollTop).from;
              const lineNum = v.state.doc.lineAt(topPos).number;
              // Scan up to 30 lines looking for real content (not comments)
              const endLine = Math.min(v.state.doc.lines, lineNum + 30);
              const contentLines: string[] = [];
              for (let i = lineNum; i <= endLine && contentLines.length < 5; i++) {
                const text = v.state.doc.line(i).text.trim();
                // Skip empty lines, comments, and pure command lines
                if (!text || text.startsWith("%")) continue;
                contentLines.push(text);
              }
              return contentLines.join("\n");
            },
            getActiveParagraphId() {
              const v = editorViewRef.current;
              if (!v) return null;
              const paras = getRanges(v);
              if (paras.length === 0) return null;

              // Cursor line (1-based)
              const cursorLine = v.state.doc.lineAt(v.state.selection.main.head).number;
              // Top visible line
              const topPos = v.lineBlockAtHeight(v.scrollDOM.scrollTop).from;
              const topLine = v.state.doc.lineAt(topPos).number;
              const bottomPos = v.lineBlockAtHeight(v.scrollDOM.scrollTop + v.scrollDOM.clientHeight).from;
              const bottomLine = v.state.doc.lineAt(bottomPos).number;

              // Rule 1: Find paragraph containing cursor
              let cursorPara = paras.find((p) => cursorLine >= p.startLine && cursorLine <= p.endLine);

              // If cursor not in a UUID paragraph, find nearest
              if (!cursorPara) {
                let bestDist = Infinity;
                for (const p of paras) {
                  const mid = (p.startLine + p.endLine) / 2;
                  const dist = Math.abs(mid - cursorLine);
                  if (dist < bestDist) {
                    bestDist = dist;
                    cursorPara = p;
                  }
                }
              }

              // Check if cursor's paragraph opening is visible
              if (cursorPara && cursorPara.startLine >= topLine && cursorPara.startLine <= bottomLine) {
                return cursorPara.uuid;
              }

              // Rule 2: Find topmost paragraph whose opening lines are visible
              for (const p of paras) {
                if (p.startLine >= topLine && p.startLine <= bottomLine) {
                  return p.uuid;
                }
              }

              // Rule 3: Find any paragraph overlapping the viewport
              for (const p of paras) {
                if (p.endLine >= topLine && p.startLine <= bottomLine) {
                  return p.uuid;
                }
              }

              return cursorPara?.uuid ?? null;
            },
            scrollToParagraphId(uuid: string) {
              const v = editorViewRef.current;
              if (!v) return;
              const paras = getRanges(v);
              const found = paras.find((p) => p.uuid === uuid);
              if (!found) return;
              try {
                const line = Math.min(found.startLine, v.state.doc.lines);
                const pos = v.state.doc.line(Math.max(1, line)).from;
                v.dispatch({
                  effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 80 }),
                  selection: { anchor: pos },
                });
              } catch { /* ignore */ }
            },
            scrollToLine(line: number, column?: number) {
              const v = editorViewRef.current;
              if (!v) return;
              try {
                const targetLine = Math.min(Math.max(1, line), v.state.doc.lines);
                const lineObj = v.state.doc.line(targetLine);
                const pos = column != null
                  ? Math.min(lineObj.from + Math.max(0, column - 1), lineObj.to)
                  : lineObj.from;
                v.dispatch({
                  effects: EditorView.scrollIntoView(pos, { y: "center", yMargin: 60 }),
                  selection: { anchor: pos },
                });
                v.focus();
              } catch { /* ignore */ }
            },
            moveCodeToTextCursor() {
              bridgeRef.current?.moveCodeToTextCursor();
            },
            moveTextToCodeCursor() {
              bridgeRef.current?.moveTextToCodeCursor();
            },
          });
        }}
      />
      <CodeEditorLogDrawer
        log={compileLog}
        status={compileStatus}
        isCompiling={isCompiling}
      />
    </div>
  );
}
