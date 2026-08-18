"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { JSONContent, type Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { isAnchorMintTransaction } from "@/lib/anchor-mint-signal";
import { isRealUserEdit, noteUserEdit } from "@/lib/write-preservation";
import { isWriteProtected } from "@/lib/preservation-notice";
import { getDocProducts } from "@/lib/doc-products/pipeline";
import { readDocBundle, writeDocBundle } from "@/lib/storage";
import { isStalePipelineError } from "@/lib/multi-window/doc-pipeline";
import { useDocWriteHandle } from "@/components/editor-layout/DocPipeline";
import {
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";
import { useDiskWatcherOrNull } from "@/components/editor-layout/contexts/disk-watcher";
import { shouldPauseAutosave } from "@/lib/autosave-pause";
import {
  TEX_DELIMITERS_CHANGED_EVENT,
  type TexDelimitersChangedDetail,
} from "@/lib/tex-delimiters-event";

type SaveStatus = "idle" | "saving" | "saved";

/**
 * Document load + autosave for the active doc.
 *
 * Architecturally requires a `<DocPipeline key={docId} docId={docId}>`
 * ancestor: the handle (and therefore the docId) is read from context
 * via `useDocWriteHandle()`. That ancestor's `key={docId}` forces the
 * subtree to fully remount on every doc switch — TipTap, save closures,
 * pending-edit refs, all of it. Stale content from the previous doc
 * cannot survive into the next one.
 *
 * If a future caller mounts this hook outside a DocPipeline, the
 * `useDocWriteHandle()` call throws synchronously with a directive to
 * add the wrap. That throw IS the architectural wall.
 *
 * Pending edits sit in a 1500 ms React-local debounce. We expose that
 * debounce via the per-doc pending-saves registry so external callers
 * (the doc-switch barrier in useFiles, the pagehide handler below) can
 * fire it before the pipeline ends. Without that, an edit made in the
 * debounce window before refresh/switch would be silently dropped — the
 * storage-layer `flushDoc` only drains writes that already entered the
 * queue, not the un-fired React debounce.
 */
export function useDocument() {
  const handle = useDocWriteHandle();
  const docId = handle.docId;
  // External-change watcher (null in bare test contexts / no provider). Used to
  // (a) inject the dirty-getter so the watcher can flip change→conflict, and
  // (b) PAUSE background autosave while an external change is unresolved so we
  // never clobber the on-disk edit (DESIGN §4). Held in a ref so the memoized
  // save closures read the CURRENT watcher without taking it as a dependency —
  // its identity is stable per doc-mount anyway, but the ref keeps the
  // keystroke-path callbacks (debouncedSave/flushNow/onUpdate) from re-creating.
  const diskWatcherCtx = useDiskWatcherOrNull();
  // Multi-doc keep-alive: ONE DiskWatcherProvider sits above N mounted
  // useDocument instances (1 active + warm). The provider watches only the
  // ACTIVE doc, so a warm doc must see a null watcher — else its background
  // autosave would pause on the ACTIVE doc's external-conflict state
  // (`shouldPauseAutosave(null)` is false, so null = "never pause"). Only the
  // doc whose id matches the provider's `activeDocId` honors the pause guard.
  const isActiveDoc = diskWatcherCtx?.activeDocId === docId;
  const watcher = isActiveDoc ? (diskWatcherCtx?.watcher ?? null) : null;
  const watcherRef = useRef(watcher);
  // Sync the ref in an effect (never during render). The async save timers
  // read `watcherRef.current` only after this effect has run, so they always
  // see the current watcher.
  useEffect(() => {
    watcherRef.current = watcher;
  }, [watcher]);
  const [content, setContent] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `latestContentRef` holds the last-debounce-fired JSON snapshot (or
  // the last-flushed snapshot). It's the *fallback* source for the
  // unmount cleanup, which fires AFTER React destroys the editor (child
  // cleanups precede parent cleanups). All other flush paths (pagehide,
  // beforeunload, external `flushPending`) run while the editor is still
  // alive and prefer a fresh `editor.getJSON()` snapshot — see those
  // call sites below. The unmount cleanup can lose up to one debounce
  // window (~1500 ms) of edits in the degenerate case where the caller
  // didn't run `flushPendingForDoc` first; in production, `useFiles`
  // calls `drainDoc(prevId)` before doc switch, so the live-editor
  // path captures the freshest snapshot.
  const latestContentRef = useRef<JSONContent | null>(null);
  const lastSavedRef = useRef<JSONContent | null>(null);
  // Editor reference captured on every onUpdate. Used by flush paths to
  // call `editor.getJSON()` lazily (only when a debounce settles or a
  // flush fires) instead of per keystroke. The reference itself is
  // refreshed on every call so a remount-without-onUpdate can't leave
  // it pointing at a stale editor.
  const editorRef = useRef<Editor | null>(null);
  // Code-pane delimiters whose immediate commit was SWALLOWED by the
  // autosave-pause guard (or by a destroyed-editor race) in
  // `saveWithDelimiters`. The bridge clears its own `pendingPersist` BEFORE
  // invoking the persist callback, so this ref is the ONLY durable copy of
  // the user's preamble edit until a write lands — dropping it would
  // permanently lose the edit while the code pane keeps displaying it (the
  // masked-loss failure mode of the original bug). Every bundle-write path
  // below consumes it via `takeDelimitersOpts()` so the NEXT successful
  // save carries the delimiters exactly once. Cleared when disk becomes
  // authoritative out-of-band: `refetch()` (external-change Reload) and the
  // per-doc tex-delimiters-changed event (style switch / compile
  // class-switch / Reload), where replaying a stale stash would clobber
  // the just-written preamble.
  const pendingDelimitersRef = useRef<{
    preamble: string;
    postamble: string;
  } | null>(null);

  // Consume the stashed delimiters (one-shot). Returns the `writeDocBundle`
  // opts for the next save, or undefined when nothing is stashed — so every
  // save call site can pass `takeDelimitersOpts()` unconditionally.
  const takeDelimitersOpts = useCallback(():
    | { delimiters: { preamble: string; postamble: string } }
    | undefined => {
    const d = pendingDelimitersRef.current;
    if (!d) return undefined;
    pendingDelimitersRef.current = null;
    return { delimiters: d };
  }, []);

  const save = useCallback(
    async (
      doc: JSONContent,
      opts?: { delimiters?: { preamble: string; postamble: string } },
    ) => {
      setSaveStatus("saving");
      try {
        await writeDocBundle(handle, doc, opts);
        // A REFUSED write returns normally — the gate leaves the `.tex` and the
        // sidecar byte-identical rather than throwing (task 357 hole 4). So the
        // refusal is read off the channel the gate publishes to, never inferred
        // from the absence of a throw: claiming "saved" here would be the same
        // silence the gate exists to end, and advancing `lastSavedRef` to a doc
        // that never reached disk would make the mint-flush suppression skip a
        // later legitimate write of it. The banner is what tells the user.
        if (isWriteProtected(handle.docId)) {
          setSaveStatus("idle");
          return;
        }
        lastSavedRef.current = doc;
        setSaveStatus("saved");
        setTimeout(() => {
          setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
        }, 2000);
      } catch (err) {
        if (isStalePipelineError(err)) {
          if (err.reason === "superseded") {
            // A newer pipeline took over for the same docId before our
            // write landed. Expected when reopening the same doc rapidly;
            // the newer pipeline has loaded fresh content and our stale
            // write would have corrupted it. Log so the case is visible.
            console.warn(
              `[useDocument] Stale save dropped — pipeline ${handle.pipelineId.slice(0, 8)} for "${handle.docId}" was superseded by ${err.currentPipelineId?.slice(0, 8) ?? "?"} before write landed`,
            );
          } else {
            // No replacement pipeline — registry has simply forgotten
            // about us. With the globalThis-stable registry this should
            // not occur in normal editing; if it does, the unmount-flush
            // ordering has regressed and edits are being silently lost.
            console.error(
              `[useDocument] Save dropped — pipeline ${handle.pipelineId.slice(0, 8)} for "${handle.docId}" had already ended with no replacement. This is unexpected and indicates a regression in the pipeline lifecycle.`,
            );
          }
          return;
        }
        console.error("Failed to save document:", err);
        setSaveStatus("idle");
      }
    },
    [handle],
  );

  // External flush hook: cancel the pending debounce, fire the latest
  // content immediately, return the write promise. Used by the unmount
  // cleanup, pagehide listener, and the doc-switch barrier in useFiles.
  // Must close over the CURRENT save (and thus current handle) so the
  // registered flusher always writes to the doc that registered it.
  //
  // Snapshot source: prefer a fresh `editor.getJSON()` so we capture
  // every keystroke right up to the flush moment (the debounce timer
  // and the per-keystroke snapshot are separated post-perf-fix; the
  // ref alone lags up to ~1500 ms). Fall back to the ref only when
  // the editor is gone (unmount path).
  const flushPending = useCallback(async (): Promise<void> => {
    // `saveTimerRef.current !== null` is the canonical "there are
    // unsaved edits" signal post-perf-fix. A clean state (no debounce
    // in flight, last save completed) has saveTimer === null and
    // latestContentRef === the saved doc — so we'd otherwise re-save
    // the same content on every flushPending call.
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const editor = editorRef.current;
    let pending: JSONContent | null;
    if (editor && !editor.isDestroyed) {
      pending = editor.getJSON();
    } else {
      pending = latestContentRef.current;
    }
    if (!pending) return;
    latestContentRef.current = null;
    await save(pending, takeDelimitersOpts());
  }, [save, takeDelimitersOpts]);

  // Load the doc on mount. The `<DocPipeline key={docId}>` ancestor
  // forces a full remount when the docId changes, so this effect runs
  // exactly once per (docId, mount) — no doc-switch race to handle here.
  // The `cancelled` flag is still load-bearing for StrictMode's
  // double-invoke and for unmount-during-load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSaveStatus("idle");
    readDocBundle(docId)
      .then((bundle) => {
        if (cancelled) return;
        setContent(bundle.content);
        lastSavedRef.current = bundle.content;
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load document:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // Register the flusher so external callers (doc-switch barrier,
  // pagehide) can fire the pending debounce before the pipeline ends.
  useEffect(() => {
    registerPendingFlusher(docId, flushPending);
    return () => unregisterPendingFlusher(docId, flushPending);
  }, [docId, flushPending]);

  // Inject the canonical dirty-getter into the external-change watcher so it
  // can pull "are there unsaved edits?" at poll time and flip severity
  // change→conflict. `saveTimerRef.current !== null` is the SSOT dirty flag.
  // This is set ONCE per mount (not per keystroke) and adds NO editor.on
  // subscriber — the watcher PULLS this getter on its wall-clock poll. The
  // getter reads a ref, so its identity never changes; the watcher's
  // hasUnsavedEdits closes over `unsavedRef.current()` in the provider.
  const registerUnsavedGetter = diskWatcherCtx?.registerUnsavedGetter;
  useEffect(() => {
    if (!registerUnsavedGetter) return;
    const unregister = registerUnsavedGetter(
      docId,
      () => saveTimerRef.current !== null,
    );
    return unregister;
  }, [registerUnsavedGetter, docId]);

  // Flush pending edits on unmount. With the DocPipeline `key={docId}`
  // boundary, unmount IS the doc-switch event — the cleanup closes over
  // this mount's save closure (and its handle), so any pending edit
  // lands in the correct doc's files. Storage's queued task uses the
  // lenient `assertNotSuperseded` check, so a write that races the
  // pipeline-end cleanup is allowed through if no newer pipeline took
  // over.
  useEffect(() => {
    return () => {
      // Nothing pending — last save already captured everything.
      if (saveTimerRef.current === null) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      // Defensive: prefer the live editor if it's still alive (e.g.,
      // test environments where the editor isn't a real TipTap instance
      // that destroys itself). In production, React destroys the editor
      // in child cleanup BEFORE this parent cleanup runs, so this
      // branch typically falls through to the ref snapshot — which
      // may lag by up to one debounce window (~1500 ms). The doc-switch
      // path in `useFiles` calls `drainDoc(prevId)` → `flushPendingForDoc`
      // BEFORE unmount, capturing the live snapshot.
      const editor = editorRef.current;
      let pending: JSONContent | null;
      if (editor && !editor.isDestroyed) {
        pending = editor.getJSON();
      } else {
        pending = latestContentRef.current;
      }
      latestContentRef.current = null;
      if (pending) void save(pending, takeDelimitersOpts());
    };
  }, [save, takeDelimitersOpts]);

  // Refresh / tab-close flush. `pagehide` is the modern, mobile-safe
  // counterpart to `beforeunload` for actually doing work; we use
  // `beforeunload` only to prompt the user when there are unsaved
  // edits, buying the in-flight write time to land.
  useEffect(() => {
    const onPageHide = () => {
      // No pending edits — nothing to flush. Without this guard, every
      // mounted useDocument instance whose editorRef happens to be alive
      // would re-save on every pagehide, which manifests as extra
      // writes across test suites where multiple instances co-exist
      // (and as wasted work in prod for multi-doc sessions).
      if (saveTimerRef.current === null) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      // Pagehide fires before component unmount, so the editor is
      // still alive here. Prefer the live snapshot.
      const editor = editorRef.current;
      let pending: JSONContent | null;
      if (editor && !editor.isDestroyed) {
        pending = editor.getJSON();
      } else {
        pending = latestContentRef.current;
      }
      if (pending) {
        latestContentRef.current = null;
        void save(pending, takeDelimitersOpts());
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // `saveTimerRef.current` is the canonical "there's pending unsaved
      // work" signal post-perf-fix: it's set on every keystroke and
      // cleared when the debounce fires (or a flush happens). The
      // earlier ref-comparison-based dirty check is unreliable here
      // because `latestContentRef` is only populated at debounce-fire,
      // not per keystroke.
      if (saveTimerRef.current === null) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const editor = editorRef.current;
      const pending = editor && !editor.isDestroyed
        ? editor.getJSON()
        : latestContentRef.current;
      if (!pending) return;
      latestContentRef.current = null;
      void save(pending, takeDelimitersOpts());
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save, takeDelimitersOpts]);

  // Debounced save — schedules a 1500 ms timer that, on fire, asks the
  // live editor for its current JSON snapshot and writes it. The doc
  // argument used to be a per-keystroke `editor.getJSON()` snapshot;
  // moving serialization INSIDE the timer means we pay O(doc-size) at
  // most once per 1500 ms during sustained typing instead of once per
  // keystroke. See plan: ok-lets-do-a-dreamy-thacker.md.
  // The re-arm path (autosave-pause guard) needs to call `debouncedSave`
  // recursively. We route the re-arm through this ref to avoid a
  // reference-before-declaration of the `useCallback` const (and to keep the
  // closure stable). The ref is assigned to the callback immediately below.
  const debouncedSaveRef = useRef<() => void>(() => {});
  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      // AUTOSAVE-CLOBBER GUARD (DESIGN §4): while an external change is
      // unresolved, do NOT overwrite disk. RE-ARM the debounce instead of
      // writing, so (a) the dirty flag `saveTimerRef.current !== null` STAYS
      // true — keeping the watcher's severity at 'conflict' — and (b) the edit
      // is retried automatically once the user resolves the change (Reload or
      // Dismiss → hasUnresolvedChange() returns false and the next fire writes
      // normally). KEYSTROKE SANCTITY: this check runs at debounce-fire (off the
      // hot path), never per keystroke; it is a single O(1) store read.
      if (shouldPauseAutosave(watcherRef.current)) {
        debouncedSaveRef.current();
        return;
      }
      saveTimerRef.current = null;
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      // Perf Wave 1 (S3): prefer the DocProducts pipeline's synchronously-
      // refreshed shared docJson — O(changed blocks), identity-stable for
      // unchanged blocks — over a fresh O(doc) deep copy. writeDocBundle is
      // mutation-safe for the shared snapshot (needsUuidWork copy-on-write).
      // Null pipeline (flag off / not mounted) falls back to getJSON.
      const doc =
        getDocProducts(editor)?.ensureFresh().docJson ?? editor.getJSON();
      // Populate the snapshot ref so the unmount cleanup (which fires
      // after the editor is destroyed) has something to flush.
      latestContentRef.current = doc;
      // Carry any pause-swallowed code-pane delimiters (see
      // `pendingDelimitersRef`) — this is the retry path that lands a
      // preamble edit after the user resolves an external change via
      // Dismiss / "Keep my version".
      save(doc, takeDelimitersOpts());
    }, 1500);
  }, [save, takeDelimitersOpts]);
  // Sync the self-reference ref in an effect (never during render). The re-arm
  // path inside the timer reads it only after this effect has run.
  useEffect(() => {
    debouncedSaveRef.current = debouncedSave;
  }, [debouncedSave]);

  // Immediate doc-bundle flush for anchor-UUID mint transactions. Cancels the
  // pending 1500 ms debounce and writes the live editor JSON NOW, so a freshly
  // minted paragraph UUID persists on the card's fast clock instead of the
  // doc's slow autosave clock (closing the anchor-persistence race — see
  // @/lib/anchor-mint-signal + docs/memos/anchor-persistence-bug/SYNTHESIS.md).
  //
  // Unlike `flushPending`, this does NOT early-return on a null timer: a mint
  // tx is itself the "there is unsaved work" signal (it changed the doc), and
  // it always arrives with the debounce just armed by `debouncedSave()` below.
  const flushNow = useCallback(() => {
    // AUTOSAVE-CLOBBER GUARD (DESIGN §4): while an external change is
    // unresolved, do NOT write. Re-arm the debounce (leaving saveTimerRef
    // armed) so the minted UUID is retried after the user resolves the change,
    // and the dirty flag stays true (severity stays 'conflict'). This is a
    // discrete commit path, not the keystroke path — O(1) store read.
    if (shouldPauseAutosave(watcherRef.current)) {
      debouncedSave();
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    // Perf Wave 1 (S3): shared pipeline snapshot when mounted (see
    // debouncedSave) — a mint flush during a drag no longer pays a full
    // deep copy, and writeDocBundle's byte-equality gate makes a
    // no-change flush skip the disk tail entirely.
    const doc =
      getDocProducts(editor)?.ensureFresh().docJson ?? editor.getJSON();
    latestContentRef.current = doc;
    void save(doc, takeDelimitersOpts());
  }, [save, debouncedSave, takeDelimitersOpts]);

  // Code-pane preamble commit: persist the live TipTap JSON with the
  // caller-supplied .tex delimiters. `writeDocBundle` skips its disk
  // re-read for them, so the code pane's preamble edit — which lives only
  // in the bridge closure, never in the TipTap doc — reaches disk instead
  // of being resurrected-over by the stale on-disk preamble. Same
  // immediate-flush shape as `flushNow` (same handle, same "bundle" write
  // queue — ordered against autosaves); subsequent autosaves then re-read
  // the NEW preamble from disk naturally. Runs only on a discrete code-pane
  // flush that changed the delimiters, never on the keystroke path.
  //
  // AUTOSAVE-CLOBBER GUARD: while an external change is unresolved, skip
  // the write like every other save path (re-arm the debounce so the dirty
  // flag stays true) — but STASH the delimiters in `pendingDelimitersRef`
  // first. The bridge already consumed its own pendingPersist before
  // calling us, so this call's argument is the ONLY copy of the user's
  // preamble edit; without the stash it would be permanently lost on the
  // Dismiss / "Keep my version" resolution (the re-armed debounce would
  // save WITHOUT delimiters and writeDocBundle would re-read the stale
  // on-disk preamble, while the pane keeps displaying the edit). Resolving
  // via Reload instead resyncs the pane from disk (disk wins, by design) —
  // that path clears the stash (refetch + the delimiters-changed event).
  const saveWithDelimiters = useCallback(
    (delimiters: { preamble: string; postamble: string }) => {
      if (shouldPauseAutosave(watcherRef.current)) {
        pendingDelimitersRef.current = delimiters;
        debouncedSave();
        return;
      }
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        // Editor gone (pane-teardown race) — keep the payload so a terminal
        // flush (unmount cleanup / pagehide), which saves from the content
        // ref, still carries it instead of silently dropping the edit.
        pendingDelimitersRef.current = delimiters;
        return;
      }
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // The argument is strictly fresher than any earlier stash (the bridge
      // re-extracts the FULL delimiters from the current pane text, so a
      // prior swallowed edit is already folded in) — supersede it.
      pendingDelimitersRef.current = null;
      const doc = editor.getJSON();
      latestContentRef.current = doc;
      void save(doc, { delimiters });
    },
    [save, debouncedSave],
  );

  // CHIP-C: immediate doc-bundle flush requested on a drop-mode re-anchor
  // COMMIT (the single mouseup in `controller.finishApply`). RC3: a card can
  // re-anchor onto a paragraph that ALREADY carries a UUID — `ensureAnchorUuid`
  // early-returns without a mint tx, so the anchor-mint flush above never
  // fires and the paragraph's `%!v:<uuid>` may not have reached the `.tex`.
  // Reload then re-mints the paragraph a fresh UUID and the card orphans. This
  // entry decouples `.tex` durability from whether a MINT happened: on every
  // successful re-anchor commit it persists the live doc (carrying the target
  // UUID) on the card's fast clock via the SAME `flushNow` → `save` →
  // `writeDocBundle` path the anchor-mint signal uses, so the `.tex` + sidecar
  // never reload-split.
  //
  // COALESCING (no double-flush): a commit that ALSO minted already flushed via
  // `flushNow` during the drag's hit-test (`hit-test.ts` mints on pointermove,
  // tagging the tx so `onUpdate` flushes). The `applyDrop` sidecar write does
  // NOT touch the editor doc, so by the time this runs `editor.getJSON()` still
  // equals `lastSavedRef.current` (what the mint flush just persisted) → we
  // skip the redundant second write. When NO mint happened but the existing
  // UUID was not yet in the persisted bundle, the live doc differs from the
  // last save → we flush, closing the RC3 gap.
  //
  // KEYSTROKE SANCTITY: invoked ONLY from `finishApply` (a discrete mouseup
  // commit), NEVER on the typing path and NEVER per pointermove. The
  // `JSON.stringify` dedupe is O(doc) but runs once per commit, off the
  // keystroke path — no new `editor.on` / bus subscriber is added.
  // The `_paragraphId` arg matches the `DropCtx.requestAnchorFlush` contract
  // (the controller passes the re-anchored paragraph's UUID) so the wiring is a
  // direct reference, not a wrapper. It is unused here: the flush persists the
  // WHOLE bundle, which already carries that paragraph's `%!v:<uuid>`.
  const flushAnchorCommit = useCallback((_paragraphId?: string) => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    // Coalesce with any mint-flush this gesture already armed: nothing new to
    // persist since the last save → no-op (dedupes the double-flush).
    // Perf Wave 1 (S3): with the pipeline mounted, both the last save and
    // this read use the SAME identity-stable shared docJson, so the dedupe
    // is an O(1) reference compare instead of two O(doc) stringifies.
    const products = getDocProducts(editor);
    if (products) {
      const doc = products.ensureFresh().docJson;
      if (doc !== null && doc === lastSavedRef.current) return;
    } else {
      const doc = editor.getJSON();
      if (
        lastSavedRef.current !== null &&
        JSON.stringify(doc) === JSON.stringify(lastSavedRef.current)
      ) {
        return;
      }
    }
    // AUTOSAVE-CLOBBER GUARD: inherited from `flushNow`, which re-arms the
    // debounce (instead of writing) while an external change is unresolved — so
    // the re-anchor commit is retried after the user resolves the change.
    flushNow();
  }, [flushNow]);

  // Called by TipTap's `onUpdate` (via the EditorPane wrapper) on every
  // docChanged transaction. Per-keystroke cost is O(1): capture the editor
  // reference + reset the debounce timer. No serialization, no React state
  // change — the per-keystroke React render storm through EditorPane is gone.
  //
  // `tx` is TipTap's update-event transaction. We arm the normal debounce, then
  // — STRICTLY for a genuine anchor-UUID mint transaction (tagged via
  // `markAnchorMint`) — force an immediate flush. KEYSTROKE SANCTITY: a plain
  // keystroke carries no mint meta, so `isAnchorMintTransaction` is false and
  // the flush NEVER fires; only the cheap debounce-reset runs (the same O(1) as
  // before this gate existed).
  const onUpdate = useCallback(
    (editor: Editor, tx?: Transaction) => {
      editorRef.current = editor;
      // Task 357: the write-side gate steps aside once the user has GENUINELY
      // edited — the 350-D rationale ("their typing is their document") applied
      // at the boundary it actually names. `isRealUserEdit` is an UNDOABLE
      // docChanged test, never a bare `docChanged`: an anchor mint is
      // doc-changing too, and keying on that would re-open the very hole the
      // gate closes. O(1) per transaction — two field reads, no doc walk.
      if (isRealUserEdit(tx)) noteUserEdit(docId);
      debouncedSave();
      if (isAnchorMintTransaction(tx)) flushNow();
    },
    [debouncedSave, flushNow, docId],
  );

  // Returns the load promise so the external-change Reload path can await
  // the refetch settling (it dispatches the code pane's delimiters-changed
  // event only AFTER the reload completes — see disk-watcher.tsx).
  const refetch = useCallback((): Promise<void> => {
    setLoading(true);
    // Reload = disk wins: a stashed pause-swallowed delimiters payload must
    // not survive to clobber the freshly reloaded preamble.
    pendingDelimitersRef.current = null;
    return readDocBundle(docId)
      .then((bundle) => {
        setContent(bundle.content);
        lastSavedRef.current = bundle.content;
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [docId]);

  // Register `refetch` with the external-change watcher so the topbar badge can
  // drive "Reload from disk" via the context's `reloadFromDisk()` without
  // coupling to EditorPane. MIRRORS the `registerUnsavedGetter` effect above:
  // set ONCE per mount (keyed on the stable `registerReload` + `refetch`
  // identities), never per keystroke, and adds NO editor.on subscriber.
  // `useDiskWatcherOrNull` keeps useDocument working with no provider (tests).
  const registerReload = diskWatcherCtx?.registerReload;
  useEffect(() => {
    if (!registerReload) return;
    const unregister = registerReload(docId, refetch);
    return unregister;
  }, [registerReload, docId, refetch]);

  // Whenever the .tex delimiters change AUTHORITATIVELY out of band (style
  // switch, external-change Reload, compile documentclass-switch — the
  // paths that dispatch tex-delimiters-changed after writing disk), drop
  // any stale pause-swallowed stash: replaying it on the next save would
  // silently revert the preamble those paths just wrote. The open code
  // pane re-reads disk on the same event, so the user's view resyncs too.
  // Set ONCE per mount; O(1) per event, never on the keystroke path.
  useEffect(() => {
    const onDelimitersChanged = (e: Event) => {
      const detail = (e as CustomEvent<TexDelimitersChangedDetail>).detail;
      if (!detail || detail.docId !== docId) return;
      pendingDelimitersRef.current = null;
    };
    window.addEventListener(TEX_DELIMITERS_CHANGED_EVENT, onDelimitersChanged);
    return () => {
      window.removeEventListener(
        TEX_DELIMITERS_CHANGED_EVENT,
        onDelimitersChanged,
      );
    };
  }, [docId]);

  return {
    content,
    loading,
    onUpdate,
    saveNow: save,
    saveStatus,
    refetch,
    // CHIP-C: commit-flush entry for the drop-mode re-anchor mouseup. Routes
    // through the same `flushNow` → `save` → `writeDocBundle` path the
    // anchor-mint signal uses, with a coalescing guard (see `flushAnchorCommit`).
    flushAnchorCommit,
    // Code-pane preamble commit — see `saveWithDelimiters` above. Bubbled to
    // the shell via PaneState so EditorLayout can hand it to CodeEditor.
    saveWithDelimiters,
  };
}
