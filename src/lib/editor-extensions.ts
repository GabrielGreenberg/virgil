// FCU factory module — relocated editor-chrome NodeView/extension builders.
//
// These builders were extracted VERBATIM from the VirgilEditor component
// body in src/components/Editor.tsx (FCU phase F0, a byte-identical
// relocation). The only change from the originals: closure dependencies on
// component refs (the heading label/type-menu callbacks) are now passed in
// as parameters; every other dependency is a module-level helper imported
// directly here. See /Users/gabriel/.claude/plans/fcu-plan.md and
// LIFTED-OVERLAY-REFACTOR.md (FCU sub-arc).
//
// React-free by design: the menu-pick type is imported as a TYPE only. The
// NodeViews use DOM APIs, but those only run client-side at render time, so
// the module itself is import-safe outside the browser.

import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import BulletList from "@tiptap/extension-bullet-list";
import OrderedList from "@tiptap/extension-ordered-list";
import ListItem from "@tiptap/extension-list-item";
import Blockquote from "@tiptap/extension-blockquote";
import CodeBlock from "@tiptap/extension-code-block";
import { Extension, mergeAttributes, type NodeViewRenderer } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MutableRefObject, RefObject } from "react";
import { generateShortId } from "@/lib/uuid";
import { UUID_ATTR_SPEC, UuidAttrDecorator } from "@/lib/tiptap/uuid-attr";
import { DocStructureObserver, readPendingDiff } from "@/lib/tiptap/doc-structure";
import { BlockUuidBackfill } from "@/lib/tiptap/block-uuid-backfill";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { autoSizeInput } from "@/lib/autoSizeInput";
import {
  sectionFoldingPlugin,
  sectionFoldingPluginKey,
  getSectionFoldingState,
} from "@/lib/section-folding";
import { focusViewPlugin } from "@/lib/focus-view";
import { headingTypeName } from "@/lib/heading-types";
import type { HeadingTypePick } from "@/components/HeadingTypeMenu";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import type { Editor } from "@tiptap/react";
import {
  InlineMath,
  DisplayMath,
  Footnote,
  LatexComment,
  Citation,
  LabelRef,
  LatexCommandMark,
  SlashPopupExtension,
  LabelHandler,
  TitleField,
  MaketitleMarker,
  EmptyParagraphTitleCleaner,
  InlineAtomGrab,
  MarginaliaAnchorGuard,
  LinkedAnchor,
  LinkedAnchorGuard,
  TextObjectOrphanGuard,
  ExampleBlock,
  ExampleItemList,
  ExampleItem,
  ExampleGloss,
  AlignedGlossRow,
  ProseGlossRow,
  GlossCell,
  ExpexNumbering,
  SmartQuotes,
  TabIndent,
  PgMarkChip,
  TextColor,
  TexBlock,
  FigureBlock,
  FigureCaption,
  GraphicsBlock,
} from "@/lib/tiptap-extensions";

// --- Heading callback refs (threaded from the host component) ----------
// Formerly lexical closures inside VirgilEditor; the heading NodeView reads
// `.current` on each at interaction time. `MutableRefObject<F | undefined>`
// mirrors the `useRef(prop)` shape in Editor.tsx exactly, so passing the
// component's existing refs is byte-identical.
type LabelTakenPredicate = (
  candidate: string,
  excludeLabel: string | null,
) => boolean;
type LabelRenameHandler = (
  oldLabel: string,
  newLabel: string,
  refCount: number,
) => Promise<boolean>;
type HeadingDeleteHandler = (typeName: string) => Promise<boolean>;
type HeadingTypeMenuOpener = (params: {
  anchorRect: DOMRect;
  currentLevel: number;
  onPick: (pick: HeadingTypePick) => void;
}) => void;

export interface HeadingCallbackRefs {
  isLabelTakenRef?: MutableRefObject<LabelTakenPredicate | undefined>;
  onConfirmLabelRenameRef?: MutableRefObject<LabelRenameHandler | undefined>;
  onConfirmHeadingDeleteRef?: MutableRefObject<HeadingDeleteHandler | undefined>;
  onOpenHeadingTypeMenuRef?: MutableRefObject<HeadingTypeMenuOpener | undefined>;
}

export interface ParagraphSurfaceOpts {
  /** Which surface the paragraph NodeView is mounted on.
   *  - "main" (default): the `parTitle` write targets the editor the
   *    NodeView lives in, resolved by live position (`getPos`). Byte-identical
   *    to the pre-FCU behaviour.
   *  - "float" (FCU Chip C1): the inline `+T` title write PROXIES to
   *    `host.getMainEditor()` (= MAIN), resolving the paragraph there by uuid
   *    (the float's paragraph carries the synced uuid). The float's own
   *    onUpdate never fires from this write, so useFloatMainSync re-reads the
   *    result idempotently — no echo loop. Mirrors the heading builder's
   *    host-proxy structural writes (Chip B). */
  surface: "main" | "float";
  /** Float only: the main editor a float proxies the title write to.
   *  Resolved per-interaction (a re-mounted main editor is picked up). */
  host?: { getMainEditor: () => Editor | null };
}

