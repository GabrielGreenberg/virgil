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
 *
 * ── EXAMPLE MIGRATED (CHIP 5c) ── `\ex` (slash) no longer rides a
 * `virgil-ex-create` CustomEvent + this listener, nor calls
 * `editorRef.insertExample`. The slash command (commands.ts) now registers
 * through the action-registry bridge (`runAction("example", …)` →
 * `exampleRun`), which owns the SAME wrap-if-selection-else-insert creator the
 * lightning grid `ex` cell calls AND the SAME backlog-#2 soft panel-select
 * (`panelRouting.selectExample` → `setSelectedExampleId`; surface the open
 * Examples panel's row, never force-open). So the example handler + its
 * `setSelectedExampleId` dep are gone from this hook.
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
}) {
  const {
    editorRef,
    setActiveRefLabel,
    setActiveRefRect,
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
}
