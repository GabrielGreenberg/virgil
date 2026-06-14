import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";

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
 *
 * ── CITATION MIGRATED (CHIP 4a-ii) ── `\cite` (slash + typed) no longer rides
 * a `virgil-citation-create` CustomEvent + this listener. The slash command
 * (commands.ts) and the typed input rules (citation.ts) now insert the atom
 * synchronously and register the card through the action-registry bridge
 * (`runAction("citation", …)` → `citation.run`), which owns the SAME
 * backlog-#2 soft-route (surface omni only when the citations side is
 * collapsed/blank) that used to live here. So the citation handler + its
 * prefs/setActive/pendingCitation deps are gone from this hook.
 *
 * ── FOOTNOTE MIGRATED (CHIP 4b) ── `\footnote` (slash + typed) no longer rides
 * the `virgil-footnote-input` CustomEvent + this listener, nor broadcasts the
 * DEAD `virgil-footnote-created` event (it had ZERO listeners). The slash
 * command (commands.ts) and the typed input rule (footnote.ts) now insert the
 * footnote atom synchronously and register the card through the action-registry
 * bridge (`runAction("footnote", …)` → `footnote.run`), which applies the SAME
 * pristine + pinned lifecycle the menu's Footnote gets and the SAME backlog-#2
 * soft-route. So the footnote handler + its `setSelectedFootnoteId` /
 * `generateShortId` deps are gone from this hook.
 */
export function useCommandInputBridges(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
  setActiveRefRect: Dispatch<SetStateAction<DOMRect | null>>;
  setSelectedExampleId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editorRef,
    setActiveRefLabel,
    setActiveRefRect,
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
}
