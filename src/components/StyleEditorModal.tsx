"use client";

/**
 * StyleEditorModal — create or edit a single Style entry. Reachable
 * from the Virgil-bar dropdown ("Add new style…", "Save current
 * preamble as new style…") and from the Manage Styles modal's "Edit"
 * row action.
 *
 * The middle pane is CodeMirror with the latex grammar (same setup as
 * the doc-bound CodeEditor, minus the persistence wiring). Validation
 * runs on every change; Save is gated behind it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";

const editorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono), 'SF Mono', monospace",
    backgroundColor: "var(--background)",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": {
    backgroundColor: "#f5f3f0",
    color: "var(--muted-light)",
    border: "none",
    borderRight: "1px solid var(--border)",
    fontFamily: "var(--font-mono), monospace",
    fontSize: "11px",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(124, 94, 60, 0.04)",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
});

const BEGIN_DOC_RE = /\\begin\{document\}/g;
const END_DOC_RE = /\\end\{document\}/;

export interface StyleEditorResult {
  name: string;
  preamble: string;
}

interface StyleEditorModalProps {
  /** Initial state. Empty for "Add new"; pre-filled for "Edit". */
  initialName?: string;
  initialPreamble?: string;
  /** Optional subtitle shown under the title. */
  subtitle?: string;
  /** Title bar text. */
  title?: string;
  /** Existing names to reject on save (case-insensitive); the entry's
   *  own current name is filtered out by the caller before passing in. */
  takenNames?: string[];
  onSave: (result: StyleEditorResult) => void;
  onCancel: () => void;
}

interface ValidationResult {
  ok: boolean;
  /** First failing rule, or null if valid. */
  message: string | null;
}

function validatePreamble(text: string): ValidationResult {
  const beginMatches = text.match(BEGIN_DOC_RE) ?? [];
  if (beginMatches.length === 0) {
    return { ok: false, message: "Missing \\begin{document}." };
  }
  if (beginMatches.length > 1) {
    return { ok: false, message: "Found more than one \\begin{document}." };
  }
  if (END_DOC_RE.test(text)) {
    return {
      ok: false,
      message: "Preamble must not contain \\end{document}.",
    };
  }
  return { ok: true, message: null };
}

/** Normalize trailing whitespace so the blob always ends with
 *  `\begin{document}\n\n` — matches the contract used by
 *  `useDocumentStyle.setStyle` when re-assembling the .tex. */
function normalizePreambleTrailing(text: string): string {
  // Find the \begin{document} marker and ensure exactly two trailing \n.
  const idx = text.indexOf("\\begin{document}");
  if (idx === -1) return text;
  const head = text.slice(0, idx + "\\begin{document}".length);
  return head + "\n\n";
}

export default function StyleEditorModal({
  initialName = "",
  initialPreamble = "",
  subtitle,
  title = "New style",
  takenNames = [],
  onSave,
  onCancel,
}: StyleEditorModalProps) {
  const [name, setName] = useState(initialName);
  const [preamble, setPreamble] = useState(initialPreamble);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const validation = useMemo(() => validatePreamble(preamble), [preamble]);

  const trimmedName = name.trim();
  const nameTaken = useMemo(
    () =>
      takenNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase()),
    [takenNames, trimmedName],
  );

  const nameError = trimmedName.length === 0
    ? "Name is required."
    : nameTaken
      ? "A style with this name already exists."
      : null;

  const canSave = !nameError && validation.ok;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave({
      name: trimmedName,
      preamble: normalizePreambleTrailing(preamble),
    });
  }, [canSave, trimmedName, preamble, onSave]);

  return (
    <SystemDialog open onClose={onCancel} size="xl">
      <SystemDialogHeader title={title} subtitle={subtitle} />

      <SystemDialogBody className="pb-2">
        <label className="block text-[11px] font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
          Name
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My style"
          className="w-full px-3 py-1.5 text-sm bg-surface border border-edge-subtle rounded-md focus:border-edge-strong focus:outline-none text-ink-body"
        />
        {nameError && (
          <p className="text-[11px] text-[var(--danger,#b91c1c)] mt-1">
            {nameError}
          </p>
        )}
      </SystemDialogBody>

      <div className="px-5 pt-2 pb-2">
        <label className="block text-[11px] font-medium text-ink-subtle uppercase tracking-wide mb-1.5">
          Preamble (everything before \begin&#123;document&#125;)
        </label>
        <div
          className="border border-edge-subtle rounded-md overflow-hidden"
          style={{ height: "55vh" }}
        >
          <CodeMirror
            value={preamble}
            onChange={setPreamble}
            extensions={[
              latex(),
              editorTheme,
              EditorView.lineWrapping,
              EditorState.tabSize.of(2),
            ]}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              bracketMatching: true,
              foldGutter: true,
              indentOnInput: true,
              closeBrackets: true,
              autocompletion: false,
            }}
            height="100%"
            style={{ height: "100%" }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-[11px]">
          <span className="text-ink-subtle">
            Virgil markers (\vfid, \vcid, \vexid) are added automatically.
          </span>
          {validation.ok ? (
            <span className="text-[var(--success,#15803d)]">✓ Valid</span>
          ) : (
            <span className="text-[var(--danger,#b91c1c)]">
              ✗ {validation.message}
            </span>
          )}
        </div>
      </div>

      <SystemDialogFooter>
        <SystemDialogButton variant="secondary" onClick={onCancel}>
          Cancel
        </SystemDialogButton>
        <SystemDialogButton
          variant="primary"
          onClick={handleSave}
          disabled={!canSave}
          autoFocus
        >
          Save
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
