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
  onFocus?: () => void;
  onViewReady?: (view: EditorView | null) => void;
}

export default function EditorMirror({ editor, onClose, onFocus, onViewReady }: EditorMirrorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onFocusRef = useRef(onFocus);
  const onViewReadyRef = useRef(onViewReady);
  onFocusRef.current = onFocus;
  onViewReadyRef.current = onViewReady;

  useEffect(() => {
    if (!editor || !hostRef.current) return;

    // Match the canonical TipTap view's content-DOM attributes so the
    // mirror inherits the same prose styling. Read directly from the
    // rendered DOM element (rather than editorProps) so classes injected
    // by TipTap itself — notably `tiptap`, which scopes most of the editor
    // typography in globals.css — are included.
    const canonicalDom = editor.view.dom as HTMLElement;
    const canonicalAttrs: Record<string, string> = {};
    for (const attr of Array.from(canonicalDom.attributes)) {
      if (attr.name === "contenteditable") continue;
      canonicalAttrs[attr.name] = attr.value;
    }

    // Pull node and mark view factories off the canonical view so the mirror
    // renders the same custom node-views (headings, titles, citations, etc.)
    // and mark decorations as the top pane.
    const canonicalProps = editor.view.props as {
      nodeViews?: Record<string, unknown>;
      markViews?: Record<string, unknown>;
    };

    const view = new EditorView(hostRef.current, {
      state: editor.state,
      attributes: canonicalAttrs,
      nodeViews: (canonicalProps.nodeViews ?? {}) as never,
      markViews: (canonicalProps.markViews ?? {}) as never,
      dispatchTransaction(tr) {
        // Route through the canonical view so TipTap's update lifecycle
        // and React state stay consistent.
        editor.view.dispatch(tr);
      },
    });
    viewRef.current = view;
    onViewReadyRef.current?.(view);

    // Track focus on the mirror so the parent can route panel interactions
    // (e.g. outline clicks, note scrolling) to whichever pane the user is in.
    const onFocusIn = () => { onFocusRef.current?.(); };
    view.dom.addEventListener("focusin", onFocusIn);
    view.dom.addEventListener("mousedown", onFocusIn);

    const onTr = () => {
      const v = viewRef.current;
      if (v && v.state !== editor.state) {
        v.updateState(editor.state);
      }
    };
    editor.on("transaction", onTr);

    return () => {
      editor.off("transaction", onTr);
      view.dom.removeEventListener("focusin", onFocusIn);
      view.dom.removeEventListener("mousedown", onFocusIn);
      onViewReadyRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [editor]);

  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
      <div
        ref={hostRef}
        data-virgil-mirror-scroll
        className="flex-1 overflow-y-auto overflow-x-hidden bg-transparent min-h-0 editor-mirror"
      />
    </div>
  );
}
