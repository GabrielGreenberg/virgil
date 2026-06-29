import { Node, mergeAttributes } from "@tiptap/react";
import type { RefObject } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { generateShortId } from "@/lib/uuid";
import { readDocStructure, readPendingDiff } from "@/lib/tiptap/doc-structure";
// FN-A1-02: orphan-worthiness reads the SAME registry-driven content model as
// the delete-confirm (a title-only footnote counts), so the two never diverge.
import { cardHasContent } from "@/cards/has-content";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";
// The shared `\footnote{…}` trigger regex — the SAME pattern the action
// registry's footnote row references, so the typed surface and the registry can
// never recognize a different footnote vocabulary.
import { FOOTNOTE_RE_FULL } from "@/lib/footnote-commands";
// CHIP 4b: the PM→React bridge the typed-LaTeX `\footnote{}` input rule uses to
// register the footnote CARD (the atom is still inserted synchronously below).
// Replaces the DEAD `virgil-footnote-created` CustomEvent (zero listeners) —
// one typed entrypoint into the registry's `footnote.run`, which now applies
// the SAME pristine + pinned lifecycle the menu's Footnote gets.
import { getEditorActionsHandleFor } from "@/lib/actions/editor-actions-bridge";

// Options accepted by the Footnote extension. `idGenerator` lets a host
// (e.g. the Library Reader) substitute a different ID strategy for newly
// created footnotes. Defaults to the 4-char hex generator with collision
// avoidance against the existing footnote IDs in the document.
export interface FootnoteOptions {
  idGenerator: (existing: Set<string>) => string;
  /**
   * Live ref to the owning editor's docId. Threaded onto the deferred
   * `virgil-footnote-orphaned` event so the per-pane orphan bridge can route
   * each orphan to its ORIGINATING doc's store — without this, under multi-doc
   * keep-alive a teardown in doc A bleeds into doc B's Footnotes panel
   * (FN-A2-03). Null on surfaces with no doc identity (cards / floats / the
   * Reader's id-substitution path).
   */
  docIdRef?: RefObject<string | null> | null;
}

