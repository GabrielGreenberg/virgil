"use client";

/**
 * EditorMirror — a second ProseMirror EditorView bound to the same
 * EditorState as the canonical TipTap editor. Implements the standard
 * "multiple views, one state" pattern from ProseMirror.
 *
 * Edits in the mirror are routed through the canonical view's dispatch,
 * so plugins, decorations, and node views all behave consistently. The
 * mirror updates its local state on every editor transaction.
 *
 * Used by EditorLayout to provide a session-only main-editor split-screen.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { EditorView } from "prosemirror-view";

interface EditorMirrorProps {
  editor: Editor | null;
  onClose: () => void;
}

export default function EditorMirror({ editor, onClose }: EditorMirrorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editor || !hostRef.current) return;

    // Match the canonical TipTap view's content-DOM attributes so the
    // mirror inherits the same prose styling.
    const canonicalAttrs = (editor.view.props as { attributes?: Record<string, string> })
      .attributes ?? {};

    const view = new EditorView(hostRef.current, {
      state: editor.state,
      attributes: canonicalAttrs,
      dispatchTransaction(tr) {
        // Route through the canonical view so TipTap's update lifecycle
        // and React state stay consistent.
        editor.view.dispatch(tr);
      },
    });
    viewRef.current = view;

    const onTr = () => {
      const v = viewRef.current;
      if (v && v.state !== editor.state) {
        v.updateState(editor.state);
      }
    };
    editor.on("transaction", onTr);

    return () => {
      editor.off("transaction", onTr);
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
      <button
        onClick={onClose}
        className="absolute top-1 right-1 z-10 p-1 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100/80 transition-colors"
        title="Close split"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div
        ref={hostRef}
        className="flex-1 overflow-y-auto bg-white min-h-0 editor-mirror"
      />
    </div>
  );
}
