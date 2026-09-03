import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorHandle } from "../../Editor";
import type { LabelInfo } from "../../LabelRefPopover";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { collectExampleBodyLabelsPM } from "@/lib/example-refs";
import {
  buildRefTargetIndexPM,
  resolveLabelDisplay,
  resolveRefTarget,
  type RefCommand,
} from "@/lib/ref-display";
import type { ActiveRef, RefNodeIdentity } from "@/lib/tiptap/label";

// Indexed by heading level 0..6 (Part..Subparagraph).
const HEADING_TYPE_NAMES = ["Part", "Chapter", "Section", "Subsection", "Subsubsection", "Paragraph", "Subparagraph"];

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
 * every `\label{...}` site in the doc, re-pointing ONE chip at a different
 * target, jumping to a target, and inserting a new `\ref{label}`.
 *
 * Two rules the handlers hold (task 550):
 *
 *   • A re-point addresses the chip by IDENTITY (`RefNodeIdentity`: the
 *     owning editor + `pos`), never by label — a label is not unique, and the
 *     pre-550 handlers walked the doc and rewrote the FIRST chip naming the
 *     old key, so re-pointing the second `\ref{sec:intro}` silently changed
 *     the first. The identity is re-checked at commit (`nodeAt(pos)` must
 *     still be a `labelRef` naming that label); a mismatch REFUSES rather than
 *     falling back to a label search (the task-285 rule).
 *   • Every NUMBER shown or written here — the popover's badges, a chip's
 *     `displayText` on insert / re-point, the jump target — is read off the
 *     one `RefTargetIndex` (`@/lib/ref-display`) the parser and the numberer
 *     read. This file resolves nothing of its own.
 *
 * Labels the index does NOT number (inside equation / table environments, or
 * stray `\label{...}` sites in raw text) are still surfaced from the text
 * scan, so authors can at least pick them by key.
 */
