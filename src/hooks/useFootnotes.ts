"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { readSidecar } from "@/lib/storage";
import { writeSidecarMerged } from "@/lib/sidecar-merged-write";
import type { FootnotesState, FootnoteRef } from "@/lib/types";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { generateShortId } from "@/lib/uuid";
import {
  bridgeFlagForCard,
  type AiRequestSyncMode,
} from "@/lib/ai-request-bridge";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import type { PristineKindApi } from "./usePristineCardManager";
import type { PullSeed } from "@/lib/stack/pull-seed";

const EMPTY: FootnotesState = { footnotes: [] };

/** The anchor context a footnote AI-request needs to be *drainable*: which
 *  paragraph(s) the footnote's `\footnote` atom sits in (so the skill can splice
 *  / act at the right place) and the surrounding selected text, if any. Unlike a
 *  panel card (whose anchor lives in its `links[]` array), a footnote's anchor is
 *  only knowable from the live editor — its `\footnote` atom position resolved to
 *  the enclosing block's uuid. The hook has no editor, so the owner (EditorPane,
 *  which closes over the editor ref) supplies this resolver. Mirrors how
 *  note/highlight setters build ctx via `getLinkedTextObjectIds` — but sourced
 *  from the doc instead of the card, because that's where a footnote's anchor is. */
export type FootnoteAnchorResolver = (
  footnoteId: string,
) => { paragraphIds?: string[]; selectedText?: string };

/** The LIVE body of a footnote's `\footnote` atom, or null when the doc holds
 *  no such atom. The seed for the mirror's ONE upsert door (`ensureRef`, task
 *  703): a footnote made in the app (toolbar / slash) or parsed from the `.tex`
 *  has NO `footnotes.json` ref — only the stack-pull factory ever called
 *  `addFootnote` — so a setter that needs the ref must first capture it from
 *  the doc. Same owner-supplied shape as `FootnoteAnchorResolver` (EditorPane
 *  closes over the editor ref); called only on a gesture, never per keystroke. */
export type FootnoteBodyResolver = (footnoteId: string) => JSONContent | null;

