"use client";

/**
 * Dispatcher for the paragraph / selection / heading drag-handle action
 * menu. The user clicks a handle, picks an action from the popover, and
 * lands here with a `Passage` describing what the click acted on (whole
 * paragraph, captured range, or whole section).
 *
 * Each action:
 *  1. Resolves the passage to a `{from, to}` range in the main editor.
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
import { isAnchorableAtom, isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { focusNewCard } from "@/lib/focus-new-card";
import type { DragHandleAction } from "@/components/DragHandleMenu";

export type DragHandlePassage =
  | { kind: "paragraph"; paragraphId: string }
  | { kind: "selection"; paragraphId: string; from: number; to: number }
  | { kind: "heading"; paragraphId: string }
  // Any block-level atom node (texBlock, figureBlock, graphicsBlock,
  // aiRequest, …) referenced by its anchor uuid. Routed to a NodeSelection
  // so atom-aware downstream code (archive, copy, etc.) sees the right
  // selection type instead of a TextSelection collapsed across the atom.
  | { kind: "atomBlock"; paragraphId: string };

export interface DragHandleActionsDeps {
  editorRef: RefObject<EditorHandle | null>;
  cardCreation: CardCreationApi;
  archiveContent: (content: unknown) => ArchivedSnippet;
  updateArchiveSnippet: (id: string, content: unknown) => void;
  addArchiveParagraphId: (id: string, paragraphId: string) => void;
  setSelectedArchiveId: (id: string | null) => void;
  pinRecentlyAddedArchive?: (id: string) => void;
  prefs: ViewPrefs;
  expandLeft: () => void;
  expandRight: () => void;
  clearBlankIfSet: () => void;
}

/**
 * Resolved view of a passage in the doc. `selectionKind` tells the
 * dispatcher whether to plant a TextSelection over `{from, to}` (text-
 * bearing blocks, ranges, sections) or a NodeSelection at `pos` (block
 * atoms). `from`/`to` remain meaningful in both variants — atom-aware
 * call sites use `pos`, while text probes (e.g. `textBetween` for the
 * highlight no-op guard) still get a usable range.
 */
type ResolvedPassage =
  | { selectionKind: "text"; from: number; to: number }
  | { selectionKind: "node"; pos: number; from: number; to: number };

export function useDragHandleActions(deps: DragHandleActionsDeps) {
  const {
    editorRef,
    cardCreation,
    archiveContent,
    updateArchiveSnippet,
    addArchiveParagraphId,
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
    (action: DragHandleAction, passage: DragHandlePassage) => {
      const handle = editorRef.current;
      const ed = handle?.getEditor();
      if (!handle || !ed) return;

      const resolved = resolvePassageRange(ed, passage);
      if (!resolved) return;

      // Plant the main editor's selection so anchor / footnote / archive
      // paths operate on the right region. Atom passages plant a
      // NodeSelection on the block itself (which atom-aware paths like
      // `archiveSelection` detect); text-bearing passages plant a
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
      const paragraphId = passage.paragraphId;
      // For paragraph/heading the action is "scoped to the block": no
      // linkedAnchor mark is created (cards are paragraph-anchored, not
      // range-anchored). Only the selection passage creates a range mark.
      const wantRangeAnchor = passage.kind === "selection" && text.length > 0;

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
          // Highlights always anchor to a range. For paragraph/heading
          // passages the selection already spans the whole block, so the
          // linkedAnchor wraps the entire passage.
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
          // passage's selection-kind is sufficient — atom NodeSelections
          // archive the atom node itself, text selections archive their
          // range. The `text` guard only protects against zero-content text
          // ranges; atom passages always have a meaningful slice.
          if (resolved.selectionKind === "text" && !text) break;
          const snippet = archiveContent(text);
          const result = handle.archiveSelection(snippet.id);
          if (result) {
            if (result.content) updateArchiveSnippet(snippet.id, result.content);
            if (result.paragraphId)
              addArchiveParagraphId(snippet.id, result.paragraphId);
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
      addArchiveParagraphId,
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
 * Resolve a Passage to a ResolvedPassage in the main editor's doc.
 * - "selection" passes through as a text range.
 * - "paragraph" locates the paragraph (or other text-bearing anchorable
 *   node) by uuid and returns its content range as text.
 * - "heading" returns the section range (heading + body) as text — suits
 *   archive (multi-block delete) and section-scoped card anchoring.
 * - "atomBlock" locates a block-level atom node by uuid and returns
 *   `selectionKind: "node"` with its position, so the dispatcher plants a
 *   NodeSelection. Used for any block atom that exposes a drag handle
 *   (texBlock today; figureBlock / graphicsBlock / aiRequest when wired).
 */
function resolvePassageRange(
  ed: Editor,
  passage: DragHandlePassage,
): ResolvedPassage | null {
  if (passage.kind === "selection") {
    const docSize = ed.state.doc.content.size;
    const from = Math.max(0, Math.min(passage.from, docSize));
    const to = Math.max(0, Math.min(passage.to, docSize));
    if (to <= from) return null;
    return { selectionKind: "text", from, to };
  }

  if (passage.kind === "paragraph") {
    let result: ResolvedPassage | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (result) return false;
      if (
        isAnchorableNode(node.type) &&
        (node.attrs?.uuid as string | null) === passage.paragraphId
      ) {
        result = {
          selectionKind: "text",
          from: pos + 1,
          to: pos + node.nodeSize - 1,
        };
        return false;
      }
      return true;
    });
    return result;
  }

  if (passage.kind === "atomBlock") {
    // Find any block atom carrying this uuid. The dispatcher then plants
    // a NodeSelection at `pos` so atom-aware paths (archiveSelection,
    // getSelectedText, copy, etc.) see the right selection type. `from`/
    // `to` span the node itself, sufficient for `textBetween`-based
    // probes used elsewhere (e.g. highlight's no-op guard).
    let result: ResolvedPassage | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (result) return false;
      if (
        isAnchorableAtom(node.type) &&
        node.type.isBlock &&
        (node.attrs?.uuid as string | null) === passage.paragraphId
      ) {
        result = {
          selectionKind: "node",
          pos,
          from: pos,
          to: pos + node.nodeSize,
        };
        return false;
      }
      return true;
    });
    return result;
  }

  const section = getSectionRangeByUuid(ed.state.doc, passage.paragraphId);
  if (!section) return null;
  return { selectionKind: "text", from: section.start, to: section.end };
}