export const Footnote = Node.create<FootnoteOptions>({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  // PM otherwise creates a NodeSelection on mousedown for inline atoms,
  // and that selection transaction defaults to `scrollIntoView: true` —
  // which scrolls the row by ~100px before our click handler can route
  // to alignOmniCardWithClick. `atom: true` still keeps Backspace
  // deletion working (single-unit deletion). Repositioning is the
  // `InlineAtomGrab` gesture (mousedown → drop-mode), NOT native HTML5
  // drag. A `contenteditable="false"` island is natively draggable by
  // default, though — so each NodeView sets `dom.draggable = false`
  // (below); otherwise a real-mouse press starts a native drag whose
  // drag-detection swallows the mousemove stream the grab gesture needs.
  selectable: false,

  addOptions() {
    return {
      idGenerator: (existing: Set<string>) => generateShortId(existing),
      docIdRef: null,
    };
  },

  addAttributes() {
    return {
      // Tiptap JSONContent doc — see normalizeRichContent for accepted shapes.
      // Default null so every footnote node owns its own object (avoids the
      // single-shared-default-mutation footgun).
      content: { default: null },
      number: { default: 1 },
      title: { default: "" },
      // footnoteId stays in JSON (persistence) but doesn't render to HTML —
      // data-link-id carries the same value and is the canonical address.
      footnoteId: { default: "", renderHTML: () => ({}) },
      // Unified link attrs — rendered as data-link-* via explicit renderHTML
      // below; suppress auto-render here to avoid camelCase HTML attrs.
      linkId: { default: "", renderHTML: () => ({}) },
      linkKind: { default: "footnote", renderHTML: () => ({}) },
      linkCard: { default: "", renderHTML: () => ({}) },
      // True when this footnote originated from a `\thanks{...}` (typically
      // inside `\author{...}`) rather than a `\footnote{...}`. Drives the
      // serializer to round-trip back to `\thanks{...}` and the panel/omni
      // card to overline as ACKNOWLEDGEMENT instead of FOOTNOTE.
      thanks: { default: false, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const footnoteId =
      (node.attrs.linkId as string) ||
      (node.attrs.footnoteId as string) ||
      "";
    const linkCard =
      (node.attrs.linkCard as string) ||
      (footnoteId ? `footnote:${footnoteId}` : "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote",
        class: "footnote-marker",
        "data-link-id": footnoteId,
        "data-link-kind": "footnote",
        "data-link-card": linkCard,
        ...(node.attrs.thanks ? { "data-thanks": "true" } : {}),
      }),
      node.attrs.thanks ? "A" : String(node.attrs.number || "1"),
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;
    const idGenerator = this.options.idGenerator;
    const docIdRef = this.options.docIdRef;
    return [
      new Plugin({
        key: new PluginKey("footnoteInput"),
        props: {
          handleTextInput(view, from, _to, text) {
            // CHIP 7b: uniform collab read-only gate (same rationale as
            // citation.ts). PM suppresses input on a non-editable view; guard
            // explicitly so typed-`\footnote{}` refuses uniformly when the
            // partner holds the pen.
            if (!view.editable) return false;
            if (text !== "}") return false;
            const { state } = view;
            const $from = state.doc.resolve(from);
            const textBefore = $from.parent.textBetween(
              Math.max(0, $from.parentOffset - 200),
              $from.parentOffset,
              undefined,
              "\ufffc"
            ) + text;
            const match = textBefore.match(FOOTNOTE_RE_FULL);
            if (!match) return false;
            const content = normalizeRichContent(match[1]);
            const existing = new Set<string>();
            state.doc.descendants((node) => {
              if (node.type.name === "footnote" && node.attrs.footnoteId) {
                existing.add(node.attrs.footnoteId as string);
              }
              return true;
            });
            const footnoteId = idGenerator(existing);
            const start = from + 1 - match[0].length;
            const tr = state.tr.replaceWith(
              start,
              from + 1,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            // Insert the typed "}" into the document first so replaceWith range is valid
            // Actually we already accounted for it — replaceWith from start to from+1 covers the "}" we're inserting
            // But we need to handle this: from is pre-insert, so we replace start..from and consume the text
            const trFixed = state.tr.replaceWith(
              start,
              from,
              nodeType.create({ content, footnoteId, number: 0 })
            );
            let counter = 1;
            trFixed.doc.descendants((node, pos) => {
              if (node.type.name === "footnote") {
                if (node.attrs.thanks) {
                  // Acknowledgements don't consume the footnote counter.
                  if (node.attrs.number !== 0) {
                    trFixed.setNodeMarkup(pos, undefined, { ...node.attrs, number: 0 });
                  }
                } else {
                  trFixed.setNodeMarkup(pos, undefined, { ...node.attrs, number: counter++ });
                }
              }
              return true;
            });
            view.dispatch(trFixed);
            // Register the panel card via the registry's `footnote.run`
            // (surface "typed"). The bridge ADOPTS this just-inserted atom (via
            // `createFootnote({ existingFootnoteId })` — pinned, NO re-insert)
            // and soft-routes into omni (backlog #2). Replaces the DEAD
            // `virgil-footnote-created` event (zero listeners).
            //
            // Pristine ONLY for a truly blank `\footnote{}` (no body between
            // the braces) so it aligns with the menu's empty footnote (blank →
            // click-away-discardable). A `\footnote{some text}` carries real
            // body content, so we pass `pristine:false` — the click-away
            // discarder must NOT reap a footnote the user typed prose into.
            const pristine = match[1].trim().length === 0;
            getEditorActionsHandleFor(view)?.runAction("footnote", {
              surface: "typed",
              payload: { footnoteId, pristine },
            });
            return true;
          },
        },
      }),
      // Orphan detector + auto-renumber plugin.
      //
      // Orphan detection + auto-renumber. Both consume the typed diff
      // already computed by DocStructureObserver — zero doc walks per
      // keystroke that doesn't touch a footnote node. The renumber
      // pass walks the index's `footnotes` array (in doc order), which
      // is at most one entry per footnote in the doc.
      new Plugin({
        key: new PluginKey("footnoteOrphanDetector"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const diff = readPendingDiff(newState);
          if (!diff) return null;

          // Orphan dispatch — only when footnote nodes vanished.
          //
          // W2 cutover: flag-ON the bus reconciler (`useInlineAtomLifecycle`)
          // owns orphan upsert/clear off the SAME structural diff, so the
          // legacy `virgil-footnote-orphaned` event web is RETIRED — emitting
          // it would race a second writer at the (now-dormant) shell store.
          // Short-circuit the emission on the flag path; flag-OFF it is the
          // sole orphan source, byte-identical to today. The renumber pass
          // below is flag-agnostic and always runs.
          if (diff.removedFootnotes.length > 0 && !isInlineAtomLifecycleOn()) {
            // The diff entries don't carry rich-text content, but the
            // event consumer needs it. Look up each removed id in
            // oldState (we have its pos in the diff).
            for (const removed of diff.removedFootnotes) {
              const oldNode = oldState.doc.nodeAt(removed.pos);
              const isFootnote = oldNode?.type?.name === "footnote";
              const content = isFootnote ? oldNode.attrs.content : null;
              const title = isFootnote ? oldNode.attrs.title : undefined;
              // FN-A1-02: orphan-worthiness counts the `\footnote` title
              // (`\thanks` acknowledgement label), not just the body — a
              // title-only footnote whose marker is deleted IS recoverable, so
              // it must orphan. Routed through the shared `cardHasContent` so
              // this gate and the delete-confirm read the SAME content model.
              if (cardHasContent("footnote", { content, title })) {
                const originDocId = docIdRef?.current ?? null;
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("virgil-footnote-orphaned", {
                      detail: { footnoteId: removed.id, content, docId: originDocId },
                    }),
                  );
                }, 0);
              }
            }
          }

          // Renumber only when the footnote set or order changed.
          // Typing a character that doesn't touch a footnote node skips
          // entirely — `addedFootnotes`, `removedFootnotes`, and
          // `footnoteOrderChanged` are all empty.
          const renumberMaybe =
            diff.addedFootnotes.length > 0 ||
            diff.removedFootnotes.length > 0 ||
            diff.footnoteOrderChanged;
          if (!renumberMaybe) return null;

          const structure = readDocStructure(newState);
          const footnotes = structure.footnotes;
          if (footnotes.length === 0) return null;

          const tr = newState.tr;
          let num = 1;
          for (const f of footnotes) {
            const node = newState.doc.nodeAt(f.pos);
            if (!node || node.type.name !== "footnote") continue;
            if (f.thanks) {
              if (node.attrs.number !== 0) {
                tr.setNodeMarkup(f.pos, undefined, { ...node.attrs, number: 0 });
              }
            } else {
              if (node.attrs.number !== num) {
                tr.setNodeMarkup(f.pos, undefined, { ...node.attrs, number: num });
              }
              num++;
            }
          }

          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "footnote-marker";
      dom.dataset.type = "footnote";
      dom.dataset.footnoteId = node.attrs.footnoteId || "";
      dom.contentEditable = "false";
      // contenteditable=false islands are natively draggable inside a
      // contenteditable root; disable it so the InlineAtomGrab mousedown
      // gesture keeps its mousemove/mouseup stream (a native drag would
      // hijack it, and the Editor.tsx dragstart guard fires too late).
      dom.draggable = false;
      if (node.attrs.thanks) dom.dataset.thanks = "true";
      dom.textContent = node.attrs.thanks ? "A" : String(node.attrs.number || "1");
      dom.title = richJsonToPlainText(node.attrs.content);

      // Click on the marker just routes the user to the side panel — the
      // panel hosts the full Tiptap mini editor for footnote bodies now.
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.attrs.footnoteId) {
          const rect = dom.getBoundingClientRect();
          window.dispatchEvent(
            new CustomEvent("virgil-footnote-click", {
              detail: { footnoteId: node.attrs.footnoteId, clickY: rect.top },
            })
          );
        }
      });

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "footnote") return false;
          dom.dataset.footnoteId = updatedNode.attrs.footnoteId || "";
          if (updatedNode.attrs.thanks) dom.dataset.thanks = "true";
          else delete dom.dataset.thanks;
          dom.textContent = updatedNode.attrs.thanks ? "A" : String(updatedNode.attrs.number || "1");
          dom.title = richJsonToPlainText(updatedNode.attrs.content);
          return true;
        },
      };
    };
  },
});
