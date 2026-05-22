"use client";

/**
 * Dispatcher for the drag-handle action menu. The user clicks a handle,
 * picks an action from the popover, and lands here with a
 * `TextObjectRef | SelectionRef` describing what the click acted on:
 * a persistent TextObject (paragraph, heading, list, listItem, etc.) or
 * a live text selection.
 *
 * Each action:
 *  1. Resolves the ref to a `{from, to}` range (or NodeSelection pos) in
 *     the main editor.
 *  2. Plants the editor's text selection over that range so all
 *     downstream code (anchor placement, footnote insertion, archive
 *     extraction, …) "sees" the same passage the handle represents.
 *  3. Calls the appropriate creation path with `mode: "omni"` so the
 *     new card is selected + pinned in its panel but NOT popped as a
 *     floating window — the user reads/edits the card directly in the
 *     omni-view on the panel's side.
 *  4. Ensures the omni-view is active on the panel's side (expanding a
 *     collapsed column or clearing a blanked side as needed). The active
 *     defaults are already omni, so this is usually a no-op.
 */

import { useCallback, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode, MarkType } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import type { CardCreationApi } from "./card-creation";
import type { EditorHandle } from "../../Editor";
import type { ViewPrefs, PanelId } from "@/hooks/useViewPrefs";
import {
  createLinkedAnchor,
  updateLinkedAnchorCard,
  type LinkedAnchorKind,
} from "@/links/links";
import { getSectionRangeByUuid } from "@/lib/section-range";
import type { ArchivedSnippet } from "@/lib/types";
import { generateShortId } from "@/lib/uuid";
import { focusNewCard } from "@/lib/focus-new-card";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "@/text-objects/text-object-registry";
import type {
  TextObjectKind,
  TextObjectRef,
  SelectionRef,
} from "@/text-objects/types";

/**
 * The handle dispatcher acts on either a TextObject (persistent node or
 * linkedRange) or a live selection (gesture-input). Re-exported under a
 * single union for callers that don't care which it is.
 */
export type DragHandleRef = TextObjectRef | SelectionRef;

export interface DragHandleActionsDeps {
  editorRef: RefObject<EditorHandle | null>;
  cardCreation: CardCreationApi;
  archiveContent: (content: unknown) => ArchivedSnippet;
  updateArchiveSnippet: (id: string, content: unknown) => void;
  addArchiveTextObjectId: (id: string, paragraphId: string) => void;
  setSelectedArchiveId: (id: string | null) => void;
  pinRecentlyAddedArchive?: (id: string) => void;
  prefs: ViewPrefs;
  expandLeft: () => void;
  expandRight: () => void;
  clearBlankIfSet: () => void;
}

/**
 * Resolved view of a ref in the doc. `selectionKind` tells the
 * dispatcher whether to plant a TextSelection over `{from, to}` (text-
 * bearing blocks, ranges, sections) or a NodeSelection at `pos` (block
 * atoms). `from`/`to` remain meaningful in both variants — atom-aware
 * call sites use `pos`, while text probes (e.g. `textBetween` for the
 * highlight no-op guard) still get a usable range.
 */
type ResolvedRef =
  | { selectionKind: "text"; from: number; to: number }
  | { selectionKind: "node"; pos: number; from: number; to: number };

