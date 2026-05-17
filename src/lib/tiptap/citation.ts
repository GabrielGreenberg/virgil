import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { CITE_RE_FULL, CITE_RE_BARE } from "@/lib/cite-commands";
import { generateShortId } from "@/lib/uuid";

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
              // Bare citation command followed by space/enter
              const beforeSpace = textBefore.slice(0, -1);
              const match = beforeSpace.match(CITE_RE_BARE);
              if (match) {
                const partial = match[0];
                _pendingCitationCreate = partial;
                const start = from - partial.length;
                const tr = state.tr.delete(start, from);
                view.dispatch(tr);
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("virgil-citation-create", {
                      detail: { partial },
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
    const setCitationHTML = (el: HTMLElement, text: string) => {
      if (/<[ib]>/i.test(text)) {
        el.innerHTML = text.replace(/<\/?(?!\/?[ib]>)[^>]+>/gi, "");
      } else {
        el.textContent = text;
      }
    };
    return ({ node, getPos }) => {
      const dom = document.createElement("span");
      dom.className = "citation-node";
      dom.dataset.type = "citation";
      dom.dataset.citationId = node.attrs.citationId || "";
      dom.contentEditable = "false";
      setCitationHTML(dom, node.attrs.displayText || node.attrs.command || "");

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
        update(updatedNode: any) {
          if (updatedNode.type.name !== "citation") return false;
          dom.dataset.citationId = updatedNode.attrs.citationId || "";
          setCitationHTML(dom, updatedNode.attrs.displayText || updatedNode.attrs.command || "");
          return true;
        },
      };
    };
  },
});