export function createParagraphWithTitle(opts?: ParagraphSurfaceOpts) {
  const isFloat = opts?.surface === "float";
  const host = opts?.host;
  return Paragraph.extend({
    // Paragraphs never participate in HTML5 drag. Pop-out (custom mousedown
    // lift on the 6-dot grip) and drop-mode (shift-drag on a float header)
    // own all paragraph repositioning; PM-native node-drag would be a third
    // text-move surface and is suppressed at the schema root.
    draggable: false,
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        let currentNode = node;
        // dragHandleEl is gone — the editor-mounted TextObjectGrabHandle
        // (src/text-objects/TextObjectGrabHandle.tsx) handles every block
        // kind now via the registry-driven, cursor/hover-following handle.

        // Detect if this paragraph is inside a list item or an expex example
        // block — skip title controls + drag handle so the inner text reads
        // as plain prose. The example block itself carries its own chrome
        // (number + drag handle) via the exampleBlock node view.
        const pos = typeof getPos === "function" ? getPos() : null;
        let skipChrome = false;
        if (pos != null) {
          const resolved = nodeEditor.state.doc.resolve(pos);
          for (let d = resolved.depth; d >= 0; d--) {
            const name = resolved.node(d).type.name;
            if (name === "listItem" || name === "exampleBlock" || name === "exampleItem") {
              skipChrome = true;
              break;
            }
          }
        }

        if (skipChrome) {
          const p = document.createElement("p");
          return { dom: p, contentDOM: p };
        }

        const wrapper = document.createElement("div");
        wrapper.className = "par-title-wrapper";
        // Belt-and-suspenders with the schema `draggable: false`: the
        // browser must never see this wrapper as a drag source.
        wrapper.draggable = false;

        // Title annotation area (above paragraph — holds +T or title)
        const titleAnnot = document.createElement("div");
        titleAnnot.className = "par-title-annotation";
        titleAnnot.contentEditable = "false";
        wrapper.appendChild(titleAnnot);

        // Paragraph content — wrapped in a relative container so the drag
        // handle can be positioned next to the first text line, not the title.
        const pContainer = document.createElement("div");
        pContainer.className = "par-body-container";
        const p = document.createElement("p");
        pContainer.appendChild(p);

        wrapper.appendChild(pContainer);

        function setTitle(newTitle: string | null) {
          if (isFloat) {
            // FCU Chip C1: proxy the title write to MAIN, resolving the
            // paragraph there by uuid (the float's paragraph carries the
            // synced uuid). The float's own onUpdate never fires from this,
            // so useFloatMainSync re-reads the result idempotently — no echo.
            // Falls back to the float editor if main isn't resolvable.
            const target = host?.getMainEditor() ?? nodeEditor;
            const uuid = (currentNode.attrs.uuid as string | null) || null;
            if (!uuid) return;
            let foundPos: number | null = null;
            let foundAttrs: Record<string, unknown> | null = null;
            target.state.doc.descendants((nd, pos) => {
              if (foundPos != null) return false;
              if (nd.type.name === "paragraph" && nd.attrs.uuid === uuid) {
                foundPos = pos;
                foundAttrs = { ...nd.attrs };
                return false;
              }
              return true;
            });
            if (foundPos == null || foundAttrs == null) return;
            const tr = target.state.tr.setNodeMarkup(foundPos, undefined, {
              ...(foundAttrs as Record<string, unknown>),
              parTitle: newTitle,
            });
            target.view.dispatch(tr);
            return;
          }
          // Main (default): UNCHANGED — write to the editor the NodeView
          // lives in, resolved by live position.
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos != null) {
            const n = nodeEditor.state.doc.nodeAt(pos);
            if (n) {
              const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
              // Assign UUID if setting a title and node doesn't have one yet
              if (newTitle && !attrs.uuid) {
                attrs.uuid = generateShortId();
              }
              const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
              nodeEditor.view.dispatch(tr);
            }
          }
        }

        function enterEditMode() {
          // Show annotation area and place input over it
          wrapper.classList.add("has-add-btn");
          wrapper.classList.add("is-editing-title");
          titleAnnot.style.display = "block";
          titleAnnot.textContent = "\u00A0"; // nbsp placeholder for height

          const annotRect = titleAnnot.getBoundingClientRect();
          const wrapperRect = wrapper.getBoundingClientRect();

          const input = document.createElement("input");
          input.type = "text";
          input.className = "par-title-input";
          input.value = (currentNode.attrs.parTitle as string) || "";
          input.placeholder = "Paragraph title…";
          input.style.position = "fixed";
          input.style.left = `${wrapperRect.left}px`;
          input.style.top = `${annotRect.top}px`;
          input.style.zIndex = "9999";
          document.body.appendChild(input);

          // Auto-size to content (must be in DOM first for font measurement)
          const cleanupSizer = autoSizeInput(input);

          let committed = false;
          const cleanup = () => {
            cleanupSizer();
            wrapper.classList.remove("is-editing-title");
            if (document.body.contains(input)) document.body.removeChild(input);
          };
          const commit = () => {
            if (committed) return;
            committed = true;
            const val = input.value.trim() || null;
            const original = (currentNode.attrs.parTitle as string | null) || null;
            cleanup();
            if (val === original) {
              renderAnnot();
              return;
            }
            setTitle(val);
          };

          input.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); committed = true; cleanup(); renderAnnot(); }
          });

          input.addEventListener("blur", () => {
            setTimeout(() => { if (!committed) commit(); }, 150);
          });

          input.focus();
          input.select();
        }

        function renderAnnot() {
          const title = currentNode.attrs.parTitle as string | null;
          titleAnnot.innerHTML = "";

          // Toggle has-text for drag handle visibility
          const hasText = currentNode.textContent.trim().length > 0;
          wrapper.classList.toggle("has-text", hasText);

          if (title) {
            wrapper.classList.add("has-title");
            wrapper.classList.remove("has-add-btn");
            titleAnnot.style.display = "block";

            // Title text, then × delete button to its right
            const span = document.createElement("span");
            span.className = "par-title-text";
            span.textContent = title;
            titleAnnot.appendChild(span);
            const xBtn = document.createElement("button");
            xBtn.className = "par-title-delete";
            xBtn.textContent = "×";
            xBtn.title = "Remove title";
            xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
            xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
            titleAnnot.appendChild(xBtn);
          } else {
            wrapper.classList.remove("has-title");

            if (hasText) {
              wrapper.classList.add("has-add-btn");
              titleAnnot.style.display = "block";

              // "+T" label shown in the gap above paragraph, revealed on hover
              const addLabel = document.createElement("span");
              addLabel.className = "par-title-add";
              addLabel.textContent = "+T";
              addLabel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
              addLabel.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
              titleAnnot.appendChild(addLabel);
            } else {
              wrapper.classList.remove("has-add-btn");
              titleAnnot.style.display = "none";
            }
          }
        }

        renderAnnot();

        // Click on title text to edit
        titleAnnot.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        titleAnnot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (titleAnnot.querySelector("input")) return;
          enterEditMode();
        });

        return {
          dom: wrapper,
          contentDOM: p,
          stopEvent(event) {
            return (
              titleAnnot === event.target || titleAnnot.contains(event.target as Node)
            );
          },
          ignoreMutation(mutation) {
            if (titleAnnot.contains(mutation.target)) return true;
            if (mutation.target === wrapper) return true;
            return false;
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "paragraph") return false;
            currentNode = updatedNode;
            if (!titleAnnot.querySelector("input")) renderAnnot();
            return true;
          },
          destroy() {},
        };
      };
    },
  });
}

export interface ListSurfaceOpts {
  /** Which surface the list NodeView is mounted on.
   *  - "main" (default): the `parTitle` write targets the editor the
   *    NodeView lives in, resolved by live position (`getPos`). Byte-identical
   *    to the pre-FCU behaviour.
   *  - "float" (FCU Chip C2): the inline `+T` list-title write PROXIES to
   *    `host.getMainEditor()` (= MAIN), resolving the list there by uuid (the
   *    float's list carries the synced uuid). The float's own onUpdate never
   *    fires from this write, so useFloatMainSync re-reads the result
   *    idempotently — no echo loop. Mirrors the paragraph builder's
   *    float-mode setTitle (Chip C1) and the heading builder's host-proxied
   *    structural writes (Chip B). */
  surface: "main" | "float";
  /** Float only: the main editor a float proxies the title write to.
   *  Resolved per-interaction (a re-mounted main editor is picked up). */
  host?: { getMainEditor: () => Editor | null };
}

