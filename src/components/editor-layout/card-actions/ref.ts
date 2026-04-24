import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";
import type { LabelInfo } from "../../LabelRefPopover";

const HEADING_TYPE_NAMES = ["Chapter", "Section", "Subsection", "Subsubsection"];

const LABEL_RE = /\\label\{([^}]+)\}/g;

/**
 * Classify a raw-latex blob containing a `\label{...}` by looking for
 * the enclosing environment. Returns the `LabelInfo` kind + badge to
 * show in the ref popover; falls back to a generic "Label" when no
 * recognized environment wraps the declaration.
 */
function classifyRawLatex(text: string): {
  kind: LabelInfo["kind"];
  typeLabel: string;
} {
  if (/\\begin\{figure\*?\}/.test(text)) return { kind: "figure", typeLabel: "Figure" };
  if (/\\begin\{table\*?\}/.test(text)) return { kind: "table", typeLabel: "Table" };
  if (
    /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}/.test(text)
  ) {
    return { kind: "equation", typeLabel: "Equation" };
  }
  return { kind: "label", typeLabel: "Label" };
}

/**
 * Collect every `\label{...}` occurrence from a raw-latex blob (figure
 * body, math source, stray command, etc.) into LabelInfo entries. A
 * single blob can declare several labels; each becomes its own entry.
 */
function extractLabelsFromRaw(text: string, fallbackKind: LabelInfo["kind"], fallbackTypeLabel: string): LabelInfo[] {
  const out: LabelInfo[] = [];
  const classified = classifyRawLatex(text);
  const kind = classified.kind === "label" ? fallbackKind : classified.kind;
  const typeLabel = classified.kind === "label" ? fallbackTypeLabel : classified.typeLabel;
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text)) !== null) {
    out.push({ label: m[1], kind, typeLabel, title: "" });
  }
  return out;
}

/**
 * Handlers behind the `\ref` popover: gathering label candidates from
 * every `\label{...}` site in the doc, rewriting a ref to point at a
 * different target, jumping to a heading target, and inserting a new
 * `\ref{label}` at the cursor. `handleRefChangeLabel` also flips the
 * popover's active label to the new value so the UI stays in sync with
 * the document.
 *
 * Non-heading labels (inside figure / equation / table environments, or
 * stray `\label{...}` sites) are surfaced even though Virgil can't
 * resolve the ref to a printed number yet — so authors can at least
 * pick them by key from the popover.
 */
export function useRefActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setActiveRefLabel: Dispatch<SetStateAction<string | null>>;
}) {
  const { editorRef, setActiveRefLabel } = deps;

  const gatherLabels = useCallback((): LabelInfo[] => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return [];
    const seen = new Set<string>();
    const result: LabelInfo[] = [];
    const pushUnique = (info: LabelInfo) => {
      if (!info.label || seen.has(info.label)) return;
      seen.add(info.label);
      result.push(info);
    };

    editor.state.doc.descendants((nd) => {
      // Headings own their label via the `label` attr (absorbed by
      // LabelHandler from a trailing `\label{...}` paragraph).
      if (nd.type.name === "heading" && nd.attrs.label) {
        const titleParts: string[] = [];
        nd.content.forEach((child) => {
          if (child.isText && child.text) titleParts.push(child.text);
        });
        const level = nd.attrs.level as number;
        const typeName = HEADING_TYPE_NAMES[Math.min(level - 1, 3)];
        const secNum = (nd.attrs.sectionNumber as string | null) || "?";
        pushUnique({
          label: nd.attrs.label,
          kind: "heading",
          typeLabel: `${typeName} ${secNum}`,
          title: titleParts.join("") || "(untitled)",
        });
        return true;
      }

      // Display-math atoms carry the raw math as an attr.
      if (nd.type.name === "displayMath") {
        const src = (nd.attrs.latex as string | undefined) ?? "";
        if (src.includes("\\label{")) {
          for (const info of extractLabelsFromRaw(src, "equation", "Equation")) {
            pushUnique(info);
          }
        }
        return true;
      }

      // Text nodes pick up `\label{...}` that lives inside raw-tex
      // paragraphs (figure/table/unknown environments, or stray
      // commands) as well as labels typed mid-prose.
      if (nd.isText && nd.text && nd.text.includes("\\label{")) {
        for (const info of extractLabelsFromRaw(nd.text, "label", "Label")) {
          pushUnique(info);
        }
      }
      return true;
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
      const needle = `\\label{${label}}`;
      editor.state.doc.descendants((nd, pos) => {
        if (targetPos >= 0) return false;
        if (nd.type.name === "heading" && nd.attrs.label === label) {
          targetPos = pos + 1;
          return false;
        }
        // Non-heading labels: jump to the \label{...} declaration site.
        if (nd.type.name === "displayMath") {
          const src = (nd.attrs.latex as string | undefined) ?? "";
          if (src.includes(needle)) {
            targetPos = pos;
            return false;
          }
        }
        if (nd.isText && nd.text && nd.text.includes(needle)) {
          targetPos = pos;
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
