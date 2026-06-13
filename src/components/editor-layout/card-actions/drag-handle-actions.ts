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
import type { Node as PMNode, MarkType, Slice } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  createDuplicateDiagnostics,
  duplicateSlice,
} from "@/text-objects/duplicate-slice";
import {
  cleanupLinksInRange,
  expandCascadeRange,
} from "@/text-objects/delete-range";
import { findPreviousAnchorableBlock } from "@/text-objects/anchor-resolution";
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
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
import { cardPopKey } from "@/panels/panel-registry";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { parseLinkCardKey } from "@/links/link-registry";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "@/text-objects/text-object-registry";
import type {
  ConfirmDescriptor,
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
  /** In-app confirm dialog. Used to surface destructive-action warnings:
   *  • Heading × Duplicate (wide-scope whole-section copy)
   *  • Any kind × {Archive, Delete} that returns a `confirmDestructive`
   *    descriptor from its registry meta.
   *  The promise resolves true on confirm, false on cancel. See
   *  ACTION-MENU-DIAGNOSIS.md cluster C5 + post-refactor followup B3. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Single-button "OK" surface for failure paths the user must see
   *  but can't recover from interactively (stale ref, schema rejection,
   *  empty slice). Implemented in EditorPane via a second
   *  `useConfirmDialog` instance with `hideCancel: true`. Replaces the
   *  silent `break;` in branches that today swallow errors. See
   *  post-refactor followup B1. */
  notify: (opts: { title?: string; message: string; tone?: "default" | "danger" }) => void;
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
    notify,
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

      // Destructive-action warnings:
      //
      //   • Archive / Delete → per-kind confirm via
      //     `meta.confirmDestructive` (registry slot). Each kind owns
      //     its own copy + can return null to skip the dialog when
      //     nothing's at stake (empty paragraph w/ no anchors). See
      //     post-refactor followup B3.
      //   • Heading × Duplicate → wide-scope section summary via the
      //     legacy `confirmHeadingLifecycle`. Duplicate is non-
      //     destructive so it doesn't go through `confirmDestructive`;
      //     heading × Duplicate still warns because a section copy is
      //     wide enough to be disorienting.
      //
      // Cancel returns silently.
      if (action === "archive" || action === "delete") {
        const descriptor = resolveDestructiveConfirm(ed, ref, action);
        if (descriptor) {
          const tone =
            descriptor.tone ?? (action === "delete" ? "danger" : "default");
          const proceed = await confirm({ ...descriptor, tone });
          if (!proceed) return;
        }
      } else if (action === "duplicate" && ref.kind === "heading") {
        const proceed = await confirmHeadingLifecycle(ed, ref, "duplicate", confirm);
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
            focusCardKey = cardPopKey("footnote", result.footnoteId);
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
          focusCardKey = cardPopKey("citation", ref.id);
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
          focusCardKey = cardPopKey("note", note.id);
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
          focusCardKey = cardPopKey("highlight", card.id);
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
          focusCardKey = cardPopKey("todo", todo.id);
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
            updateLinkedAnchorCard(ed, anchor.anchorId, "revision-comment", card.id);
          }
          panelId = "revisions";
          focusCardKey = cardPopKey("revision-comment", card.id);
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
          focusCardKey = cardPopKey("cutter-comment", card.id);
          break;
        }
        case "report": {
          // The quick gesture files a Report REQUEST (the ask), not an
          // authored Report.
          const anchor = wantRangeAnchor
            ? createAnchor(ed, "report-request")
            : undefined;
          const card = cardCreation.createReportRequest({
            paragraphId,
            anchor,
            targetKind,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(
              ed,
              anchor.anchorId,
              "report-request",
              card.id,
            );
          }
          panelId = "reports";
          focusCardKey = cardPopKey("report-request", card.id);
          break;
        }
        case "duplicate": {
          // Fail-loud flow (post-refactor followup B1):
          //   1. Stale ref     → notify + abort.
          //   2. Empty slice   → notify + abort.
          //   3. Walker warns  → console.warn summary (no toast for
          //      minor recoverable issues; severe codes already surface
          //      via stripped marks / orphan atoms).
          //   4. Schema reject → notify + abort BEFORE dispatch (PM
          //      can't roll back a dispatched transaction). Catches
          //      titleField-style "you can't have two of these" cases
          //      even if the action curation slips.
          //   5. Atom blocks   → post-insert NodeSelection on the clone,
          //      not TextSelection.near (which doesn't make sense for
          //      a non-text-bearing wrapper).
          const outer = outerRangeFor(ed, ref);
          if (!outer || outer.to <= outer.from) {
            console.warn("[Duplicate] stale ref — could not resolve outer range", ref);
            notify({
              message: "Could not find the source. Close the menu and try again.",
            });
            break;
          }
          const slice = ed.state.doc.slice(outer.from, outer.to);
          if (slice.size === 0) {
            console.warn("[Duplicate] empty slice for ref", ref);
            notify({ message: "Nothing to duplicate." });
            break;
          }
          const diag = createDuplicateDiagnostics();
          const cloned = duplicateSlice(slice, cardLifecycle, diag);
          const tr = ed.state.tr.replace(outer.to, outer.to, cloned);
          // Pre-dispatch schema validation. PM's `Node.check` throws
          // when the new doc shape violates a content rule (e.g. two
          // titleFields, an exampleItem outside an exampleBlock, a
          // figureBlock in a slot that doesn't allow one). Catch here
          // so we never dispatch a doomed transaction; on throw the
          // doc is untouched.
          try {
            tr.doc.check();
          } catch (err) {
            console.warn("[Duplicate] schema violation; aborting", err);
            notify({
              tone: "danger",
              message: "This kind cannot be duplicated here.",
            });
            break;
          }
          // Atom blocks: select the cloned node as a unit. Text-bearing
          // kinds: drop the caret near the start of the cloned content.
          try {
            const insertPos = outer.to;
            const docSize = tr.doc.content.size;
            const refKind = ref.kind;
            const atomBlock =
              refKind !== "selection" &&
              isTextObjectKind(refKind) &&
              TEXT_OBJECT_REGISTRY[refKind].isAtomBlock;
            if (atomBlock && insertPos < docSize) {
              tr.setSelection(NodeSelection.create(tr.doc, insertPos));
            } else if (insertPos < docSize) {
              const caretPos = Math.min(insertPos + 1, docSize - 1);
              tr.setSelection(TextSelection.near(tr.doc.resolve(caretPos)));
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
          if (diag.codes.size > 0) {
            console.warn(
              "[Duplicate] diagnostics:",
              [...diag.codes],
              diag.details,
            );
          }
          break;
        }
        case "archive": {
          // C4: archive routes through `cardCreation.createArchiveSnippet`
          // (peer of Delete via the unified card-creation factory).
          // Dispatcher's job here is the editor mutation: snapshot
          // content, resolve the reanchor target, cascade, cleanup
          // sidecars, delete the range, then mint the snippet.
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
          //
          // For a SELECTION ref that's a sub-range of a paragraph
          // (openStart > 0 && openEnd > 0), the fragment's direct
          // children are TEXT / inline nodes, not a paragraph. The
          // archive snippet mounts a mini-TipTap whose `doc.content`
          // schema is `block+`, so bare inline children at doc level
          // throw `contentMatchAt on a node with invalid content` when
          // the mini-editor boots. For multi-paragraph selections with
          // partial first/last paragraphs, the fragment is mixed:
          // inline at the boundaries, block(s) in the middle. Walk the
          // fragment and wrap any inline runs in a paragraph so the
          // resulting doc is schema-valid in all cases.
          const slice = ed.state.doc.slice(extended.from, extended.to);
          const richContent = sliceToDocJson(slice);
          // B2 (post-refactor followup): resolve the snippet's anchor
          // BEFORE deletion. The pre-delete `paragraphId` is the source
          // block's own uuid — for a whole-paragraph archive that uuid
          // is about to vanish in the same transaction, and the
          // TextObjectOrphanGuard would immediately strip the freshly-
          // created link. Instead, walk to the nearest TextObject above
          // `extended.from` (cascade-extended, so a collapsing list
          // looks above the LIST, not the now-orphan items) and
          // anchor the snippet to THAT survivor.
          //
          // For selection-ref Archive (a sub-range inside a paragraph),
          // the source paragraph survives, so we keep its uuid as the
          // anchor — `findPreviousAnchorableBlock` is only the right
          // call when the whole anchoring entity is being deleted.
          let snippetParagraphId: string = paragraphId;
          let snippetTargetKind: TextObjectKind = targetKind;
          if (ref.kind !== "selection") {
            const reanchor = findPreviousAnchorableBlock(
              ed.state.doc,
              extended.from,
            );
            snippetParagraphId = reanchor?.uuid ?? "";
            snippetTargetKind = reanchor?.kind ?? targetKind;
          }
          cleanupLinksInRange(
            ed.state.doc,
            extended.from,
            extended.to,
            cardLifecycle,
          );
          // Tag this as a deliberate lifecycle removal so
          // MarginaliaAnchorGuard does NOT resurrect the anchored block as
          // an empty same-uuid placeholder. The snippet reanchors to the
          // previous block (above) and TextObjectOrphanGuard sweeps any
          // Mode-A card whose anchor vanished.
          const tr = ed.state.tr
            .delete(extended.from, extended.to)
            .setMeta(LIFECYCLE_DELETE_META, true);
          ed.view.dispatch(tr);
          const snippet = cardCreation.createArchiveSnippet({
            text,
            content: richContent,
            paragraphId: snippetParagraphId,
            targetKind: snippetTargetKind,
            mode: "omni",
          });
          panelId = "archive";
          focusCardKey = cardPopKey("archive", snippet.id);
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
          // Deliberate lifecycle removal — tag so MarginaliaAnchorGuard
          // bypasses the anchored-block re-insert. TextObjectOrphanGuard
          // sweeps any Mode-A card whose anchor disappeared.
          const tr = ed.state.tr
            .delete(extended.from, extended.to)
            .setMeta(LIFECYCLE_DELETE_META, true);
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
      //
      // No new card to take focus → return focus to the editor so the
      // user's next keypress (Cmd-Z to undo, arrow keys to navigate)
      // reaches the doc instead of being eaten by the browser.
      // Critical for Delete: it routes through a confirm dialog whose
      // close orphans focus on the body; without this re-focus, Cmd-Z
      // does nothing until the user clicks back into the editor. See
      // post-refactor followup B4.
      if (focusCardKey) {
        focusNewCard(focusCardKey);
      } else {
        try {
          ed.view.focus();
        } catch {
          /* editor torn down — ignore */
        }
      }
    },
    [
      editorRef,
      cardCreation,
      cardLifecycle,
      confirm,
      notify,
      ensureOmniActiveForPanel,
    ],
  );

  return { dispatch };
}

/**
 * Wide-scope summary dialog for `heading × Duplicate` only. The
 * Archive/Delete variants of this warning now live in the registry slot
 * `heading.confirmDestructive` so they share the per-kind confirm
 * routing with every other kind. Duplicate is non-destructive (creates
 * a copy, no loss of work), so it stays out of `confirmDestructive` —
 * but heading × Duplicate is still wide enough to be disorienting
 * without warning, so this helper survives for that single case.
 *
 * Reads off `collectMoveSource` for the section nodes, so the message
 * body never walks the doc twice. See ACTION-MENU-DIAGNOSIS.md C5.
 */
async function confirmHeadingLifecycle(
  ed: Editor,
  ref: TextObjectRef,
  action: "duplicate",
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
    title: `${action[0].toUpperCase() + action.slice(1)} the entire section?`,
    message: `This will ${action} the entire section ${titleText}${countsText}.`,
    confirmLabel: "Duplicate section",
    tone: "default",
  });
}