// --- List title node view factory (shared by bullet + ordered lists) ---
//
// List-level chrome (drag handle + +T title) is added for top-level
// lists only. Nested sublists (lists inside a `listItem`) return a
// bare `<ul>` / `<ol>` with no wrapper — matching the way paragraphs
// inside a `listItem` skip chrome (see ~line 572 above) so the inner
// structure reads as part of its parent's prose.
//
// Per-listItem affordances are intentionally NOT implemented in THIS
// list-level NodeView. `listItem` is a first-class TextObject sub-object
// with its own `uuid` attr (`createListItemWithUuid`) that round-trips —
// the serializer emits `\item …%!v:<uuid>` and the parser reads it back
// (block-uuid-backfill mints/dedupes item ids). Its per-item affordances
// (grab handle, and the L3k lift float) live in the TextObject layer
// (`TextObjectGrabHandle` + the registry), so this NodeView stays scoped
// to list-LEVEL chrome only.
function createListTitleNodeView(
  tagName: "ul" | "ol",
  typeName: string,
  opts?: ListSurfaceOpts,
): NodeViewRenderer {
  const isFloat = opts?.surface === "float";
  const host = opts?.host;
  return ({ node, getPos, editor: nodeEditor }) => {
    let currentNode = node;

    // Detect nesting — return a bare list element with no chrome.
    const startPos = typeof getPos === "function" ? getPos() : null;
    let isNested = false;
    if (startPos != null) {
      const resolved = nodeEditor.state.doc.resolve(startPos);
      for (let d = resolved.depth; d >= 0; d--) {
        if (resolved.node(d).type.name === "listItem") {
          isNested = true;
          break;
        }
      }
    }
    if (isNested) {
      const bare = document.createElement(tagName);
      // A nested ordered list renders its number from the node attrs too.
      if (tagName === "ol") {
        const start = node.attrs.start as number | null;
        if (typeof start === "number" && start !== 1) {
          bare.setAttribute("start", String(start));
        }
        if (node.attrs.type) bare.setAttribute("type", String(node.attrs.type));
      }
      return { dom: bare, contentDOM: bare };
    }

    const wrapper = document.createElement("div");
    wrapper.className = "list-title-wrapper";
    // Lists always have content; mark the wrapper accordingly so the
    // editor-level hover-band delegation (see useEffect below) can
    // detect it the same way it detects paragraph wrappers.
    wrapper.classList.add("has-text");

    const titleAnnot = document.createElement("div");
    titleAnnot.className = "par-title-annotation";
    titleAnnot.contentEditable = "false";
    wrapper.appendChild(titleAnnot);

    const listEl = document.createElement(tagName);
    wrapper.appendChild(listEl);

    // Paint the ordered-list numbering attrs onto the <ol> so the marker
    // renders from the SYNCED node attrs, not from DOM position alone. In main
    // this is invisible for the usual `start:1` list (a 2nd <li> counts to "2."
    // by position), but a sub-object lift float hosts a SINGLE item, so the
    // wrapper's `start` (= the item's source ordinal) must reach the DOM for the
    // marker to read its real number. Mirrors how the exampleBlock NodeView
    // renders `(N)` from `node.attrs.number`. O(1), no doc walk.
    const applyOrderedListAttrs = () => {
      if (tagName !== "ol") return;
      const start = currentNode.attrs.start as number | null;
      const listType = currentNode.attrs.type as string | null;
      if (typeof start === "number" && start !== 1) {
        listEl.setAttribute("start", String(start));
      } else {
        listEl.removeAttribute("start");
      }
      if (listType) listEl.setAttribute("type", String(listType));
      else listEl.removeAttribute("type");
    };
    applyOrderedListAttrs();

    // The grip is gone — the editor-mounted TextObjectGrabHandle
    // (src/text-objects/TextObjectGrabHandle.tsx) handles bulletList /
    // orderedList lift via the registry-driven, cursor/hover-following
    // handle. The list wrapper keeps its `position: relative` so the
    // editor-level handle can pin to its gutter via DOM-rect math.

    function setTitle(newTitle: string | null) {
      if (isFloat) {
        // FCU Chip C2: proxy the title write to MAIN, resolving the list
        // there by uuid (the float's list carries the synced uuid). The
        // float's own onUpdate never fires from this write, so
        // useFloatMainSync re-reads the result idempotently — no echo loop.
        // Falls back to the float editor if main isn't resolvable. Mirrors
        // the paragraph builder's float-mode setTitle (Chip C1).
        const target = host?.getMainEditor() ?? nodeEditor;
        const uuid = (currentNode.attrs.uuid as string | null) || null;
        if (!uuid) return;
        let foundPos: number | null = null;
        let foundAttrs: Record<string, unknown> | null = null;
        target.state.doc.descendants((nd, pos) => {
          if (foundPos != null) return false;
          if (nd.type.name === typeName && nd.attrs.uuid === uuid) {
            foundPos = pos;
            foundAttrs = { ...nd.attrs };
            return false;
          }
          return true;
        });
        if (foundPos == null || foundAttrs == null) return;
        const tr = target.state.tr.setNodeMarkup(foundPos, undefined, {
          ...(foundAttrs as Record<string, unknown>),
          parTitle: newTitle,
        });
        target.view.dispatch(tr);
        return;
      }
      // Main (default): UNCHANGED — write to the editor the NodeView lives
      // in, resolved by live position.
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos != null) {
        const n = nodeEditor.state.doc.nodeAt(pos);
        if (n) {
          const attrs = { ...n.attrs, parTitle: newTitle } as Record<string, unknown>;
          if (newTitle && !attrs.uuid) {
            attrs.uuid = generateShortId();
          }
          const tr = nodeEditor.state.tr.setNodeMarkup(pos, undefined, attrs);
          nodeEditor.view.dispatch(tr);
        }
      }
    }

    function enterEditMode() {
      // Show annotation area and place input over it
      wrapper.classList.add("has-add-btn");
      wrapper.classList.add("is-editing-title");
      titleAnnot.style.display = "block";
      titleAnnot.textContent = "\u00A0"; // nbsp placeholder for height

      const annotRect = titleAnnot.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();

      const overlay = document.createElement("div");
      overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;`;
      document.body.appendChild(overlay);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "par-title-input";
      input.value = currentNode.attrs.parTitle || "";
      input.placeholder = "Title…";
      input.style.cssText = `position:fixed;z-index:9999;left:${wrapperRect.left}px;top:${annotRect.top}px;`;
      document.body.appendChild(input);

      // Auto-size to content (must be in DOM first for font measurement)
      const cleanupSizer = autoSizeInput(input);

      input.focus();
      input.select();

      let committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        cleanupSizer();
        wrapper.classList.remove("is-editing-title");
        const val = input.value.trim();
        setTitle(val || null);
        if (document.body.contains(input)) input.remove();
        if (document.body.contains(overlay)) overlay.remove();
      }
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); committed = true; cleanupSizer(); wrapper.classList.remove("is-editing-title"); if (document.body.contains(input)) input.remove(); if (document.body.contains(overlay)) overlay.remove(); renderAnnot(); }
      });
      input.addEventListener("blur", commit);
      overlay.addEventListener("mousedown", (e) => { e.preventDefault(); commit(); });
    }

    function renderAnnot() {
      const title = currentNode.attrs.parTitle as string | null;
      titleAnnot.innerHTML = "";

      if (title) {
        wrapper.classList.add("has-title");
        wrapper.classList.remove("has-add-btn");
        titleAnnot.style.display = "block";

        const span = document.createElement("span");
        span.className = "par-title-text";
        span.textContent = title;
        titleAnnot.appendChild(span);
        const xBtn = document.createElement("button");
        xBtn.className = "par-title-delete";
        xBtn.textContent = "×";
        xBtn.title = "Remove title";
        xBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        xBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setTitle(null); });
        titleAnnot.appendChild(xBtn);
      } else {
        wrapper.classList.remove("has-title");
        wrapper.classList.add("has-add-btn");
        titleAnnot.style.display = "block";

        const addLabel = document.createElement("span");
        addLabel.className = "par-title-add";
        addLabel.textContent = "+T";
        addLabel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        addLabel.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); enterEditMode(); });
        titleAnnot.appendChild(addLabel);
      }
    }

    renderAnnot();

    titleAnnot.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    titleAnnot.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (titleAnnot.querySelector("input")) return;
      enterEditMode();
    });

    return {
      dom: wrapper,
      contentDOM: listEl,
      stopEvent(event) {
        return (
          titleAnnot === event.target || titleAnnot.contains(event.target as Node)
        );
      },
      ignoreMutation(mutation) {
        if (mutation.target && titleAnnot.contains(mutation.target)) return true;
        if (mutation.target === wrapper) return true;
        // The `start`/`type` attrs we paint on the <ol> are driven FROM the doc
        // (never read back), so ignore those own-writes on the contentDOM.
        if (mutation.type === "attributes" && mutation.target === listEl) {
          return true;
        }
        return false;
      },
      update(updatedNode) {
        if (updatedNode.type.name !== typeName) return false;
        currentNode = updatedNode;
        applyOrderedListAttrs();
        if (!titleAnnot.querySelector("input")) renderAnnot();
        return true;
      },
    };
  };
}

export function createBulletListWithTitle(opts?: ListSurfaceOpts) {
  return BulletList.extend({
    group: "block list textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ul", "bulletList", opts);
    },
  });
}

export function createOrderedListWithTitle(opts?: ListSurfaceOpts) {
  return OrderedList.extend({
    group: "block list textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        parTitle: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        listPreamble: { default: null, rendered: false },
      };
    },
    addNodeView() {
      return createListTitleNodeView("ol", "orderedList", opts);
    },
  });
}

export function createBlockquoteWithUuid() {
  return Blockquote.extend({
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });
}

export function createListItemWithUuid() {
  return ListItem.extend({
    // Sub-object: lives only inside bulletList/orderedList. Widen content
    // so the FIRST child may be a graphicsBlock (e.g. an item that's just
    // `\includegraphics{...}`), not only a paragraph. Subsequent children
    // were already free via `block*` since graphicsBlock is in the block
    // group. Adding another inner kind (tables, etc.) is a one-token
    // edit to the union.
    content: "(paragraph | graphicsBlock) block*",
    group: "textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });
}

export function createCodeBlockWithUuid() {
  return CodeBlock.extend({
    group: "block textObject",
    addAttributes() {
      return {
        ...this.parent?.(),
        uuid: UUID_ATTR_SPEC.uuid,
      };
    },
  });
}

export interface HeadingSurfaceOpts {
  /** Which surface the heading NodeView is mounted on.
   *  - "main" (default): adds the doc-wide `sectionNumbers` numberer +
   *    `sectionFoldingPlugin`, renders the fold chevron, and routes
   *    structural writes to the host editor it lives in.
   *  - "float" (FCU Chip B): OMITS the numberer + folding (the float must
   *    not renumber its lone section — its number rides in via the synced
   *    node attrs), HIDES the fold chevron, gates off demote-to-paragraph +
   *    delete (they'd dissolve the float's own subject), and PROXIES the
   *    label-rename / toggle-numbered / change-level writes to
   *    `host.getMainEditor()` (= MAIN), resolving the heading there by uuid. */
  surface: "main" | "float";
  /** Float only: the main editor a float proxies structural writes to.
   *  Resolved per-interaction (a re-mounted main editor is picked up). */
  host?: { getMainEditor: () => Editor | null };
}

export function createHeadingWithLabel(
  refs: HeadingCallbackRefs,
  opts?: HeadingSurfaceOpts,
) {
  const isFloat = opts?.surface === "float";
  const host = opts?.host;
  return Heading.extend({
    group: "block textObject",
    // TipTap's default markdown-style heading input rules (`#`/`##`/… + space)
    // are dead surface area in this LaTeX-first editor (slash popup + the
    // heading type menu cover heading creation). They also produce a real
    // bug at level 0: with `levels: [0..6]`, the level-0 rule becomes
    // `^(#{0,0})\s$`, i.e. `^\s$`. TipTap's input-rules plugin reruns rules
    // on Enter with `text="\n"`, so Enter at parentOffset 0 of any paragraph
    // matches that rule and `setBlockType`s the paragraph into a \part —
    // the paragraph's text becomes the heading's title. Disabling the rules
    // outright kills the bug and the unused markdown shortcuts in one shot.
    addInputRules() {
      return [];
    },
    addAttributes() {
      return {
        ...this.parent?.(),
        label: { default: null },
        uuid: UUID_ATTR_SPEC.uuid,
        numbered: { default: true, rendered: false },
        sectionNumber: { default: null, rendered: false },
      };
    },
    parseHTML() {
      const tagLevels: Array<{ tag: string; level: number }> = [
        { tag: "h1", level: 1 },
        { tag: "h2", level: 2 },
        { tag: "h3", level: 3 },
        { tag: "h4", level: 4 },
        { tag: "h5", level: 5 },
        { tag: "h6", level: 6 },
      ];
      return tagLevels.map(({ tag, level }) => ({
        tag,
        getAttrs: (el: HTMLElement | string) => {
          if (typeof el === "string") return { level };
          const dataLevel = el.getAttribute("data-heading-level");
          const parsed = dataLevel != null ? Number.parseInt(dataLevel, 10) : NaN;
          return { level: Number.isFinite(parsed) ? parsed : level };
        },
      }));
    },
    renderHTML({ HTMLAttributes, node }) {
      const level = (node.attrs.level as number) ?? 1;
      // h0 isn't valid HTML; clamp the emitted tag and round-trip the real
      // level via data-heading-level. The in-editor visual is driven by the
      // node view's wrapper class, so this only matters for HTML serialization.
      const safeLevel = Math.max(1, Math.min(level || 1, 6));
      return [`h${safeLevel}`, mergeAttributes(HTMLAttributes, { "data-heading-level": String(level) }), 0];
    },
    addNodeView() {
      return ({ node, getPos, editor: nodeEditor }) => {
        let currentNode = node;

        // Structural-write target. Main: the editor the NodeView lives in.
        // Float (FCU Chip B): the MAIN editor, resolved per-interaction via
        // `host` so the label-rename / numbered / level edits mutate the
        // source of truth (the float's own onUpdate never fires, so
        // useFloatMainSync re-reads the result idempotently — no echo loop).
        // Falls back to the float editor if main isn't resolvable.
        const getTarget = (): Editor =>
          isFloat ? (host?.getMainEditor() ?? nodeEditor) : nodeEditor;

        // Locate this heading inside `target`. Main resolves by live
        // position (`getPos`); float resolves by uuid (its `getPos` points
        // into the float doc, not main). Returns the live node so callers
        // spread its current attrs.
        const resolveHeadingInTarget = (
          target: Editor,
        ): { pos: number; node: PMNode } | null => {
          if (!isFloat) {
            const p = typeof getPos === "function" ? getPos() : null;
            if (p == null) return null;
            const n = target.state.doc.nodeAt(p);
            if (!n || n.type.name !== "heading") return null;
            return { pos: p, node: n };
          }
          const uuid = (currentNode.attrs.uuid as string | null) || null;
          if (!uuid) return null;
          let result: { pos: number; node: PMNode } | null = null;
          target.state.doc.descendants((nd, pos) => {
            if (result) return false;
            if (nd.type.name === "heading" && nd.attrs.uuid === uuid) {
              result = { pos, node: nd };
              return false;
            }
            return true;
          });
          return result;
        };

        const wrapper = document.createElement("div");
        wrapper.className = `heading-wrapper heading-wrapper-l${node.attrs.level}`;

        // Folding chevron — positioned in the left margin gutter at the same
        // horizontal offset as the paragraph drag handles. Clicking toggles
        // the fold state for this heading's section. OMITTED in floats: the
        // section-folding plugin doesn't run there (decision 6), so there's
        // no fold state to drive a chevron, and folding a float's lone
        // section is meaningless.
        let foldBtn: HTMLButtonElement | null = null;
        if (!isFloat) {
          foldBtn = document.createElement("button");
          foldBtn.type = "button";
          foldBtn.className = "heading-fold-chevron";
          foldBtn.contentEditable = "false";
          foldBtn.setAttribute("aria-label", "Toggle section fold");
          const SVG_NS_FOLD = "http://www.w3.org/2000/svg";
          const foldSvg = document.createElementNS(SVG_NS_FOLD, "svg");
          foldSvg.setAttribute("width", "12");
          foldSvg.setAttribute("height", "12");
          foldSvg.setAttribute("viewBox", "0 0 12 12");
          foldSvg.setAttribute("fill", "none");
          foldSvg.setAttribute("stroke", "currentColor");
          foldSvg.setAttribute("stroke-width", "1.5");
          foldSvg.setAttribute("stroke-linecap", "round");
          foldSvg.setAttribute("stroke-linejoin", "round");
          const foldPath = document.createElementNS(SVG_NS_FOLD, "path");
          foldPath.setAttribute("d", "M4.5 2l4 4-4 4");
          foldSvg.appendChild(foldPath);
          foldBtn.appendChild(foldSvg);
          // Prevent PM from focusing the editor / moving the selection.
          foldBtn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
          foldBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const p = typeof getPos === "function" ? getPos() : null;
            if (p == null) return;
            // Ensure the heading has a UUID we can key the fold state to.
            let uuid = currentNode.attrs?.uuid as string | null;
            if (!uuid) {
              uuid = ensureAnchorUuid(nodeEditor.view, p + 1);
            }
            if (!uuid) return;
            const tr = nodeEditor.view.state.tr.setMeta(sectionFoldingPluginKey, {
              action: "toggle",
              uuid,
            });
            tr.setMeta("addToHistory", false);
            nodeEditor.view.dispatch(tr);
          });
          wrapper.appendChild(foldBtn);

          // Sibling-decoration fold changes (folding/unfolding a DIFFERENT
          // section) don't trigger this node's update(), so the doc-wide
          // resync is handled by the shared sectionFoldingPlugin `view()`
          // (#29 nit-3) — ONE pluginView per EditorView, not a per-heading
          // `on("transaction")` subscriber (N headings = N subscribers, the
          // keystroke-sanctity nit this fix closed). The per-node `update()`
          // below still calls refreshFoldBtn() for THIS heading's own node
          // changes (e.g. undo re-inserting a heading), and it is idempotent
          // against the live `is-folded` class, so it is O(1)-per-affected-node.
        }

        function refreshFoldBtn() {
          if (!foldBtn) return;
          const uuid = currentNode.attrs?.uuid as string | null;
          const folded = uuid
            ? getSectionFoldingState(nodeEditor.state).folded.has(uuid)
            : false;
          // Idempotent (#29a/#29 nit-3): skip the DOM writes when this section's
          // fold state didn't flip. We compare against the LIVE `is-folded`
          // class — the SAME source of truth the shared sectionFoldingPlugin
          // `view()` writes — rather than a private mirror var, so the two
          // paths can't drift (a stale mirror would force a redundant repaint
          // when this NodeView's update() fires AFTER the shared view already
          // painted the class). update() fires while this section stays folded
          // whenever this heading's own node is re-visited — e.g. editing its
          // OWN text, or pruning a SIBLING heading (a node deletion re-walks the
          // doc's child list, firing update() on the survivors). Folding the
          // section itself does NOT fire update() — it decorates a sibling, not
          // this node — so the shared view paints it. A plain keystroke that
          // reaches here via update() therefore does no DOM work.
          if (folded === foldBtn.classList.contains("is-folded")) return;
          foldBtn.classList.toggle("is-folded", folded);
          foldBtn.title = folded ? "Unfold section" : "Fold section";
        }
        refreshFoldBtn();

        const h = document.createElement(`h${node.attrs.level}`) as HTMLHeadingElement;
        if (node.attrs.numbered !== false && node.attrs.sectionNumber) {
          h.dataset.sectionNumber = node.attrs.sectionNumber;
        }
        wrapper.appendChild(h);

        const annot = document.createElement("div");
        annot.className = "heading-annotation";
        annot.contentEditable = "false";
        wrapper.appendChild(annot);

        // The grip is gone — the editor-mounted TextObjectGrabHandle
        // (src/text-objects/TextObjectGrabHandle.tsx) handles heading
        // lift + click-to-menu via the registry-driven, cursor/hover-
        // following handle. HTML5 drag stays disabled at the wrapper
        // level; cross-editor drops route through drop-mode.

        function getTypeName(n: typeof node) {
          return headingTypeName(n.attrs.level as number);
        }

        function enterEditMode(targetSpan: HTMLElement) {
          if (annot.querySelector("input")) return;

          const input = document.createElement("input");
          input.type = "text";
          input.className = "heading-label-input";
          input.value = (currentNode.attrs.label as string) || "";
          input.placeholder = "label key";

          // Replace the target span with the input inline
          targetSpan.replaceWith(input);

          // Auto-size to content (must be in DOM first for font measurement)
          const cleanupSizer = autoSizeInput(input);

          input.addEventListener("mousedown", (ev) => ev.stopPropagation());

          // Live "label already in use" warning — consults the central
          // predicate from @/lib/labels via the isLabelTakenRef mirror.
          const warning = document.createElement("div");
          warning.className = "heading-label-warning";
          warning.textContent = "⚠ label already in use";
          warning.style.display = "none";
          annot.appendChild(warning);

          const refreshWarning = () => {
            const candidate = input.value.trim();
            const own = (currentNode.attrs.label as string | null) || null;
            const predicate = refs.isLabelTakenRef?.current;
            const taken =
              candidate && predicate ? predicate(candidate, own) : false;
            warning.style.display = taken ? "" : "none";
            input.classList.toggle("has-conflict", !!taken);
          };
          input.addEventListener("input", refreshWarning);
          refreshWarning();

          let committed = false;
          const commit = async () => {
            if (committed) return;
            committed = true;
            cleanupSizer();
            const newLabel = input.value.trim() || null;
            const oldLabel = (currentNode.attrs.label as string | null) || null;

            if (oldLabel === newLabel) {
              renderAnnot();
              return;
            }

            // Resolve against the write TARGET — MAIN in a float, where the
            // labelRef rewrite walk must run over the whole doc (the float
            // only holds this one section) and the heading is found by uuid.
            const target = getTarget();
            if (!resolveHeadingInTarget(target)) {
              renderAnnot();
              return;
            }

            // Restore the annotation display before awaiting a modal so
            // the user isn't staring at a stale editable input behind it.
            renderAnnot();

            // Only prompt when renaming between two non-empty keys.
            // Add/remove cases either have no refs (add) or can't point
            // the refs anywhere meaningful (remove).
            const refPositions: number[] = [];
            if (oldLabel && newLabel) {
              target.state.doc.descendants((nd, pos) => {
                if (nd.type.name === "labelRef" && nd.attrs.label === oldLabel) {
                  refPositions.push(pos);
                }
              });
            }

            let updateRefs = false;
            const handler = refs.onConfirmLabelRenameRef?.current;
            if (refPositions.length > 0 && handler && oldLabel && newLabel) {
              updateRefs = await handler(oldLabel, newLabel, refPositions.length);
            }

            // Re-resolve the heading position after the modal in case
            // the doc shifted (shouldn't happen while modal is open, but
            // cheap insurance).
            const after = resolveHeadingInTarget(target);
            if (!after) return;
            const headingPos = after.pos;
            const headingNode = after.node;

            const tr = target.state.tr;
            tr.setNodeMarkup(headingPos, undefined, {
              ...headingNode.attrs,
              label: newLabel,
            });

            if (updateRefs) {
              const display =
                (headingNode.attrs.sectionNumber as string | null) || "??";
              // labelRef is an inline atom of fixed size — updating attrs
              // keeps existing positions valid within the same transaction.
              for (const rPos of refPositions) {
                const rNode = target.state.doc.nodeAt(rPos);
                if (
                  rNode &&
                  rNode.type.name === "labelRef" &&
                  rNode.attrs.label === oldLabel
                ) {
                  tr.setNodeMarkup(rPos, undefined, {
                    ...rNode.attrs,
                    label: newLabel,
                    displayText: display,
                  });
                }
              }
            }

            target.view.dispatch(tr);
            // Focus the editor the NodeView lives in (the float in float
            // mode, main in main mode) — keeps the user in the popout.
            nodeEditor.commands.focus();
          };

          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); committed = true; cleanupSizer(); renderAnnot(); }
          });

          let armed = false;
          input.addEventListener("blur", () => { if (armed) commit(); });
          setTimeout(() => { armed = true; }, 200);

          requestAnimationFrame(() => {
            input.focus();
            if (currentNode.attrs.label) {
              // Place cursor at end for existing labels
              input.selectionStart = input.selectionEnd = input.value.length;
            } else {
              input.select();
            }
          });
          const refocusId = setInterval(() => {
            if (document.activeElement !== input && annot.contains(input)) {
              input.focus();
            }
          }, 30);
          setTimeout(() => clearInterval(refocusId), 250);
        }

        function renderAnnot() {
          const typeName = getTypeName(currentNode);
          const isNumbered = currentNode.attrs.numbered !== false;
          const label = currentNode.attrs.label as string | null;
          annot.innerHTML = "";

          // 1. Type chip — clickable dropdown trigger.
          const typeChip = document.createElement("span");
          typeChip.className = "heading-annotation-type-chip";
          typeChip.dataset.action = "type-menu";
          typeChip.setAttribute("role", "button");
          typeChip.setAttribute("aria-haspopup", "menu");
          typeChip.title = "Change heading type";
          const typeText = document.createElement("span");
          typeText.textContent = typeName;
          typeChip.appendChild(typeText);
          const caret = document.createElement("span");
          caret.className = "heading-annotation-caret";
          caret.textContent = "▾";
          typeChip.appendChild(caret);
          annot.appendChild(typeChip);

          // 2. Numbered on/off toggle — drives \section{} vs \section*{}
          // and the CSS-rendered section number on the heading itself.
          const numToggle = document.createElement("span");
          numToggle.className = "heading-annotation-numbered-toggle";
          if (!isNumbered) numToggle.classList.add("is-off");
          numToggle.dataset.action = "toggle-numbered";
          numToggle.setAttribute("role", "button");
          numToggle.setAttribute("aria-pressed", isNumbered ? "true" : "false");
          numToggle.title = isNumbered ? "Hide section number" : "Show section number";
          numToggle.textContent = "#";
          annot.appendChild(numToggle);

          // 3. Label slot (unchanged behaviour).
          if (label) {
            const sep = document.createElement("span");
            sep.className = "heading-annotation-sep";
            sep.textContent = "  ·  label: ";
            annot.appendChild(sep);

            const labelSpan = document.createElement("span");
            labelSpan.textContent = label;
            labelSpan.className = "heading-label-text";
            annot.appendChild(labelSpan);
          } else {
            const addBtn = document.createElement("span");
            addBtn.className = "heading-label-add";
            addBtn.textContent = "Label +";
            annot.appendChild(addBtn);
          }

          // 4. Trailing × delete button — OMITTED in floats: deleting the
          // heading would dissolve the float's own subject (decision 3).
          if (!isFloat) {
            const deleteBtn = document.createElement("span");
            deleteBtn.className = "heading-annotation-delete";
            deleteBtn.dataset.action = "delete";
            deleteBtn.setAttribute("role", "button");
            deleteBtn.title = "Delete heading";
            deleteBtn.textContent = "×";
            annot.appendChild(deleteBtn);
          }
        }

        renderAnnot();

        function toggleNumbered() {
          // Proxies to MAIN in a float (target === host editor).
          const target = getTarget();
          const resolved = resolveHeadingInTarget(target);
          if (!resolved) return;
          const tr = target.state.tr.setNodeMarkup(resolved.pos, undefined, {
            ...resolved.node.attrs,
            numbered: !(resolved.node.attrs.numbered !== false),
          });
          target.view.dispatch(tr);
        }

        function applyLevelChange(newLevel: number) {
          // Proxies to MAIN in a float (target === host editor).
          const target = getTarget();
          const resolved = resolveHeadingInTarget(target);
          if (!resolved) return;
          if (resolved.node.attrs.level === newLevel) return;
          const tr = target.state.tr.setNodeMarkup(resolved.pos, undefined, {
            ...resolved.node.attrs,
            level: newLevel,
          });
          target.view.dispatch(tr);
        }

        function demoteToParagraph() {
          // Gated off in floats: demoting the section's own heading to a
          // paragraph would dissolve the float's subject (decision 3).
          if (isFloat) return;
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          const paragraphType = nodeEditor.state.schema.nodes.paragraph;
          if (!paragraphType) return;
          const tr = nodeEditor.state.tr.setBlockType(p, p + 1, paragraphType);
          nodeEditor.view.dispatch(tr);
        }

        async function requestDelete() {
          // Gated off in floats: deleting the heading would dissolve the
          // float's own subject (decision 3). The delete × isn't rendered
          // in floats either; this is belt-and-suspenders.
          if (isFloat) return;
          const p = typeof getPos === "function" ? getPos() : null;
          if (p == null) return;
          const headingNode = nodeEditor.state.doc.nodeAt(p);
          if (!headingNode || headingNode.type.name !== "heading") return;
          const typeName = headingTypeName(headingNode.attrs.level as number);
          const confirmFn = refs.onConfirmHeadingDeleteRef?.current;
          const ok = confirmFn ? await confirmFn(typeName) : true;
          if (!ok) return;
          // Re-resolve after the modal — the doc shouldn't have shifted
          // while the user was deciding, but cheap insurance.
          const pos2 = typeof getPos === "function" ? getPos() : null;
          if (pos2 == null) return;
          const hn = nodeEditor.state.doc.nodeAt(pos2);
          if (!hn || hn.type.name !== "heading") return;
          const tr = nodeEditor.state.tr.delete(pos2, pos2 + hn.nodeSize);
          nodeEditor.view.dispatch(tr);
        }

        function openTypeMenu(target: HTMLElement) {
          const opener = refs.onOpenHeadingTypeMenuRef?.current;
          if (!opener) return;
          const rect = target.getBoundingClientRect();
          opener({
            anchorRect: rect,
            currentLevel: currentNode.attrs.level as number,
            onPick: (pick) => {
              if (pick.kind === "no-heading") {
                demoteToParagraph();
              } else {
                applyLevelChange(pick.level);
              }
            },
          });
        }

        // Phase 1: prevent browser default on mousedown so the contenteditable
        // doesn't receive focus (which would let PM steal it back later).
        annot.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        // Phase 2: dispatch on click. Walks up from the click target so a
        // click on the type chip's text or caret still resolves to the
        // chip's `data-action`.
        annot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const start = e.target as HTMLElement;
          let cursor: HTMLElement | null = start;
          while (cursor && cursor !== annot) {
            const action = cursor.dataset?.action;
            if (action === "type-menu") {
              openTypeMenu(cursor);
              return;
            }
            if (action === "toggle-numbered") {
              toggleNumbered();
              return;
            }
            if (action === "delete") {
              void requestDelete();
              return;
            }
            cursor = cursor.parentElement;
          }
          if (start.classList.contains("heading-label-text")) {
            enterEditMode(start);
          } else if (start.classList.contains("heading-label-add")) {
            // Materialize the label slot, then enter edit mode on the
            // freshly-inserted empty label span.
            const labelSpan = document.createElement("span");
            labelSpan.className = "heading-label-text";
            const sep = document.createElement("span");
            sep.className = "heading-annotation-sep";
            sep.textContent = "  ·  label: ";
            start.replaceWith(sep);
            sep.after(labelSpan);
            enterEditMode(labelSpan);
          }
        });

        return {
          dom: wrapper,
          contentDOM: h,
          // Tell ProseMirror to ignore all events originating from the annotation
          // area so it cannot steal focus from our label input.
          stopEvent(event) {
            if (annot === event.target || annot.contains(event.target as Node)) return true;
            if (foldBtn && (foldBtn === event.target || foldBtn.contains(event.target as Node))) return true;
            return false;
          },
          ignoreMutation(mutation) {
            // Ignore all mutations in the annotation area (label editing, etc.)
            if (annot.contains(mutation.target)) return true;
            // Mutations inside the fold chevron (contentEditable=false) should
            // also be ignored. (No chevron in floats — foldBtn is null.)
            if (foldBtn && foldBtn.contains(mutation.target)) return true;
            return false;
          },
          update(updatedNode) {
            if (updatedNode.type.name !== "heading") return false;
            if (updatedNode.attrs.level !== currentNode.attrs.level) return false;
            currentNode = updatedNode;
            // Keep section number in sync for CSS ::before
            if (updatedNode.attrs.numbered !== false && updatedNode.attrs.sectionNumber) {
              h.dataset.sectionNumber = updatedNode.attrs.sectionNumber;
            } else {
              delete h.dataset.sectionNumber;
            }
            // Don't overwrite annot if an input is active
            if (!annot.querySelector("input")) renderAnnot();
            refreshFoldBtn();
            return true;
          },
        };
      };
    },
    addProseMirrorPlugins() {
      // Float (FCU Chip B): OMIT the doc-wide `sectionNumbers` numberer +
      // `sectionFoldingPlugin`. The float holds a single section; running
      // the numberer would renumber it to "1", clobbering the real number
      // that rides in via the synced node attrs (the whole point of the
      // crux). Folding a float's lone section is meaningless. The heading
      // still renders its number/chip/divider from the synced attrs.
      if (isFloat) {
        return [...(this.parent?.() || [])];
      }
      return [
        ...(this.parent?.() || []),
        sectionFoldingPlugin(),
        // Focus view: hides out-of-band top-level blocks via a node decoration.
        // Main-only (omitted for float, like folding) — the mirror inherits it
        // via the shared editor.state. Fed the band by an EditorLayout effect
        // dispatching a focus-meta. Cannot reach card RichTextFields.
        focusViewPlugin(),
        new Plugin({
          key: new PluginKey("sectionNumbers"),
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;

            // Gate: skip the entire numberer (3 doc walks) unless the
            // observer says headings / figures / examples / labels
            // actually changed. Pure text edits inside a paragraph
            // produce contentChangedUuids only — the numberer's output
            // can't change in that case, so we bail immediately.
            //
            // Trade-off (memo §5): manually editing a labelRef's
            // `label` attribute via the popover doesn't trigger this
            // gate, so the labelRef's displayText may stay stale until
            // the next structural change. The labelRef-insert flow
            // (`\ref{x}` + Enter) sets displayText at insertion, so
            // the common case still works.
            const pending = readPendingDiff(newState);
            if (pending) {
              const structuralChange =
                pending.addedHeadings.length > 0 ||
                pending.removedHeadings.length > 0 ||
                pending.changedHeadings.length > 0 ||
                pending.addedFigures.length > 0 ||
                pending.removedFigures.length > 0 ||
                pending.changedFigures.length > 0 ||
                pending.addedExamples.length > 0 ||
                pending.removedExamples.length > 0 ||
                pending.exampleStructureChanged ||
                pending.addedLabels.length > 0 ||
                pending.removedLabels.length > 0;
              if (!structuralChange) return null;
            }

            // Collect heading positions & attrs
            const headings: { pos: number; level: number; numbered: boolean; cur: string | null }[] = [];
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name === "heading") {
                headings.push({
                  pos,
                  level: nd.attrs.level,
                  numbered: nd.attrs.numbered !== false,
                  cur: nd.attrs.sectionNumber,
                });
              }
            });
            // Don't bail when there are no headings — figures still need
            // numbering and label-ref resolution.

            // Find top-level among numbered headings (levels 0..6 — 7 sentinels "above all")
            let topLevel = 7;
            for (const h of headings) {
              if (h.numbered && h.level < topLevel) topLevel = h.level;
            }

            const counters = [0, 0, 0, 0, 0, 0, 0];
            const updates: { pos: number; num: string | null }[] = [];

            for (const h of headings) {
              if (h.numbered && topLevel <= 6) {
                const idx = h.level;
                counters[idx]++;
                for (let i = idx + 1; i < 7; i++) counters[i] = 0;
                const parts: number[] = [];
                for (let i = topLevel; i <= idx; i++) parts.push(counters[i]);
                const num = parts.join(".");
                if (num !== h.cur) updates.push({ pos: h.pos, num });
              } else if (h.cur !== null) {
                updates.push({ pos: h.pos, num: null });
              }
            }

            // Build label→section-number map from headings
            const headingMap = new Map<string, string>();
            for (const h of headings) {
              if (h.numbered && topLevel <= 6) {
                const nd = newState.doc.nodeAt(h.pos);
                const label = nd?.attrs.label as string | null;
                // Use the computed number (from updates or current)
                const upd = updates.find((u) => u.pos === h.pos);
                const num = upd ? upd.num : h.cur;
                if (label && num) headingMap.set(label, num);
              }
            }

            // Build tag/label → example-number map from exampleBlocks.
            // parentKey → { number: "3", items: Map<subKey, "a"> }
            const exampleMap = new Map<
              string,
              { number: string; items: Map<string, string> }
            >();
            newState.doc.descendants((nd) => {
              if (nd.type.name !== "exampleBlock") return true;
              const parentNum = nd.attrs.number ? String(nd.attrs.number) : "";
              if (!parentNum) return false;
              const entry = { number: parentNum, items: new Map<string, string>() };
              if (nd.attrs.tag) exampleMap.set(nd.attrs.tag, entry);
              if (nd.attrs.label) exampleMap.set(nd.attrs.label, entry);
              nd.descendants((child) => {
                if (child.type.name === "exampleItem") {
                  const sub = child.attrs.subLabel || "";
                  if (!sub) return false;
                  if (child.attrs.tag) entry.items.set(child.attrs.tag, sub);
                  if (child.attrs.label) entry.items.set(child.attrs.label, sub);
                  return false;
                }
                return true;
              });
              return false;
            });

            // Walk figureBlocks in document order. Numbered figures get
            // sequential 1-based numbers; unnumbered figures get
            // `figureNumber: null` and are skipped by the counter.
            const figureUpdates: { pos: number; figureNumber: number | null }[] = [];
            const figureMap = new Map<string, string>();
            let figureCounter = 0;
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name !== "figureBlock") return true;
              const isNumbered = nd.attrs.numbered !== false;
              let next: number | null = null;
              if (isNumbered) {
                figureCounter += 1;
                next = figureCounter;
              }
              const cur = nd.attrs.figureNumber as number | string | null;
              const curNorm =
                typeof cur === "string" && cur !== ""
                  ? parseInt(cur, 10)
                  : (cur as number | null);
              if (next !== curNorm) {
                figureUpdates.push({ pos, figureNumber: next });
              }
              const label = nd.attrs.label as string | undefined;
              if (label && next != null) {
                figureMap.set(label, String(next));
              }
              return false; // figureCaption child has no nested figures
            });

            // Resolve a label + refCommand → display text.
            const resolveRef = (label: string, refCommand: string): string => {
              if (!label) return "??";
              const heading = headingMap.get(label);
              if (heading) {
                return refCommand === "ref" ? heading : `(${heading})`;
              }
              // Example — parent form first
              const ex = exampleMap.get(label);
              if (ex) {
                return refCommand === "ref" ? ex.number : `(${ex.number})`;
              }
              const fig = figureMap.get(label);
              if (fig) {
                return refCommand === "ref" ? fig : `(${fig})`;
              }
              // Dotted "parent.sub" form for \getfullref (and \ref if the user
              // typed the dotted form)
              const dot = label.lastIndexOf(".");
              if (dot > 0) {
                const parentKey = label.slice(0, dot);
                const subKey = label.slice(dot + 1);
                const parent = exampleMap.get(parentKey);
                if (parent) {
                  const sub = parent.items.get(subKey) || subKey;
                  const full = `${parent.number}${sub}`;
                  return refCommand === "ref" ? full : `(${full})`;
                }
              }
              return "??";
            };

            // Check labelRef nodes for stale displayText
            const refUpdates: { pos: number; display: string }[] = [];
            newState.doc.descendants((nd, pos) => {
              if (nd.type.name === "labelRef") {
                const resolved = resolveRef(
                  nd.attrs.label as string,
                  (nd.attrs.refCommand as string) || "ref",
                );
                if (nd.attrs.displayText !== resolved) {
                  refUpdates.push({ pos, display: resolved });
                }
              }
            });

            if (
              updates.length === 0 &&
              refUpdates.length === 0 &&
              figureUpdates.length === 0
            )
              return null;
            const tr = newState.tr;
            for (const { pos, num } of updates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, sectionNumber: num });
            }
            for (const { pos, figureNumber } of figureUpdates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, figureNumber });
            }
            for (const { pos, display } of refUpdates) {
              const nd = newState.doc.nodeAt(pos);
              if (nd) tr.setNodeMarkup(pos, undefined, { ...nd.attrs, displayText: display });
            }
            return tr;
          },
        }),
      ];
    },
    // TipTap's Level type is 1..6; we widen to 0..6 because \part is
    // level 0 in our scheme. The schema attribute already accepts any
    // integer; configure() only uses `levels` for input rules and
    // keyboard shortcuts, both of which tolerate the wider range.
  }).configure({ levels: [0, 1, 2, 3, 4, 5, 6] as unknown as import("@tiptap/extension-heading").Level[] });
}


