import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";
import type { LabelInfo } from "../../LabelRefPopover";

/**
 * Handlers behind the `\ref` popover: gathering label candidates from
 * all headings, rewriting a ref to point at a different heading, jumping
 * to a heading by label, and inserting a new `\ref{label}` at the
 * cursor. `handleRefChangeLabel` also flips the popover's active label
 * to the new value so the UI stays in sync with the document.
 */
export function useRefActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
}) {
  const { editorRef, setActiveRefLabel } = deps;

  const gatherLabels = useCallback((): LabelInfo[] => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return [];
    const result: LabelInfo[] = [];
    editor.state.doc.descendants((nd) => {
      if (nd.type.name === "heading" && nd.attrs.label) {
        const titleParts: string[] = [];
        nd.content.forEach((child) => {
          if (child.isText && child.text) titleParts.push(child.text);
        });
        result.push({
          label: nd.attrs.label,
          title: titleParts.join("") || "(untitled)",
          sectionNumber: nd.attrs.sectionNumber || "?",
          level: nd.attrs.level,
        });
      }
    });
    return result;
  }, [editorRef]);

  const handleRefChangeLabel = useCallback(
    (oldLabel: string, newLabel: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      editor.state.doc.descendants((nd, pos) => {
        if (nd.type.name === "labelRef" && nd.attrs.label === oldLabel) {
          let display = "??";
          editor.state.doc.descendants((h) => {
            if (h.type.name === "heading" && h.attrs.label === newLabel && h.attrs.sectionNumber) {
              display = h.attrs.sectionNumber;
            }
          });
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...nd.attrs,
            label: newLabel,
            displayText: display,
          });
          editor.view.dispatch(tr);
          return false;
        }
        return true;
      });
      setActiveRefLabel(newLabel);
    },
    [editorRef, setActiveRefLabel],
  );

  const handleRefJump = useCallback(
    (label: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      let targetPos = -1;
      editor.state.doc.descendants((nd, pos) => {
        if (nd.type.name === "heading" && nd.attrs.label === label) {
          targetPos = pos + 1;
          return false;
        }
        return true;
      });
      if (targetPos >= 0) {
        editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
      }
    },
    [editorRef],
  );

  const handleInsertRef = useCallback(
    (newLabel: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      let display = "??";
      editor.state.doc.descendants((h) => {
        if (h.type.name === "heading" && h.attrs.label === newLabel && h.attrs.sectionNumber) {
          display = h.attrs.sectionNumber;
        }
      });
      editor.chain().focus().insertContent({
        type: "labelRef",
        attrs: { label: newLabel, displayText: display },
      }).run();
    },
    [editorRef],
  );

  return { gatherLabels, handleRefChangeLabel, handleRefJump, handleInsertRef };
}
