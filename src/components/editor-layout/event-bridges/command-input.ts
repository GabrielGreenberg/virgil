import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";
import { generateShortId } from "@/lib/uuid";

/**
 * Command-input bridges — editor input rules dispatch these when the user
 * types a bare LaTeX command, to complete the command inline.
 *
 * As a class, slash commands create their thing inline (atom/block + cursor
 * placement) and do NOT hard-open a dedicated panel (backlog #2).
 *
 * - `virgil-ref-create` — bare `\ref` opens the LabelRef popover in
 *   create mode anchored at the current cursor (inline; no panel).
 * - `virgil-ex-create` — bare `\ex` inserts a single-part example block
 *   at the cursor and selects it (so an already-open Examples panel can
 *   scroll to it); it does NOT open the panel.
 * - `virgil-footnote-input` — bare `\footnote` inserts an empty footnote
 *   node at cursor, selects it, and broadcasts `virgil-footnote-created`
 *   so an already-open panel can scroll-to-new; it does NOT open the panel.
 *
 * ── CITATION MIGRATED (CHIP 4a-ii) ── `\cite` (slash + typed) no longer rides
 * a `virgil-citation-create` CustomEvent + this listener. The slash command
 * (commands.ts) and the typed input rules (citation.ts) now insert the atom
 * synchronously and register the card through the action-registry bridge
 * (`runAction("citation", …)` → `citation.run`), which owns the SAME
 * backlog-#2 soft-route (surface omni only when the citations side is
 * collapsed/blank) that used to live here. So the citation handler + its
 * prefs/setActive/pendingCitation deps are gone from this hook.
 */
export function useCommandInputBridges(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setSelectedFootnoteId: Dispatch<SetStateAction<string | null>>;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editorRef,
    setActiveRefLabel,
    setActiveRefRect,
    setSelectedFootnoteId,
    setSelectedExampleId,
  } = deps;

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