// --- buildEditorExtensions(ctx) — the FCU factory ----------------------
//
// The single source of the editor's TipTap extension stack. Consumed by the
// main editor today (surface: "main") and — from FCU Chips B/C — by every
// popped-out TextObject float (surface: "float"), so editor-appearance
// changes port to popouts automatically with no per-kind keying. See
// /Users/gabriel/.claude/plans/fcu-plan.md.

type FigureDeleteHandler = () => Promise<boolean>;

export interface EditorExtensionsCallbackRefs {
  isLabelTaken?: MutableRefObject<LabelTakenPredicate | undefined>;
  onConfirmLabelRename?: MutableRefObject<LabelRenameHandler | undefined>;
  onConfirmHeadingDelete?: MutableRefObject<HeadingDeleteHandler | undefined>;
  onOpenHeadingTypeMenu?: MutableRefObject<HeadingTypeMenuOpener | undefined>;
  onConfirmFigureDelete?: MutableRefObject<FigureDeleteHandler | undefined>;
}

export interface EditorExtensionsCtx {
  /** Which surface this stack is for. "main" emits the full stack; "float"
   *  (FCU Chips B/C) emits the shared core minus the doc-wide numberers /
   *  folding and the main-only chrome. */
  surface: "main" | "float";
  /** Main: ref mirroring the host's `editable` prop; drives readOnlyEnforcer. */
  editableRef?: RefObject<boolean>;
  /** Float: static editability (FCU Chips B/C). */
  editable?: boolean;
  /** When true, atoms render as compact card previews (floats). main: false. */
  cardContext: boolean;
  /** When true, FigureBlock / GraphicsBlock render their OWN lifted-overlay
   *  float (L3n) — editable caption + read-only image, no chrome, no
   *  click-to-edit. Set only by `figure-body.tsx`; the figure NodeView
   *  prefers it over `cardContext`. main / other floats: false. */
  figureFloat?: boolean;
  /** Heading / figure callback refs, read by the relocated NodeViews. */
  callbacks: EditorExtensionsCallbackRefs;
  /** docId mirror for FigureBlock / GraphicsBlock NodeViews. */
  docIdRef?: RefObject<string | null> | null;
  /** texBlock is-popped predicate (double-ref shape; see TexBlockOptions). */
  texBlockIsPoppedRef?: RefObject<
    RefObject<(uuid: string) => boolean> | undefined
  > | null;
  /** Paragraph UUIDs carrying marginalia — gates MarginaliaAnchorGuard. */
  anchoredUuidsRef?: RefObject<Set<string>>;
  /** Float: the main editor a float reads numbering from / proxies structural
   *  writes to. `null` for the main surface. (Exercised in FCU Chips B/C.) */
  host?: { getMainEditor: () => Editor | null } | null;
}

