import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { PanelId, ViewPrefs } from "@/hooks/useViewPrefs";
import type { EditorHandle } from "../../Editor";
import { generateShortId } from "@/lib/uuid";

type CitationMode = "anchored" | "unanchored";

/**
 * Command-input bridges — editor input rules dispatch these when the user
 * types a bare LaTeX command, to open the appropriate panel UI for
 * completing the command.
 *
 * - `virgil-citation-create` ({ partial }) — bare `\cite` triggers an
 *   anchored-mode create in the citations panel.
 * - `virgil-ref-create` — bare `\ref` opens the LabelRef popover in
 *   create mode anchored at the current cursor.
 * - `virgil-ex-create` — bare `\ex` inserts a single-part example block
 *   at the cursor, selects it in the Examples panel, and opens the
 *   panel on whichever side it's placed.
 * - `virgil-footnote-input` — bare `\footnote` inserts an empty footnote
 *   node at cursor, opens the panel, and broadcasts
 *   `virgil-footnote-created` so the panel can scroll-to-new.
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
      // Soft routing: only expand the citations side if it's collapsed
      // or blank. If the user already has omni mode (or any other panel)
      // active on that side, leave it. Mirrors the
      // `ensureOmniActiveForPanel` pattern used by the drag-handle path.
      const p = prefsRef.current;
      const citPlacement = p.placements.find((pl) => pl.id === "citations");
      const side = citPlacement?.side ?? "right";
      const active = side === "left" ? p.activeLeft : p.activeRight;
      if (active == null || active === "blank") {
        if (side === "left") setActiveLeft("citations");
        else setActiveRight("citations");
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
      setSelectedExampleId(result.exampleId);
      const p = prefsRef.current;
      const placement = p.placements.find((pl) => pl.id === "examples");
      if (placement?.side === "left") {
        if (p.activeLeft !== "examples") setActiveLeft("examples");
      } else {
        if (p.activeRight !== "examples") setActiveRight("examples");
      }
    };
    window.addEventListener("virgil-ex-create", handler);
    return () => window.removeEventListener("virgil-ex-create", handler);
  }, [editorRef, prefsRef, setActiveLeft, setActiveRight, setSelectedExampleId]);

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
      const p = prefsRef.current;
      const fnPlacement = p.placements.find((pl) => pl.id === "footnotes");
      if (fnPlacement?.side === "left") {
        if (p.activeLeft !== "footnotes") setActiveLeft("footnotes");
      } else {
        if (p.activeRight !== "footnotes") setActiveRight("footnotes");
      }
      setSelectedFootnoteId(footnoteId);
      window.dispatchEvent(
        new CustomEvent("virgil-footnote-created", { detail: { footnoteId, content } }),
      );
    };
    window.addEventListener("virgil-footnote-input", handler);
    return () => window.removeEventListener("virgil-footnote-input", handler);
  }, [editorRef, prefsRef, setActiveLeft, setActiveRight, setSelectedFootnoteId]);
}