/**
 * Resolve the per-kind confirm descriptor for an Archive/Delete action.
 * Returns null when no warning is needed (the kind's registry slot
 * decided the action is silently safe, or the ref is a SelectionRef
 * with no text at stake). The caller passes the resulting descriptor
 * to `confirm()` and gates on the user's choice.
 *
 * For `SelectionRef`, the lookup is inline (no registry entry); for
 * `TextObjectRef`, it consults `meta.confirmDestructive` and computes
 * the `outerRange` + `hasAnchorsOrAtoms` context once.
 */
function resolveDestructiveConfirm(
  ed: Editor,
  ref: DragHandleRef,
  action: "archive" | "delete",
): ConfirmDescriptor | null {
  if (ref.kind === "selection") {
    return confirmSelectionDestructive(ed, ref, action);
  }
  if (!isTextObjectKind(ref.kind)) return null;
  const meta = TEXT_OBJECT_REGISTRY[ref.kind];
  if (!meta.confirmDestructive) return null;
  const outer = outerRangeFor(ed, ref);
  if (!outer) return null;
  const hasAnchorsOrAtoms = rangeHasAnchorsOrAtoms(
    ed.state.doc,
    outer.from,
    outer.to,
  );
  return meta.confirmDestructive(ed.state.doc, ref.id, action, {
    outerRange: outer,
    hasAnchorsOrAtoms,
  });
}

