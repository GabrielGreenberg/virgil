import { Node, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";
import { citationDisplay } from "./citation-display";
import { CITE_RE_BARE } from "@/lib/cite-commands";
// The FULL-form trigger is read from the typed-LaTeX census (task 639) — the
// same object `cite-commands` exports and the `citation` registry row records
// as its `inputRulePattern`. Reading it HERE is what makes the census live: the
// table the coverage assertion reconciles against is the table this rule
// matches with, not a description of it. (The bare `\cite ` soft-route stays on
// its own `CITE_RE_BARE`; the row records the canonical full form.)
import { TYPED_LATEX_INPUT_RULES } from "./typed-latex-input-rules";
import { generateShortId } from "@/lib/uuid";
// The link DOM contract + the `<cardKind>:<cardId>` grammar, from their one
// speller (task 202) — a hand-built `citation:${id}` here was a second copy.
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  DATA_LINK_KIND,
  linkCardKey,
} from "@/links/link-dom-contract";
import { collabReadOnly } from "./collab-read-only-gate";
import { setAttrIfChanged, setDataIfChanged } from "./idempotent-dom";
// CHIP 4a-ii: the PM→React bridge the typed-LaTeX input rules use to register
// the citation CARD (the atom is still inserted synchronously below). Replaces
// the `virgil-citation-create` CustomEvent. The FULL `\cite{key}` branch
// previously made NO card at all — this is the bug fix: both the full and the
// bare branch now land at the SAME registry `citation.run` as menu + slash.
import { runEditorAction } from "@/lib/actions/editor-actions-bridge";
// Task 061: the cross-surface applicability SSOT — the typed `\cite{}` input
// rule must honor the SAME curated per-kind action set the menus consult, so a
// citation atom can't land in a `titleField` / non-prose block where the
// curated set greys `citation` out. Resolved by the block kind at the caret.
import {
  posHostsInlineAtom,
} from "@/text-objects/text-object-registry";
// Task 232: structural DOM facets (`data-type` / `class`) come from the atom
// SSOT rather than hardcoded literals, so a NodeView rename can't drift from
// ATOM_REGISTRY. Pinned by atom-selectable-parity.test.ts.
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import { createLeafNodeView } from "@/lib/tiptap/leaf-node-view";
import { rangeHoldsOnlyText } from "@/lib/tiptap/typed-prose-gate";

