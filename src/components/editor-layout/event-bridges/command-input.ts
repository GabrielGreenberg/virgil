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
  } = deps;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.partial) {
        setPendingCitationMode("anchored");
        setPendingCitationCreate(detail.partial);
        const p = prefsRef.current;
        const citPlacement = p.placements.find((pl) => pl.id === "citations");
        if (citPlacement?.side === "left") {
          if (p.activeLeft !== "citations") setActiveLeft("citations");
        } else {
          if (p.activeRight !== "citations") setActiveRight("citations");
        }
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