/** Selection-ref destructive confirm. No registry entry — selection is
 *  gesture-input, not a TextObject. Skip if the range is empty or
 *  trivially short; warn with a word-count summary otherwise. */
function confirmSelectionDestructive(
  ed: Editor,
  ref: SelectionRef,
  action: "archive" | "delete",
): ConfirmDescriptor | null {
  const docSize = ed.state.doc.content.size;
  const from = Math.max(0, Math.min(ref.from, docSize));
  const to = Math.max(0, Math.min(ref.to, docSize));
  if (to <= from) return null;
  const text = ed.state.doc.textBetween(from, to, " ").trim();
  if (!text) return null;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const verb = action === "delete" ? "Delete" : "Archive";
  return {
    title: `${verb} this passage?`,
    message: `${verb} this ${wordCount}-word passage.`,
    confirmLabel: `${verb} passage`,
  };
}

/** Cheap walk over `[from, to)` looking for any `linkedAnchor` mark or
 *  `footnote`/`citation` inline atom. Used to drive the
 *  "empty + nothing-attached → skip the warning" decision in per-kind
 *  `confirmDestructive` helpers. Bounded by the outer range, which is
 *  always the single block the action targets. */
function rangeHasAnchorsOrAtoms(
  doc: PMNode,
  from: number,
  to: number,
): boolean {
  if (to <= from) return false;
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.type.name === "footnote" || node.type.name === "citation") {
      found = true;
      return false;
    }
    for (const mark of node.marks) {
      if (mark.type.name === "linkedAnchor") {
        found = true;
        return false;
      }
    }
    return true;
  });
  return found;
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

