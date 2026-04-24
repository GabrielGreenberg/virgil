import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";
import type { LabelInfo, RefCommand } from "../../LabelRefPopover";

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
          kind: "heading",
        });
      }
      if (nd.type.name === "exampleBlock") {
        const number = nd.attrs.number ? String(nd.attrs.number) : "?";
        const preview = exampleBlockPreview(nd);
        const parentTag = (nd.attrs.tag as string) || "";
        const parentLabel = (nd.attrs.label as string) || "";
        // Parent-level entries (tag and \label both resolve to the same
        // example number — expose whichever the user typed).
        if (parentTag) {
          result.push({
            label: parentTag,
            title: preview,
            sectionNumber: number,
            level: 0,
            kind: "example",
          });
        }
        if (parentLabel && parentLabel !== parentTag) {
          result.push({
            label: parentLabel,
            title: preview,
            sectionNumber: number,
            level: 0,
            kind: "example",
          });
        }
        // Sub-item entries: dotted form (parent.sub) → e.g. "3b".
        nd.descendants((child) => {
          if (child.type.name !== "exampleItem") return true;
          const sub = (child.attrs.subLabel as string) || "";
          if (!sub) return false;
          const childTag = (child.attrs.tag as string) || "";
          const childLabel = (child.attrs.label as string) || "";
          const parents = [parentTag, parentLabel].filter(Boolean);
          const subs = [childTag, childLabel].filter(Boolean);
          for (const p of parents) {
            for (const s of subs) {
              const dotted = `${p}.${s}`;
              if (!result.some((r) => r.label === dotted)) {
                result.push({
                  label: dotted,
                  title: preview,
                  sectionNumber: `${number}${sub}`,
                  level: 0,
                  kind: "example",
                });
              }
            }
          }
          return false;
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
          const refCommand = (nd.attrs.refCommand as RefCommand) || "ref";
          const { display, targetKind } = resolveLabelDisplay(
            editor.state.doc,
            newLabel,
            refCommand,
          );
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...nd.attrs,
            label: newLabel,
            displayText: display,
            targetKind,
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

  const handleRefChangeCommand = useCallback(
    (label: string, newCommand: RefCommand) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      editor.state.doc.descendants((nd, pos) => {
        if (nd.type.name === "labelRef" && nd.attrs.label === label) {
          const { display, targetKind } = resolveLabelDisplay(
            editor.state.doc,
            label,
            newCommand,
          );
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
            ...nd.attrs,
            refCommand: newCommand,
            displayText: display,
            targetKind,
          });
          editor.view.dispatch(tr);
          return false;
        }
        return true;
      });
    },
    [editorRef],
  );

  const handleRefJump = useCallback(
    (label: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      let targetPos = -1;
      // Try heading first
      editor.state.doc.descendants((nd, pos) => {
        if (nd.type.name === "heading" && nd.attrs.label === label) {
          targetPos = pos + 1;
          return false;
        }
        return true;
      });
      if (targetPos < 0) {
        // Example match — tag or \label on a block, or a sub-item.
        editor.state.doc.descendants((nd, pos) => {
          if (nd.type.name !== "exampleBlock") return true;
          const parentTag = (nd.attrs.tag as string) || "";
          const parentLabel = (nd.attrs.label as string) || "";
          if (label === parentTag || label === parentLabel) {
            targetPos = pos + 1;
            return false;
          }
          // Dotted parent.sub
          const dot = label.lastIndexOf(".");
          if (dot > 0) {
            const p = label.slice(0, dot);
            const s = label.slice(dot + 1);
            if (p === parentTag || p === parentLabel) {
              let itemPos = -1;
              nd.descendants((child, rel) => {
                if (child.type.name !== "exampleItem") return true;
                const childTag = (child.attrs.tag as string) || "";
                const childLabel = (child.attrs.label as string) || "";
                if (s === childTag || s === childLabel) {
                  itemPos = pos + 1 + rel + 1;
                  return false;
                }
                return true;
              });
              if (itemPos >= 0) {
                targetPos = itemPos;
                return false;
              }
            }
          }
          return true;
        });
      }
      if (targetPos >= 0) {
        editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
      }
    },
    [editorRef],
  );

  const handleInsertRef = useCallback(
    (newLabel: string, refCommand: RefCommand = "ref") => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const { display, targetKind } = resolveLabelDisplay(
        editor.state.doc,
        newLabel,
        refCommand,
      );
      editor.chain().focus().insertContent({
        type: "labelRef",
        attrs: { label: newLabel, displayText: display, refCommand, targetKind },
      }).run();
    },
    [editorRef],
  );

  return {
    gatherLabels,
    handleRefChangeLabel,
    handleRefChangeCommand,
    handleRefJump,
    handleInsertRef,
  };
}

// --- helpers -----------------------------------------------------------

function exampleBlockPreview(node: import("@tiptap/pm/model").Node): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText && child.text) {
      text += child.text;
      return text.length < 80;
    }
    return true;
  });
  return (text.trim() || "(empty example)").slice(0, 80);
}

function resolveLabelDisplay(
  doc: import("@tiptap/pm/model").Node,
  label: string,
  refCommand: RefCommand,
): { display: string; targetKind: "heading" | "example" | null } {
  if (!label) return { display: "??", targetKind: null };
  // Heading scan
  let headingNum: string | null = null;
  doc.descendants((nd) => {
    if (
      nd.type.name === "heading" &&
      nd.attrs.label === label &&
      nd.attrs.sectionNumber
    ) {
      headingNum = nd.attrs.sectionNumber as string;
      return false;
    }
    return true;
  });
  if (headingNum) {
    return {
      display: refCommand === "ref" ? headingNum : `(${headingNum})`,
      targetKind: "heading",
    };
  }
  // Example scan
  let exactNum: string | null = null;
  let dottedNum: string | null = null;
  doc.descendants((nd) => {
    if (nd.type.name !== "exampleBlock") return true;
    const parentTag = (nd.attrs.tag as string) || "";
    const parentLabel = (nd.attrs.label as string) || "";
    const numAttr = nd.attrs.number ? String(nd.attrs.number) : "";
    if (!numAttr) return true;
    if (label === parentTag || label === parentLabel) {
      exactNum = numAttr;
      return false;
    }
    const dot = label.lastIndexOf(".");
    if (dot > 0) {
      const p = label.slice(0, dot);
      const s = label.slice(dot + 1);
      if (p === parentTag || p === parentLabel) {
        nd.descendants((child) => {
          if (child.type.name !== "exampleItem") return true;
          const childTag = (child.attrs.tag as string) || "";
          const childLabel = (child.attrs.label as string) || "";
          if (s === childTag || s === childLabel) {
            dottedNum = `${numAttr}${child.attrs.subLabel || s}`;
            return false;
          }
          return true;
        });
      }
    }
    return true;
  });
  const num = exactNum || dottedNum;
  if (num) {
    return {
      display: refCommand === "ref" ? num : `(${num})`,
      targetKind: "example",
    };
  }
  return { display: "??", targetKind: null };
}
