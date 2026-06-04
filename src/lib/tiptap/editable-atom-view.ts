import { NodeSelection } from "@tiptap/pm/state";

/**
 * Helper: creates a seamless inline-editable node view.
 * Click to place cursor and start editing — no visual change.
 * The prefix (e.g. "% " or "$") is shown but not editable.
 */
export function editableAtomView({
  node,
  getPos,
  editor,
  tag,
  className,
  attrName,
  prefix,
  suffix,
  handleBar,
  surface = "main",
}: {
  node: any;
  getPos: any;
  editor: any;
  tag: "span" | "div";
  className: string;
  attrName: string;
  prefix?: string;
  suffix?: string;
  handleBar?: boolean;
  // Which editor surface this atom NodeView is mounted on. A float is a
  // single-node surface, so ProseMirror rests a NodeSelection on the lone atom
  // and fires selectNode() at rest — which would paint `.selected` chrome the
  // page never shows. Threaded from the node's `surface` option by the factory
  // (`.configure({ surface })`), mirroring math.ts. Default "main" so any stray
  // / non-factory usage behaves like the editable main surface.
  surface?: "main" | "float";
}) {
  const dom = document.createElement(tag);
  dom.className = className;
  dom.contentEditable = "false";

  // If handleBar is enabled, wrap content in a flex layout with a clickable bar
  let contentContainer: HTMLElement = dom;
  if (handleBar) {
    dom.style.display = "flex";
    dom.style.alignItems = "stretch";

    const bar = document.createElement("div");
    bar.className = `${className}-handle`;
    bar.contentEditable = "false";
    bar.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (pos != null && editor && editor.view) {
        const tr = editor.view.state.tr.setSelection(
          NodeSelection.create(editor.view.state.doc, pos)
        );
        editor.view.dispatch(tr);
        editor.view.focus();
      }
    });
    dom.appendChild(bar);

    contentContainer = document.createElement("div");
    contentContainer.className = `${className}-content`;
    contentContainer.style.flex = "1";
    contentContainer.style.minWidth = "0";
    dom.appendChild(contentContainer);
  }

  // Build: [prefix][editable-text][suffix]
  if (prefix) {
    const pre = document.createElement("span");
    pre.className = `${className}-prefix`;
    pre.textContent = prefix;
    pre.contentEditable = "false";
    contentContainer.appendChild(pre);
  }

  const textSpan = document.createElement("span");
  textSpan.className = `${className}-editable`;
  // Always ensure there's a text node (even if empty) so cursor placement works
  textSpan.appendChild(document.createTextNode(node.attrs[attrName] || ""));
  textSpan.contentEditable = "false";
  textSpan.style.outline = "none";
  contentContainer.appendChild(textSpan);

  if (suffix) {
    const suf = document.createElement("span");
    suf.className = `${className}-suffix`;
    suf.textContent = suffix;
    suf.contentEditable = "false";
    contentContainer.appendChild(suf);
  }

  let editing = false;

  const enterEditMode = (clientX?: number, clientY?: number) => {
    if (editing) return;
    editing = true;
    textSpan.contentEditable = "true";
    textSpan.focus();

    // Place cursor at click position or end
    try {
      let range: Range | null = null;
      if (clientX != null && clientY != null && document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      }
      if (range) {
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      } else {
        // Fallback: cursor at start of editable area (right after "% ")
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          const textNode = textSpan.firstChild || textSpan;
          r.setStart(textNode, textNode.textContent?.length || 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    } catch {
      // fallback
    }
  };

  dom.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterEditMode((e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  const commit = () => {
    if (!editing) return;
    editing = false;
    textSpan.contentEditable = "false";
    const newVal = textSpan.textContent || "";
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos != null && editor && editor.view) {
      editor.view.dispatch(
        editor.view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          [attrName]: newVal,
        })
      );
    }
  };

  textSpan.addEventListener("blur", commit);

  // Stop ALL key events from reaching TipTap/ProseMirror while editing
  const stopPropagation = (e: Event) => {
    if (editing) e.stopPropagation();
  };
  textSpan.addEventListener("keydown", (e) => {
    if (!editing) return;
    e.stopPropagation();
    const ke = e as KeyboardEvent;
    if (ke.key === "Enter" && !ke.shiftKey) {
      ke.preventDefault();
      textSpan.blur();
    }
    if (ke.key === "Escape") {
      textSpan.textContent = node.attrs[attrName] || "";
      editing = false;
      textSpan.contentEditable = "false";
    }
  });
  textSpan.addEventListener("keyup", stopPropagation);
  textSpan.addEventListener("keypress", stopPropagation);
  textSpan.addEventListener("input", stopPropagation);
  textSpan.addEventListener("beforeinput", stopPropagation);

  // Suppress the `.selected` chrome on the float surface only: an atom-only
  // float doc rests a NodeSelection on this lone atom, firing selectNode() at
  // rest, so the float embed would otherwise show a selection the page never
  // does (the L3h.1 surface gate, generalized to the selection chrome). The
  // MAIN surface keeps its selection chrome.
  const selectNode = () => { if (surface !== "float") dom.classList.add("selected"); };
  const deselectNode = () => { dom.classList.remove("selected"); };

  return { dom, enterEditMode, selectNode, deselectNode };
}
