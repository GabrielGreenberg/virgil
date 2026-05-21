import { Node, mergeAttributes } from "@tiptap/react";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { CITE_RE_FULL, CITE_RE_BARE } from "@/lib/cite-commands";
import { generateShortId } from "@/lib/uuid";

// Drag-paint state. Window-wide because the drag is a property of the cursor.
// We use mousemove (not mouseenter) because mouseenter doesn't fire reliably on
// contentEditable=false inline atoms during a native text-selection drag in
// Chromium/WebKit — and even when it does, the browser pairs it with phantom
// mouseleaves that wipe any paint immediately.
console.log("[citation drag-paint v2] loaded");
let _citationDragging = false;
let _citationPills: HTMLElement[] = [];
let _paintedPill: HTMLElement | null = null;

const clearAllCitationDragPaint = () => {
  document
    .querySelectorAll<HTMLElement>('.citation-node[data-text-drag-paint]')
    .forEach((el) => el.removeAttribute("data-text-drag-paint"));
  _paintedPill = null;
};

const updateCitationDragPaint = (cx: number, cy: number) => {
  let hit: HTMLElement | null = null;
  for (const pill of _citationPills) {
    const rects = pill.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
        hit = pill;
        break;
      }
    }
    if (hit) break;
  }
  if (hit === _paintedPill) return;
  _paintedPill?.removeAttribute("data-text-drag-paint");
  hit?.setAttribute("data-text-drag-paint", "true");
  _paintedPill = hit;
};

if (typeof window !== "undefined") {
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      _citationDragging = true;
      // Cache pill list at drag-start — pills don't appear or disappear during a drag.
      _citationPills = Array.from(
        document.querySelectorAll<HTMLElement>(".citation-node"),
      );
    },
    true,
  );
  window.addEventListener(
    "mousemove",
    (e) => {
      if (!_citationDragging) return;
      updateCitationDragPaint(e.clientX, e.clientY);
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    () => {
      if (!_citationDragging) return;
      _citationDragging = false;
      _citationPills = [];
      clearAllCitationDragPaint();
    },
    true,
  );
  window.addEventListener("blur", () => {
    _citationDragging = false;
    _citationPills = [];
    clearAllCitationDragPaint();
  });
}

// Build node decorations marking every citation that falls inside the
// current non-empty text selection. The citation nodeView's update()
// applies the resulting `data-text-selected` attribute to its DOM, which
// CSS then paints with the browser selection color. This is the fallback
// for ::selection not painting reliably on contentEditable="false" atoms
// in Chrome/Safari.
function buildCitationSelectionDecos(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  if (from === to) return DecorationSet.empty;
  const decos: Decoration[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "citation") {
      decos.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          { "data-text-selected": "true" },
          { isTextSelectionPaint: true },
        ),
      );
    }
  });
  // Return the singleton when there's nothing to paint so PM can short-
  // circuit decoration reconciliation by reference equality. Without this,
  // every drag-select mousemove over text that doesn't contain a citation
  // allocates a fresh empty DecorationSet, which PM still has to reconcile.
  if (decos.length === 0) return DecorationSet.empty;
  return DecorationSet.create(state.doc, decos);
}

// Flag: when a bare \cite is typed, signal the panel to open
let _pendingCitationCreate: string | null = null;

export function consumePendingCitationCreate(): string | null {
  const v = _pendingCitationCreate;
  _pendingCitationCreate = null;
  return v;
}

/** Used by the `\cite` Virgil command — see commands.ts. */
export function markPendingCitationCreate(partial: string): void {
  _pendingCitationCreate = partial;
}

// Citation regexes are defined in @/lib/cite-commands so the parser, the
// tiptap input rule, and the bib formatter all agree on the supported set.

// Options accepted by the Citation extension. `idGenerator` lets a host
// (e.g. the Library Reader) substitute a different ID strategy for newly
// created citations. Defaults to the 4-char hex generator with collision
// avoidance against the existing citation IDs in the document.
export interface CitationOptions {
  idGenerator: (existing: Set<string>) => string;
}

