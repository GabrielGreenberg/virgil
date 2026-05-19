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
import { isAnchorableNode } from "@/lib/marginalia";
import { generateShortId } from "@/lib/uuid";
import { focusNewCard } from "@/lib/focus-new-card";
import type { DragHandleAction } from "@/components/DragHandleMenu";

export type DragHandlePassage =
  | { kind: "paragraph"; paragraphId: string }
  | { kind: "selection"; paragraphId: string; from: number; to: number }
  | { kind: "heading"; paragraphId: string };

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

interface ResolvedRange {
  from: number;
  to: number;
}

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

      const range = resolvePassageRange(ed, passage);
      if (!range) return;

      // Plant the main editor's selection over the passage so anchor /
      // footnote / archive paths operate on the right text.
      try {
        ed.commands.setTextSelection(range);
      } catch {
        return;
      }

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
          const card = cardCreation.createRevisionSuggestion({
            paragraphId,
            originalText: text || undefined,
            anchor,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(
              ed,
              anchor.anchorId,
              "revision-suggestion",
              card.id,
            );
          }
          panelId = "revisions";
          focusCardKey = `revision-suggestion:${card.id}`;
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
          // archiveSelection needs a non-empty selection (which we've set
          // above). Behaves correctly for paragraph (whole-paragraph
          // selection collapses to a paragraph delete), selection
          // (subrange delete), and heading (multi-block section delete).
          if (!text) break;
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
 * Resolve a Passage to a {from, to} range in the main editor's doc.
 * - "selection" passes through.
 * - "paragraph" locates the paragraph node by uuid and returns the range
 *   of its content (start..end, inside the node).
 * - "heading" returns the section range (heading + body), which is
 *   suitable for archive (multi-block delete) and for anchoring cards
 *   to "the whole section."
 */
function resolvePassageRange(
  ed: Editor,
  passage: DragHandlePassage,
): ResolvedRange | null {
  if (passage.kind === "selection") {
    const docSize = ed.state.doc.content.size;
    const from = Math.max(0, Math.min(passage.from, docSize));
    const to = Math.max(0, Math.min(passage.to, docSize));
    if (to <= from) return null;
    return { from, to };
  }

  if (passage.kind === "paragraph") {
    let result: ResolvedRange | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (result) return false;
      if (
        isAnchorableNode(node.type) &&
        (node.attrs?.uuid as string | null) === passage.paragraphId
      ) {
        result = { from: pos + 1, to: pos + node.nodeSize - 1 };
        return false;
      }
      return true;
    });
    return result;
  }

  const section = getSectionRangeByUuid(ed.state.doc, passage.paragraphId);
  if (!section) return null;
  return { from: section.start, to: section.end };
}
