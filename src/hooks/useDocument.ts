"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { JSONContent, type Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { isAnchorMintTransaction } from "@/lib/anchor-mint-signal";
import { isRealUserEdit, noteUserEdit } from "@/lib/write-preservation";
import { isWriteProtected } from "@/lib/preservation-notice";
import { getDocProducts } from "@/lib/doc-products/pipeline";
import {
  readDocBundle,
  snapshotConflictSides,
  writeDocBundle,
} from "@/lib/storage";
import { isStalePipelineError } from "@/lib/multi-window/doc-pipeline";
import { useDocWriteHandle } from "@/components/editor-layout/DocPipeline";
import {
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";
import { useDiskWatcherOrNull } from "@/components/editor-layout/contexts/disk-watcher";
import { autosavePauseReason } from "@/lib/autosave-pause";
import {
  clearUnsavedWork,
  getUnsavedWork,
  hasUnlandedWork,
  noteSaveBlocked,
  noteSaveLanded,
  noteUnsavedEdit,
} from "@/lib/unsaved-work";
import {
  registerSaveDoor,
  type SaveAttemptOutcome,
} from "@/lib/save-request";
import {
  dropMirrorAfterLandedSave,
  useEmergencyMirror,
} from "@/hooks/useEmergencyMirror";
import {
  clearMirror,
  pruneExpiredMirrors,
  readMirror,
} from "@/lib/emergency-mirror";
import {
  clearRecoveryOffer,
  getRecoveryOffer,
  offerMirrorRecovery,
  registerRecoveryActions,
} from "@/lib/mirror-recovery";
import { hashContent } from "@/lib/disk-ledger";
import {
  TEX_DELIMITERS_CHANGED_EVENT,
  type TexDelimitersChangedDetail,
} from "@/lib/tex-delimiters-event";


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
  // (a null watcher never contributes a `conflict` pause). Only the
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

  /**
   * The LIVE editor model, or the last flushed snapshot when the editor is
   * gone. Both conflict ports need it, the emergency mirror ticks from it, and
   * none of them may invent its own source: archiving one model and writing
   * another would make the net a copy of something that never existed.
   *
   * Declared here (rather than beside its conflict-port consumers below)
   * because the mirror is mounted before `save`, so the ONE model source has
   * to precede both.
   */
  const currentModel = useCallback((): JSONContent | null => {
    const editor = editorRef.current;
    if (editor && !editor.isDestroyed) return editor.getJSON();
    return latestContentRef.current ?? lastSavedRef.current;
  }, []);

  // THE EMERGENCY MIRROR (task 391). While a write is refused, paused, or
  // erroring, this hook's memory is the only copy of the user's work — and
  // every door that drops it (a service-worker reload, a tab close, a crash)
  // stays armed. The mirror is the durable second copy; it is timer-driven,
  // adds no editor subscription, and writes nothing while saves are landing.
  const { ticker: mirrorTicker } = useEmergencyMirror({
    docId,
    getModel: currentModel,
  });
  // Read through a ref so the save closures (which run on the keystroke-adjacent
  // debounce) do not take the ticker as a dependency. Its identity is stable
  // per mount anyway; the ref keeps that from being load-bearing.
  const mirrorTickerRef = useRef(mirrorTicker);
  mirrorTickerRef.current = mirrorTicker;

  /**
   * **"Does this document hold work that is not on disk?"** — one predicate,
   * task 392.
   *
   * `saveTimerRef.current !== null` was the de-facto answer on every flush
   * path, and task 391 already recorded why it is unsound in BOTH directions:
   * the debounce callback nulls the handle BEFORE calling `save`, so a
   * REFUSED write leaves the document dirty with the flag already cleared.
   * `beforeunload` was migrated off it there; the other three paths
   * (`flushPending`, the unmount cleanup, `pagehide`) were not, so after a
   * standing refusal each of them early-returned as "nothing pending" — which
   * is exactly the state in which a flush matters most, and which made
   * `flushAllPendingDocs` (the reload door's first move) a no-op.
   *
   * The channel is the SSOT: an armed debounce OR unlanded work on the
   * channel. O(1) — two field reads, and it is never called from the typing
   * path.
   */
  const hasWorkToWrite = useCallback(
    () => saveTimerRef.current !== null || hasUnlandedWork(docId),
    [docId],
  );

  const save = useCallback(
    async (
      doc: JSONContent,
      opts?: {
        delimiters?: { preamble: string; postamble: string };
        /** Task 364 — this write IS the user's conflict decision; the
         *  automatic-write gate steps aside. See `writeDocBundle`. */
        userResolvedConflict?: boolean;
      },
    ) => {
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
          // Task 391: the refusal is also a fact about the USER'S WORK, not
          // only about the document. Publishing it here is what arms the
          // emergency mirror and what every reload door reads — the incident's
          // unload flushes all resolved exactly like this one and every guard
          // downstream read them as success.
          noteSaveBlocked(handle.docId, "preservation");
          return;
        }
        lastSavedRef.current = doc;
        // THIS is a landed write — the only thing that clears the dirty state
        // and drops the mirror. Never inferred from the absence of a throw.
        noteSaveLanded(handle.docId);
        dropMirrorAfterLandedSave(handle.docId, mirrorTickerRef.current);
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
          // A dropped write is unlanded work like any other (task 391). The
          // superseded arm is the benign one — a newer pipeline holds fresher
          // content — but neither leaves this model on disk, so neither may
          // report clean.
          noteSaveBlocked(handle.docId, "error");
          return;
        }
        console.error("Failed to save document:", err);
        noteSaveBlocked(handle.docId, "error");
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
    // save-silent-ok: nothing to write — no armed debounce and the channel
    // reports every edit landed. Writing here would re-send the last saved
    // model on every flush call.
    if (!hasWorkToWrite()) return;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const editor = editorRef.current;
    let pending: JSONContent | null;
    if (editor && !editor.isDestroyed) {
      pending = editor.getJSON();
    } else {
      // Deliberately NOT `?? lastSavedRef.current`: that ref holds the last
      // LANDED model, so writing it would resolve normally, publish
      // `noteSaveLanded`, and report a document clean whose pending edit was
      // never written — a false-clean, which is the one outcome every gate in
      // this file exists to prevent.
      pending = latestContentRef.current;
    }
    // save-silent-ok: no model exists to write — the editor is gone and no
    // snapshot was ever taken, so there is nothing this call could land.
    if (!pending) return;
    latestContentRef.current = null;
    await save(pending, takeDelimitersOpts());
  }, [save, takeDelimitersOpts, hasWorkToWrite]);

  // Load the doc on mount. The `<DocPipeline key={docId}>` ancestor
  // forces a full remount when the docId changes, so this effect runs
  // exactly once per (docId, mount) — no doc-switch race to handle here.
  // The `cancelled` flag is still load-bearing for StrictMode's
  // double-invoke and for unmount-during-load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    readDocBundle(docId)
      .then((bundle) => {
        if (cancelled) return;
        setContent(bundle.content);
        lastSavedRef.current = bundle.content;
        setLoading(false);
        // TASK 391 — a mirror is cleared by nothing but a landed write, so one
        // that survived to this open is work that never reached disk. Compare
        // it against what we just loaded and raise the offer if they differ.
        // Fire-and-forget: this must never delay the editor opening, and a
        // failed IndexedDB read is not a reason to hold a document hostage.
        void (async () => {
          const entry = await readMirror(docId);
          if (cancelled) return;
          if (!entry) {
            clearRecoveryOffer(docId);
            return;
          }
          if (entry.hash === hashContent(JSON.stringify(bundle.content))) {
            // The work reached disk by some other route (another window, a
            // later landed write). Nothing to recover; drop the debris.
            void clearMirror(docId);
            clearRecoveryOffer(docId);
            return;
          }
          offerMirrorRecovery(entry);
        })();
        // One sweep per session, on the same idle promise: a paper that is
        // never reopened must not leak its slot forever.
        void pruneExpiredMirrors();
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
  // change→conflict. Since task 392 that is `hasWorkToWrite` — the ONE
  // predicate — rather than the debounce handle: after a preservation refusal
  // the handle is null while the work is very much unlanded, and reporting
  // clean there would drop the watcher's severity from conflict back to
  // change, i.e. offer a one-click Reload over work the user has not saved.
  // This is set ONCE per mount (not per keystroke) and adds NO editor.on
  // subscriber — the watcher PULLS this getter on its wall-clock poll. The
  // getter reads a ref, so its identity never changes; the watcher's
  // hasUnsavedEdits closes over `unsavedRef.current()` in the provider.
  const registerUnsavedGetter = diskWatcherCtx?.registerUnsavedGetter;
  useEffect(() => {
    if (!registerUnsavedGetter) return;
    const unregister = registerUnsavedGetter(docId, hasWorkToWrite);
    return unregister;
  }, [registerUnsavedGetter, docId, hasWorkToWrite]);

  // Flush pending edits on unmount. With the DocPipeline `key={docId}`
  // boundary, unmount IS the doc-switch event — the cleanup closes over
  // this mount's save closure (and its handle), so any pending edit
  // lands in the correct doc's files. Storage's queued task uses the
  // lenient `assertNotSuperseded` check, so a write that races the
  // pipeline-end cleanup is allowed through if no newer pipeline took
  // over.
  useEffect(() => {
    return () => {
      // save-silent-ok: nothing pending — the channel reports every edit
      // landed and no debounce is armed, so the last save captured everything.
      if (!hasWorkToWrite()) return;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
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
      // save-silent-ok: no model to write (see `flushPending`). The forced
      // mirror tick in the sibling cleanup below is what covers this document.
      if (pending) void save(pending, takeDelimitersOpts());
    };
  }, [save, takeDelimitersOpts, hasWorkToWrite]);

  // Task 391 — the doc is leaving memory. Take a final forced mirror tick (the
  // flush above is fire-and-forget and may be refused), then stop reporting
  // this document as memory-at-risk: from here the durable record is the
  // MIRROR, and the recovery offer on the next open is what surfaces it. A
  // channel entry that outlived its editor would make every app-wide reload
  // door answer for work nothing can flush.
  useEffect(() => {
    return () => {
      const ticker = mirrorTickerRef.current;
      if (ticker && hasUnlandedWork(docId)) void ticker.tick({ force: true });
      clearUnsavedWork(docId);
    };
  }, [docId]);

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
      // save-silent-ok: nothing pending — see `flushPending`.
      if (!hasWorkToWrite()) return;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // Pagehide fires before component unmount, so the editor is
      // still alive here. Prefer the live snapshot.
      const editor = editorRef.current;
      let pending: JSONContent | null;
      if (editor && !editor.isDestroyed) {
        pending = editor.getJSON();
      } else {
        pending = latestContentRef.current;
      }
      // save-silent-ok: no model to write (see `flushPending`).
      if (pending) {
        latestContentRef.current = null;
        void save(pending, takeDelimitersOpts());
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // TASK 391 — the predicate is the CHANNEL, not the debounce handle.
      // `saveTimerRef.current !== null` is unsound in both directions for this
      // question: the debounce callback nulls it BEFORE calling `save`, so a
      // REFUSED write leaves the document dirty with the flag already cleared
      // — the exact state (a standing preservation refusal, a paused conflict
      // whose re-arm has just fired) in which a reload is most expensive and
      // this prompt went silent. `hasUnlandedWork` is cleared by nothing but a
      // write that actually landed.
      // save-silent-ok: nothing pending — the ONE predicate, shared with
      // every other flush path since task 392.
      if (!hasWorkToWrite()) return;
      // Do NOT disarm the debounce. This handler runs on a leave the user can
      // still CANCEL, and the pre-391 code cleared the timer unconditionally —
      // so choosing "Stay" left the document dirty with no retry armed until
      // the next keystroke. The duplicate write this risks is a no-op:
      // `writeDocBundle`'s byte-equality gate skips an unchanged bundle
      // outright.
      const editor = editorRef.current;
      const pending = editor && !editor.isDestroyed
        ? editor.getJSON()
        : latestContentRef.current;
      if (pending) void save(pending, takeDelimitersOpts());
      // The mirror makes the loss small; this prompt makes it CHOSEN. Both
      // matter: a native leave-confirmation is the only thing that can stop a
      // reload the user did not understand they were asking for.
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [save, takeDelimitersOpts, docId, hasWorkToWrite]);

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
      const paused = autosavePauseReason(watcherRef.current, docId);
      if (paused) {
        // Task 391: the pause is correct AND it means the user's work is
        // memory-only from here. Say so on the channel — that is what arms the
        // mirror and what stops a reload door opening quietly on top of it.
        // Task 489: the REASON comes from the door that decided to pause, so a
        // cowork hold can no longer be reported as a conflict.
        noteSaveBlocked(docId, paused);
        debouncedSaveRef.current();
        return;
      }
      saveTimerRef.current = null;
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        // Task 392 — the debounce has just been disarmed and there is no
        // model to write, so this edit has no retry left on this path. Say so
        // on the channel: the unmount flush below (or a manual Save) is what
        // clears it, and until one of them lands the work is memory-only.
        noteSaveBlocked(docId, "error");
        return;
      }
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
  }, [save, takeDelimitersOpts, docId]);
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
    const paused = autosavePauseReason(watcherRef.current, docId);
    if (paused) {
      noteSaveBlocked(docId, paused);
      debouncedSave();
      return;
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) {
      // Task 392 — same as the debounce timer's arm: the flush was requested,
      // the debounce is disarmed, and nothing was written.
      noteSaveBlocked(docId, "error");
      return;
    }
    // Perf Wave 1 (S3): shared pipeline snapshot when mounted (see
    // debouncedSave) — a mint flush during a drag no longer pays a full
    // deep copy, and writeDocBundle's byte-equality gate makes a
    // no-change flush skip the disk tail entirely.
    const doc =
      getDocProducts(editor)?.ensureFresh().docJson ?? editor.getJSON();
    latestContentRef.current = doc;
    void save(doc, takeDelimitersOpts());
  }, [save, debouncedSave, takeDelimitersOpts, docId]);

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
      const paused = autosavePauseReason(watcherRef.current, docId);
      if (paused) {
        noteSaveBlocked(docId, paused);
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
        // Task 392 — the stash keeps the bytes; it does not put them on disk.
        // A preamble edit sitting in a ref is exactly the memory-only state
        // this channel exists to name.
        noteSaveBlocked(docId, "error");
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
    [save, debouncedSave, docId],
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
    if (!editor || editor.isDestroyed) {
      // Task 392 — a commit was asked for and nothing was written.
      noteSaveBlocked(docId, "error");
      return;
    }
    // Coalesce with any mint-flush this gesture already armed: nothing new to
    // persist since the last save → no-op (dedupes the double-flush).
    // Perf Wave 1 (S3): with the pipeline mounted, both the last save and
    // this read use the SAME identity-stable shared docJson, so the dedupe
    // is an O(1) reference compare instead of two O(doc) stringifies.
    const products = getDocProducts(editor);
    if (products) {
      const doc = products.ensureFresh().docJson;
      // save-silent-ok: byte-identical to the last LANDED write (lastSavedRef
      // advances only past the refusal check), so there is nothing to persist.
      if (doc !== null && doc === lastSavedRef.current) return;
    } else {
      const doc = editor.getJSON();
      // save-silent-ok: byte-identical to the last LANDED write — see above.
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
  }, [flushNow, docId]);

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
      if (isRealUserEdit(tx)) {
        noteUserEdit(docId);
        // Task 391: the SAME undoable-edit test arms the unsaved-work channel.
        // O(1) and edge-only — `noteUnsavedEdit` returns on its first field
        // read once the document is already dirty, so a typing burst notifies
        // its subscribers exactly once.
        noteUnsavedEdit(docId);
      }
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
        // …and NOW the unlanded-work state and its mirror may go (task 391).
        // The user has just chosen the disk copy over their own, and the
        // conflict door archived their side to `virgil/.history/` before this
        // ran, so the work is preserved WHERE THEY CHOSE — keeping a mirror
        // alive would offer to restore, on the next open, exactly the version
        // they discarded.
        //
        // TASK 392: this runs AFTER the read resolves, not before it. Dropping
        // the channel entry and the mirror up front meant a FAILED reload — a
        // permission lapse, a vanished file — left the document with no dirty
        // state and no emergency copy, having replaced the user's work with
        // nothing. The disk only wins once it has actually answered.
        clearUnsavedWork(docId);
        dropMirrorAfterLandedSave(docId, mirrorTickerRef.current);
      })
      .catch((err) => {
        console.error("Failed to reload document:", err);
        setLoading(false);
        // The reload did not happen, so whatever was unlanded still is — and
        // the surfaces must keep saying so rather than going quiet on a read
        // nobody heard fail.
        noteSaveBlocked(docId, "error");
      });
  }, [docId]);

  /**
   * "Keep my version" (task 364) — write the live model over the externally
   * changed disk bytes, NOW, as the user's explicit decision.
   *
   * Three things make this different from every other save path here, and all
   * three are the decision rather than a shortcut. It does not consult
   * `autosavePauseReason`: the clobber guard exists to stop an AUTOMATIC write
   * from overwriting an external change, and this write is the user answering
   * that exact question (the resolution has also already re-baselined the
   * watcher, so the guard is down by the time this runs). It passes
   * `userResolvedConflict`, so the 357 write gate steps aside — the conflict
   * net is unconditional and has already been taken, so an informed decision
   * cannot silently cost the missing bytes. And it cancels the pending debounce
   * rather than riding it, because a resolution the user watched happen must
   * not land 1500 ms later.
   */
  const keepMineOverDisk = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const doc = currentModel();
    // save-silent-ok: reported by RETURN — `false` reaches the conflict door,
    // which tells the user their version was not kept.
    if (!doc) return false;
    latestContentRef.current = doc;
    await save(doc, { ...takeDelimitersOpts(), userResolvedConflict: true });
    // Task 391 — REPORT whether it landed, read off the one channel rather
    // than inferred from the absence of a throw. `userResolvedConflict` steps
    // the 357 write gate aside but not the SERIALIZE gate, and the write can
    // fail outright; either way the door must not report the user's version
    // "kept" while it sits in memory alone.
    return !hasUnlandedWork(docId);
  }, [currentModel, save, takeDelimitersOpts, docId]);

  /**
   * TASK 391 — restore the emergency mirror over the file on disk.
   *
   * The recovered value is a MODEL, so it goes back in the way any model does:
   * through `writeDocBundle`, which runs the serializer gate and (once the
   * user has said yes) writes, and then through `refetch`, so the editor shows
   * what actually landed rather than what we hoped would. Three properties
   * make this safe to offer as a one-click action:
   *
   * - **The net is unconditional and comes FIRST.** `snapshotConflictSides`
   *   archives the disk side under its real names AND the model being restored
   *   as `unsaved-<tex>`, into one `virgil/.history/` slot. So the answer is
   *   reversible whichever way the user goes, and "view it first" is a folder
   *   away — which is why the badge can offer restore/discard without a
   *   preview surface it does not have.
   * - **`userResolvedConflict` is the same claim task 364 makes**: the 357
   *   write gate measures AUTOMATIC writes, and this is the user answering the
   *   question that gate exists to ask. The SERIALIZE gate is not bypassed and
   *   must not be — a model that cannot be written produces no bytes at all.
   * - **The report is the permission.** A restore that did not land leaves the
   *   mirror in place and the offer standing, so the badge cannot claim a
   *   recovery that never happened.
   */
  const restoreFromMirror = useCallback(async (): Promise<boolean> => {
    const offer = getRecoveryOffer(docId);
    // save-silent-ok: reported by RETURN — the badge keeps its offer standing.
    if (!offer) return false;
    const recovered = offer.entry.content;
    // THE NET, FIRST — both sides, before anything is overwritten.
    await snapshotConflictSides(handle, recovered);
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await save(recovered, { userResolvedConflict: true });
    // save-silent-ok: reported by RETURN, off the channel the gate published
    // to — the badge keeps its offer standing and the mirror survives.
    if (isWriteProtected(docId)) return false; // refused — keep the mirror
    await refetch();
    void clearMirror(docId);
    clearRecoveryOffer(docId);
    return true;
  }, [docId, handle, save, refetch]);

  /** Keep what is on disk. The mirror's content is NOT archived here: the disk
   *  copy is the one the user chose and the mirrored one is being declined —
   *  and unlike the restore path there is nothing about to be overwritten, so
   *  there is no net to take. */
  const discardMirror = useCallback(async (): Promise<void> => {
    await clearMirror(docId);
    clearRecoveryOffer(docId);
  }, [docId]);

  useEffect(
    () =>
      registerRecoveryActions(docId, {
        restore: restoreFromMirror,
        discard: discardMirror,
      }),
    [docId, restoreFromMirror, discardMirror],
  );

  /**
   * **"Save now"** — the manual door (task 392), published to
   * `save-request.ts` so the topbar button and the app-level Cmd+S can reach
   * it from outside this subtree.
   *
   * Three rules, and each is the incident rather than a preference:
   *
   * - **It respects the clobber guard.** The 364 pause lives in
   *   `debouncedSave` / `flushNow`, not in `save`, so a manual write that went
   *   straight to `writeDocBundle` would overwrite the external change the
   *   guard exists to protect. A Save button that quietly does the one thing
   *   every automatic path refuses to do is worse than no button. It reports
   *   `conflict` instead, and the caller ROUTES to the flow that owns that
   *   decision.
   * - **The report is the CHANNEL.** A refused write resolves normally, so
   *   landing is read off `unsaved-work` after the attempt — never inferred
   *   from the absence of a throw. This is the whole reason the surgical
   *   version of this feature (a button wired to `flushPending`) would have
   *   reported "saved" throughout the seventy minutes it was meant to catch.
   * - **It writes even when the debounce is not armed.** After a refusal the
   *   handle is null and the work is unlanded; "nothing pending" is exactly
   *   the wrong answer to a user asking for their work to be saved.
   */
  const saveNowRequested = useCallback(async (): Promise<SaveAttemptOutcome> => {
    const paused = autosavePauseReason(watcherRef.current, docId);
    if (paused) {
      noteSaveBlocked(docId, paused);
      return { landed: false, reason: paused };
    }
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const doc = currentModel();
    if (doc) {
      latestContentRef.current = null;
      await save(doc, takeDelimitersOpts());
    }
    // No model at all (no editor, nothing ever snapshotted) falls through to
    // the same question every other path asks: does the channel still hold
    // work? A document with nothing to write and nothing outstanding IS saved.
    if (!hasUnlandedWork(docId)) return { landed: true };
    return {
      landed: false,
      reason: getUnsavedWork(docId)?.reason ?? "error",
    };
  }, [docId, currentModel, save, takeDelimitersOpts]);

  useEffect(
    () => registerSaveDoor(docId, saveNowRequested),
    [docId, saveNowRequested],
  );

  /** The doc half of the conflict net: the storage backend can copy the DISK
   *  side on its own, but the editor's unsaved side lives only here. */
  const archiveConflictSides = useCallback(
    () => snapshotConflictSides(handle, currentModel()),
    [handle, currentModel],
  );

  // Register this doc's conflict-side actions with the external-change watcher
  // so the topbar badge can drive Reload / Keep-mine / the net via the context
  // without coupling to EditorPane. MIRRORS the `registerUnsavedGetter` effect
  // above: set ONCE per mount (keyed on stable identities), never per
  // keystroke, and adds NO editor.on subscriber. `useDiskWatcherOrNull` keeps
  // useDocument working with no provider (tests).
  const registerDocActions = diskWatcherCtx?.registerDocActions;
  useEffect(() => {
    if (!registerDocActions) return;
    const unregister = registerDocActions(docId, {
      reload: refetch,
      keepMine: keepMineOverDisk,
      archiveSides: archiveConflictSides,
    });
    return unregister;
  }, [
    registerDocActions,
    docId,
    refetch,
    keepMineOverDisk,
    archiveConflictSides,
  ]);

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