export const Citation = Node.create<CitationOptions>({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  // PM otherwise creates a NodeSelection on mousedown for inline atoms,
  // and that selection transaction defaults to `scrollIntoView: true`,
  // scrolling the row ~70px before our click handler can route to
  // alignOmniCardWithClick. `atom: true` keeps Backspace deletion working
  // as a single unit. Matches footnote.ts.
  selectable: false,

  addOptions() {
    return {
      idGenerator: (existing: Set<string>) => generateShortId(existing),
    };
  },

  addAttributes() {
    return {
      command: { default: "" },
      displayText: { default: "" },
      // citationId stays in JSON but doesn't render to HTML.
      citationId: { default: "", renderHTML: () => ({}) },
      linkId: { default: "", renderHTML: () => ({}) },
      linkKind: { default: "citation", renderHTML: () => ({}) },
      linkCard: { default: "", renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="citation"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const citationId =
      (node.attrs.linkId as string) ||
      (node.attrs.citationId as string) ||
      "";
    const linkCard =
      (node.attrs.linkCard as string) ||
      (citationId ? `citation:${citationId}` : "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "citation",
        class: "citation-node",
        "data-link-id": citationId,
        "data-link-kind": "citation",
        "data-link-card": linkCard,
      }),
      (node.attrs.displayText as string) || (node.attrs.command as string) || "",
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    const idGenerator = this.options.idGenerator;
    return [
      new Plugin({
        key: new PluginKey("citationClipboardText"),
        props: {
          // Plain-text clipboard: substitute citation atoms with their
          // displayText so copy-paste preserves the visible reference
          // (e.g. "Smith 2020") instead of dropping the atom entirely.
          // HTML clipboard already round-trips via renderHTML/parseHTML.
          clipboardTextSerializer(slice) {
            let out = "";
            let firstBlock = true;
            slice.content.descendants((node) => {
              if (node.type.name === "citation") {
                out +=
                  (node.attrs.displayText as string) ||
                  (node.attrs.command as string) ||
                  "";
                return false;
              }
              if (node.isText) {
                out += node.text ?? "";
                return false;
              }
              if (node.isBlock) {
                if (!firstBlock && !out.endsWith("\n")) out += "\n";
                firstBlock = false;
              }
              return true;
            });
            return out;
          },
        },
      }),
      new Plugin<DecorationSet>({
        key: new PluginKey("citationTextSelectionPaint"),
        state: {
          init: (_, state) => buildCitationSelectionDecos(state),
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.selectionSet) return old;
            // Per-keystroke fast path: a collapsed selection paints nothing.
            // Skip the build so typing transactions (where the selection
            // collapses to the caret) don't enter nodesBetween at all.
            // Reuse `old` when it's already empty so PM sees an unchanged
            // reference and skips decoration reconciliation entirely.
            if (newState.selection.from === newState.selection.to) {
              return old === DecorationSet.empty ? old : DecorationSet.empty;
            }
            const next = buildCitationSelectionDecos(newState);
            // Same reuse trick for the drag-select-over-text case:
            // when the range doesn't intersect any citation, the build
            // returns DecorationSet.empty. Keep the existing reference.
            if (next === DecorationSet.empty && old === DecorationSet.empty) {
              return old;
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      new Plugin({
        key: new PluginKey("citationInput"),
        props: {
          handleTextInput(view, from, to, text) {
            // Only check on characters that could complete a citation pattern
            if (text !== "}" && text !== " " && text !== "\n") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 120),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;

            if (text === "}") {
              // Full citation command ending with }
              const match = textBefore.match(CITE_RE_FULL);
              if (match) {
                const command = match[0];
                const start = from + text.length - command.length;
                const existing = new Set<string>();
                state.doc.descendants((node) => {
                  if (node.type.name === "citation" && node.attrs.citationId) {
                    existing.add(node.attrs.citationId as string);
                  }
                  return true;
                });
                const tr = state.tr.replaceWith(
                  start,
                  from + text.length,
                  nodeType.create({
                    citationId: idGenerator(existing),
                    command,
                    displayText: "",
                  })
                );
                view.dispatch(tr);
                return true;
              }
            } else {
              // Bare citation command followed by space/enter — insert an
              // empty citation atom at the cursor so the resulting card is
              // anchored, then signal the panel to open and select it.
              const beforeSpace = textBefore.slice(0, -1);
              const match = beforeSpace.match(CITE_RE_BARE);
              if (match) {
                const partial = match[0];
                const start = from - partial.length;
                const existing = new Set<string>();
                state.doc.descendants((node) => {
                  if (node.type.name === "citation" && node.attrs.citationId) {
                    existing.add(node.attrs.citationId as string);
                  }
                  return true;
                });
                const citationId = idGenerator(existing);
                const tr = state.tr.replaceWith(
                  start,
                  from,
                  nodeType.create({
                    citationId,
                    command: `${partial}{}`,
                    displayText: "",
                  }),
                );
                view.dispatch(tr);
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("virgil-citation-create", {
                      detail: { partial, citationId },
                    })
                  );
                }, 0);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },

  addNodeView() {
    // Display text may contain <i> tags (e.g. book titles from \citetitle).
    // Allow only safe inline formatting tags; strip everything else.
    const isEmptyCiteCommand = (command: string): boolean =>
      /^\\[A-Za-z]+\*?\{\s*\}$/.test(command || "");
    const applyCitationContent = (
      el: HTMLElement,
      displayText: string,
      command: string,
    ) => {
      const display = displayText || "";
      // Empty atom (e.g. `\cite{}` with no keys yet) — render a dotted
      // placeholder pill so the user sees the anchor even before picking
      // a key. Once the panel updates the command, this flips automatically.
      if (!display && isEmptyCiteCommand(command)) {
        el.textContent = "[cite]";
        el.setAttribute("data-empty", "true");
        return;
      }
      el.removeAttribute("data-empty");
      const text = display || command || "";
      if (/<[ib]>/i.test(text)) {
        el.innerHTML = text.replace(/<\/?(?!\/?[ib]>)[^>]+>/gi, "");
      } else {
        el.textContent = text;
      }
    };
    return ({ node, view, getPos }) => {
      const dom = document.createElement("span");
      dom.className = "citation-node";
      dom.dataset.type = "citation";
      dom.dataset.citationId = node.attrs.citationId || "";
      dom.contentEditable = "false";
      applyCitationContent(dom, node.attrs.displayText, node.attrs.command);

      // Smooth-drag-through is handled entirely by the window-level
      // mousemove handler at the top of this module — no per-pill listeners
      // are involved. We keep mouseup here only to force PM's TextSelection
      // to cover the atom when the user releases inside the pill, so
      // copy/paste sees the citation.
      const extendSelectionToCoverAtom = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const { state } = view;
        const sel = state.selection;
        if (!(sel instanceof TextSelection)) return;
        if (sel.empty) return;
        const atomFrom = pos;
        const atomTo = pos + node.nodeSize;
        if (sel.from <= atomFrom && sel.to >= atomTo) return;
        const anchor = sel.anchor;
        const head = anchor < atomFrom ? atomTo : atomFrom;
        view.dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, anchor, head)),
        );
      };
      dom.addEventListener("mouseup", () => {
        extendSelectionToCoverAtom();
      });

      dom.addEventListener("click", (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = dom.getBoundingClientRect();
        const panelAncestor = dom.closest(
          "[data-panel-side]",
        ) as HTMLElement | null;
        const clickedPos = typeof getPos === "function" ? getPos() : undefined;
        window.dispatchEvent(
          new CustomEvent("virgil-citation-click", {
            detail: {
              citationId: node.attrs.citationId,
              // Viewport Y of the clicked citation — used by the citations
              // panel to align the corresponding card vertically with the
              // click target.
              clickY: rect.top,
              // Doc position of THIS citation instance — used to override
              // the card's anchor when a later/repeated citation is clicked
              // so the card moves to align with the click rather than the
              // (often-distant) first citation.
              clickedPos,
              sourceSide: panelAncestor?.dataset.panelSide,
              sourcePanelId: panelAncestor?.dataset.panelId,
              sourceHalf: panelAncestor?.dataset.panelHalf,
            },
          })
        );
      });

      return {
        dom,
        update(updatedNode: any, decorations: readonly Decoration[]) {
          if (updatedNode.type.name !== "citation") return false;
          dom.dataset.citationId = updatedNode.attrs.citationId || "";
          applyCitationContent(dom, updatedNode.attrs.displayText, updatedNode.attrs.command);
          // Apply the text-selection paint attribute. The citationTextSelectionPaint
          // plugin emits a Decoration.node with spec.isTextSelectionPaint when this
          // citation falls inside a non-empty text selection.
          const inTextSelection = decorations.some(
            (d) =>
              (d.spec as { isTextSelectionPaint?: boolean } | undefined)
                ?.isTextSelectionPaint === true,
          );
          if (inTextSelection) dom.setAttribute("data-text-selected", "true");
          else dom.removeAttribute("data-text-selected");
          return true;
        },
      };
    };
  },
});