export function useRefActions(deps: {
  editorRef: RefObject<EditorHandle | null>;
  setActiveRef: Dispatch<SetStateAction<ActiveRef | null>>;
}) {
  const { editorRef, setActiveRef } = deps;

  const gatherLabels = useCallback((): LabelInfo[] => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return [];
    // ONE index for every number the badges show — headings, examples,
    // figures — built once per gather (the popover is open; user-paced).
    const index = buildRefTargetIndexPM(editor.state.doc);
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
        const typeName = HEADING_TYPE_NAMES[Math.max(0, Math.min(level, 6))];
        const secNum = index.targets.get(nd.attrs.label as string)?.number || "?";
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
        // Sub-item entries: surface both the flat form (matching expex's
        // `\label{foo}` inside `\a` → "3a") and the Virgil dotted form
        // (parent.sub) for backwards-compat. Recurses through nested
        // exampleItemList wrappers (xlist tiers).
        nd.descendants((child) => {
          if (child.type.name !== "exampleItem") return true;
          const sub = (child.attrs.subLabel as string) || "";
          if (!sub) return true;
          const childTag = (child.attrs.tag as string) || "";
          const childLabel = (child.attrs.label as string) || "";
          // Flat: \label{foo} on a sub-item is its own ref target.
          for (const s of [childTag, childLabel].filter(Boolean)) {
            pushUnique({
              label: s,
              kind: "example",
              typeLabel: `Example (${number}${sub})`,
              title: preview,
            });
          }
          // Dotted: parent.sub form (Virgil-specific shorthand).
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
          // Continue recursing — nested item lists carry more items.
          return true;
        });
        // Body-line `\label{…}` (shared SSOT): surface as an Example target
        // with its number BEFORE the generic text-node scan below dedups it to
        // a bare "Label". Parent-bound → (N), item-bound → (N+sub).
        for (const bl of collectExampleBodyLabelsPM(nd)) {
          const fullNum = bl.subLabel == null ? number : `${number}${bl.subLabel}`;
          pushUnique({
            label: bl.key,
            kind: "example",
            typeLabel: `Example (${fullNum})`,
            title: preview,
          });
        }
        return true;
      }

      // A modelled figure declares its label on the node. Its number is the
      // index's (a caption-less float takes none — task 319 — and then lists
      // as a bare "Figure"). The caption text is still scanned below, so a
      // label declared INSIDE the caption (task 318) is reached either way.
      if (nd.type.name === "figureBlock") {
        const label = (nd.attrs.label as string) || "";
        if (label) {
          const num = index.targets.get(label);
          pushUnique({
            label,
            kind: "figure",
            typeLabel: num ? `Figure ${num.number}` : "Figure",
            title: (nd.firstChild?.textContent ?? "").trim().slice(0, 80),
          });
        }
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

  /**
   * The doc the NUMBER is read from: MAIN, where the referenced heading /
   * example / figure lives. The chip itself may sit in a footnote or note
   * body (its own editor, its own pos-space) — that editor is where the WRITE
   * goes; a card body owns no declarations, so resolving against it would
   * always yield "??". Falls back to the owning editor's doc with no main.
   */
  const displayDocFor = useCallback(
    (owner: Editor) => editorRef.current?.getEditor()?.state.doc ?? owner.state.doc,
    [editorRef],
  );

  /**
   * Resolve a chip's identity against the LIVE document at commit time. The
   * popover is open across an async gap; if the doc moved and `pos` no longer
   * holds a `labelRef` naming `label`, the answer is REFUSE (`null`) — never
   * "the first chip with that label", which is the mis-address task 550 closed.
   */
  const locateRef = useCallback((target: RefNodeIdentity) => {
    const { editor, pos, label } = target;
    if (editor.isDestroyed) return null;
    const doc = editor.state.doc;
    if (pos < 0 || pos >= doc.content.size) return null;
    const node = doc.nodeAt(pos);
    if (!node || node.type.name !== "labelRef" || node.attrs.label !== label) return null;
    return node;
  }, []);

  /** Re-point ONE chip (by identity) at `newLabel`. Returns whether it did. */
  const handleRefChangeLabel = useCallback(
    (target: RefNodeIdentity | null, newLabel: string): boolean => {
      if (!target || !newLabel) return false;
      const node = locateRef(target);
      if (!node) return false;
      const { editor, pos } = target;
      const refCommand = (node.attrs.refCommand as RefCommand) || "ref";
      const { display, targetKind } = resolveLabelDisplay(
        displayDocFor(editor),
        newLabel,
        refCommand,
      );
      // label-write-exempt: re-points ONE `labelRef` atom — a REFERENCE, not a
      // declaration (task 553 census); the rename door governs the declaring
      // kinds in `LABEL_DECLARING_NODE_TYPES`, and `labelRef` is not one.
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          label: newLabel,
          displayText: display,
          targetKind,
        }),
      );
      // The popover stays on THIS chip, now showing its new target.
      setActiveRef((prev) =>
        prev && prev.editor === editor && prev.pos === pos ? { ...prev, label: newLabel } : prev,
      );
      return true;
    },
    [displayDocFor, locateRef, setActiveRef],
  );

  /** Flip ONE chip's command (`\ref` / `\getref` / `\getfullref`). */
  const handleRefChangeCommand = useCallback(
    (target: RefNodeIdentity | null, newCommand: RefCommand): boolean => {
      if (!target) return false;
      const node = locateRef(target);
      if (!node) return false;
      const { editor, pos, label } = target;
      const { display, targetKind } = resolveLabelDisplay(
        displayDocFor(editor),
        label,
        newCommand,
      );
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          refCommand: newCommand,
          displayText: display,
          targetKind,
        }),
      );
      setActiveRef((prev) =>
        prev && prev.editor === editor && prev.pos === pos
          ? { ...prev, refCommand: newCommand }
          : prev,
      );
      return true;
    },
    [displayDocFor, locateRef, setActiveRef],
  );

  const handleRefJump = useCallback(
    (label: string) => {
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      let targetPos = -1;
      const needle = `\\label{${label}}`;
      // A raw `\label{...}` declaration site (math source, a body-line label,
      // an unmodelled environment) is the most precise place to land, so it
      // is asked first; every NUMBERED target — heading / example / figure —
      // then comes off the shared index, which carries each declaring node's
      // position.
      editor.state.doc.descendants((nd, pos) => {
        if (targetPos >= 0) return false;
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
        const target = resolveRefTarget(buildRefTargetIndexPM(editor.state.doc), label);
        if (target && target.pos >= 0) targetPos = target.pos + 1;
      }
      if (targetPos >= 0) {
        editor.chain().focus().setTextSelection(targetPos).scrollIntoView().run();
      }
    },
    [editorRef],
  );

  const handleInsertRef = useCallback(
    (
      newLabel: string,
      refCommand: RefCommand = "ref",
      at?: number,
      owner?: Editor | null,
    ) => {
      // Insert into the editor that OWNS the create — the footnote/card editor
      // whose pos-space the popover captured `at` in — falling back to MAIN
      // (CHIP 5; mirrors `handleMathSave(activeMath.editor, …)` and
      // `commitCitationCreate`). Edit-mode / legacy callers pass no owner ⇒ MAIN.
      const mainEd = editorRef.current?.getEditor();
      // An explicitly-threaded owner that has since been DESTROYED (the footnote
      // card closed / scrolled away while the deferred-commit popover stayed
      // open) leaves `at` stranded in that editor's pos-space — silently
      // retargeting to MAIN would insert at a bogus main position. Abort. A
      // null/undefined owner is a MAIN create (`at` is main-space / caret).
      if (owner && owner.isDestroyed) return;
      const editor = owner ?? mainEd;
      if (!editor) return;
      // Resolve the ref's display number from the MAIN doc, where the referenced
      // doc-level label (heading / figure / example) actually lives — a footnote
      // body owns no headings/examples, so resolving against the owner's doc
      // would always yield "??" for a footnote-nested `\ref`. The atom still
      // INSERTS into `editor` (the footnote body); only the number lookup reads
      // MAIN. Falls back to the owner's doc when MAIN is unavailable.
      const displaySource = (mainEd ?? editor).state.doc;
      const { display, targetKind } = resolveLabelDisplay(
        displaySource,
        newLabel,
        refCommand,
      );
      // No scroll: `labelRef` is an inline atom — inserting one must never jump
      // the viewport (insertInlineAtom invariant). `at` is the position the
      // create popover captured at trigger time (the shared create controller),
      // so the atom lands there even if the live selection drifted; omitted ⇒
      // insert at the current caret (the edit-mode / legacy path).
      insertInlineAtom({
        editor,
        type: "labelRef",
        attrs: { label: newLabel, displayText: display, refCommand, targetKind },
        at,
      });
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
