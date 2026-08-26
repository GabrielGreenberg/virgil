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
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import {
  createDuplicateDiagnostics,
  duplicateSlice,
} from "@/text-objects/duplicate-slice";
import {
  cleanupAndComputeDeleteRange,
  expandCascadeRange,
} from "@/text-objects/delete-range";
import {
  collectRemovedAnchorUuids,
  resolveDisplacedAnchorTarget,
} from "@/text-objects/anchor-resolution";
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
import type { CardCreationApi } from "./card-creation";
import type { EditorHandle } from "../../Editor";
import type { ViewPrefs, PanelId } from "@/hooks/useViewPrefs";
import type { AnchorRetargetApi } from "@/cards/retarget-anchors";
import {
  captureParagraphSnapshot,
  createLinkedAnchor,
  paragraphUuidAt,
  updateLinkedAnchorCard,
  type LinkedAnchorKind,
} from "@/links/links";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { getSectionRangeByUuid } from "@/lib/section-range";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { cardPopKey } from "@/panels/panel-registry";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { parseLinkCardKey } from "@/links/link-dom-contract";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  blockRangeAllowsAction,
  inlineInsertPos,
  INLINE_INSERT_ACTIONS,
} from "@/text-objects/text-object-registry";
import { isAtomNode } from "@/lib/tiptap/atom-registry";
import {
  describeCardBodyRefusal,
  prepareCardBodyCapture,
} from "@/lib/tiptap/card-body-capture";
import { bodySchemaForCardKind } from "@/cards/predicates";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
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
  /**
   * Re-home the margin context a destructive CAPTURE displaces (task 491).
   *
   * Gabriel: *"when you archive a passage that has an archive card, you loose
   * the original archive card. they should just stack up on the preceeding
   * paragraph."* An archive SETS TEXT ASIDE rather than destroying it, so every
   * Mode-A paragraph-anchored card whose anchor the capture consumes moves to
   * the surviving neighbour — the same paragraph the fresh snippet lands on,
   * which is what makes them stack.
   *
   * REQUIRED, not optional: a bag that can omit it silently reinstates the
   * loss for every host that forgets. A host with nothing to retarget supplies
   * a bundle whose collections are empty, which is a no-op — an ANSWER, not an
   * omission.
   */
  anchorRetarget: AnchorRetargetApi;
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
    anchorRetarget,
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
      const collapsed =
        side === "left" ? prefs.collapsedLeft : prefs.collapsedRight;
      const blank = side === "left" ? prefs.blankLeft : prefs.blankRight;
      if (collapsed) {
        if (side === "left") expandLeft();
        else expandRight();
        return;
      }
      if (blank) {
        clearBlankIfSet();
      }
    },
    [
      prefs.placements,
      prefs.collapsedLeft,
      prefs.collapsedRight,
      prefs.blankLeft,
      prefs.blankRight,
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
      if (!resolved) {
        // Stale/unresolvable ref. A destructive lifecycle action (archive /
        // delete / duplicate) clicked on a ghost handle must fail LOUD —
        // this is the actual landing point for the "the block was already
        // removed" case (the per-case `outerRangeFor` guards below only fire
        // on the rarer divergence where the ref resolves here but not there).
        // Annotation actions still bail silently for the USER: nothing is at
        // stake. See post-refactor followup B1 + Nit D. But a SILENT bail is
        // exactly what hid BUG2 for a release (a mislabeled ref that resolves
        // null → no card, no feedback). Surface a dev-only console.warn for the
        // annotation class so the next ref-resolution regression is visible in
        // the console without changing any production behavior.
        if (!LIFECYCLE_ACTIONS.has(action) && process.env.NODE_ENV !== "production") {
          console.warn(
            `[ActionsMenu] annotation action "${action}" could not resolve its ref; no card created.`,
            ref,
          );
        }
        if (LIFECYCLE_ACTIONS.has(action)) {
          notifyStaleRef(lifecycleLabel(action), ref, notify);
        }
        return;
      }

      // Defense-in-depth (task 145): the grab-bar's SELECTION ref reaches this
      // legacy dispatcher DIRECTLY, bypassing `runAction`'s applies() gate. The
      // menu decoration greys a container-invalid action (a selection inside a
      // titleField/codeBlock/latexComment can't click Citation/footnote/
      // suggest-edit/highlight), but re-check here too via the SSOT
      // `blockRangeAllowsAction` so no inline atom/mark can land in a block
      // whose schema rejects it — even by a programmatic dispatch — the
      // enforcement point is not the menu alone.
      //
      // task 148 dropped the `ref.kind === "selection"` restriction, and the
      // reason is the same reason the menu had to stop reading a container's
      // kind: a BLOCK ref's curated set says what may be done TO the block,
      // while these four act at a position INSIDE it, which for a container is
      // in its BODY. Asking the RESOLVED RANGE — the very range spliced below —
      // is the one question that answers both. Lifecycle actions stay exempt (a
      // delete/archive acts on the selected text, always safe).
      if (
        CONTAINER_SENSITIVE_ACTIONS.has(action) &&
        !blockRangeAllowsAction(ed.state.doc, resolved.from, resolved.to, action)
      ) {
        return;
      }

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
          // the current cursor. `inlineInsertPos` is what makes "the end of
          // the passage" a TEXT position for a container ref, where `range.to`
          // is a position between block children (task 148).
          try {
            ed.commands.setTextSelection(inlineInsertPos(ed.state.doc, range.to));
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
          // Deferred create popover — the menu/lightning twin of slash `/cite`.
          // Instead of dropping a blank `\cite{}` pill + pristine card, OPEN the
          // create popover at the END of the captured passage. The popover stages
          // citekeys and materializes the real atom (no-scroll, at this captured
          // pos) + the gutter card only on commit, so no blank card flashes. We
          // leave `panelId` / `focusCardKey` null — there's no card to route yet.
          if (typeof window !== "undefined") {
            try {
              // Same normalization as the footnote twin: the popover's commit
              // calls `insertInlineAtom({ at: pos })`, which clamps to doc
              // bounds only — so a container ref's raw content-range end would
              // materialize the `\cite{}` in a fabricated trailing block.
              const atPos = inlineInsertPos(ed.state.doc, range.to);
              const coords = ed.view.coordsAtPos(atPos);
              const rect = new DOMRect(
                coords.left,
                coords.top,
                0,
                coords.bottom - coords.top,
              );
              // Thread the OWNING editor (CHIP 5). The grab handle is a
              // MAIN-editor NodeView (footnotes are inline atoms — you can't
              // grab inside one), so `ed` is MAIN here; threading it keeps the
              // owning-editor channel uniform with the slash/lightning surfaces
              // so the commit always reads `pos` in the right pos-space.
              window.dispatchEvent(
                new CustomEvent(ATOM_CREATE_POPOVER_EVENT, {
                  detail: { kind: "citation", rect, pos: atPos, editor: ed },
                }),
              );
            } catch {
              /* coordsAtPos can throw on a stale pos — bail without opening */
            }
          }
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
          // Highlights always anchor to a range. For a NON-empty block ref the
          // selection spans the whole node's content, so the linkedAnchor
          // wraps the ENTIRE passage — this whole-block-wrap is INTENTIONAL
          // (highlighting a block = highlight its text; to highlight only part,
          // make a partial selection first). Do not "fix" it to a sub-range.
          //
          // Empty-block safety (Nit E): a truly-empty block has empty `text`,
          // so the `!text` guard makes this a CLEAN no-op — no broken/empty
          // anchor is ever minted. As a second layer, `createLinkedAnchor`
          // itself returns null on a zero-width selection (`to <= from`) and
          // the `!record` guard below bails on that too. So both an empty
          // paragraph AND any zero-content range short-circuit cleanly here.
          if (!text) break;
          const record = createLinkedAnchor(ed, "highlight", undefined, undefined, {
            tintColor: defaultTintForLinkedAnchorKind("highlight"),
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
          // Mode-B symmetry with note/cutter/revision: a todo from a
          // non-empty selection drops a range `linkedAnchor` mark; a
          // cursor-only todo (no selection ⇒ no wantRangeAnchor) stays
          // Mode-A paragraph-anchored. The reconciler tracks todos in its
          // alive-set, so the mark survives the orphan sweep.
          const anchor = wantRangeAnchor ? createAnchor(ed, "todo") : undefined;
          const todo = cardCreation.createTodo({
            text: text || undefined,
            paragraphId,
            anchor,
            targetKind,
            mode: "omni",
          });
          if (anchor) {
            updateLinkedAnchorCard(ed, anchor.anchorId, "todo", todo.id);
          }
          panelId = "todo";
          focusCardKey = cardPopKey("todo", todo.id);
          break;
        }
        case "suggest-edit": {
          const anchor = wantRangeAnchor ? createAnchor(ed, "revision") : undefined;
          const card = cardCreation.createRevisionRequest({
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
            notifyStaleRef("Duplicate", ref, notify);
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
          // Node-selecting blocks (true atoms): select the cloned node as a
          // unit. Text-bearing kinds (incl. `latexComment`, a content block
          // since task-017): drop the caret near the start of the cloned
          // content, so a duplicated comment lands caret-ready. Keys on the
          // SELECTION facet, not the gating facet (task 066).
          try {
            const insertPos = outer.to;
            const docSize = tr.doc.content.size;
            const refKind = ref.kind;
            const atomBlock =
              refKind !== "selection" &&
              isTextObjectKind(refKind) &&
              TEXT_OBJECT_REGISTRY[refKind].selectsAsNode;
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
          // A line whose ONLY content is an inline atom — math-only
          // (`$\lambda$`), citation-only, footnote-only — has empty
          // `textContent` but is NOT empty: the slice still carries the
          // atom. The old `!text` guard silently no-op'd these (the user
          // could not archive a single `$\lambda$` line) — see
          // ACTION-MENU-DIAGNOSIS.md §5.2.10. Bail only when the resolved
          // range has NO content at all, so an atom-only line archives like
          // any other text-bearing block.
          //
          // task 066: a meaningful block atom that now resolves as TEXT
          // (`latexComment`, a content block since task-017 with an empty inner
          // range for `% `) is meaningful in the NODE itself, not its inner
          // content — so an empty `% ` comment stays archivable. Skip the bail
          // for those (keys on the gating facet, so `figureBlock` — meaningful
          // for confirm but not gated — is unaffected).
          if (
            resolved.selectionKind === "text" &&
            !isMeaningfulBlockAtomKind(ref.kind) &&
            ed.state.doc.slice(range.from, range.to).content.size === 0
          )
            break;
          const outer = outerRangeFor(ed, ref);
          // Stale/unresolvable ref (the block was already removed) — fail
          // loud like Duplicate (B1), not the old silent `break;` that left
          // the user clicking Archive on a ghost handle with zero feedback.
          if (!outer || outer.to <= outer.from) {
            notifyStaleRef("Archive", ref, notify);
            break;
          }
          // Same cascade as Delete — if the wrapper would be empty
          // after the deletion, swallow it too. See C6.
          const extended = expandCascadeRange(ed.state.doc, outer);
          // ── THE NEVER-DESTROY INVARIANT (task 308) ─────────────────────
          // A destructive lifecycle action must never delete content its
          // capture destination cannot hold. Archive is the one action that
          // deletes AND captures, so it is the one that has to ask.
          //
          // This existed as a silent data-loss hole: the capture is faithful
          // (it carries whatever the slice had — `heading`, `blockquote`,
          // `codeBlock`, `horizontalRule`, the expex family, `highlight` /
          // `textColor` marks), and the archive card body's schema did not
          // admit those. TipTap does NOT throw on the mismatch —
          // `createNodeFromContent` swallows the `RangeError` and returns an
          // EMPTY document — so the section was deleted from the doc and the
          // card rendered blank, with no error anywhere. Archiving a section was
          // total loss from the user's view.
          //
          // ONE DOOR (task 393): `prepareCardBodyCapture` derives the payload
          // the snippet will STORE — slice → doc JSON → the card normalizer's
          // own `DOC_ONLY_MARKS` strip — and validates THAT. Before it, the
          // guard judged the RAW slice while the write stored the normalized
          // one, so any passage carrying a Mode-B `linkedAnchor` span (the
          // worked-over prose a user most wants to archive) was refused for a
          // loss that could not happen. `capture.content` below is the same
          // object that was judged; never re-derive a second payload here.
          //
          // Runs BEFORE `cleanupAndComputeDeleteRange`, so an abort leaves the
          // document and every sidecar completely untouched.
          const capture = prepareCardBodyCapture(
            ed.state.doc.slice(extended.from, extended.to),
            bodySchemaForCardKind("archive"),
          );
          if (!capture.ok) {
            console.warn(
              "[Archive] refused — the capture cannot mount in the archive card body; " +
                "the document was NOT modified.",
              { reason: capture.reason, constructs: capture.constructs, ref },
            );
            // A refusal NAMES what it refused (the loud-refusal rule): "part of
            // it" leaves the user with nothing to act on.
            notify({
              message:
                `Can't archive this — the Archive panel can't hold ` +
                `${describeCardBodyRefusal(capture)}, so nothing was removed.`,
            });
            break;
          }
          const richContent = capture.content;
          // ── ONE NEIGHBOUR, ONE GESTURE (task 491) ──────────────────────
          // An archive SETS THE TEXT ASIDE; it does not destroy it. So the
          // margin context the capture displaces has somewhere to be, and
          // Gabriel's ruling is that it is the surviving neighbour: *"they
          // should just stack up on the preceeding paragraph."*
          //
          // Resolved ONCE, here, and read by BOTH halves of the gesture — the
          // fresh snippet's own anchor and every Mode-A card the capture
          // displaced. Two resolutions would put them on two paragraphs, which
          // is precisely NOT stacking. `resolveDisplacedAnchorTarget` is also
          // the honest form of what B2 (below) always meant: it asks whether
          // the range's own host block SURVIVES rather than approximating that
          // with `ref.kind !== "selection"`, and it falls FORWARD when the
          // capture starts at the document's first block (where the previous
          // rung has no answer and everything used to orphan).
          //
          // Mode-B (`linkedAnchor`) anchors deliberately do NOT move: a Mode-B
          // anchor names the TEXT RANGE, which is exactly what left. Those stay
          // on the `cleanupLinksInRange` path Delete shares — see
          // `src/cards/retarget-anchors.ts` and task 393's equality leg.
          //
          // Runs BEFORE the delete: the deferred `virgil-textobject-orphaned`
          // sweep fires off that transaction and strips any link still naming a
          // vanished uuid, so retargeting first makes the two agree by
          // construction rather than by racing.
          const displacedUuids = collectRemovedAnchorUuids(
            ed.state.doc,
            extended.from,
            extended.to,
          );
          const neighbour = resolveDisplacedAnchorTarget(
            ed.state.doc,
            extended.from,
            extended.to,
            displacedUuids,
          );
          anchorRetarget.retarget({
            removed: displacedUuids,
            target: neighbour,
            // Self-healing on reload, exactly as the drop-mode re-anchor
            // gesture's fresh links are.
            snapshot: neighbour
              ? captureParagraphSnapshot(ed, neighbour.uuid)
              : null,
          });
          // B2 (post-refactor followup): resolve the snippet's anchor
          // BEFORE deletion. The pre-delete `paragraphId` is the source
          // block's own uuid — for a whole-paragraph archive that uuid
          // is about to vanish in the same transaction, and the
          // TextObjectOrphanGuard would immediately strip the freshly-
          // created link. The neighbour resolved above is that survivor.
          //
          // For selection-ref Archive (a sub-range inside a paragraph),
          // the source paragraph survives and the ref already carries its
          // uuid, so we keep it — byte-identical to pre-491.
          let snippetParagraphId: string = paragraphId;
          let snippetTargetKind: TextObjectKind = targetKind;
          if (ref.kind !== "selection") {
            snippetParagraphId = neighbour?.uuid ?? "";
            snippetTargetKind = neighbour?.kind ?? targetKind;
          }
          // F2: same stale-range hazard as Delete — cleanup may strip an
          // inline atom inside the range and shrink the block, so re-derive
          // the deletion bounds against the post-cleanup state. The
          // `richContent` snapshot above is taken BEFORE cleanup, so the
          // archived copy still carries the atom. See delete-range.ts.
          const delRange = cleanupAndComputeDeleteRange(
            ed,
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
            .delete(delRange.from, delRange.to)
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
          // Stale/unresolvable ref — fail loud like Duplicate (B1) rather
          // than the old silent `break;`. Without this, Delete on a ghost
          // handle no-op'd with no user feedback.
          if (!outer || outer.to <= outer.from) {
            notifyStaleRef("Delete", ref, notify);
            break;
          }
          // C6: if removing this child empties a structural wrapper
          // (last listItem in a list, last exampleItem in an
          // exampleItemList / exampleBlock), extend the range to
          // include the wrapper so PM's content-rule auto-fill never
          // gets a chance to inject a placeholder.
          const extended = expandCascadeRange(ed.state.doc, outer);
          // F2: cleanupLinksInRange may synchronously dispatch a doc tx
          // (e.g. deleting a `\cite` atom inside the range), shrinking the
          // block and making `extended.to` stale — the old code then deleted
          // the stale range and swallowed the next sibling (a size-1
          // graphicsBlock vanished silently). The helper runs the cleanup
          // and returns a range corrected for that mutation, valid against
          // the post-cleanup `ed.state`. See delete-range.ts.
          const delRange = cleanupAndComputeDeleteRange(
            ed,
            extended.from,
            extended.to,
            cardLifecycle,
          );
          // Deliberate lifecycle removal — tag so MarginaliaAnchorGuard
          // bypasses the anchored-block re-insert. TextObjectOrphanGuard
          // sweeps any Mode-A card whose anchor disappeared.
          const tr = ed.state.tr
            .delete(delRange.from, delRange.to)
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

      // Drop cursor into the new card's main editable field: CHIP B moved
      // this into the central `finishCreate` chokepoint, so every `createX`
      // above (a user-initiated create ⇒ `autoFocus` defaults true) already
      // expanded + focused its new card's body. `focusCardKey` now serves
      // only as the "was a card created?" signal for the no-card branch.
      //
      // No new card to take focus → return focus to the editor so the
      // user's next keypress (Cmd-Z to undo, arrow keys to navigate)
      // reaches the doc instead of being eaten by the browser.
      // Critical for Delete: it routes through a confirm dialog whose
      // close orphans focus on the body; without this re-focus, Cmd-Z
      // does nothing until the user clicks back into the editor. See
      // post-refactor followup B4.
      if (!focusCardKey) {
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
      anchorRetarget,
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
export function resolveDestructiveConfirm(
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

/** Shared fail-loud feedback for the lifecycle actions when a ref can't be
 *  resolved to an outer range — the block was already removed (stale uuid /
 *  ghost handle). Duplicate established this convention (post-refactor
 *  followup B1: console.warn + a single-button notify); Archive and Delete
 *  reuse it so all three lifecycle actions surface the SAME message instead
 *  of one failing loud and two returning silently. `label` is the action
 *  name for the console tag. */
function notifyStaleRef(
  label: string,
  ref: DragHandleRef,
  notify: DragHandleActionsDeps["notify"],
): void {
  console.warn(`[${label}] stale ref — could not resolve outer range`, ref);
  notify({
    message: "Could not find the source. Close the menu and try again.",
  });
}

/** Capitalized console tag for a lifecycle action ("archive" → "Archive"). */
function lifecycleLabel(action: DragHandleAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

/**
 * Block-atom / opaque-content node names whose presence makes a range
 * non-trivial to lose — even when its `textContent` is empty. Derived from
 * the SSOTs so a newly-added atom kind is recognized here for free:
 *
 *   • `isAtomNode` (ATOM_REGISTRY, the inline-Atom SSOT) covers the inline
 *     atoms: `footnote`, `citation`, `labelRef` (`\ref`), `inlineMath`.
 *   • This set covers the BLOCK atoms — every `TEXT_OBJECT_REGISTRY` kind
 *     flagged `isMeaningfulBlockAtom`, the kind name being the PM node name —
 *     PLUS `figureBlock`, which is NOT a schema atom (`content: figureCaption?`)
 *     but is still meaningful, destroy-with-a-confirm content.
 *
 * Keep both sourced from the registries; do not hard-code a parallel
 * inline list. If a new atom kind is added to either registry it must
 * either carry `isMeaningfulBlockAtom` (block) or be in ATOM_REGISTRY (inline)
 * for this gate to pick it up. */
const MEANINGFUL_BLOCK_ATOM_NODE_NAMES: ReadonlySet<string> = new Set<string>([
  ...Object.entries(TEXT_OBJECT_REGISTRY)
    .filter(([, meta]) => meta.isMeaningfulBlockAtom)
    .map(([kind]) => kind),
  "figureBlock",
]);

/** True iff `kind` carries the GATING facet `isMeaningfulBlockAtom` (task 066).
 *  Deliberately DISTINCT from `MEANINGFUL_BLOCK_ATOM_NODE_NAMES`, which also
 *  includes `figureBlock` for destructive-confirm content detection: the gating
 *  facet excludes `figureBlock` (it must stay "ok" for the block/heading gates),
 *  so the archive-empty-content bail-skip leaves an empty-caption figure
 *  untouched while letting an empty `% ` latexComment stay archivable. */
function isMeaningfulBlockAtomKind(kind: DragHandleRef["kind"]): boolean {
  return (
    isTextObjectKind(kind) && TEXT_OBJECT_REGISTRY[kind].isMeaningfulBlockAtom
  );
}

/** Cheap walk over `[from, to)` looking for any `linkedAnchor` mark, inline
 *  Atom (footnote / citation / `\ref` / inline-math — via the ATOM_REGISTRY
 *  SSOT), or meaningful block atom (math / tex / graphic / figure block).
 *  Used to drive the "empty + nothing-attached → skip the warning" decision
 *  in per-kind `confirmDestructive` helpers, so deleting/archiving a block
 *  whose only content is one of these surfaces the destructive confirm
 *  instead of silently destroying it. Bounded by the outer range, which is
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
    if (isAtomNode(node) || MEANINGFUL_BLOCK_ATOM_NODE_NAMES.has(node.type.name)) {
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
    return findLinkedAnchorRange(ed.state.doc, ref.id, markType);
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

// The card actions whose result is an INLINE ATOM (footnote/citation) or an
// inline MARK (highlight/suggest-edit) embedded in the block's text — so the
// containing block's schema decides whether they're valid. Task 145 re-checks
// the container for these on dispatch as defense-in-depth: the menu decoration
// greys them (so a user can't click through), but the grab bar reaches this
// dispatcher directly, bypassing `runAction`, so the dispatch itself also
// guards — no `\title{\cite{}}` corruption / dead codeBlock click can land even
// by a programmatic dispatch. Lifecycle actions are NOT here: a selection
// delete/archive acts on the selected TEXT (always safe), not on the singleton
// title block the curated set protects — gating those would over-grey.
//
// DERIVED from `INLINE_INSERT_ACTIONS` (task 148), the family whose
// applicability is a property of the target TEXTBLOCK rather than of the ref's
// kind, plus `highlight` — mark-backed like `suggest-edit`, but deliberately
// left OUT of that family because the true atom blocks keep it as a pinned
// clean no-op, so it stays a per-KIND answer.
const CONTAINER_SENSITIVE_ACTIONS: ReadonlySet<DragHandleAction> = new Set([
  ...INLINE_INSERT_ACTIONS,
  "highlight" as DragHandleAction,
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
    const bounds = findLinkedAnchorRange(ed.state.doc, ref.id, markType);
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
      if (meta.selectsAsNode && node.type.isBlock) {
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
      const anchorRange = findLinkedAnchorRange(doc, anchorId);
      const anchorText = anchorRange
        ? doc.textBetween(anchorRange.from, anchorRange.to, " ")
        : "";
      bind(parsed.id, paragraphId, anchorId, anchorText);
    }
    return true;
  });
}


// ---------------------------------------------------------------------------
// Re-exports for callers that constructed the old `DragHandlePassage`
// union. After D2 they import the new types directly.
// ---------------------------------------------------------------------------

export type { TextObjectKind, TextObjectRef, SelectionRef };