const CITATION_ATOM = ATOM_REGISTRY.citation;

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
      (citationId ? linkCardKey("citation", citationId) : "");
    // The visible content is the NodeView's, from the ONE `citationDisplay`
    // answer (task 823): sanitized `<i>`/`<b>` as real elements and the
    // `[cite]` pill for an empty cite — so the static card tier and the HTML
    // clipboard show what the live atom shows.
    const display = citationDisplay(
      node.attrs.displayText as string,
      node.attrs.command as string,
    );
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": CITATION_ATOM.domType,
        class: CITATION_ATOM.domClass,
        [DATA_LINK_ID]: citationId,
        [DATA_LINK_KIND]: "citation",
        [DATA_LINK_CARD]: linkCard,
        ...(display.empty ? { "data-empty": "true" } : {}),
      }),
      ...display.children,
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
            if (collabReadOnly(view)) return false;
            // Only check on characters that could complete a citation pattern
            if (text !== "}" && text !== " " && text !== "\n") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);
            // The ONE inline-atom door (task 740) — it asks BOTH halves: the
            // curated POLICY (task 061: a `titleField` greys `citation` out,
            // since its text round-trips into `\title{…}` and re-expands under
            // `\maketitle`) and the SCHEMA (task 396: a markless `text*` block
            // would be torn). Covers BOTH the full `\cite{key}` and bare
            // `\cite ` branches below (they share this `$from`).
            // Caret form, deliberately (task 428): the typed match lies inside
            // ONE textblock, so `from` names every block the rule reaches.
            if (!posHostsInlineAtom(state.doc, from, nodeType)) return false;
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 120),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;

            if (text === "}") {
              // Full citation command ending with } (e.g. `\cite{key}`).
              const match = textBefore.match(TYPED_LATEX_INPUT_RULES.citation);
              if (match) {
                const command = match[0];
                const start = from + text.length - command.length;
                // Task 578: the typed command must be text end to end — an
                // inline atom inside the match window would be swallowed.
                if (!rangeHoldsOnlyText(state.doc, start, from)) return false;
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
                //
                // Task 642: `runEditorAction` carries THIS view as the
                // invocation's origin, so the card is built against the
                // document the user typed in. `Citation` mounts unconditionally
                // in card-body schemas, so this rule fires inside a note /
                // footnote body too — where the pre-642 dispatch read the
                // active PANE's caret instead. The outcome is warned in dev
                // when the card half does not run: the atom above is already in
                // the doc (durable on purpose) and would otherwise be orphaned
                // in silence.
                runEditorAction(view, "citation", {
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
                // Task 578: same door as the full branch.
                if (!rangeHoldsOnlyText(state.doc, start, from)) return false;
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
                // Task 642: origin-carrying dispatch — see the full branch above.
                runEditorAction(view, "citation", {
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
    // What the atom shows is `citationDisplay`'s answer — the SAME one
    // `renderHTML` paints from (task 823): display text with only `<i>`/`<b>`
    // kept, or the dotted `[cite]` pill for an empty `\cite{}` (e.g. no keys
    // picked yet; it flips once the panel updates the command).
    const applyCitationContent = (
      el: HTMLElement,
      displayText: string,
      command: string,
    ) => {
      const display = citationDisplay(displayText, command);
      setDataIfChanged(el, "empty", display.empty ? "true" : null);
      el.replaceChildren(
        ...display.children.map((child) =>
          typeof child === "string"
            ? document.createTextNode(child)
            : DOMSerializer.renderSpec(document, child).dom,
        ),
      );
    };
    return ({ node, getPos }) =>
      // Task 840: the click reads the LIVE node, so a citation id re-minted in
      // place opens ITS card, not the mount-time one.
      createLeafNodeView({
        node,
        getPos,
        className: CITATION_ATOM.domClass,
        dataType: CITATION_ATOM.domType,
        paint(dom, next, prev) {
          // Idempotence-gated (task 551): O(changed atoms), and an unchanged
          // id must not invalidate style on a renumber / display pass.
          // The `data-citation-id` SPELLING comes from the row, like `data-type`
          // and the class (task 645) — it is what the drag ghost strips and
          // the hover bridge reads, and both of those now read it from there too.
          setAttrIfChanged(dom, CITATION_ATOM.domIdAttr, next.attrs.citationId || "");
          // The content rebuild (`replaceChildren`) runs only when what it is
          // derived from moved (task 840).
          if (
            !prev ||
            prev.attrs.displayText !== next.attrs.displayText ||
            prev.attrs.command !== next.attrs.command
          ) {
            applyCitationContent(dom, next.attrs.displayText, next.attrs.command);
          }
        },
        onClick({ node: current, dom, pos }) {
          const rect = dom.getBoundingClientRect();
          const panelAncestor = dom.closest(
            "[data-panel-side]",
          ) as HTMLElement | null;
          window.dispatchEvent(
            new CustomEvent("virgil-citation-click", {
              detail: {
                citationId: current.attrs.citationId,
                // Viewport Y of the clicked citation — used by the citations
                // panel to align the corresponding card vertically with the
                // click target.
                clickY: rect.top,
                // Doc position of THIS citation instance — used to override
                // the card's anchor when a later/repeated citation is clicked
                // so the card moves to align with the click rather than the
                // (often-distant) first citation.
                clickedPos: pos(),
                sourceSide: panelAncestor?.dataset.panelSide,
                sourcePanelId: panelAncestor?.dataset.panelId,
                sourceHalf: panelAncestor?.dataset.panelHalf,
              },
            })
          );
        },
      });
  },
});
