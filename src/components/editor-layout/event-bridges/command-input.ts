import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { EditorHandle } from "../../Editor";
import { generateShortId } from "@/lib/uuid";

type CitationMode = "anchored" | "unanchored";

/**
 * Command-input bridges — editor input rules dispatch these when the user
 * types a bare LaTeX command, to complete the command inline.
 *
 * As a class, slash commands create their thing inline (atom/block + cursor
 * placement) and do NOT hard-open a dedicated panel (backlog #2).
 *
 * - `virgil-citation-create` ({ partial, citationId }) — bare `\cite`
 *   inserts the citation atom and routes the new card into OMNI-VIEW
 *   (`createCitation({ mode: "omni" })` in citations-host). The soft route
 *   here only surfaces omni when the citations side is collapsed/blank; it
 *   never clobbers a panel the user already has covering omni.
 * - `virgil-ref-create` — bare `\ref` opens the LabelRef popover in
 *   create mode anchored at the current cursor (inline; no panel).
 * - `virgil-ex-create` — bare `\ex` inserts a single-part example block
 *   at the cursor and selects it (so an already-open Examples panel can
 *   scroll to it); it does NOT open the panel.
 * - `virgil-footnote-input` — bare `\footnote` inserts an empty footnote
 *   node at cursor, selects it, and broadcasts `virgil-footnote-created`
 *   so an already-open panel can scroll-to-new; it does NOT open the panel.
 */
export function useCommandInputBridges(deps: {
  editorRef: RefObject<EditorHandle | null>;
  prefsRef: MutableRefObject<ViewPrefs>;
  setActiveLeft: (id: PanelId) => void;
  setActiveRight: (id: PanelId) => void;
  setPendingCitationMode: Dispatch<SetStateAction<CitationMode>>;
  setPendingCitationCreate: Dispatch<SetStateAction<string | null>>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editorRef,
    prefsRef,
    setActiveLeft,
    setActiveRight,
    setPendingCitationMode,
    setPendingCitationCreate,
    setActiveRefLabel,
    setActiveRefRect,
    setSelectedFootnoteId,
    setSelectedExampleId,
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { partial?: string; citationId?: string }
        | undefined;
      if (!detail?.partial) return;
      // Slash commands don't hard-open their dedicated panel (backlog #2).
      // `\cite` is the nuance: the new card still needs a completion
      // surface, so we route it into OMNI-VIEW rather than the Citations
      // panel. Soft route — mirror `ensureOmniActiveForPanel` (the
      // drag-handle path): only surface omni if the citations side is
      // currently collapsed or blank. If the user has another panel up on
      // that side (covering omni), we leave it — the card lands + selects
      // in omni and reveals itself when the user next views it, instead of
      // clobbering whatever panel they have open. `citations-host` does the
      // select + pin + library-picker via `createCitation({ mode: "omni" })`.
      const p = prefsRef.current;
      const citPlacement = p.placements.find((pl) => pl.id === "citations");
      const side = citPlacement?.side ?? "right";
      const active = side === "left" ? p.activeLeft : p.activeRight;
      if (active == null || active === "blank") {
        if (side === "left") setActiveLeft("omni");
        else setActiveRight("omni");
      }
      if (!detail.citationId) {
        // Legacy path: no inline atom — open a panel-only draft card.
        // (When `citationId` IS present, the atom is already in the
        // editor; CitationsHost has its own listener that routes the
        // event through `cardCreation.createCitation` so the card lands
        // in the panel with the same pin / focus behavior as the
        // drag-handle "Citation" action.)
        setPendingCitationMode("anchored");
        setPendingCitationCreate(detail.partial);
      }
    };
    window.addEventListener("virgil-citation-create", handler);
    return () => window.removeEventListener("virgil-citation-create", handler);
  }, [prefsRef, setActiveLeft, setActiveRight, setPendingCitationMode, setPendingCitationCreate]);

  useEffect(() => {
    const handler = () => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const { from } = editor.state.selection;
      const coords = editor.view.coordsAtPos(from);
      const rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      setActiveRefLabel("");
      setActiveRefRect(rect);
    };
    window.addEventListener("virgil-ref-create", handler);
    return () => window.removeEventListener("virgil-ref-create", handler);
  }, [editorRef, setActiveRefLabel, setActiveRefRect]);

  useEffect(() => {
    const handler = () => {
      const result = editorRef.current?.insertExample("single");
      if (!result) return;
      // Slash commands create their thing inline and do NOT activate any
      // panel (backlog #2). We still select the new example so that if the
      // Examples panel happens to be open it scrolls to it; we never open it.
      setSelectedExampleId(result.exampleId);
    };
    window.addEventListener("virgil-ex-create", handler);
    return () => window.removeEventListener("virgil-ex-create", handler);
  }, [editorRef, setSelectedExampleId]);

  useEffect(() => {
    const handler = () => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const existing = new Set<string>();
      editor.state.doc.descendants((n) => {
        if (n.type.name === "footnote" && n.attrs.footnoteId) {
          existing.add(n.attrs.footnoteId as string);
        }
        return true;
      });
      const footnoteId = generateShortId(existing);
      const content = { type: "doc", content: [{ type: "paragraph" }] };
      editor
        .chain()
        .focus()
        .insertContent({ type: "footnote", attrs: { footnoteId, content, number: 0 } })
        .run();
      editorRef.current?.renumberFootnotes();
      // Slash commands create their thing inline and do NOT activate any
      // panel (backlog #2). Select the new footnote (so an already-open
      // panel can scroll to it) but never open the Footnotes panel.
      setSelectedFootnoteId(footnoteId);
      window.dispatchEvent(
        new CustomEvent("virgil-footnote-created", { detail: { footnoteId, content } }),
      );
    };
    window.addEventListener("virgil-footnote-input", handler);
    return () => window.removeEventListener("virgil-footnote-input", handler);
  }, [editorRef, setSelectedFootnoteId]);
}