export function buildEditorExtensions(ctx: EditorExtensionsCtx) {
  // ONE ordered source of truth for both surfaces. The relative order is
  // load-bearing — DocStructureObserver MUST stay at index 1 (right after
  // StarterKit) for the keystroke-sanctity first-extension invariant — so a
  // single array (with `...(isMain ? [X] : [])` spreads for the main-only
  // chrome) keeps the two surfaces from drifting. For surface "main" this
  // emits the exact pre-FCU stack (Chip A's name-order test is the gate).
  //
  // Float (FCU Chip B): the shared core MINUS the doc-wide numberers/folding
  // (sectionNumbers / sectionFoldingPlugin — omitted inside the heading
  // builder's float mode — and ExpexNumbering) and the main-only chrome
  // (Placeholder, SlashPopupExtension, SmartQuotes, TextObjectOrphanGuard,
  // Title/Maketitle/Label handlers, EmptyParagraphTitleCleaner,
  // MarginaliaAnchorGuard, PgMarkChip, UuidAttrDecorator, readOnlyEnforcer).
  // TextColor is now SHARED (FCU Chip C1, decision 4) so colored text renders
  // faithfully in popouts — the exact Issue-2 fidelity class. Block atoms
  // render as compact card previews (`cardContext: true`) and the heading
  // builder proxies its structural writes to `ctx.host` (= MAIN).
  const isFloat = ctx.surface === "float";
  const isMain = !isFloat;

  const headingRefs: HeadingCallbackRefs = {
    isLabelTakenRef: ctx.callbacks.isLabelTaken,
    onConfirmLabelRenameRef: ctx.callbacks.onConfirmLabelRename,
    onConfirmHeadingDeleteRef: ctx.callbacks.onConfirmHeadingDelete,
    onOpenHeadingTypeMenuRef: ctx.callbacks.onOpenHeadingTypeMenu,
  };

  return [
    StarterKit.configure({
      heading: false,
      paragraph: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      blockquote: false,
      codeBlock: false,
      // Main styles the drop-cursor; floats disable it (they don't host
      // cross-block drops — matches the bodies' pre-FCU StarterKit config).
      dropcursor: isFloat ? false : { color: "var(--drag-highlight)", width: 2 },
    }),
    // Position 0 (after StarterKit). The observer must run first so
    // any appendTransaction plugin that wants to read the diff via
    // `readPendingDiff(state)` can do so. See
    // `docs/perf/keystroke-sanctity-findings.md` and
    // `src/lib/tiptap/doc-structure/`.
    DocStructureObserver,
    // Position 2 (right after the observer). Backfills a unique non-null uuid
    // onto every anchorable block by the end of its insertion transaction, so
    // dropped / pasted / split blocks are immediately graspable (the grab
    // handle + UuidAttrDecorator key off a non-null uuid). Reads the observer's
    // typed diff machinery, so it must run after it. Shared by both surfaces:
    // floats sync uuid-bearing content from main, and the move/re-sync identity
    // guard keeps those uuids stable (see block-uuid-backfill.ts).
    BlockUuidBackfill,
    createParagraphWithTitle(
      isFloat
        ? { surface: "float", host: ctx.host ?? undefined }
        : { surface: "main" },
    ),
    createHeadingWithLabel(
      headingRefs,
      isFloat
        ? { surface: "float", host: ctx.host ?? undefined }
        : { surface: "main" },
    ),
    createBulletListWithTitle(
      isFloat
        ? { surface: "float", host: ctx.host ?? undefined }
        : { surface: "main" },
    ),
    createOrderedListWithTitle(
      isFloat
        ? { surface: "float", host: ctx.host ?? undefined }
        : { surface: "main" },
    ),
    createListItemWithUuid(),
    createBlockquoteWithUuid(),
    createCodeBlockWithUuid(),
    // ── Borrowed-schema atoms (backlog #11) ──────────────────────────────
    // The block-atom previews (TexBlock/FigureBlock/FigureCaption/
    // GraphicsBlock + the LatexComment/Citation/LabelRef/Footnote/InlineMath/
    // DisplayMath inline atoms below) are the SAME set the card surfaces share
    // via `buildBorrowedAtomSchema` (src/lib/tiptap/borrowed-schema.ts). They
    // are NOT spread from that module here on purpose: on MAIN they carry
    // main-only config (isPoppedRef / docIdRef / figure callbacks / figureFloat
    // / per-surface `surface`) and sit in a position-gated order
    // (EXPECTED_MAIN_ORDER — the observer-first keystroke-sanctity invariant),
    // so a drop-in would either reorder the stack or make borrowed-schema.ts a
    // leaky owner of main-editor concerns. The cross-surface invariant ("add an
    // atom kind in one place") is instead enforced by the contract test
    // src/lib/tiptap/__tests__/borrowed-schema.test.ts, which asserts this main
    // stack registers EVERY name in BORROWED_INLINE_ATOM_NAMES /
    // BORROWED_BLOCK_ATOM_NAMES. Add a new atom to borrowed-schema.ts AND here;
    // that test fails until both surfaces carry it.
    TexBlock.configure({
      isPoppedRef: ctx.texBlockIsPoppedRef ?? null,
      cardContext: ctx.cardContext,
    }),
    FigureBlock.configure({
      docIdRef: ctx.docIdRef ?? null,
      onConfirmLabelRenameRef: ctx.callbacks.onConfirmLabelRename ?? null,
      onConfirmFigureDeleteRef: ctx.callbacks.onConfirmFigureDelete ?? null,
      cardContext: ctx.cardContext,
      figureFloat: ctx.figureFloat ?? false,
    }),
    FigureCaption,
    GraphicsBlock.configure({
      docIdRef: ctx.docIdRef ?? null,
      cardContext: ctx.cardContext,
      figureFloat: ctx.figureFloat ?? false,
    }),
    ...(isMain
      ? [
          Placeholder.configure({
            placeholder: "Start writing...",
          }),
        ]
      : []),
    Highlight.configure({
      multicolor: true,
    }),
    // TextColor: SHARED core (FCU Chip C1, decision 4). Colored text now
    // renders in popouts; main keeps it at the same position (order unchanged).
    TextColor,
    // Per-surface so the click→edit bridge fires from MAIN only: the bridge
    // (`virgil-math-click` → MathPopover → handleMathSave) edits MAIN by
    // absolute `pos`, meaningless from a float's getPos. Mirrors the sibling
    // NodeViews' surface threading above (memo L3h.1).
    InlineMath.configure({ surface: isFloat ? "float" : "main" }),
    DisplayMath.configure({ surface: isFloat ? "float" : "main" }),
    Footnote,
    // Per-surface so the atom's selection chrome stays MAIN-only: a float is a
    // single-node surface, so its atom-only doc rests a NodeSelection on the
    // lone comment and the NodeView would paint `.selected` chrome the page
    // never shows. Mirrors the math surface threading above (memo L3h.1).
    LatexComment.configure({ surface: isFloat ? "float" : "main" }),
    Citation,
    LabelRef,
    ExampleBlock,
    ExampleItemList,
    ExampleItem,
    ExampleGloss,
    AlignedGlossRow,
    ProseGlossRow,
    GlossCell,
    // ExpexNumbering: doc-wide example numberer — symmetric with
    // sectionNumbers, omitted on floats (example numbers ride in via the
    // synced node attrs). Decision 8.
    ...(isMain ? [ExpexNumbering] : []),
    LatexCommandMark,
    // Direct in-text Atom grab (footnote/citation/ref/inline math →
    // drag to a new inline cursor). Ungated: present on every surface
    // (main + card bodies) so any editor's atoms are graspable. Reads the
    // same `editableRef` the readOnlyEnforcer uses to stay inert in
    // read-only / no-pen state.
    InlineAtomGrab.configure({ editableRef: ctx.editableRef ?? null }),
    ...(isMain ? [SlashPopupExtension, SmartQuotes] : []),
    LinkedAnchor,
    LinkedAnchorGuard,
    ...(isMain ? [TextObjectOrphanGuard] : []),
    // titleField (L3j, bodyless kinds Chip 4): PROMOTED out of the main-only
    // spread to an always-included entry, so the FLOAT schema gains exactly
    // `titleField` — it was the lone bodyless kind that was main-only, which
    // blanked its popout. Its MAIN position is unchanged (the orphan guard
    // still precedes it, the maketitle/label/cleaner guards still follow it,
    // all still main-only), so EXPECTED_MAIN_ORDER stays byte-identical. The
    // siblings are doc-wide main-only guards; the float needs only the node
    // spec (like it already omits sectionNumbers / ExpexNumbering).
    TitleField,
    ...(isMain
      ? [
          MaketitleMarker,
          LabelHandler,
          EmptyParagraphTitleCleaner,
        ]
      : []),
    ...(isMain && ctx.anchoredUuidsRef
      ? [
          MarginaliaAnchorGuard.configure({
            anchoredUuidsRef: ctx.anchoredUuidsRef,
          }),
        ]
      : []),
    TabIndent,
    ...(isMain
      ? [
          PgMarkChip,
          // Emits `data-uuid` decorations on every anchorable block's outer
          // DOM element. The marginalia registry + drag hit-test depend on
          // these attributes being present in the live DOM. See uuid-attr.ts
          // for why this needs to be a decoration and not renderHTML.
          UuidAttrDecorator,
          // Read-only enforcement plugin: rejects any transaction that
          // mutates the document when the host's `editable` is false. For
          // surface "main" this reads the `editableRef` mirror of the React
          // `editable` prop, so it matches the former inline `readOnlyRef`
          // guard exactly (editableNow === !readOnlyRef.current). Floats
          // gate editability via TipTap's own `editable` flag instead.
          Extension.create({
            name: "readOnlyEnforcer",
            addProseMirrorPlugins() {
              return [
                new Plugin({
                  key: new PluginKey("readOnlyEnforcer"),
                  filterTransaction(tr) {
                    const editableNow = ctx.editableRef
                      ? ctx.editableRef.current
                      : true;
                    if (editableNow) return true;
                    if (!tr.docChanged) return true;
                    // Programmatic citation attribute syncs (panel-driven
                    // type changes refreshing the inline citation's command
                    // / displayText) tag their transactions with this meta
                    // so they pass through even in collaborator read-only
                    // mode. They don't touch document text, just node attrs.
                    if (tr.getMeta("ignoreReadOnly")) return true;
                    return false;
                  },
                }),
              ];
            },
          }),
        ]
      : []),
  ];
}
