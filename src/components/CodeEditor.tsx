"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { search, highlightSelectionMatches } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

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
}

interface CodeEditorProps {
  docId: string;
  initialLine?: number;
  initialParagraphId?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
  onReady?: (handle: CodeEditorHandle) => void;
}

// Helper: find all paragraph UUIDs and their line ranges in LaTeX source
// Only tracks actual content lines — pure comment lines (starting with %)
// are not counted as part of the paragraph.
function findParagraphUuids(text: string): Array<{ uuid: string; startLine: number; endLine: number }> {
  const lines = text.split("\n");
  const results: Array<{ uuid: string; startLine: number; endLine: number }> = [];
  let contentStart = -1; // first content (non-comment) line in current block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      contentStart = -1;
      continue;
    }
    // Pure comment lines (starting with %) that don't carry a UUID anchor
    // are not part of the paragraph content
    const hasUuid = /%!v:[0-9a-f]{4}/.test(line);
    const isPureComment = line.startsWith("%") && !hasUuid;
    if (!isPureComment && contentStart === -1) contentStart = i;
    if (hasUuid) {
      const match = line.match(/%!v:([0-9a-f]{4})/)!;
      const start = contentStart === -1 ? i : contentStart;
      results.push({ uuid: match[1], startLine: start + 1, endLine: i + 1 }); // 1-based
      contentStart = -1;
    }
  }
  return results;
}

export default function CodeEditor({ docId, initialLine, initialParagraphId, onDirtyChange, onReady }: CodeEditorProps) {
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestValueRef = useRef<string>("");
  const savedValueRef = useRef<string>("");
  const editorViewRef = useRef<EditorView | null>(null);
  const scrolledRef = useRef(false);

  // Fetch raw LaTeX on mount
  useEffect(() => {
    fetch(`/api/document/latex?docId=${docId}`)
      .then((r) => r.json())
      .then((data) => {
        setValue(data.latex || "");
        latestValueRef.current = data.latex || "";
        savedValueRef.current = data.latex || "";
      })
      .catch(() => setValue(""));
  }, [docId]);

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
          const paras = findParagraphUuids(view.state.doc.toString());
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

  const persist = useCallback(async (latex: string) => {
    setSaving(true);
    try {
      await fetch(`/api/document/latex?docId=${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      savedValueRef.current = latex;
      onDirtyChange?.(false);
    } catch (err) {
      console.error("Failed to save LaTeX:", err);
    } finally {
      setSaving(false);
    }
  }, [docId, onDirtyChange]);

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (latestValueRef.current !== savedValueRef.current) {
        // Fire-and-forget save
        fetch(`/api/document/latex?docId=${docId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latex: latestValueRef.current }),
        }).catch(() => {});
      }
    };
  }, [docId]);

  const handleChange = useCallback((val: string) => {
    setValue(val);
    latestValueRef.current = val;
    onDirtyChange?.(val !== savedValueRef.current);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(val), 1500);
  }, [persist, onDirtyChange]);

  if (value === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
      {saving && (
        <div className="absolute top-2 right-4 z-10 text-[10px] text-[var(--muted-light)]">
          Saving...
        </div>
      )}
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={[
          latex(),
          search(),
          highlightSelectionMatches(),
          virgilTheme,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
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
              const text = v.state.doc.toString();
              const paras = findParagraphUuids(text);
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
              const paras = findParagraphUuids(v.state.doc.toString());
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
          });
        }}
      />
    </div>
  );
}
