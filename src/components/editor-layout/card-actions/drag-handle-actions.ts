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
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { duplicateSlice } from "@/text-objects/duplicate-slice";
import {
  cleanupLinksInRange,
  expandCascadeRange,
} from "@/text-objects/delete-range";
import type { CardCreationApi } from "./card-creation";
import type { EditorHandle } from "../../Editor";
import type { ViewPrefs, PanelId } from "@/hooks/useViewPrefs";
import {
  createLinkedAnchor,
  paragraphUuidAt,
  updateLinkedAnchorCard,
  type LinkedAnchorKind,
} from "@/links/links";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { generateShortId } from "@/lib/uuid";
import { focusNewCard } from "@/lib/focus-new-card";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { parseLinkCardKey } from "@/links/link-registry";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
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
  /** Per-CardKind clone/delete SSOT. Used by the `duplicate` and
   *  `delete` actions to fork or remove sidecar entries for any inline
   *  atoms / linkedAnchor marks living in the captured passage. The
   *  walkers never branch on kind — they look up via this API. */
  cardLifecycle: CardLifecycleApi;
  /** In-app confirm dialog. Used to surface the Class D wide-scope
   *  warning before lifecycle actions fire on a heading (whole-section
   *  duplicate / archive / delete). The promise resolves true on
   *  confirm, false on cancel. See ACTION-MENU-DIAGNOSIS.md cluster C5. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
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
    cardLifecycle,
    confirm,
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
    async (action: DragHandleAction, ref: DragHandleRef) => {
      const handle = editorRef.current;
      const ed = handle?.getEditor();
      if (!handle || !ed) return;

      // Class D wide-scope warning: lifecycle actions on a heading
      // operate on the whole section. Surface the section summary in
      // a confirm dialog before firing. Cancel returns silently.
      if (
        ref.kind === "heading" &&
        (action === "duplicate" || action === "archive" || action === "delete")
      ) {
        const proceed = await confirmHeadingLifecycle(ed, ref, action, confirm);
        if (!proceed) return;
      }

      // Annotation actions (H/N/F/C/Q/T/E/X) work on the heading line for
      // headings; lifecycle actions (D/A/⌫) work on the whole section.
      // Non-heading kinds yield the same range either way. See C9/C11.
      const resolved = resolveRefRange(ed, ref, actionClass(action));
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
      // paragraphId resolution per ref-kind. Selection refs already carry
      // a paragraph uuid; block refs use their own uuid; linkedRange refs
      // hold an `anchorId`, NOT a paragraph uuid, so we walk up from the
      // mark's start position to find the containing block. See
      // ACTION-MENU-DIAGNOSIS.md cluster C10.
      let paragraphId: string;
      if (ref.kind === "selection") {
        paragraphId = ref.paragraphId;
      } else if (ref.kind === "linkedRange") {
        paragraphId = paragraphUuidAt(ed.state.doc, resolved.from) ?? "";
      } else {
        paragraphId = ref.id;
      }
      // The kind of TextObject the new card's Mode A link should record
      // as `targetKind`. SelectionRefs anchor to the containing paragraph
      // (ref.paragraphId is a paragraph uuid). Block refs (paragraph,
      // heading, listItem, exampleItem, atom blocks, …) anchor at the
      // block level and record their actual kind — D9 sub-object
      // anchoring depends on this being correct. linkedRange refs follow
      // selection semantics (the mark wraps text inside a paragraph),
      // so we record `paragraph` here too.
      const targetKind: import("@/text-objects/types").TextObjectKind =
        ref.kind === "selection" || ref.kind === "linkedRange"
          ? "paragraph"
          : ref.kind;
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
            targetKind,
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
            targetKind,
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
            targetKind,
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
            targetKind,
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
            targetKind,
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
        case "duplicate": {
          // Slice the OUTER block bounds (so the wrapper node travels with
          // its contents), deep-clone it via the registry-driven walker
          // (which remints every uuid / inline-atom id / linkedAnchor mark
          // and clones the corresponding sidecar entries), then insert the
          // clone immediately after the source.
          const outer = outerRangeFor(ed, ref);
          if (!outer || outer.to <= outer.from) break;
          const slice = ed.state.doc.slice(outer.from, outer.to);
          if (slice.size === 0) break;
          const cloned = duplicateSlice(slice, cardLifecycle);
          const tr = ed.state.tr.replace(outer.to, outer.to, cloned);
          // Drop the caret near the start of the inserted duplicate so the
          // user can immediately see/move it. `near` snaps to a valid text
          // position regardless of node type.
          try {
            const insertPos = outer.to;
            if (insertPos <= tr.doc.content.size) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
            }
          } catch {
            /* ignore — selection placement is best-effort */
          }
          ed.view.dispatch(tr);
          // C2: walk the inserted slice and rewire each cloned card's
          // `links[]` back to its mark via `lifecycle.bindAnchor`. The
          // duplicate-slice walker already minted fresh anchorIds + new
          // linkCard keys on the marks; this pass populates the card's
          // own links so card → editor jump-to lands on the clone, not
          // the source. Action-time, bounded by the inserted slice's
          // size — no keystroke-sanctity impact.
          rewireClonedAnchors(ed, outer.to, cloned.size, cardLifecycle);
          break;
        }
        case "archive": {
          // C4: archive is now a peer of Delete via `cardCreation`. The
          // five ad-hoc deps (`archiveContent` / `updateArchiveSnippet`
          // / `addArchiveTextObjectId` / `setSelectedArchiveId` /
          // `pinRecentlyAddedArchive`) all live inside
          // `cardCreation.createArchiveSnippet` now. Dispatcher's job
          // here is the editor mutation: snapshot the content, cascade,
          // cleanup sidecars, delete the range, then mint the snippet.
          //
          // `text` guard protects against zero-content text ranges;
          // atom NodeSelections always have a meaningful slice.
          if (resolved.selectionKind === "text" && !text) break;
          const outer = outerRangeFor(ed, ref);
          if (!outer || outer.to <= outer.from) break;
          // Same cascade as Delete — if the wrapper would be empty
          // after the deletion, swallow it too. See C6.
          const extended = expandCascadeRange(ed.state.doc, outer);
          // Snapshot the full slice (rich JSON) BEFORE deletion so the
          // archive snippet preserves paragraph structure, atom blocks,
          // and any inline atoms it carries.
          const slice = ed.state.doc.slice(extended.from, extended.to);
          const richContent = { type: "doc", content: slice.content.toJSON() };
          cleanupLinksInRange(
            ed.state.doc,
            extended.from,
            extended.to,
            cardLifecycle,
          );
          const tr = ed.state.tr.delete(extended.from, extended.to);
          ed.view.dispatch(tr);
          // The pre-delete `paragraphId` is the source block's uuid;
          // for paragraph/heading/listItem × Archive that block is now
          // gone. The C3 orphan sweep (Landing 6c) clears stale Mode A
          // links automatically — appropriate, since archived content
          // is "moved out of the document" by definition.
          const snippet = cardCreation.createArchiveSnippet({
            text,
            content: richContent,
            paragraphId,
            targetKind,
            mode: "omni",
          });
          panelId = "archive";
          focusCardKey = `archive:${snippet.id}`;
          break;
        }
        case "delete": {
          // Outer block bounds so the wrapper goes with its contents.
          // The cleanup walker enumerates every sidecar-bearing element
          // inside the range (inline footnote/citation atoms +
          // linkedAnchor marks) and calls each kind's lifecycle.delete
          // so the deletion doesn't leak orphan sidecar entries.
          const outer = outerRangeFor(ed, ref);
          if (!outer || outer.to <= outer.from) break;
          // C6: if removing this child empties a structural wrapper
          // (last listItem in a list, last exampleItem in an
          // exampleItemList / exampleBlock), extend the range to
          // include the wrapper so PM's content-rule auto-fill never
          // gets a chance to inject a placeholder.
          const extended = expandCascadeRange(ed.state.doc, outer);
          cleanupLinksInRange(
            ed.state.doc,
            extended.from,
            extended.to,
            cardLifecycle,
          );
          const tr = ed.state.tr.delete(extended.from, extended.to);
          ed.view.dispatch(tr);
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
      cardLifecycle,
      confirm,
      ensureOmniActiveForPanel,
    ],
  );

  return { dispatch };
}

