import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { CITE_RE_FULL, CITE_RE_BARE } from "@/lib/cite-commands";
import { generateShortId } from "@/lib/uuid";
import { refuseTypedInsertWhenReadOnly } from "./typed-latex-read-only-gate";
// CHIP 4a-ii: the PM→React bridge the typed-LaTeX input rules use to register
// the citation CARD (the atom is still inserted synchronously below). Replaces
// the `virgil-citation-create` CustomEvent. The FULL `\cite{key}` branch
// previously made NO card at all — this is the bug fix: both the full and the
// bare branch now land at the SAME registry `citation.run` as menu + slash.
import { getEditorActionsHandleFor } from "@/lib/actions/editor-actions-bridge";
// Task 061: the cross-surface applicability SSOT — the typed `\cite{}` input
// rule must honor the SAME curated per-kind action set the menus consult, so a
// citation atom can't land in a `titleField` / non-prose block where the
// curated set greys `citation` out. Resolved by the block kind at the caret.
import { blockKindAllowsAction } from "@/text-objects/text-object-registry";
// Task 232: structural DOM facets (`data-type` / `class`) come from the atom
// SSOT rather than hardcoded literals, so a NodeView rename can't drift from
// ATOM_REGISTRY. Pinned by atom-selectable-parity.test.ts.
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

const CITATION_ATOM = ATOM_REGISTRY.citation;

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
    return [{ tag: `span[data-type="${CITATION_ATOM.domType}"]` }];
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
        "data-type": CITATION_ATOM.domType,
        class: CITATION_ATOM.domClass,
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
            // CHIP 7b: uniform collab read-only gate. PM already suppresses
            // `handleTextInput` on a non-editable view, but guard explicitly so
            // the typed-`\cite{}` surface refuses uniformly with the other four
            // typed-LaTeX surfaces (math ×2, footnote, `% ` comment) via the
            // shared SSOT — no synchronous atom insert when the partner holds
            // the pen.
            if (refuseTypedInsertWhenReadOnly(view)) return false;
            // Only check on characters that could complete a citation pattern
            if (text !== "}" && text !== " " && text !== "\n") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);
            // Task 061: refuse the synchronous citation-atom insert when the
            // caret's containing block greys `citation` out (a `titleField` —
            // whose text round-trips into `\title{…}` and re-expands under
            // `\maketitle` — or any non-prose block). Covers BOTH the full
            // `\cite{key}` and bare `\cite ` branches (they share `$from`).
            if (!blockKindAllowsAction($from.parent.type.name, "citation")) {
              return false;
            }
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 120),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;

            if (text === "}") {
              // Full citation command ending with } (e.g. `\cite{key}`).
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
                const citationId = idGenerator(existing);
                // Insert the atom SYNCHRONOUSLY (lands even if React is
                // unmounted).
                const tr = state.tr.replaceWith(
                  start,
                  from + text.length,
                  nodeType.create({ citationId, command, displayText: "" }),
                );
                view.dispatch(tr);
                // BUG FIX (CHIP 4a-ii): typed `\cite{key}` previously made NO
                // card. Now register the panel card via the registry's
                // `citation.run` (surface "typed"), the SAME destination as
                // menu + slash. Keeps the FULL typed command on the card so
                // the card renders the keys instead of an empty `\cite{}`.
                getEditorActionsHandleFor(view)?.runAction("citation", {
                  surface: "typed",
                  payload: { citationId, command },
                });
                return true;
              }
            } else {
              // Bare citation command followed by space/enter — insert an
              // empty citation atom at the cursor so the resulting card is
              // anchored, then register the card + soft-route via the bridge.
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
                const command = `${partial}{}`;
                // Insert the atom SYNCHRONOUSLY (lands even if React is
                // unmounted).
                const tr = state.tr.replaceWith(
                  start,
                  from,
                  nodeType.create({ citationId, command, displayText: "" }),
                );
                view.dispatch(tr);
                // Register the panel card via the registry's `citation.run`
                // (surface "typed"). Replaces the retired
                // `virgil-citation-create` CustomEvent + its two listeners.
                getEditorActionsHandleFor(view)?.runAction("citation", {
                  surface: "typed",
                  payload: { citationId, command },
                });
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
    return ({ node, getPos }) => {
      const dom = document.createElement("span");
      dom.className = CITATION_ATOM.domClass;
      dom.dataset.type = CITATION_ATOM.domType;
      dom.dataset.citationId = node.attrs.citationId || "";
      dom.contentEditable = "false";
      dom.draggable = false; // see footnote.ts: keep the grab gesture's mousemove stream
      applyCitationContent(dom, node.attrs.displayText, node.attrs.command);

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
          applyCitationContent(dom, updatedNode.attrs.displayText, updatedNode.attrs.command);
          return true;
        },
      };
    };
  },
});