/**
 * Convert a ProseMirror Slice to a schema-valid `{type: "doc", content: ...}`
 * JSON object suitable for booting a fresh TipTap editor (e.g. the
 * archive snippet's mini-editor).
 *
 * Why this is non-trivial: a slice produced by `doc.slice(from, to)`
 * carries `openStart` / `openEnd` indicating that the boundaries cut
 * THROUGH ancestor nodes. For a selection inside a paragraph the
 * slice's content Fragment holds inline children (text + inline marks),
 * not a paragraph wrapper. Wrapping that fragment directly under
 * `{type: "doc", content: [...inline...]}` violates the doc schema's
 * `block+` content rule and throws `contentMatchAt on a node with
 * invalid content` when the mini-editor mounts.
 *
 * Algorithm: walk the slice's top-level children. Inline runs (children
 * with `child.isBlock === false`) accumulate into an `openInline`
 * buffer; each block child flushes the buffer into a paragraph and
 * emits itself. Final flush at end. Handles every shape:
 *   - all-inline (single-paragraph sub-range): one paragraph wrapping all.
 *   - all-block (full-paragraph selection): no wrapping, blocks pass through.
 *   - mixed (multi-paragraph w/ partial first/last): inline runs at the
 *     boundaries become paragraphs flanking the middle blocks.
 */
function sliceToDocJson(slice: Slice): { type: "doc"; content: unknown[] } {
  const docContent: unknown[] = [];
  let openInline: unknown[] = [];
  const flushInline = () => {
    if (openInline.length === 0) return;
    docContent.push({ type: "paragraph", content: openInline });
    openInline = [];
  };
  slice.content.forEach((child) => {
    if (child.isBlock) {
      flushInline();
      docContent.push(child.toJSON());
    } else {
      openInline.push(child.toJSON());
    }
  });
  flushInline();
  return { type: "doc", content: docContent };
}

// ---------------------------------------------------------------------------
// Re-exports for callers that constructed the old `DragHandlePassage`
// union. After D2 they import the new types directly.
// ---------------------------------------------------------------------------

export type { TextObjectKind, TextObjectRef, SelectionRef };
