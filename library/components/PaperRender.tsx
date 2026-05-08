"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import EditorPane from "@/components/EditorPane";
import type { EditorHandle } from "@/components/Editor";
import { READER_CHROME } from "@/components/editor-layout/chrome-config";
import { useReaderViewPrefs } from "@/components/editor-layout/reader-view-prefs";
import { setDocHandle, deleteDocHandle } from "@/lib/doc-index";
import { readTextFile } from "@library/lib/library-storage";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids } from "@/lib/latex-serializer";
import type { IndexedState } from "@library/lib/catalog";
import PageScrollStrip from "./PageScrollStrip";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
  indexedState: IndexedState;
}

/**
 * Renders the body of a paper-file tab — mounts the **main Virgil
 * editor** (`@/components/Editor`) in read-only mode with the
 * `READER_CHROME` config in context, so all editor improvements made
 * in the main app automatically flow through to the Library Reader.
 *
 * Suppressed in Reader mode (via `READER_CHROME`):
 *  - text editing (TipTap `editable: false`)
 *  - paragraph float title-edit input + heading float label-edit input
 *  - drop / paste handlers (gated on `view.editable`)
 *
 * Library-specific chrome layered on top of the editor:
 *  - sticky `PageScrollStrip` for `\pgmark{N}` printed-page navigation
 *  - right-side panel rail with the Outline panel (more panels follow
 *    the EditorPane extraction)
 *
 * Panels currently inherited (Reader subset):
 *  - **Outline** — derived from the editor's parsed content; click any
 *    heading to scroll the reader to it.
 *
 * Panels deferred (require EditorPane extraction from EditorLayout):
 *  - Notes, Footnotes, Citations, Bibliography, Examples — depend on
 *    sidecar persistence wired through `usePersistentState`, the
 *    pristine-card manager, and the popped-cards / FloatingCards
 *    portal system.
 *  - Marginalia rendering (left + right gutter chips) — depends on
 *    `linksByParagraph` derived from all card hooks plus per-card
 *    hover/selection coupling.
 *  - Omni view, drag-drop card creation, action toolbar, formatting
 *    toolbar — orchestrated by EditorLayout.
 */
