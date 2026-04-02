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
}

interface CodeEditorProps {
  docId: string;
  initialLine?: number;
  onDirtyChange?: (dirty: boolean) => void;
  onReady?: (handle: CodeEditorHandle) => void;
}

export default function CodeEditor({ docId, initialLine, onDirtyChange, onReady }: CodeEditorProps) {
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

  // Scroll to initial line once editor + content are ready
  useEffect(() => {
    if (scrolledRef.current || !initialLine || value === null) return;

    const tryScroll = () => {
      const view = editorViewRef.current;
      if (!view) return false;
      try {
        const line = Math.min(initialLine, view.state.doc.lines);
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
  }, [value, initialLine]);

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
          });
        }}
      />
    </div>
  );
}