export function useDragHandleActions(deps: DragHandleActionsDeps) {
  const {
    editorRef,
    cardCreation,
    archiveContent,
    updateArchiveSnippet,
    addArchiveTextObjectId,
    setSelectedArchiveId,
    pinRecentlyAddedArchive,
    prefs,
    expandLeft,
    expandRight,
    clearBlankIfSet,
  } = deps;

  const ensureOmniActiveForPanel = useCallback(
    (panelId: PanelId) => {
      const placement = prefs.placements.find((p) => p.id === panelId);
      const side = placement?.side ?? "right";
      const active = side === "left" ? prefs.activeLeft : prefs.activeRight;
      if (active == null) {
        if (side === "left") expandLeft();
        else expandRight();
        return;
      }
      if (active === "blank") {
        clearBlankIfSet();
      }
    },
    [
      prefs.placements,
      prefs.activeLeft,
      prefs.activeRight,
      expandLeft,
      expandRight,
      clearBlankIfSet,
    ],
  );

  const dispatch = useCallback(
    (action: DragHandleAction, ref: DragHandleRef) => {
      const handle = editorRef.current;
      const ed = handle?.getEditor();
      if (!handle || !ed) return;

      const resolved = resolveRefRange(ed, ref);
      if (!resolved) return;

      // Plant the main editor's selection so anchor / footnote / archive
      // paths operate on the right region. Atom refs plant a
      // NodeSelection on the block itself (which atom-aware paths like
      // `archiveSelection` detect); text-bearing refs plant a
      // TextSelection over the range, as before.
      try {
        if (resolved.selectionKind === "node") {
          ed.view.dispatch(
            ed.state.tr.setSelection(
              NodeSelection.create(ed.state.doc, resolved.pos),
            ),
          );
        } else {
          ed.commands.setTextSelection({ from: resolved.from, to: resolved.to });
        }
      } catch {
        return;
      }

      const range = { from: resolved.from, to: resolved.to };
      const text = ed.state.doc.textBetween(range.from, range.to, " ").trim();
      const paragraphId = ref.kind === "selection" ? ref.paragraphId : ref.id;
      // Only the selection / linkedRange refs hold a literal text range
      // whose first-line top is meaningful for a range anchor — Mode B
      // cards (note/highlight/cutter/revision) drop a linkedAnchor mark
      // when invoked from a range source. Block refs (paragraph, heading,
      // list, listItem, …) anchor at the block level — no mark.
      const wantRangeAnchor =
        text.length > 0 &&
        (ref.kind === "selection" || ref.kind === "linkedRange");

      let panelId: PanelId | null = null;

      // Each branch records the new card's key prefix + id so we can hand
      // focus into its main editable field right after React renders it.
      let focusCardKey: string | null = null;

      switch (action) {
        case "footnote": {
          // Footnote anchor goes at the end of the passage. Collapse the
          // selection there before calling createFootnote — its
          // `fromSelection: false` path inserts an empty footnote atom at
          // the current cursor.
          try {
            ed.commands.setTextSelection(range.to);
          } catch {
            /* ignore */
          }
          const result = cardCreation.createFootnote({
            fromSelection: false,
            mode: "omni",
          });
          if (result) {
            panelId = "footnotes";
            focusCardKey = `footnote:${result.footnoteId}`;
          }
          break;
        }
        case "citation": {
          // Drop a [cite] placeholder pill at the end of the captured
          // passage (matches the footnote convention above), then register
          // an *anchored* panel ref with the same citationId so the card
          // appears under the anchored group with the picker open.
          try {
            ed.commands.setTextSelection(range.to);
          } catch {
            /* ignore */
          }
          const existingIds = handle.getCitationIds();
          const citationId = generateShortId(existingIds);
          handle.insertCitation("\\cite{}", citationId, "");
          const ref = cardCreation.createCitation({
            command: "\\cite{}",
            citationId,
            unanchored: false,
            mode: "omni",
          });
          panelId = "citations";
          focusCardKey = `citation:${ref.id}`;
          break;
        }
        case "quotation": {
          const group = cardCreation.createQuotation({
            text: text || undefined,
            paragraphId,
            mode: "omni",
          });
          panelId = "quotations";
          focusCardKey = `quotation:${group.id}`;
          break;
        }
        case "note": {
          const anchor = wantRangeAnchor ? createAnchor(ed, "note") : undefined;
          const note = cardCreation.createNote({
            paragraphId,
            anchor,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(ed, anchor.anchorId, "note", note.id);
          }
          panelId = "notes";
          focusCardKey = `note:${note.id}`;
          break;
        }
        case "highlight": {
          // Highlights always anchor to a range. For block refs the
          // selection spans the whole node's content, so the linkedAnchor
          // wraps the entire passage.
          if (!text) break;
          const record = createLinkedAnchor(ed, "highlight", undefined, undefined, {
            tintColor: "#fbbf24",
          });
          if (!record) break;
          const card = cardCreation.createHighlight({
            anchor: { anchorId: record.anchorId, anchorText: record.text },
            paragraphId,
            mode: "omni",
          });
          updateLinkedAnchorCard(ed, record.anchorId, "highlight", card.id);
          panelId = "notes";
          focusCardKey = `highlight:${card.id}`;
          break;
        }
        case "todo": {
          const todo = cardCreation.createTodo({
            text: text || undefined,
            paragraphId,
            mode: "omni",
          });
          panelId = "todo";
          focusCardKey = `todo:${todo.id}`;
          break;
        }
        case "suggest-edit": {
          const anchor = wantRangeAnchor ? createAnchor(ed, "revision") : undefined;
          const card = cardCreation.createRevisionComment({
            paragraphId,
            anchor,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(ed, anchor.anchorId, "comment", card.id);
          }
          panelId = "revisions";
          focusCardKey = `revision:${card.id}`;
          break;
        }
        case "cutter": {
          const anchor = wantRangeAnchor
            ? createAnchor(ed, "cutter-comment")
            : undefined;
          const card = cardCreation.createCutterComment({
            paragraphId,
            anchor,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(
              ed,
              anchor.anchorId,
              "cutter-comment",
              card.id,
            );
          }
          panelId = "cutter";
          focusCardKey = `cutter-comment:${card.id}`;
          break;
        }
        case "archive": {
          // archiveSelection slices the current selection into JSON, so the
          // ref's selection-kind is sufficient — atom NodeSelections
          // archive the atom node itself, text selections archive their
          // range. The `text` guard only protects against zero-content text
          // ranges; atom refs always have a meaningful slice.
          if (resolved.selectionKind === "text" && !text) break;
          const snippet = archiveContent(text);
          const result = handle.archiveSelection(snippet.id);
          if (result) {
            if (result.content) updateArchiveSnippet(snippet.id, result.content);
            if (result.paragraphId)
              addArchiveTextObjectId(snippet.id, result.paragraphId);
          }
          setSelectedArchiveId(snippet.id);
          pinRecentlyAddedArchive?.(snippet.id);
          panelId = "archive";
          focusCardKey = `archive:${snippet.id}`;
          break;
        }
      }

      if (panelId) ensureOmniActiveForPanel(panelId);

      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }

      // Drop cursor into the new card's main editable field once it
      // mounts. The card needs a couple of React commits to render
      // (state update → panel re-render → card mount), so we retry a
      // handful of frames before giving up.
      if (focusCardKey) focusNewCard(focusCardKey);
    },
    [
      editorRef,
      cardCreation,
      archiveContent,
      updateArchiveSnippet,
      addArchiveTextObjectId,
      setSelectedArchiveId,
      pinRecentlyAddedArchive,
      ensureOmniActiveForPanel,
    ],
  );

  return { dispatch };
}

function createAnchor(ed: Editor, kind: LinkedAnchorKind) {
  const record = createLinkedAnchor(ed, kind);
  if (!record) return undefined;
  return { anchorId: record.anchorId, anchorText: record.text };
}

/**
 * Resolve a `TextObjectRef | SelectionRef` to a doc range plus selection
 * kind. Dispatch is driven by the registry — atom-block kinds get
 * NodeSelection, `heading` gets the section range (heading + body),
 * `linkedRange` is found by walking the linkedAnchor mark across the doc,
 * everything else gets the node's content range.
 */
function resolveRefRange(ed: Editor, ref: DragHandleRef): ResolvedRef | null {
  if (ref.kind === "selection") {
    const docSize = ed.state.doc.content.size;
    const from = Math.max(0, Math.min(ref.from, docSize));
    const to = Math.max(0, Math.min(ref.to, docSize));
    if (to <= from) return null;
    return { selectionKind: "text", from, to };
  }

  if (!isTextObjectKind(ref.kind)) return null;
  const meta = TEXT_OBJECT_REGISTRY[ref.kind];

  if (meta.isRange) {
    // linkedRange — walk the doc for the linkedAnchor mark with this id.
    const markType = ed.state.schema.marks.linkedAnchor;
    if (!markType) return null;
    const bounds = findLinkedRangeBounds(ed.state.doc, ref.id, markType);
    if (!bounds) return null;
    return { selectionKind: "text", from: bounds.from, to: bounds.to };
  }

  if (ref.kind === "heading") {
    const section = getSectionRangeByUuid(ed.state.doc, ref.id);
    if (!section) return null;
    return { selectionKind: "text", from: section.start, to: section.end };
  }

  // Locate the node by uuid.
  let result: ResolvedRef | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (result) return false;
    if (
      node.type.name === ref.kind &&
      (node.attrs?.uuid as string | null) === ref.id
    ) {
      if (meta.isAtomBlock && node.type.isBlock) {
        result = {
          selectionKind: "node",
          pos,
          from: pos,
          to: pos + node.nodeSize,
        };
      } else {
        result = {
          selectionKind: "text",
          from: pos + 1,
          to: pos + node.nodeSize - 1,
        };
      }
      return false;
    }
    return true;
  });
  return result;
}

function findLinkedRangeBounds(
  doc: PMNode,
  anchorId: string,
  markType: MarkType,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const has = node.marks.some(
      (m) => m.type === markType && m.attrs.anchorId === anchorId,
    );
    if (has) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  if (from < 0) return null;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Re-exports for callers that constructed the old `DragHandlePassage`
// union. After D2 they import the new types directly.
// ---------------------------------------------------------------------------

export type { TextObjectKind, TextObjectRef, SelectionRef };