export default function PaperRender({ handle, citekey, indexedState }: Props) {
  const [tex, setTex] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const isIndexed = indexedState === "indexed" || indexedState === "deepIndexed";

  useEffect(() => {
    setTex(null);
    setParseError(null);
    if (!handle || !citekey || !isIndexed) return;
    let cancelled = false;
    (async () => {
      const t = await readTextFile(handle, `papers/${citekey}/main.tex`);
      if (!cancelled) setTex(t ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, citekey, isIndexed]);

  // Register the paper folder under a synthetic `library-paper:<citekey>`
  // docId. Per-doc storage hooks (useDocument, useNotes, useFootnotes,
  // ...) resolve the folder via this registration; storage-fsa.ts
  // synthesizes the FsaDocMeta on the fly so the synthetic id never
  // appears in the doc index. Cleanup deletes the handle on unmount /
  // citekey change so a stale handle can't be picked up after the user
  // closes the paper.
  useEffect(() => {
    if (!handle || !citekey || !isIndexed) return;
    const docId = `library-paper:${citekey}`;
    let cancelled = false;
    (async () => {
      try {
        const papersDir = await handle.getDirectoryHandle("papers");
        const paperDir = await papersDir.getDirectoryHandle(citekey);
        if (cancelled) return;
        await setDocHandle(docId, paperDir);
      } catch (e) {
        // Folder may not exist yet (e.g. mid-indexing); the editor's
        // own load path will surface the error to the user. Just don't
        // register a stale handle.
        console.warn(`Failed to register Library paper handle for ${docId}`, e);
      }
    })();
    return () => {
      cancelled = true;
      void deleteDocHandle(docId);
    };
  }, [handle, citekey, isIndexed]);

  if (!citekey) return null;

  if (!isIndexed) {
    return (
      <div
        style={{
          padding: 16,
          background: "var(--surface)",
          border: "var(--pod-border)",
          borderRadius: "var(--pod-radius)",
          color: "var(--muted)",
          fontStyle: "italic",
          margin: 16,
        }}
      >
        This paper hasn&apos;t been indexed yet. Use the <strong>Index</strong> or{" "}
        <strong>Deep&nbsp;index</strong> button in the header above to queue it,
        then run <code>/library/index-pending</code> in a Claude session to drain
        the queue.
      </div>
    );
  }

  if (tex === null) {
    return (
      <div style={{ padding: 16, color: "var(--muted)" }}>
        Loading <code>papers/{citekey}/main.tex</code>…
      </div>
    );
  }

  if (tex === "") {
    return (
      <div style={{ padding: 16, color: "var(--muted)" }}>
        <code>papers/{citekey}/main.tex</code> is empty.
      </div>
    );
  }

  return (
    <PaperReader
      citekey={citekey}
      tex={tex}
      onParseError={setParseError}
      parseError={parseError}
    />
  );
}

interface PaperReaderProps {
  citekey: string;
  tex: string;
  parseError: string | null;
  onParseError: (err: string | null) => void;
}

function PaperReader({ citekey, tex, parseError, onParseError }: PaperReaderProps) {
  const readerViewPrefs = useReaderViewPrefs();
  const [content, setContent] = useState<JSONContent | null>(null);
  // PageScrollStrip needs the live TipTap Editor instance to compute
  // page-mark scroll positions. Editor.tsx hands one back via
  // `onEditorReady`; we keep it in state (not a ref) so the strip
  // re-renders once the editor is mounted.
  const [editor, setEditor] = useState<Editor | null>(null);
  // Tracked as state (not a ref) so the strip re-mounts/relays out once
  // the scroll container exists. A plain ref would leave the strip
  // with `null` on its first render.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  useEffect(() => {
    try {
      const doc = parseLatex(tex);
      // Assign UUIDs to anchorable nodes so marginalia / linked-anchor
      // operations have stable paragraph ids to bind to. The main-app
      // load path runs this inside `readDocBundle`; the Reader parses
      // tex directly so we run it here.
      assignUuids(doc);
      setContent(doc);
      onParseError(null);
    } catch (e) {
      onParseError(e instanceof Error ? e.message : String(e));
      setContent(null);
    }
  }, [tex, onParseError]);

  if (parseError) {
    return (
      <div
        style={{
          padding: 16,
          background: "var(--pill-red-bg)",
          color: "var(--pill-red-fg)",
          borderRadius: 6,
          fontFamily: "var(--mono)",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          margin: 16,
        }}
      >
        Parse error: {parseError}
      </div>
    );
  }

  if (!content) {
    return <div style={{ padding: 16, color: "var(--muted)" }}>Rendering…</div>;
  }

  // The Reader's docId is synthetic — it doesn't appear in the FsaDocIndex
  // and intentionally doesn't pollute the main app's recents. Per-doc
  // sidecar hooks (post-extraction) will resolve this prefix to the
  // paper folder via the doc-handle registry.
  const docId = `library-paper:${citekey}`;

  return (
    <div
      ref={setScrollEl}
      data-virgil-row-scroll
      data-virgil-library-reader
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--background)",
        padding: "16px 0",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: 2,
      }}
    >
      {/* Left: page-mark scroll strip. The editor pod + right-side
       *  panel rail are now both inside `<EditorPane>` — the rail
       *  renders only when `chrome.visiblePanelKinds` is non-empty
       *  (Reader's whitelist is `outline`, `footnotes`, `examples`,
       *  `citations`, `bibliography`, `notes`). */}
      <PageScrollStrip editor={editor} scrollContainer={scrollEl} />
      <EditorPane
        ref={editorRef}
        docId={docId}
        initialContent={content as JSONContent}
        editable={false}
        chrome={READER_CHROME}
        viewPrefs={readerViewPrefs}
        onEditorReady={setEditor}
      />
    </div>
  );
}
