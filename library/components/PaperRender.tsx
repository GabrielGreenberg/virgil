"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import EditorPane from "@/components/EditorPane";
import type { EditorHandle } from "@/components/Editor";
import { READER_CHROME } from "@/components/editor-layout/chrome-config";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { useReaderViewPrefs } from "@/components/editor-layout/reader-view-prefs";
import { setDocHandle, deleteDocHandle } from "@/lib/doc-index";
import { readTextFile } from "@library/lib/library-storage";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids } from "@/lib/latex-serializer";
import type { IndexedState } from "@library/lib/catalog";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { getSession, setListScroll } from "@library/lib/view-session-store";
import PageScrollStrip from "./PageScrollStrip";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
  indexedState: IndexedState;
  /** View-session scope ('' inline / 'outer:<libId>' tear-out) + panel.
   *  The reader scroll is persisted under (scope, panel, paper:<citekey>). */
  scope: string;
  panel: PanelKey;
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
export default function PaperRender({
  handle,
  citekey,
  indexedState,
  scope,
  panel,
}: Props) {
  const [tex, setTex] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const isIndexed = indexedState === "indexed" || indexedState === "deepIndexed";

  // Register the paper folder under a synthetic `library-paper:<citekey>`
  // docId FIRST, then load `main.tex` and unblock EditorPane mount.
  // Sequencing matters: EditorPane's child hooks (useCitations,
  // usePersistentState) fire bottom-up, so if `setTex` lands before
  // `setDocHandle` resolves, those hooks call `requireDocHandle` against
  // an unregistered docId, the read throws, the `.catch(() => {})`
  // swallows it, and the Bibliography / Citations panels come up empty.
  useEffect(() => {
    setTex(null);
    setParseError(null);
    if (!handle || !citekey || !isIndexed) return;
    const docId = `library-paper:${citekey}`;
    let cancelled = false;
    (async () => {
      try {
        const papersDir = await handle.getDirectoryHandle("papers");
        const paperDir = await papersDir.getDirectoryHandle(citekey);
        if (cancelled) return;
        await setDocHandle(docId, paperDir);
        const t = await readTextFile(handle, `papers/${citekey}/main.tex`);
        if (cancelled) return;
        setTex(t ?? "");
      } catch (e) {
        // Folder may not exist yet (e.g. mid-indexing). Surface an empty
        // tex so the "main.tex is empty" branch renders rather than
        // hanging on the loading state forever.
        console.warn(`Failed to mount Library paper ${docId}`, e);
        if (!cancelled) setTex("");
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
      scope={scope}
      panel={panel}
    />
  );
}

interface PaperReaderProps {
  citekey: string;
  tex: string;
  parseError: string | null;
  onParseError: (err: string | null) => void;
  scope: string;
  panel: PanelKey;
}

function PaperReader({
  citekey,
  tex,
  parseError,
  onParseError,
  scope,
  panel,
}: PaperReaderProps) {
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

  // ── Reader scroll save/restore (per (scope, panel, paper:<citekey>)) ──
  const scrollSessionLibId = `paper:${citekey}`;
  // RAF-coalesced scroll save; the store's 250 ms debounce then coalesces
  // the localStorage writes (no synchronous write per scroll tick).
  const scrollRafRef = useRef<number | null>(null);
  const onReaderScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setListScroll(scope, panel, scrollSessionLibId, el.scrollTop);
      });
    },
    [scope, panel, scrollSessionLibId],
  );
  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );

  // One-shot restore. The paper body is async (tex → JSONContent →
  // EditorPane mount, which streams children after first paint), so we
  // can't restore synchronously. Once `content` is resolved AND the scroll
  // element exists, retry on RAF until the element is actually scrollable
  // (scrollHeight > clientHeight), apply the saved scrollTop once, then
  // stop. Bails after ~1 s so a short paper never spins.
  const restoredRef = useRef(false);
  useEffect(() => {
    restoredRef.current = false;
  }, [scrollSessionLibId]);
  useEffect(() => {
    if (restoredRef.current) return;
    if (!content || !scrollEl) return;
    const saved = getSession().scopes[scope]?.[panel]?.lists[scrollSessionLibId]
      ?.scrollTop;
    if (!saved || saved <= 0) {
      restoredRef.current = true; // nothing to restore
      return;
    }
    let raf = 0;
    const deadline =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) + 1000;
    const tryApply = () => {
      if (restoredRef.current) return;
      const el = scrollEl;
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = saved;
        restoredRef.current = true;
        return;
      }
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now >= deadline) {
        restoredRef.current = true; // give up — content never grew tall enough
        return;
      }
      raf = requestAnimationFrame(tryApply);
    };
    raf = requestAnimationFrame(tryApply);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [content, scrollEl, scope, panel, scrollSessionLibId]);

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
      onScroll={onReaderScroll}
      data-virgil-row-scroll
      data-virgil-library-reader
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
      }}
    >
      {/* `<DocPipeline key={docId}>` wraps EditorPane so `useDocument`
          (which the canonical EditorPane mounts unconditionally) can
          read its handle from context. The Reader is read-only so the
          handle is never used for writes, but `useDocument` will throw
          without an ancestor — this wrap satisfies the architectural
          contract and gives the Reader the same `key=`-driven remount
          on docId change as the main app. */}
      <DocPipeline key={docId} docId={docId}>
        <EditorPane
          ref={editorRef}
          docId={docId}
          initialContent={content as JSONContent}
          editable={false}
          chrome={READER_CHROME}
          viewPrefs={readerViewPrefs}
          onEditorReady={setEditor}
          leftGutterPrelude={
            <PageScrollStrip editor={editor} scrollContainer={scrollEl} />
          }
        />
      </DocPipeline>
    </div>
  );
}
