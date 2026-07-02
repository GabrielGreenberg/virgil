"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import EditorPane from "@/components/EditorPane";
import type { EditorHandle } from "@/components/Editor";
import { READER_CHROME } from "@/components/editor-layout/chrome-config";
import { EditorChromeProvider } from "@/components/editor-layout/chrome-context";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import { useReaderView } from "@/components/editor-layout/reader-view-prefs";
import { setDocHandle, deleteDocHandle } from "@/lib/doc-index";
import { readTextFile } from "@library/lib/library-storage";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids } from "@/lib/latex-serializer";
import type { IndexedState } from "@library/lib/catalog";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { getSession, setListScrollQuiet } from "@library/lib/view-session-store";
import type { PgmarkPages } from "@library/hooks/usePgmarkPages";
import PageScrollLozenge from "./PageScrollLozenge";
import PagePicker from "./PagePicker";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  citekey: string | null;
  indexedState: IndexedState;
  /** View-session scope ('' inline / 'outer:<libId>' tear-out) + panel.
   *  The reader scroll is persisted under (scope, panel, paper:<citekey>). */
  scope: string;
  panel: PanelKey;
  /** Reports the live TipTap editor + scroll container up to RightDetail,
   *  which calls `usePgmarkPages` ONCE off these refs (F#11) and threads the
   *  resulting `PgmarkPages` back down to BOTH the header's page picker and
   *  this component's `PageScrollLozenge`. Both null while the reader is still
   *  mounting / on unmount. */
  onReaderRefs?: (refs: {
    editor: Editor | null;
    scrollEl: HTMLElement | null;
  }) => void;
  /** F#11: the shared printed-page derivation, computed ONCE in RightDetail
   *  (the single owner) and threaded down so PageScrollLozenge consumes the
   *  SAME PgmarkPages the header's page picker uses — no second
   *  ResizeObserver / scroll listener / doc-scan. */
  pgmarkPages?: PgmarkPages;
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
 *  - floating `PageScrollLozenge` (`p. N` pill near the right scrollbar)
 *    surfacing the current `\pgmark{N}` printed page while scrolling
 *
 * Panel + view-state inheritance (NOT a Reader subset anymore): the
 * Reader runs the SAME `useViewPrefs` engine as the main app, in
 * `"ephemeral"` (session-only) mode via `useReaderView()`, which assembles
 * BOTH the `viewPrefs` bundle (shared `buildEditorPaneViewPrefs(...)` builder)
 * AND the `menuBar` bundle off ONE ephemeral engine. So the panel rail
 * (for the 6 whitelisted kinds — outline, footnotes, examples, citations,
 * bibliography, notes), the panel↔text divider, dock stacking, card
 * popouts, omni toggles, and margins are all LIVE here (session-only). The
 * Outline panel's click-to-scroll is wired through the one REAL Reader
 * editor-handler (`onScrollToHeading`); the rest of the editor-mutation
 * handlers are typed no-ops because the doc is read-only.
 *
 * F#16: the Reader now ALSO passes a `menuBar` bundle, so the docked MenuBar
 * lights up — its View-menu toggles (par titles, latex comments, marginalia/
 * highlight types, divider levels/width, dim-at-rest, close-all) are all
 * FUNCTIONAL via the SAME ephemeral engine, and paragraph back/forward nav is
 * a keystroke-safe wall-clock recorder. Fonts…/Margins…/Preferences stay
 * absent (Fonts/Margins via `READER_CHROME.showMenuBarEditItems=false`;
 * ViewMenu renders no Preferences row). Passing `menuBar` on this single
 * `<EditorPane>` lights up BOTH reader contexts (inline panel + outer tab).
 * Note cards stay editable (`READER_CHROME.editableCardKinds`).
 */