/**
 * Build a Class D wide-scope summary for heading lifecycle actions and
 * await the user's confirmation. See ACTION-MENU-DIAGNOSIS.md cluster
 * C5. The summary reads off the section nodes the registry already
 * returns from `collectMoveSource`, so the message body never walks the
 * doc twice.
 */
async function confirmHeadingLifecycle(
  ed: Editor,
  ref: TextObjectRef,
  action: "duplicate" | "archive" | "delete",
  confirm: (opts: ConfirmOptions) => Promise<boolean>,
): Promise<boolean> {
  const meta = TEXT_OBJECT_REGISTRY.heading;
  const source = meta.collectMoveSource?.(ed.state.doc, ref.id);
  if (!source) return true; // fail-open if the section can't be resolved
  const headingNode = source.nodes[0];
  const headingText = headingNode?.textContent?.trim() ?? "";
  const paragraphCount = source.nodes.filter(
    (n) => n.type.name === "paragraph",
  ).length;
  const subHeadingCount = source.nodes.filter(
    (n, i) => i > 0 && n.type.name === "heading",
  ).length;
  const verbs: Record<typeof action, { verb: string; confirmLabel: string }> = {
    duplicate: { verb: "duplicate", confirmLabel: "Duplicate section" },
    archive: { verb: "archive", confirmLabel: "Archive section" },
    delete: { verb: "delete", confirmLabel: "Delete section" },
  };
  const { verb, confirmLabel } = verbs[action];
  const counts: string[] = [];
  if (paragraphCount > 0) {
    counts.push(`${paragraphCount} paragraph${paragraphCount === 1 ? "" : "s"}`);
  }
  if (subHeadingCount > 0) {
    counts.push(
      `${subHeadingCount} sub-heading${subHeadingCount === 1 ? "" : "s"}`,
    );
  }
  const countsText = counts.length > 0 ? ` — ${counts.join(", ")}` : "";
  const titleText = headingText ? `"${headingText}"` : "this section";
  return confirm({
    title: `${verb[0].toUpperCase() + verb.slice(1)} the entire section?`,
    message: `This will ${verb} the entire section ${titleText}${countsText}.`,
    confirmLabel,
    tone: action === "delete" ? "danger" : "default",
  });
}