export function useFootnotes(
  docId: string | null,
  pristine?: PristineKindApi | null,
  resolveAnchor?: FootnoteAnchorResolver | null,
  resolveBody?: FootnoteBodyResolver | null,
) {
  const [state, setState] = useState<FootnotesState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  // True once THIS doc's footnotes.json read has resolved. The upsert door
  // refuses before then: a ref minted over the pre-load EMPTY would persist a
  // one-entry file over the real sidecar (task 570's loss class). A FAILED read
  // leaves it false for the same reason — the collection is not authoritative.
  const loadedRef = useRef(false);
  // THE MERGE BASE (task 719) — what this hook last knew the file to hold (its
  // load, or its own last submitted payload). The third input the write needs
  // to stop being a rebuild: without it "absent from local" cannot be told
  // apart from "the user deleted it". Null until the read resolves, and null
  // forever on a read that threw, which degrades the merge to a union rather
  // than letting it guess at a deletion.
  const baselineRef = useRef<FootnotesState | null>(null);
  // The same fact, REACTIVE — the load edge a consumer keys an effect on (the
  // live-atom intent reconcile in EditorPane, task 704: a stale `archived` flag
  // persisted by an earlier session is only healable once the mirror is here).
  const [loaded, setLoaded] = useState(false);

  // Pin the write handle to docId's active pipeline. Stale handles
  // are rejected by the storage layer (see doc-pipeline.ts).
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    setLoaded(false);
    if (!docId) { setState(EMPTY); return; }
    readSidecar<FootnotesState>(docId, "footnotes.json", EMPTY)
      .then((data) => {
        if (cancelled) return;
        if (!data.footnotes) {
          // A readable file with no `footnotes` array is an empty mirror.
          loadedRef.current = true;
          setLoaded(true);
          return;
        }
        // Migrate legacy footnotes that stored content as HTML strings.
        const migrated: FootnotesState = {
          footnotes: data.footnotes.map((f) => ({
            ...f,
            content: normalizeRichContent(f.content),
          })),
        };
        stateRef.current = migrated;
        baselineRef.current = migrated;
        setState(migrated);
        loadedRef.current = true;
        setLoaded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const persist = useCallback(
    async (s: FootnotesState) => {
      if (!handle) return;
      // The ONE merged write door (task 719): a skill appending to
      // `footnotes.json` while the user has an unsaved body edit is no longer
      // overwritten by this whole snapshot. The base becomes the SUBMITTED
      // payload, never the merged result — re-basing to the union would make
      // the next write read the external record as "in base, absent from
      // local" and delete it.
      const base = baselineRef.current;
      try {
        await writeSidecarMerged(handle, "footnotes.json", base, s);
        baselineRef.current = s;
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save footnotes:", err);
      }
    },
    [handle],
  );

  /** THE mirror's upsert door (task 703). Returns the collection with a ref
   *  for `id` guaranteed present — the existing one, or a fresh one seeded from
   *  `seed` (a caller that already holds the body) or else the LIVE atom via
   *  `resolveBody` — or null when no ref exists and none can be captured (no
   *  atom, no resolver, or the sidecar has not loaded). Pure over `current`:
   *  the caller commits the result. Every setter that writes INTO a ref routes
   *  through here, so a footnote the sidecar has never seen is no longer a
   *  silent no-op for archive / AI-request / body-edit. */
  const withRef = useCallback(
    (
      current: FootnotesState,
      id: string,
      seed?: JSONContent,
    ): FootnotesState | null => {
      if (current.footnotes.some((f) => f.id === id)) return current;
      if (!loadedRef.current) return null;
      const body = seed ?? resolveBody?.(id) ?? null;
      if (!body) return null;
      const ref: FootnoteRef = {
        id,
        // Deep copy: never alias the live node's attr JSON (see `contentFor`).
        content: structuredClone(normalizeRichContent(body)),
        createdAt: new Date().toISOString(),
      };
      return { footnotes: [...current.footnotes, ref] };
    },
    [resolveBody],
  );

  /** Capture a footnote's live body into the mirror WITHOUT flipping any flag,
   *  returning whether the ref now exists. The archive door calls this BEFORE
   *  it splices the `\footnote` atom out (capture/schema symmetry: never delete
   *  what you cannot restore) — after the splice there is nothing left to
   *  capture from. Idempotent; writes only when it actually mints. */
  const ensureRef = useCallback(
    (id: string): boolean => {
      const current = stateRef.current;
      const next = withRef(current, id);
      if (!next) return false;
      if (next !== current) {
        stateRef.current = next;
        setState(next);
        persist(next);
      }
      return true;
    },
    [withRef, persist],
  );

  /** Commit `patch` onto `id`'s ref through the upsert door. Returns false
   *  (and writes nothing) when no ref exists and none could be captured. */
  const patchRef = useCallback(
    (id: string, patch: (f: FootnoteRef) => FootnoteRef, seed?: JSONContent): boolean => {
      const base = withRef(stateRef.current, id, seed);
      if (!base) return false;
      const next = {
        footnotes: base.footnotes.map((f) => (f.id === id ? patch(f) : f)),
      };
      stateRef.current = next;
      setState(next);
      persist(next);
      return true;
    },
    [withRef, persist],
  );

  const addFootnote = useCallback((content: JSONContent | string, existingId?: string): FootnoteRef => {
    const ref: FootnoteRef = {
      id: existingId || generateShortId(),
      content: normalizeRichContent(content),
      createdAt: new Date().toISOString(),
    };
    // Skip if already registered
    const current = stateRef.current;
    if (current.footnotes.some((f) => f.id === ref.id)) return ref;
    const next = { footnotes: [...current.footnotes, ref] };
    stateRef.current = next;
    setState(next);
    persist(next);
    return ref;
  }, [persist]);

  /** A stack pull's footnote door (task 705): the whole surviving record —
   *  `content` AND `title` — lands, never a hand-picked field. Mirrors
   *  `useNotes.addNoteFromSeed`: fresh identity wins over anything the seed
   *  carries (defence in depth behind `NON_TRAVELLING_FIELDS`).
   *
   *  It lands `unanchored` (task 754). A footnote's pull is `GAP_ONLY`
   *  (`CARD_PLACEMENTS`) and synthesizes no `\footnote` atom, so the record is
   *  ATOMLESS — and an atomless ref no list can see unless it declares that
   *  intent (`selectAtomlessFootnoteRefs`: `archived || unanchored`). Without
   *  the flag the pull saved the user's text to `footnotes.json` and showed it
   *  nowhere: not the panel, not Omni, not the float. Same decision as
   *  `useArchive.archiveFromSeed`'s born-free branch — THIS pull's placement
   *  decides it, never the source record (`unanchored` is non-travelling). */
  const addFootnoteFromSeed = useCallback((seed: PullSeed<"footnote">): FootnoteRef => {
    const ref: FootnoteRef = {
      ...seed,
      id: generateShortId(),
      content: normalizeRichContent(seed.content ?? ""),
      createdAt: new Date().toISOString(),
      unanchored: true,
    };
    if (!ref.title) delete ref.title;
    const next = { footnotes: [...stateRef.current.footnotes, ref] };
    stateRef.current = next;
    setState(next);
    persist(next);
    return ref;
  }, [persist]);

  /** Persist a renamed card title (task 705). The `.tex` cannot carry a
   *  footnote title, so this ref IS its persistent home; the caller
   *  (EditorPane's `handleEditFootnoteTitle`) also writes the live atom's attr.
   *  Through the upsert door, so a footnote the mirror has never seen gains its
   *  ref (seeded from the live atom) instead of dropping the rename. An empty
   *  title is stored as ABSENT, so "untitled" has one spelling. Returns whether
   *  the ref took the write. */
  const setFootnoteTitle = useCallback((id: string, title: string): boolean => {
    const kept = title.trim() ? title : "";
    const ok = patchRef(id, (f) => {
      const { title: _prev, ...rest } = f;
      return kept ? { ...rest, title: kept } : rest;
    });
    if (ok && kept) pristine?.markDirty(id);
    return ok;
  }, [patchRef, pristine]);

  /** Persist an edited footnote body into the sidecar mirror. The body's source
   *  of truth is the editor node (it serializes to the `.tex` `\footnote{}`);
   *  this keeps `footnotes.json`'s `content` coherent so consumers that read the
   *  ref — the AI-request inbox summary in `setFootnoteAiRequest`, plus any
   *  archived/unanchored ref that outlives its atom — don't show creation-time
   *  (often empty) text. Called from EditorPane's `handleEditFootnote`.
   *  Deliberately does NOT touch pristine state: a footnote stays
   *  click-away-discardable while its body is empty, and the caller already
   *  clears pristine — gated on `cardHasContent` — so marking dirty here
   *  (unconditionally, before the gate) would reintroduce the lingering-blank
   *  regression. (task_9768c44e) */
  const updateFootnoteContent = useCallback((id: string, content: JSONContent) => {
    // Upsert (task 703): the edited body IS the seed, so a footnote the mirror
    // has never seen gains its ref here rather than dropping the edit.
    patchRef(id, (f) => ({ ...f, content }), content);
  }, [patchRef]);

  const deleteFootnote = useCallback((id: string) => {
    pristine?.markDirty(id);
    setState((prev) => {
      const next = { footnotes: prev.footnotes.filter((f) => f.id !== id) };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist, pristine]);

  /** The card's live body, read by the footnote drop spec's "anchor the
   *  unanchored" create branch (`ctx.atomCards.footnote.atomAttrsFor`). An
   *  atomless ref — archived, or born unanchored from the panel "+" — has NO
   *  `\footnote` node anywhere, so the rebuilt atom's `content` attr can come
   *  from here and NOWHERE else: skipping this read is what silently destroyed
   *  the user's footnote text on a re-place (task 233). Normalized through the
   *  same `normalizeRichContent` the load migration and `cloneFootnote` use, so
   *  a legacy HTML-string body rebuilds as a proper doc. Reads `stateRef` for a
   *  stable identity (mirrors `useCitations.commandFor`).
   *
   *  DEEP-COPIED on the way out. `normalizeRichContent` returns its INPUT when
   *  the body is already a clean doc, so handing it straight to
   *  `footnoteNodeType.create({ content })` would leave the sidecar ref and the
   *  new ProseMirror node aliasing one mutable JSON tree — the exact footgun
   *  the footnote node's `content` attr defaults to `null` to avoid
   *  (footnote.ts). */
  const contentFor = useCallback(
    (id: string): JSONContent | null => {
      const ref = stateRef.current.footnotes.find((f) => f.id === id);
      return ref ? structuredClone(normalizeRichContent(ref.content)) : null;
    },
    [],
  );

  /** Reconcile a ref's own anchor intent once its `\footnote` atom is back in
   *  the prose (the drop spec's `onAnchored`). Clears BOTH flags, mirroring the
   *  citation twin's re-anchor rule: `setArchived(true)` sets `archived` +
   *  `unanchored` JOINTLY (archiving splices the atom out), so re-anchoring must
   *  un-set both — the footnote is a live in-text note again, neither archived
   *  nor a parked draft. Without this the sidecar keeps declaring `unanchored`
   *  and the panel lists the same footnote twice: live from the editor, and
   *  again as a stale atomless ref (task 233). Idempotent + no-write when
   *  neither flag is set, so an ordinary drop of an already-anchored card
   *  touches no sidecar. */
  const markAnchored = useCallback((id: string) => {
    const current = stateRef.current;
    const ref = current.footnotes.find((f) => f.id === id);
    if (!ref || (!ref.unanchored && !ref.archived)) return;
    const next = {
      footnotes: current.footnotes.map((f) =>
        f.id === id ? { ...f, unanchored: undefined, archived: undefined } : f,
      ),
    };
    stateRef.current = next;
    setState(next);
    persist(next);
  }, [persist]);

  /** Flip a footnote ref's archived (set-aside) flag. The caller (EditorPane's
   *  archive handler) additionally splices the `\footnote` atom out of the doc;
   *  the now-atomless ref stays in the sidecar as an unanchored entry (nothing
   *  reconciles `footnotes.json` against the editor's atoms — the panel's live
   *  rows come from `getFootnotes()`, and atomless refs are selected by the
   *  `unanchored` flag), so the archived card keeps its content. Unarchive (archived=false) leaves it as a normal
   *  unanchored ref — the atom is NOT re-inserted. */
  const setArchived = useCallback((id: string, archived: boolean): boolean => {
    pristine?.markDirty(id);
    // Archiving ALSO marks `unanchored` (mirror of useCitations.setArchived)
    // so the atomless ref is SELECTED as unanchored and the panel lists it
    // under Archives. Unarchive clears `archived` only — `unanchored` rides
    // on (the atom is NOT re-inserted; the card returns re-placeable).
    // Through the upsert door (task 703); returns whether the flag landed.
    return patchRef(id, (f) => ({
      ...f,
      archived,
      ...(archived ? { unanchored: true as const } : {}),
    }));
  }, [patchRef, pristine]);

  /** Flip a footnote ref's per-card AI-request flag (BUG #55) AND bridge the
   *  toggle into the unified `ai-requests.json` queue. Mirrors the note/todo/
   *  comment `setXAiRequest` callbacks: the flag is the panel UI's source of
   *  truth; the bridge keeps the skill-drain inbox in sync (best-effort, never
   *  throws). The bridged entry's `kind`/`linkPanel` come from CARD_REGISTRY
   *  (registry-declared routing, R29). `text` is a short plain-text summary of
   *  the footnote body so the request row is legible in the inbox.
   *
   *  CRITICAL (#55b): the bridged request must carry the footnote's anchoring
   *  `paragraphIds` (and any `selectedText`), or it files an UNACTIONABLE request
   *  — the drain skill halts when `paragraphIds` is empty. Unlike a panel card,
   *  a footnote's anchor isn't in the sidecar; it's the position of the
   *  `\footnote` atom in the live doc. The owner supplies that via
   *  `resolveAnchor` (EditorPane closes over the editor ref). This is the exact
   *  analogue of note/highlight threading `getLinkedTextObjectIds(card)` —
   *  sourced from the doc instead of the card, because that's where the anchor
   *  lives for an atom-bearing kind. */
  const setFootnoteAiRequest = useCallback(
    (id: string, value: boolean, mode: AiRequestSyncMode = "toggle") => {
      pristine?.markDirty(id);
      // Through the upsert door (task 703): a footnote with no mirror ref gains
      // one captured from its live atom, so the flag lands and the panel's
      // checkbox (derived from refs) reflects the filed request.
      patchRef(id, (f) => ({ ...f, aiRequest: value }));
      const ref = stateRef.current.footnotes.find((f) => f.id === id);
      // Card-MAY-BE-ABSENT (task 697). This hook never had the `if (ref)`
      // gate its five siblings had — it degraded the SUMMARY instead, which
      // is the shape the others were fixed INTO — so it routes through the
      // same door now, for one reason only: a seventh flag-bearing kind
      // added later cannot reintroduce the gate by copying a neighbour.
      // The anchor is sourced from the live DOC (`resolveAnchor`), not the
      // ref, so the degraded context keeps its paragraph ids.
      const anchor = resolveAnchor?.(id);
      bridgeFlagForCard(docId, "footnote", id, value, mode, ref, (found) => ({
        text:
          richJsonToPlainText(normalizeRichContent(found.content)).trim() ||
          "<footnote>",
        paragraphIds: anchor?.paragraphIds,
        selectedText: anchor?.selectedText,
      }));
    },
    [patchRef, pristine, docId, resolveAnchor],
  );

  /** Deep-copy a footnote sidecar entry with a fresh id. Returns the new
   *  id, or null if the source id wasn't found. Used by the drag-handle
   *  Duplicate action when a duplicated block contains a footnote atom. */
  const cloneFootnote = useCallback((sourceId: string): string | null => {
    const source = stateRef.current.footnotes.find((f) => f.id === sourceId);
    if (!source) return null;
    const newRef: FootnoteRef = {
      id: generateShortId(),
      content: normalizeRichContent(source.content),
      createdAt: new Date().toISOString(),
      // The title is the card's own writing (task 705) — a duplicate keeps it.
      ...(source.title ? { title: source.title } : {}),
    };
    const next = { footnotes: [...stateRef.current.footnotes, newRef] };
    stateRef.current = next;
    setState(next);
    persist(next);
    return newRef.id;
  }, [persist]);

  // There is deliberately NO `syncFromEditor` here (task 570). The footnote
  // panel's live rows are `getFootnotes()` off the editor node; this sidecar is
  // the MIRROR that outlives an atom (archived / unanchored refs, the aiRequest
  // flag, the edited body via `updateFootnoteContent`). The editor-derived
  // reconcile this hook used to export had no production caller since the
  // keystroke-sanctity work of 2026-05, and this hook has no `loaded` gate —
  // wired into a mount effect it would run over the pre-load EMPTY and write
  // the loss (the citations defect). A reconcile that writes a sidecar from
  // editor-derived inputs belongs on `usePersistentState.updateWhenLoaded`.

  return useMemo(
    () => ({
      footnoteRefs: state.footnotes,
      loaded,
      addFootnote,
      addFootnoteFromSeed,
      ensureRef,
      updateFootnoteContent,
      setFootnoteTitle,
      deleteFootnote,
      setArchived,
      setFootnoteAiRequest,
      cloneFootnote,
      contentFor,
      markAnchored,
    }),
    [
      state.footnotes,
      loaded,
      addFootnote,
      addFootnoteFromSeed,
      ensureRef,
      updateFootnoteContent,
      setFootnoteTitle,
      deleteFootnote,
      setArchived,
      setFootnoteAiRequest,
      cloneFootnote,
      contentFor,
      markAnchored,
    ],
  );
}
