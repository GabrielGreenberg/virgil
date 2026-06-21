"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { FootnotesState, FootnoteRef } from "@/lib/types";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { generateShortId } from "@/lib/uuid";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import type { PristineKindApi } from "./usePristineCardManager";

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

export function useFootnotes(
  docId: string | null,
  pristine?: PristineKindApi | null,
  resolveAnchor?: FootnoteAnchorResolver | null,
) {
  const [state, setState] = useState<FootnotesState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Pin the write handle to docId's active pipeline. Stale handles
  // are rejected by the storage layer (see doc-pipeline.ts).
  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!docId) { setState(EMPTY); return; }
    readSidecar<FootnotesState>(docId, "footnotes.json", EMPTY)
      .then((data) => {
        if (cancelled || !data.footnotes) return;
        // Migrate legacy footnotes that stored content as HTML strings.
        const migrated: FootnotesState = {
          footnotes: data.footnotes.map((f) => ({
            ...f,
            content: normalizeRichContent(f.content),
          })),
        };
        setState(migrated);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const persist = useCallback(
    async (s: FootnotesState) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, "footnotes.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save footnotes:", err);
      }
    },
    [handle],
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

  const updateFootnoteContent = useCallback((id: string, content: JSONContent) => {
    pristine?.markDirty(id);
    setState((prev) => {
      const next = {
        footnotes: prev.footnotes.map((f) =>
          f.id === id ? { ...f, content } : f
        ),
      };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist, pristine]);

  const deleteFootnote = useCallback((id: string) => {
    pristine?.markDirty(id);
    setState((prev) => {
      const next = { footnotes: prev.footnotes.filter((f) => f.id !== id) };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist, pristine]);

  /** Flip a footnote ref's archived (set-aside) flag. The caller (EditorPane's
   *  archive handler) additionally splices the `\footnote` atom out of the doc;
   *  the now-atomless ref survives `syncFromEditor` as an unanchored entry (the
   *  `archived` flag rides along on the preserved object), so the archived card
   *  keeps its content. Unarchive (archived=false) leaves it as a normal
   *  unanchored ref — the atom is NOT re-inserted. */
  const setArchived = useCallback((id: string, archived: boolean) => {
    pristine?.markDirty(id);
    setState((prev) => {
      const next = {
        footnotes: prev.footnotes.map((f) =>
          f.id === id ? { ...f, archived } : f,
        ),
      };
      stateRef.current = next;
      persist(next);
      return next;
    });
  }, [persist, pristine]);

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
    (id: string, value: boolean) => {
      pristine?.markDirty(id);
      const ref = stateRef.current.footnotes.find((f) => f.id === id);
      setState((prev) => {
        const next = {
          footnotes: prev.footnotes.map((f) =>
            f.id === id ? { ...f, aiRequest: value } : f,
          ),
        };
        stateRef.current = next;
        persist(next);
        return next;
      });
      const summary = ref
        ? richJsonToPlainText(normalizeRichContent(ref.content)).trim()
        : "";
      const anchor = resolveAnchor?.(id);
      void bridgeCardAiRequestFlag(docId, "footnote", id, value, {
        text: summary || "<footnote>",
        paragraphIds: anchor?.paragraphIds,
        selectedText: anchor?.selectedText,
      });
    },
    [persist, pristine, docId, resolveAnchor],
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
    };
    const next = { footnotes: [...stateRef.current.footnotes, newRef] };
    stateRef.current = next;
    setState(next);
    persist(next);
    return newRef.id;
  }, [persist]);

  const syncFromEditor = useCallback(
    (editorFootnotes: Array<{ footnoteId: string; content: JSONContent }>) => {
      const current = stateRef.current;
      const editorIds = new Set(editorFootnotes.map((f) => f.footnoteId));

      // Keep unanchored footnotes (in state but not in editor)
      const unanchored = current.footnotes.filter((f) => !editorIds.has(f.id));

      // Build list from editor footnotes (canonical for anchored)
      const anchored: FootnoteRef[] = editorFootnotes.map((ef) => {
        const existing = current.footnotes.find((f) => f.id === ef.footnoteId);
        return existing
          ? { ...existing, content: ef.content }
          : { id: ef.footnoteId, content: ef.content, createdAt: new Date().toISOString() };
      });

      const next = { footnotes: [...anchored, ...unanchored] };
      stateRef.current = next;
      setState(next);
      persist(next);
    },
    [persist]
  );

  return {
    footnoteRefs: state.footnotes,
    addFootnote,
    updateFootnoteContent,
    deleteFootnote,
    setArchived,
    setFootnoteAiRequest,
    cloneFootnote,
    syncFromEditor,
  };
}