/**
 * Outer block bounds for a ref — what the Duplicate and Delete actions
 * operate on. Unlike `resolveRefRange` (which returns the INNER content
 * range for text-bearing blocks because archive/note/etc. want the text
 * inside), this returns the full node bounds so the wrapper node travels
 * with its contents during slice / delete.
 *
 *   selection         → the selection's range as-is
 *   heading           → section bounds (heading + body, via collectMoveSource)
 *   linkedRange       → mark bounds (the menu never opens for this kind,
 *                       but kept for completeness)
 *   block / sub-object → {pos, pos + nodeSize}
 *   atom block         → {pos, pos + nodeSize}
 */
function outerRangeFor(
  ed: Editor,
  ref: DragHandleRef,
): { from: number; to: number } | null {
  if (ref.kind === "selection") {
    const docSize = ed.state.doc.content.size;
    const from = Math.max(0, Math.min(ref.from, docSize));
    const to = Math.max(0, Math.min(ref.to, docSize));
    return to > from ? { from, to } : null;
  }
  if (!isTextObjectKind(ref.kind)) return null;
  const meta = TEXT_OBJECT_REGISTRY[ref.kind];

  if (meta.isRange) {
    const markType = ed.state.schema.marks.linkedAnchor;
    if (!markType) return null;
    return findLinkedRangeBounds(ed.state.doc, ref.id, markType);
  }

  if (ref.kind === "heading") {
    const section = getSectionRangeByUuid(ed.state.doc, ref.id);
    return section ? { from: section.start, to: section.end } : null;
  }

  let result: { from: number; to: number } | null = null;
  ed.state.doc.descendants((node, pos) => {
    if (result) return false;
    if (
      node.type.name === ref.kind &&
      (node.attrs?.uuid as string | null) === ref.id
    ) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

function createAnchor(ed: Editor, kind: LinkedAnchorKind) {
  const record = createLinkedAnchor(ed, kind);
  if (!record) return undefined;
  return { anchorId: record.anchorId, anchorText: record.text };
}

/**
 * Action class — annotation actions attach a card to text in place;
 * lifecycle actions operate on the structural region (whole section for
 * heading, etc.). The split exists so that heading × Highlight wraps
 * only the heading line (annotation) while heading × Delete removes the
 * whole section (lifecycle). See ACTION-MENU-DIAGNOSIS.md cluster C9.
 */
type ResolveAction = "annotation" | "lifecycle";

const LIFECYCLE_ACTIONS: ReadonlySet<DragHandleAction> = new Set([
  "duplicate",
  "archive",
  "delete",
]);

function actionClass(action: DragHandleAction): ResolveAction {
  return LIFECYCLE_ACTIONS.has(action) ? "lifecycle" : "annotation";
}

/**
 * Resolve a `TextObjectRef | SelectionRef` to a doc range plus selection
 * kind. Dispatch is driven by the registry — atom-block kinds get
 * NodeSelection, `heading` gets the section range or the heading line
 * (depending on `forAction`), `linkedRange` is found by walking the
 * linkedAnchor mark across the doc, everything else gets the node's
 * content range.
 *
 * `forAction` selects which range a heading should yield: annotation
 * actions get the heading line; lifecycle actions get the whole section.
 * Non-heading kinds ignore this and return the same range either way.
 */
function resolveRefRange(
  ed: Editor,
  ref: DragHandleRef,
  forAction: ResolveAction,
): ResolvedRef | null {
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

  // Annotation actions on a heading stay on the heading line; lifecycle
  // actions on a heading take the whole section. The `forAction` flag
  // tells us which side we're on. See ACTION-MENU-DIAGNOSIS.md C9/C11.
  if (ref.kind === "heading") {
    if (forAction === "annotation" && meta.collectAnnotationRange) {
      const line = meta.collectAnnotationRange(ed.state.doc, ref.id);
      if (!line) return null;
      return { selectionKind: "text", from: line.from, to: line.to };
    }
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

/**
 * Post-Duplicate walker — for every freshly-cloned `linkedAnchor` mark
 * inside the just-inserted slice, look up the card via the new
 * `linkCard` attr (cardKind:cardId) and call `lifecycle.bindAnchor(...)`
 * with the new anchorId + the containing paragraph's uuid. This
 * populates the cloned card's `links[]`, fixing the C2 gap where
 * card → editor jump-to landed on the SOURCE instead of the clone.
 *
 * Bounded by `insertedSize` (the slice length) — does not walk the
 * whole doc. Runs once per Duplicate, action-time. See
 * ACTION-MENU-DIAGNOSIS.md cluster C2.
 */
function rewireClonedAnchors(
  ed: Editor,
  insertedFrom: number,
  insertedSize: number,
  lifecycle: CardLifecycleApi,
): void {
  if (insertedSize <= 0) return;
  const doc = ed.state.doc;
  const docSize = doc.content.size;
  const from = Math.max(0, Math.min(insertedFrom, docSize));
  const to = Math.max(from, Math.min(insertedFrom + insertedSize, docSize));
  if (to <= from) return;
  const seen = new Set<string>();
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const anchorId =
        typeof mark.attrs.anchorId === "string" ? mark.attrs.anchorId : "";
      if (!anchorId || seen.has(anchorId)) continue;
      seen.add(anchorId);
      const linkCard =
        typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
      const parsed = parseLinkCardKey(linkCard);
      if (!parsed) continue;
      const bind = lifecycle.get(parsed.kind)?.bindAnchor;
      if (!bind) continue;
      const paragraphId = paragraphUuidAt(doc, pos);
      if (!paragraphId) continue;
      const anchorRange = findAnchorIdRange(doc, anchorId);
      const anchorText = anchorRange
        ? doc.textBetween(anchorRange.from, anchorRange.to, " ")
        : "";
      bind(parsed.id, paragraphId, anchorId, anchorText);
    }
    return true;
  });
}

/** Locate the full span of a `linkedAnchor` mark by `anchorId`, scanning
 *  only inside a region we already know contains it. Cheaper than a
 *  whole-doc walk for the rewireup post-insert path. */
function findAnchorIdRange(
  doc: PMNode,
  anchorId: string,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const has = node.marks.some(
      (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
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