export default function PaperRender({
  handle,
  citekey,
  indexedState,
  scope,
  panel,
  onReaderRefs,
  pgmarkPages,
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
      onReaderRefs={onReaderRefs}
      pgmarkPages={pgmarkPages}
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
  onReaderRefs?: (refs: {
    editor: Editor | null;
    scrollEl: HTMLElement | null;
  }) => void;
  pgmarkPages?: PgmarkPages;
}

function PaperReader({
  citekey,
  tex,
  parseError,
  onParseError,
  scope,
  panel,
  onReaderRefs,
  pgmarkPages,
}: PaperReaderProps) {
  const [content, setContent] = useState<JSONContent | null>(null);
  // PageScrollLozenge needs the live TipTap Editor instance to compute
  // page-mark scroll positions. Editor.tsx hands one back via
  // `onEditorReady`; we keep it in state (not a ref) so the lozenge
  // re-renders once the editor is mounted.
  const [editor, setEditor] = useState<Editor | null>(null);
  // Tracked as state (not a ref) so the lozenge re-mounts/relays out once
  // the scroll container exists. A plain ref would leave the lozenge
  // with `null` on its first render.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  // Report the live editor + scroll container up to RightDetail, which owns the
  // single `usePgmarkPages` derivation (F#11) and threads the result back down
  // to both the header's page picker and this component's lozenge. Re-fires
  // whenever either ref flips.
  useEffect(() => {
    onReaderRefs?.({ editor, scrollEl });
    return () => onReaderRefs?.({ editor: null, scrollEl: null });
  }, [editor, scrollEl, onReaderRefs]);

  // Reader view-prefs + menuBar bundle run the real `useViewPrefs` engine in
  // ephemeral mode — ONE engine backs both so a menu toggle and a rail click
  // mutate the same store (F#16). The editor is threaded in for the Outline
  // panel's click-to-scroll + the menu's divider-level walk; the editor handle
  // ref + scroll element drive the menu's paragraph back/forward recorder.
  const { viewPrefs: readerViewPrefs, menuBar: readerMenuBar } = useReaderView(
    editor,
    editorRef,
    scrollEl,
  );

  // ── Reader scroll save/restore (per (scope, panel, paper:<citekey>)) ──
  const scrollSessionLibId = `paper:${citekey}`;
  // RAF-coalesced scroll save; the store's 250 ms debounce then coalesces
  // the localStorage writes (no synchronous write per scroll tick).
  const scrollRafRef = useRef<number | null>(null);
  // True while the one-shot restore below is still pending (the ~1 s streaming
  // retry window). The save listener is attached the moment the scroll element
  // exists — BEFORE restore lands — so without this gate a user scroll during
  // streaming would persist, then the restore would clobber it back to the
  // stale captured value. Suppress saves until restore completes; a real user
  // scroll during the window also flips this off (see the restore effect) so
  // the user's intent wins.
  const restoringRef = useRef(false);
  const onReaderScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (restoringRef.current) return; // restore in flight — don't persist
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setListScrollQuiet(scope, panel, scrollSessionLibId, el.scrollTop);
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
    restoringRef.current = false;
  }, [scrollSessionLibId]);
  useEffect(() => {
    if (restoredRef.current) return;
    if (!content || !scrollEl) return;
    const saved = getSession().scopes[scope]?.[panel]?.lists[scrollSessionLibId]
      ?.scrollTop;
    if (!saved || saved <= 0) {
      restoredRef.current = true; // nothing to restore
      restoringRef.current = false;
      return;
    }
    // Restore is now pending: suppress the save listener so a mid-stream user
    // scroll isn't first persisted then clobbered by `saved`. We also record
    // the element's baseline so we can detect a deliberate user scroll during
    // the retry window and yield to it.
    restoringRef.current = true;
    const baseline = scrollEl.scrollTop;
    let raf = 0;
    const deadline =
      (typeof performance !== "undefined" ? performance.now() : Date.now()) + 1000;
    const finish = () => {
      restoredRef.current = true;
      restoringRef.current = false;
    };
    const tryApply = () => {
      if (restoredRef.current) return;
      const el = scrollEl;
      // If the user scrolled meaningfully since mount, their intent wins:
      // abandon the restore (and re-enable saves) rather than yanking them
      // back to the stale captured position.
      if (Math.abs(el.scrollTop - baseline) > 4) {
        finish();
        return;
      }
      if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = saved;
        finish();
        return;
      }
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now >= deadline) {
        finish(); // give up — content never grew tall enough
        return;
      }
      raf = requestAnimationFrame(tryApply);
    };
    raf = requestAnimationFrame(tryApply);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      // Effect teardown (libId change / unmount) must not leave saves wedged
      // off. The re-arm effect above resets both flags on the next libId.
      restoringRef.current = false;
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

  // Chrome-band page picker element, memoized on the fields PagePicker actually
  // renders from — NOT on the `pgmarkPages` object, which usePgmarkPages returns
  // as a fresh literal every render. During a same-page scroll only
  // scrollTop/containerH bump, leaving `pages` (ref), `currentLabel` (value) and
  // `scrollToPage` (ref) stable, so this element stays identity-stable and
  // EditorPane's memo() can bail on the scroll frame; it re-creates only when the
  // shown page label or the marks actually change. Must sit above the early
  // returns below (hooks run unconditionally).
  const pagePickerEl = useMemo(
    () =>
      pgmarkPages && pgmarkPages.pages.length > 0 ? (
        // `dense` keeps the input short so it doesn't crowd the 26px band's top
        // border; marginRight nudges the picker left to give the paragraph
        // back/forward nav (immediately to its right) some breathing room.
        <span style={{ display: "inline-flex", marginRight: 12 }}>
          <PagePicker pages={pgmarkPages} dense />
        </span>
      ) : undefined,
    // Intentionally keyed on the sub-fields, not the fresh `pgmarkPages` object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pgmarkPages?.pages, pgmarkPages?.currentLabel, pgmarkPages?.scrollToPage],
  );

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
    // Positioned wrapper so the page lozenge can pin near the right
    // scrollbar without scrolling away with the content. The wrapper owns
    // the flex sizing; the inner div is the actual scroll container.
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
      }}
    >
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
          {/* EditorChromeProvider here (above EditorPane) so EditorPane's
              OWN body hooks — useNotes/useTodos/useReports/... and the
              persistent-state write-guard inside them — resolve READER_CHROME
              rather than the FULL_CHROME context default. EditorPane's inner
              provider (which adds `menuBar`) only wraps its CHILDREN, so
              without this ancestor the body hooks would read FULL_CHROME and
              the Reader's note-only sidecar write-guard would never engage,
              letting a load-only Mode-A anchor reconcile write card sidecars
              to disk on a read-only open. Value MUST match EditorPane's
              `chrome` prop below (READER_CHROME) so there's no split-brain. */}
          <EditorChromeProvider value={READER_CHROME}>
            <EditorPane
              ref={editorRef}
              docId={docId}
              initialContent={content as JSONContent}
              editable={false}
              chrome={READER_CHROME}
              viewPrefs={readerViewPrefs}
              menuBar={readerMenuBar}
              // Printed-page selector, docked into the editor's in-card chrome
              // band just left of the paragraph back/forward nav (text mode
              // only — this component never mounts in PDF mode, where the picker
              // stays in PaperHeader). Fed the SHARED PgmarkPages threaded from
              // RightDetail (F#11); renders nothing for pgmark-less papers
              // (DOCX / plain-tex). Memoized above so a same-page scroll frame
              // doesn't defeat EditorPane's memo().
              chromeHeaderTrailing={pagePickerEl}
              onEditorReady={setEditor}
            />
          </EditorChromeProvider>
        </DocPipeline>
      </div>
      {/* Page lozenge — a floating `p. N` pill pinned near the right
          scrollbar (D-4), absolutely positioned against this wrapper so
          it stays put while the inner div scrolls. Fades in on scroll,
          out after ~1s idle; renders nothing for pgmark-less papers.
          F#11: consumes the SHARED PgmarkPages threaded from RightDetail
          (one derivation) rather than running its own usePgmarkPages. */}
      <PageScrollLozenge pages={pgmarkPages} scrollContainer={scrollEl} />
    </div>
  );
}
