import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../../Editor";
import type { LabelInfo, RefCommand } from "../../LabelRefPopover";

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
      }
      if (nd.type.name === "exampleBlock") {
        const number = nd.attrs.number ? String(nd.attrs.number) : "?";
        const preview = exampleBlockPreview(nd);
        const parentTag = (nd.attrs.tag as string) || "";
        const parentLabel = (nd.attrs.label as string) || "";
        // Parent-level entries (tag and \label both resolve to the same
        // example number — expose whichever the user typed).
        if (parentTag) {
          pushUnique({
            label: parentTag,
            kind: "example",
            typeLabel: `Example (${number})`,
            title: preview,
          });
        }
        if (parentLabel && parentLabel !== parentTag) {
          pushUnique({
            label: parentLabel,
            kind: "example",
            typeLabel: `Example (${number})`,
            title: preview,
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
              pushUnique({
                label: dotted,
                kind: "example",
                typeLabel: `Example (${number}${sub})`,
                title: preview,
              });
            }
          }
          return false;
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
      const needle = `\\label{${label}}`;
      // Try heading first, then math/raw `\label{...}`, then examples below.
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
