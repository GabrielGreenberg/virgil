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
import {
  NodeSelection,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import {
  createDuplicateDiagnostics,
  dryCloneLifecycle,
  duplicateSlice,
  recordingCloneLifecycle,
} from "@/text-objects/duplicate-slice";
import { commitDocThenCards } from "@/components/drop-mode/commit-seam";
import { transactionAdmitted } from "@/lib/tiptap/transaction-admitted";
import {
  commitRangeDelete,
  expandCascadeRange,
  settleRangeCardObligations,
} from "@/text-objects/delete-range";
import type { AppliedSpliceOps } from "@/cards/lifecycle/applied-splice";
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
  tryCreateLinkedAnchor,
  paragraphUuidAt,
  updateLinkedAnchorCard,
  type LinkedAnchorKind,
} from "@/links/links";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { cardPopKey } from "@/panels/panel-registry";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { parseLinkCardKey } from "@/links/link-dom-contract";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  isRangeKind,
  blockRangeAllowsAction,
  MEANINGFUL_BLOCK_ATOM_NODE_NAMES,
  inlineInsertPos,
  INLINE_INSERT_ACTIONS,
} from "@/text-objects/text-object-registry";
import {
  actionScopeClass,
  scopeOverrideRange,
  LIFECYCLE_ACTION_IDS,
  type ActionScopeClass,
} from "@/text-objects/action-scope";
import { isAtomNode } from "@/lib/tiptap/atom-registry";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";
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
  /**
   * The SETTLE obligation's ops bag (task 238), for the RANGE legs (task 636).
   *
   * Archive and Delete end every card record inside a passage at once, and one
   * of those records can own a LIVE in-document splice — a `status:"applied"`
   * suggestion whose blue `pending-ai-change` range sits in the very text about
   * to be deleted. That is a declinable question about the DOCUMENT, and it has
   * to be asked before the document is mutated, not from inside the cleanup walk
   * that mutates it. So the dispatcher settles the range's splices itself
   * (`settleRangeCardObligations`) rather than letting each card's own delete
   * raise the prompt mid-deletion.
   *
   * REQUIRED, not optional — same reasoning as `anchorRetarget` above. A bag
   * that can be omitted silently reinstates the data loss for every host that
   * forgets; a host with no pending-change wiring supplies a bag whose `get`
   * answers null, which is an ANSWER rather than an omission.
   */
  appliedSplice: AppliedSpliceOps;
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
    appliedSplice,
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

  const dispatchUnguarded = useCallback(
    async (action: DragHandleAction, ref: DragHandleRef) => {
      const handle = editorRef.current;
      const ed = handle?.getEditor();
      if (!handle || !ed) return;

      // ── COLLAB GATE (task 638) — the DEEPEST point, and the only one BOTH
      // menus pass through. Every card row declares `surfaces: { grab: true,
      // lightning: true }` and every `run()` in `ACTION_REGISTRY` opens with the
      // collab check — but neither menu ever calls `spec.run()` for a card row:
      // `DragHandleMenu` and `ActionsMenuPanel` both dispatch HERE, to the legacy
      // dispatcher, so the run-side gate was unreachable from exactly the two
      // surfaces those rows exist on. The only thing left was a `disabled` flag
      // computed once at menu-build time, which a pen hand-off while the menu is
      // open makes stale.
      //
      // `readOnlyEnforcer` is not the backstop: it rejects doc-changing PM
      // transactions, which covers `delete` / `archive`, but `note` / `todo` /
      // `report` / `cutter` / `suggest-edit` REGISTER A CARD — React state plus a
      // sidecar write, which never passes through ProseMirror. Those sailed past.
      //
      // Asked through the ONE door and asked LIVE, at the moment of the
      // mutation, so no snapshot can go stale between menu-build and click.
      //
      // TASK 733 — that door is now `surfaceEditableNow`, not `collabReadOnly`,
      // because the pen was only ONE of the two axes and this seam was reading
      // the one that cannot move. `collabReadOnly` is `!view.editable`, and
      // MAIN pins `view.editable = true` for the view's entire lifetime
      // (`Editor.tsx` — `contenteditable="false"` broke selection routing in
      // the Reader), so on MAIN the gate above was a CONSTANT `false`: inert on
      // the one surface every card row lives on. The HOST axis — the React
      // `editable` prop, mirrored in `editableRef`, which `readOnlyEnforcer`
      // filters transactions against — is what a Library Reader pane sets
      // false, and there this dispatcher ran the destructive confirm, fired
      // every anchored card's lifecycle `delete` and the anchor retarget, and
      // THEN dispatched a transaction the enforcer dropped on the floor. The
      // paragraph stayed; its footnote and citation cards left the panels until
      // reload.
      //
      // Both axes, one question: `surfaceEditableNow` is `view.editable` AND
      // `editableRef` (`surface-editable.ts`). Still NOT the sidecar axis —
      // what a Reader may write to DISK is `isSidecarWriteAllowed` /
      // `isCardMutationAllowed`. The Reader's one writable sidecar is
      // `notes.json`, and a note created from here is unreachable anyway: its
      // Mode-B `linkedAnchor` mark is itself a `docChanged` transaction the
      // enforcer refuses, so an enabled note row was another dead affordance.
      // It greys with the rest.
      if (!surfaceEditableNow(ed)) return;

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

      // ── RE-ASK AFTER EVERY AWAIT (task 735) ─────────────────────────────
      // The gate above is live at CLICK time; a confirm is unbounded user time,
      // and the host can flip the surface read-only while it is open. So the
      // question is asked again here, and once more at the commit door
      // (`commitDocThenCards` / `commitRangeDelete`) after the settle prompt the
      // range legs await below — the 648 contract, one surface over. A refusal
      // after the user confirmed is LOUD: they asked for something that did not
      // happen.
      if (!surfaceEditableNow(ed)) {
        notifyRefused(lifecycleLabel(action), notify);
        return;
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
      // NodeSelection on the block itself (so an atom-aware path reads the
      // BLOCK, not a text range); text-bearing refs plant a TextSelection
      // over the range, as before. (The `archiveSelection` handle this used
      // to name as the atom-aware reader was a dead capture outside the door
      // — task 565 retired it; the archive branch below is the one capture.)
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
      } else if (isRangeKind(ref.kind)) {
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
        ref.kind === "selection" || isRangeKind(ref.kind)
          ? "paragraph"
          : ref.kind;
      // Only the selection / linkedRange refs hold a literal text range
      // whose first-line top is meaningful for a range anchor — Mode B
      // cards (note/highlight/cutter/revision) drop a linkedAnchor mark
      // when invoked from a range source. Block refs (paragraph, heading,
      // list, listItem, …) anchor at the block level — no mark.
      const wantRangeAnchor =
        text.length > 0 &&
        (ref.kind === "selection" || isRangeKind(ref.kind));

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
          // anchor is ever minted. As a second layer, `tryCreateLinkedAnchor`
          // itself returns null on a zero-width selection (`to <= from`) and
          // the `!record` guard below bails on that too. So both an empty
          // paragraph AND any zero-content range short-circuit cleanly here.
          if (!text) break;
          const attempt = tryCreateLinkedAnchor(ed, "highlight", undefined, undefined, {
            tintColor: defaultTintForLinkedAnchorKind("highlight"),
          });
          if (!attempt.ok) {
            // Filtered ⇒ loud (task 735); nothing to mark ⇒ the clean no-op.
            if (attempt.reason === "filtered") throw new DocChangeRefused();
            break;
          }
          const record = attempt.record;
          const card = cardCreation.createHighlight({
            anchor: {
              anchorId: record.anchorId,
              anchorText: record.text,
              anchorContent: record.content,
              anchorLatex: record.latex,
            },
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
          // ── VALIDATE DRY, MINT, THEN COMMIT (task 735) ─────────────────
          // `duplicateSlice` clones every atom's / Mode-B mark's card as it
          // walks, because `lifecycle.clone` MINTS the id the slice must carry
          // — so the card half cannot simply follow the document half here.
          // Instead every question that could refuse the transaction is asked
          // FIRST, on a dry build whose "clones" mint nothing: the schema
          // check, the surface's editability, and the plugins' own filters.
          // Only a transaction all three admit is rebuilt for real. (A dry
          // clone never answers null, so the dry slice keeps every atom and
          // mark the real one could — stripping a mark can only make a slice
          // MORE valid, never less.) Before this, the clones existed before
          // `tr.doc.check()` ran, so a schema refusal left a full set of cards
          // pointing at content that was never inserted.
          const placeDupSelection = (tr: Transaction) => {
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
          };
          const dryTr = ed.state.tr.replace(
            outer.to,
            outer.to,
            duplicateSlice(slice, dryCloneLifecycle(cardLifecycle)),
          );
          // Pre-dispatch schema validation. PM's `Node.check` throws
          // when the new doc shape violates a content rule (e.g. two
          // titleFields, an exampleItem outside an exampleBlock, a
          // figureBlock in a slot that doesn't allow one). Asked of the DRY
          // build, so a refusal leaves the doc AND every sidecar untouched.
          try {
            dryTr.doc.check();
          } catch (err) {
            console.warn("[Duplicate] schema violation; aborting", err);
            notify({
              tone: "danger",
              message: "This kind cannot be duplicated here.",
            });
            break;
          }
          placeDupSelection(dryTr);
          if (!surfaceEditableNow(ed) || !transactionAdmitted(ed, dryTr)) {
            notifyRefused("Duplicate", notify);
            break;
          }
          const diag = createDuplicateDiagnostics();
          const cloneLog = recordingCloneLifecycle(cardLifecycle);
          const cloned = duplicateSlice(slice, cloneLog.api, diag);
          const tr = ed.state.tr.replace(outer.to, outer.to, cloned);
          placeDupSelection(tr);
          if (!commitDocThenCards(ed, tr)) {
            // Unreachable while the dry probe above asks every filter the
            // dispatch runs — kept so a future filter that disagrees with its
            // own probe still cannot strand the clones it forced us to mint.
            cloneLog.rollback();
            notifyRefused("Duplicate", notify);
            break;
          }
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
          // content, resolve the reanchor target, cascade, then commit the
          // delete — and only once it has landed, re-home the displaced cards,
          // clean up the range's sidecars and mint the snippet (task 735).
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
          // The door takes the RANGE, not a slice (task 563): the leaf cuts it
          // WITH its parents, so a selection from the middle of one bullet item
          // to the middle of the next arrives as `bulletList(listItem, listItem)`
          // — a model the card can hold and a restore lands as a two-item list
          // — rather than two orphan items at doc level that mounted a dead
          // card and restored as a phantom list. Open (partly covered)
          // ancestors are captured identity-less; wholly covered blocks keep
          // theirs. The door then asks the excerpt schema about CONTENT as
          // well as vocabulary.
          //
          // Runs BEFORE `commitRangeDelete`, so an abort leaves the
          // document and every sidecar completely untouched.
          //
          // It is also the FIRST of the two read-only questions this leg asks
          // before it mutates anything (task 636): the schema probe below, then
          // the SETTLE ask. Both must precede the first mutation, so the probe
          // runs against the pre-settle doc for its VERDICT and the payload is
          // re-derived after the settle only if a settlement actually moved the
          // document. `prepareCardBodyCapture` is pure, so asking twice costs
          // nothing but says the truth: the refusal leaves everything untouched.
          const refuseCapture = (
            refusal: Extract<
              ReturnType<typeof prepareCardBodyCapture>,
              { ok: false }
            >,
          ) => {
            console.warn(
              "[Archive] refused — the capture cannot mount in the archive card body; " +
                "the document was NOT modified.",
              {
                reason: refusal.reason,
                constructs: refusal.constructs,
                illFormed: refusal.illFormed,
                ref,
              },
            );
            // A refusal NAMES what it refused (the loud-refusal rule): "part of
            // it" leaves the user with nothing to act on.
            notify({
              message:
                `Can't archive this — the Archive panel can't hold ` +
                `${describeCardBodyRefusal(refusal)}, so nothing was removed.`,
            });
          };
          const probe = prepareCardBodyCapture(
            { doc: ed.state.doc, from: extended.from, to: extended.to },
            bodySchemaForCardKind("archive"),
          );
          if (!probe.ok) {
            refuseCapture(probe);
            break;
          }
          // ── ASK BEFORE YOU DESTROY (task 636) ──────────────────────────
          // A card inside this passage can own a LIVE applied splice, and
          // ending its record raises a three-way keep/revert/cancel prompt.
          // That prompt used to be raised from inside `cleanupLinksInRange`,
          // one statement before the `tr.delete` — so the text was gone before
          // the user answered and `Revert` had nothing left to restore. Settle
          // every splice in the range FIRST; a decline aborts the whole gesture
          // with the document untouched. The returned range is corrected for
          // whatever the settlements moved.
          const settlement = await settleRangeCardObligations(
            ed,
            extended.from,
            extended.to,
            appliedSplice,
          );
          if (!settlement) break;
          const settled = { from: settlement.from, to: settlement.to };
          // A settlement rewrote text inside the passage (a revert restored the
          // pre-suggestion original), so the archived copy must be taken from
          // the document the user actually settled on — not the pre-settle one.
          const capture = settlement.docMoved
            ? prepareCardBodyCapture(
                { doc: ed.state.doc, from: settled.from, to: settled.to },
                bodySchemaForCardKind("archive"),
              )
            : probe;
          if (!capture.ok) {
            refuseCapture(capture);
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
          // RESOLVED before the delete (positions are pre-delete), APPLIED
          // right after it lands (task 735): the `virgil-textobject-orphaned`
          // sweep that strips a link still naming a vanished uuid runs in a
          // `setTimeout(0)` off that transaction, so a synchronous retarget in
          // the commit's card half still precedes it — by construction, not by
          // racing — without re-homing anything for a delete that was refused.
          const displacedUuids = collectRemovedAnchorUuids(
            ed.state.doc,
            settled.from,
            settled.to,
          );
          const neighbour = resolveDisplacedAnchorTarget(
            ed.state.doc,
            settled.from,
            settled.to,
            displacedUuids,
          );
          // Taken now, against the pre-delete doc, and APPLIED only once the
          // delete has landed (task 735) — see `commitRangeDelete`.
          const snapshot = neighbour
            ? captureParagraphSnapshot(ed, neighbour.uuid)
            : null;
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
          // ── THE DOCUMENT FIRST, THEN THE CARDS (task 735) ──────────────
          // Every sidecar write this gesture makes — the Mode-A re-home, the
          // range's card deletes, the snippet — runs only once the delete has
          // LANDED. Before, all three ran around a dispatch nobody measured, so
          // a refused delete left the passage in place, its cards destroyed and
          // an archive snippet minted for text that was never archived.
          // (`richContent` was captured above, from the settled document, so the
          // snippet still carries every inline atom the delete removes.)
          let snippetId: string | null = null;
          const landed = commitRangeDelete(
            ed,
            settled.from,
            settled.to,
            cardLifecycle,
            () => {
              anchorRetarget.retarget({
                removed: displacedUuids,
                target: neighbour,
                // Self-healing on reload, exactly as the drop-mode re-anchor
                // gesture's fresh links are.
                snapshot,
              });
              snippetId = cardCreation.createArchiveSnippet({
                text,
                content: richContent,
                paragraphId: snippetParagraphId,
                targetKind: snippetTargetKind,
                mode: "omni",
              }).id;
            },
          );
          if (!landed || snippetId == null) {
            notifyRefused("Archive", notify);
            break;
          }
          panelId = "archive";
          focusCardKey = cardPopKey("archive", snippetId);
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
          // ── ASK BEFORE YOU DESTROY (task 636) ──────────────────────────
          // Phase one: settle every live applied splice inside the passage,
          // awaited, BEFORE a single character moves. The prompt this raises
          // used to come from inside the cleanup walk, one statement before the
          // `tr.delete` below — so the paragraph was already gone by the time
          // the user answered, Cancel left a card whose text had vanished, and
          // Revert could no longer resolve the range it existed to restore. A
          // decline aborts the whole gesture with the document untouched.
          const settlement = await settleRangeCardObligations(
            ed,
            extended.from,
            extended.to,
            appliedSplice,
          );
          if (!settlement) break;
          // Phase two, through the commit door (task 735): the range's delete
          // lands and is MEASURED before a single card's lifecycle `delete`
          // fires. A refused transaction destroys nothing. (This ordering also
          // retires F2 by construction — see `commitRangeDelete`.)
          if (
            !commitRangeDelete(
              ed,
              settlement.from,
              settlement.to,
              cardLifecycle,
            )
          ) {
            notifyRefused("Delete", notify);
          }
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
      // reaches the doc instead of being eaten by the browser. See
      // post-refactor followup B4.
      //
      // RENEGOTIATED (task 531). This used to say it was "critical for Delete:
      // it routes through a confirm dialog whose close orphans focus on the
      // body" — an accurate description of a defect in the dialog SHELL, patched
      // at this one call site and nowhere else, which is exactly how the audit
      // found it. `SystemDialog` now captures the element focus was on when it
      // opened and gives it back on every close path, so no caller compensates
      // for a dialog close any more.
      //
      // This call SURVIVES because it wants a DIFFERENT target, and the two
      // compose rather than duplicate:
      //   - CANCEL returns above (`if (!proceed) return;`), so this never runs;
      //     the shell restores the grab-handle affordance the user came from,
      //     which is where they are looking.
      //   - CONFIRM deletes the block, taking its own handle out of the DOM —
      //     so the shell's restore correctly finds no connected target and
      //     stands down, and the honest destination for "the thing you were on
      //     is gone" is the DOCUMENT, not a substitute chrome element.
      // It also wins on ordering whichever way the two land: this runs in the
      // microtask that resumes after `await confirm(...)`, before React flushes
      // the passive cleanup the restore lives in, and a restore that did run
      // first would be a still-connected element this `focus()` then overrides.
      //
      // `view.focus()` (raw ProseMirror) focuses with `preventScroll`, so this
      // is a focus and not a navigation — same rule as `refocusEditor`.
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
      appliedSplice,
      confirm,
      notify,
      ensureOmniActiveForPanel,
    ],
  );

  // ── ONE FAILURE DOOR (task 735) ─────────────────────────────────────────
  // Both menus fire this and move on; a throw anywhere in the compound (between
  // a settle prompt and the commit, inside a card creation, a stale position)
  // used to surface as an unhandled rejection the user never saw. The promise
  // therefore never rejects: a failure reaches the user through the same
  // `notify` door the refusals use.
  const dispatch = useCallback(
    async (action: DragHandleAction, ref: DragHandleRef): Promise<void> => {
      try {
        await dispatchUnguarded(action, ref);
      } catch (err) {
        if (err instanceof DocChangeRefused) {
          notifyRefused(lifecycleLabel(action), notify);
          return;
        }
        console.error(`[ActionsMenu] "${action}" failed`, err, ref);
        notify({
          tone: "danger",
          message: `${lifecycleLabel(action)} failed — something went wrong, see the console for details.`,
        });
      }
    },
    [dispatchUnguarded, notify],
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

/** The loud refusal for a compound the commit door turned away (task 735): the
 *  surface stopped being editable while the gesture was in flight (a confirm or
 *  settle prompt was open), or a plugin filtered the transaction. Nothing was
 *  changed — the document half never landed, so the card half never ran — and
 *  the user who just confirmed an action must hear that it did not happen. */
function notifyRefused(
  label: string,
  notify: DragHandleActionsDeps["notify"],
): void {
  console.warn(`[${label}] refused — the document change did not land; nothing was modified.`);
  notify({
    message: `${label} didn't happen — this document can't be edited right now, so nothing was changed.`,
  });
}

/** Capitalized console tag for a lifecycle action ("archive" → "Archive"). */
function lifecycleLabel(action: DragHandleAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

// `MEANINGFUL_BLOCK_ATOM_NODE_NAMES` — the "non-trivial to lose" set — now
// lives in `@/text-objects/text-object-registry` beside the registry it derives
// from (task 641), because the capture/schema-symmetry predicate the WRAP paths
// ask is its second consumer. `isAtomNode` (ATOM_REGISTRY) still covers the
// INLINE atoms (`footnote` / `citation` / `\ref` / `inlineMath`) here.

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
 * This is a LIFECYCLE-class door, so the range comes from the registry's
 * lifecycle hook (`collectMoveSource`) for ANY kind that declares one —
 * `heading` is merely the only kind that does so today (task 732; before it,
 * the comment claimed this wiring and the code hardcoded the section walk).
 *
 *   selection          → the selection's range as-is
 *   linkedRange        → mark bounds (the menu never opens for this kind,
 *                        but kept for completeness)
 *   kind with a lifecycle hook → whatever `collectMoveSource` returns
 *                        (heading → section bounds: heading + body)
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

  // The registry's lifecycle hook, for ANY kind that declares one. `undefined`
  // = no hook (fall through to the generic node bounds); `null` = the hook is
  // declared and could not locate the object, which is a BAIL — never a
  // silent fallback to bounds the kind has said are the wrong ones.
  const lifecycleOverride = scopeOverrideRange(
    ed.state.doc,
    ref.kind,
    ref.id,
    "lifecycle",
  );
  if (lifecycleOverride !== undefined) return lifecycleOverride;

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

/**
 * The card-creating legs' refusal (task 735): the Mode-B mark a card was about
 * to be written against was FILTERED out of the document. Thrown rather than
 * returned so no leg can go on to register its card — the one failure door in
 * `dispatch` turns it into the loud refusal.
 */
class DocChangeRefused extends Error {
  constructor() {
    super("the document change was refused");
  }
}

/**
 * A range anchor for a new card, or `undefined` when the range has nothing to
 * mark — the card then anchors at block level (Mode A), as it always has.
 * THROWS `DocChangeRefused` when the mark was filtered: a card written against
 * an anchor that exists nowhere would have a dead "jump to text" and a
 * highlight that never paints.
 */
function createAnchor(ed: Editor, kind: LinkedAnchorKind) {
  const attempt = tryCreateLinkedAnchor(ed, kind);
  if (!attempt.ok) {
    if (attempt.reason === "filtered") throw new DocChangeRefused();
    return undefined;
  }
  const record = attempt.record;
  // `anchorContent` (task 488) is the RICH twin of `record.text` — carry it, or
  // every card minted here shows its captured passage as the flattened line
  // `doc.textBetween` produced. `anchorLatex` (task 696) is the third form:
  // drop it and every suggestion this card is later morphed into is applied
  // against a dialect it was never captured in.
  return {
    anchorId: record.anchorId,
    anchorText: record.text,
    anchorContent: record.content,
    anchorLatex: record.latex,
  };
}

/**
 * Action class — annotation actions attach a card to text in place;
 * lifecycle actions operate on the structural region (whole section for
 * heading, etc.). The split exists so that heading × Highlight wraps
 * only the heading line (annotation) while heading × Delete removes the
 * whole section (lifecycle). See ACTION-MENU-DIAGNOSIS.md cluster C9.
 */
type ResolveAction = ActionScopeClass;

// DERIVED from the one owner (`@/text-objects/action-scope`); the registry
// side (`action-registry.ts`) asks that same owner rather than keeping the
// copy it used to — task 732 retired the two hand-kept sets. The explicit
// `Set<DragHandleAction>` is this vocabulary's type-level pin: it compiles
// only while every canonical id is a real `DragHandleAction`.
const LIFECYCLE_ACTIONS: ReadonlySet<DragHandleAction> =
  new Set<DragHandleAction>(LIFECYCLE_ACTION_IDS);

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
  return actionScopeClass(action);
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

  // The registry's per-class scope hook, for ANY kind that declares one.
  // Annotation actions on a heading stay on the heading line; lifecycle
  // actions on a heading take the whole section — but that is the REGISTRY's
  // statement about `heading`, not this function's. A kind that grows scope
  // asymmetry later is honoured here without an edit. See
  // ACTION-MENU-DIAGNOSIS.md C9/C11 and task 732.
  const override = scopeOverrideRange(
    ed.state.doc,
    ref.kind,
    ref.id,
    forAction,
  );
  if (override !== undefined) {
    return override && { selectionKind: "text", ...override };
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
