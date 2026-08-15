/**
 * Generic factory for "move an inline-atom node" drop specs.
 *
 * Footnotes, citations, refs, and inline math are all inline atom nodes
 * (size 1, no internal cursor positions). Dropping such a payload moves
 * its inline marker from its current position in the doc to the chosen
 * inline cursor position. For Card-bearing atoms (footnote/citation) the
 * Card's body content stays the same — only the marker relocates.
 *
 * TWO source-resolution modes share this one factory:
 *  • **by-id** (default) — `{nodeName, idAttr}`. Scans the doc for the
 *    atom whose id attr matches the id in the cardKey. Used by the
 *    Card float-header drop path (footnote/citation), which can move an
 *    atom across editors (the atom may live in a nested card body).
 *  • **captured-source** — `{resolveSource}`. The in-text grab gesture
 *    captures the exact source node at mousedown (the id-less kinds —
 *    ref, inline math — have nothing to scan by). Same-editor only.
 *
 * Source-editor discovery for by-id: searches the main editor first,
 * then any other editors registered with the drop-target registry (card
 * bodies). This covers a footnote added inside a note's rich-text field.
 *
 * **Anchor the unanchored (opt-in `createAtom`):** a footnote/citation
 * card can exist with NO marker in any editor (created via the panel "+"
 * before being dropped into the prose). For such a card `locateAtom`
 * returns null, so the move path no-ops. When a `createAtom` factory is
 * configured, the no-op becomes an `apply` that BUILDS a fresh atom node
 * — carrying the card's EXISTING id — and inserts it at the drop point.
 * The branch is purely additive: with no factory the move path is
 * byte-unchanged.
 *
 * **Inline invariant:** this factory must NEVER return `{kind:"confirm"}`.
 * Inline atoms are `selectable:false`; the grab gesture is a live drag
 * with a floating ghost, and an async confirm modal would freeze that
 * ghost mid-gesture. Re-anchoring an existing atom is a silent MOVE, and
 * anchoring an unanchored card is a silent CREATE — both `apply`, never
 * `confirm`.
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { getRegisteredEditors } from "../target-registry";
import { adoptNodeIntoSchema, insertLanded } from "../schema-adopt";
import { parseAnyKey } from "@/floats/float-key";
import type {
  DropCtx,
  DropSpec,
  InlineAtomCardAttrs,
  InlineAtomCardKind,
  PlacementKind,
} from "../types";

export interface AtomLocation {
  editor: Editor;
  node: PMNode;
  from: number;
  to: number;
}

/**
 * The per-kind card attrs a create factory receives, or `null` for a spec that
 * declares no `cardApiKind` (the id-less in-text grab kinds).
 */
type CardAttrsOf<K extends InlineAtomCardKind | undefined> =
  K extends InlineAtomCardKind ? InlineAtomCardAttrs[K] : never;

/**
 * Inputs handed to an opt-in `createAtom` factory (the "anchor the
 * unanchored" branch). The factory builds a fresh inline-atom node for a
 * card whose marker doesn't exist in any editor yet, reusing the card's
 * EXISTING id so the new atom and the card stay coupled.
 */
export interface CreateAtomArgs<K extends InlineAtomCardKind | undefined = undefined> {
  /** The card's EXISTING entity id (footnoteId / citationId), parsed from
   *  the drop's `cardKey`. The built node MUST carry this — minting a fresh
   *  id would orphan the card from its marker. */
  id: string;
  /** Schema of the TARGET editor (where the atom will be inserted), so the
   *  factory can resolve its node type and `create(...)` the node. */
  schema: Schema;
  /** The full drop `cardKey`, for factories that need more than the id. */
  cardKey: string;
  /** The per-doc drop context, so a factory can consult a hook accessor
   *  it needs beyond the resolved `cardAttrs`. */
  ctx: DropCtx;
  /**
   * The CARD-AUTHORITATIVE atom attrs, already resolved from
   * `ctx.atomCards[cardApiKind].atomAttrsFor(id)` — the whole point of the
   * create branch (task 233). An unanchored card has no marker to read attrs
   * off, so anything the atom can't regenerate (a footnote's body) has to come
   * from here or be DESTROYED.
   *
   * `null` means the accessor isn't wired in this doc, or the hook declined (an
   * empty draft citation). Both of today's factories REFUSE on it — a rebuild
   * that can't read what it needs must not fill the gap from a default. That is
   * the whole lesson of 233: the empty-body fallback looked like graceful
   * degradation and was the data loss. A factory may only treat `null` as a
   * usable default for a field that carries no user content and that the atom
   * could regenerate anyway.
   */
  cardAttrs: CardAttrsOf<K> | null;
}

export interface InlineAtomMoveOptions<
  K extends InlineAtomCardKind | undefined = undefined,
> {
  /** Schema node name (e.g. "footnote") — for the default by-id resolver. */
  nodeName?: string;
  /** Attribute carrying the entity id (e.g. "footnoteId") — by-id resolver. */
  idAttr?: string;
  /**
   * The inline-atom CARD KIND whose `ctx.atomCards` entry this spec's create
   * branch reads (task 233). Declaring it does three things at once: the
   * factory resolves `cardAttrs` for `createAtom`, it calls the hook's
   * `onAnchored(id)` after a successful insert so the card sheds its
   * `unanchored`/`archived` intent, and it surfaces on the built spec as
   * `requiresCardApi` so the contract test can assert the accessor is actually
   * wired. Omit for the id-less in-text grab (no card, nothing to read).
   */
  cardApiKind?: K;
  /**
   * Override source resolution. The in-text grab passes this to resolve
   * the source from a position captured at mousedown rather than by
   * scanning for an id (the id-less kinds have no id to scan by). When
   * absent, falls back to the by-id scan (`nodeName` + `idAttr`).
   */
  resolveSource?: (cardKey: string, ctx: DropCtx) => AtomLocation | null;
  /**
   * OPT-IN "anchor the unanchored" branch. When source resolution finds NO
   * atom (the card has no marker in any editor yet) AND this factory is
   * configured, `classifyDrop` returns `apply` (instead of the move path's
   * no-op) and `applyDrop` inserts a freshly-built atom — carrying the
   * card's EXISTING id — at the drop position. Return `null` to DECLINE
   * (e.g. an empty draft citation with no serializable citekey, or a target
   * editor whose schema lacks the node type); declining falls back to no-op,
   * exactly as if the factory were absent.
   *
   * When ABSENT the factory is byte-unchanged: the create branch never fires,
   * so the id-less in-text atom-grab path and the by-id float-header move path
   * behave precisely as before. The branch is purely additive.
   *
   * The factory MUST reuse the doc-level node construction (the same attrs the
   * `\footnote{}` / `\cite{}` create paths build) but substitute the card's
   * EXISTING id — it must NEVER mint a new one (that orphans the card).
   */
  createAtom?: (args: CreateAtomArgs<K>) => PMNode | null;
  /** Reject cross-editor drops (the in-text grab is same-editor only). */
  sameEditorOnly?: boolean;
  /** Post-move selection: select the moved node (default) or a caret
   *  just after it. */
  select?: "node" | "caret-after";
  /** Placement geometries this spec accepts (default ["inline-cursor"]). */
  allowedPlacements?: ReadonlyArray<PlacementKind>;
}

/**
 * What the drop RESOLVES to, computed once and read by both doors.
 *
 * `null` (a refusal) and these three shapes are the whole answer space — so
 * `classifyDrop` is `resolveDrop(...) ? apply : no-op` and `applyDrop` executes
 * the very resolution `classifyDrop` decided on. That symmetry was already the
 * reason this hand-written spec is allowlisted out of the `plannedDropSpec`
 * derivation (`planned-decision-guardrail`), and task 328 is what made it
 * load-bearing rather than incidental: the cross-editor branch can now REFUSE,
 * and a refusal reachable from only one door is exactly the task-321 defect.
 */
type AtomResolution =
  | { kind: "create"; node: PMNode }
  | { kind: "move-within"; src: AtomLocation }
  | { kind: "move-across"; src: AtomLocation; insertTr: Transaction };

export function inlineAtomMoveSpec<
  K extends InlineAtomCardKind | undefined = undefined,
>(opts: InlineAtomMoveOptions<K>): DropSpec {
  const resolve = (cardKey: string, ctx: DropCtx): AtomLocation | null =>
    opts.resolveSource
      ? opts.resolveSource(cardKey, ctx)
      : locateAtom(opts, extractId(cardKey), ctx.mainEditor);

  /**
   * The ONE resolution. PURE — it builds values and transactions and dispatches
   * nothing, so running it on both doors (and only on the two doors; never on a
   * hover frame) is free of side effects.
   */
  const resolveDrop = (
    placement: Parameters<DropSpec["applyDrop"]>[0],
    cardKey: string,
    ctx: DropCtx,
  ): AtomResolution | null => {
    if (placement.kind !== "inline-cursor") return null;
    const src = resolve(cardKey, ctx);
    if (!src) {
      // No marker in any editor. If a `createAtom` factory is configured AND it
      // can build a node for this card (a serializable atom), this is the
      // "anchor the unanchored" CREATE branch — apply, never confirm (the
      // inline ghost can't survive an async modal). The factory declining
      // (null) — e.g. an empty draft citation — is a refusal, exactly as if it
      // weren't configured. The node is built with `placement.editor.schema`,
      // so it is target-native by construction and needs no adoption.
      const node = opts.createAtom
        ? buildCreateNode(opts, placement, cardKey, ctx)
        : null;
      return node ? { kind: "create", node } : null;
    }
    // The in-text grab is same-editor only (v1): a cross-editor move splits
    // into two transactions and would fire an unsuppressed footnote-orphan
    // event in the source editor.
    if (opts.sameEditorOnly && placement.editor !== src.editor) return null;
    // Same-editor no-ops: dropping at the position the atom already occupies
    // (either side) leaves it where it was.
    if (
      placement.editor === src.editor &&
      placement.pos >= src.from &&
      placement.pos <= src.to
    ) {
      return null;
    }
    if (placement.editor === src.editor) return { kind: "move-within", src };

    // CROSS-EDITOR (task 328). A footnote/citation card's marker released
    // inside a card body: `footnoteDropSpec` / `citationDropSpec` do not set
    // `sameEditorOnly`, so this is live. The source node comes from the SOURCE
    // editor's schema and ProseMirror compares `NodeType`s by IDENTITY, so
    // splicing it straight in made the fitter drop the atom and append NO step
    // — while the delete below took the marker out of the prose, and with it
    // the footnote's BODY, which is the atom's `content` attr. Adopt, then
    // require evidence the insert landed; either refusal leaves both documents
    // untouched, and the float survives (`postDrop: "keep"`, plus the `no-op`
    // decision cancels the session).
    const node = adoptNodeIntoSchema(src.node, placement.editor.state.schema);
    if (!node) return null;
    // container-fit-exempt: an INLINE atom at an inline-cursor position inside a
    // textblock — there is no block-in-container fit to decide and no container
    // the fitter could split to accommodate it. (The VOCABULARY question, which
    // that exemption is not entitled to answer, is settled one line above.)
    const insertTr = placement.editor.state.tr.insert(placement.pos, node);
    if (!insertLanded(insertTr, node.nodeSize)) return null;
    try {
      insertTr.setSelection(NodeSelection.create(insertTr.doc, placement.pos));
    } catch {
      /* skip silently */
    }
    return { kind: "move-across", src, insertTr };
  };

  return {
    allowedPlacements: opts.allowedPlacements ?? ["inline-cursor"],
    targetScope: "any-editor",
    // Surface BOTH halves of the create-branch obligation on the spec, from the
    // mechanism itself: that this spec rebuilds an atom at all, and which ctx
    // accessor it declared for the card's half of it. The contract test asserts
    // the implication (`createsAtom ⇒ requiresCardApi`) — keying the guard on
    // the DECLARATION alone would have walked straight past the pre-233
    // footnote spec, which rebuilt an atom and declared nothing.
    createsAtom: !!opts.createAtom,
    requiresCardApi: opts.cardApiKind,
    classifyDrop(placement, cardKey, ctx) {
      return resolveDrop(placement, cardKey, ctx)
        ? { kind: "apply" }
        : { kind: "no-op" };
    },
    applyDrop(placement, cardKey, ctx) {
      // RE-resolve rather than reuse what `classifyDrop` computed — the same
      // rule `plannedDropSpec` follows, so the transaction dispatched below is
      // always built against the state it lands in.
      const plan = resolveDrop(placement, cardKey, ctx);
      if (!plan || placement.kind !== "inline-cursor") return;
      if (plan.kind === "create") {
        insertNewAtom(placement.editor, placement.pos, plan.node, opts.select);
        // The OTHER half of anchoring (task 233): the card is now in the
        // prose, so its own "parked, re-placeable" intent must clear.
        // Without this the sidecar keeps `unanchored` (and, for a card that
        // got here via archive → unarchive, `archived`), and a panel that
        // lists atomless refs straight from the sidecar renders the same
        // entity twice — live in the prose AND as a stale parked duplicate.
        //
        // MAIN EDITOR ONLY. This spec's `targetScope` is `"any-editor"`, so
        // the atom can legitimately land in a card body (an archive card's
        // excerpt-scope field mounts `footnote`) — but the panels resolve
        // "is it anchored?" against the MAIN doc alone (`getFootnotes()` /
        // the citation position map). Clearing the parked intent for an
        // atom the panel can't see would hide the card from BOTH lists at
        // once: no flags left for the atomless list, no marker in the main
        // doc for the anchored one. Reconcile only where the derivation can
        // corroborate it; a card-body drop leaves the card parked, which is
        // what the panel still shows.
        const id = extractId(cardKey);
        if (id && opts.cardApiKind && placement.editor === ctx.mainEditor) {
          cardApiFor(opts.cardApiKind, ctx)?.onAnchored?.(id);
        }
        return;
      }
      if (plan.kind === "move-within") {
        // Single transaction: delete + adjusted insert (see helper).
        const { node, from, to } = plan.src;
        moveInlineAtomWithin(placement.editor, node, from, to, placement.pos, opts.select);
        return;
      }
      // Cross-editor move: insert first (preserves node identity), then
      // delete in source. Order matters less for atoms than for
      // paragraphs because PM positions are decoupled across editors.
      // (Unreachable when sameEditorOnly — `resolveDrop` already refused.)
      // The insert transaction was BUILT in the resolution, where its adoption
      // and its landed-check could still turn into a refusal; here it is only
      // dispatched, and the source delete happens on its strength alone.
      const { editor: sourceEditor, from, to } = plan.src;
      placement.editor.view.dispatch(plan.insertTr);
      placement.editor.view.focus();
      // Park a caret at the atom's home in the SOURCE editor before the delete,
      // so that editor's undo `selectionBefore` is on-screen (same #8 rationale
      // as the same-editor path). Selection-only, addToHistory:false.
      parkCaretBeforeChange(sourceEditor, from);
      const deleteTr = sourceEditor.state.tr.delete(from, to);
      sourceEditor.view.dispatch(deleteTr);
    },
    postDrop: "keep",
  };
}

/**
 * Resolve the card's existing id and invoke the opt-in `createAtom` factory
 * to build a fresh atom node for the TARGET editor's schema. Returns the
 * built node, or null when no factory is configured, the cardKey has no id,
 * or the factory declines (e.g. an empty draft citation). Pure (no dispatch)
 * so `classifyDrop` can use it as a "can this card be created?" probe and
 * `applyDrop` can reuse the same construction.
 */
function buildCreateNode<K extends InlineAtomCardKind | undefined>(
  opts: InlineAtomMoveOptions<K>,
  placement: Extract<Parameters<DropSpec["applyDrop"]>[0], { kind: "inline-cursor" }>,
  cardKey: string,
  ctx: DropCtx,
): PMNode | null {
  if (!opts.createAtom) return null;
  const id = extractId(cardKey);
  if (!id) return null;
  // Resolve the card-authoritative attrs ONCE, here, so every factory reads
  // them the same way and none can forget to (task 233 was exactly that
  // forgetting). `null` when the kind declares no accessor, the accessor isn't
  // wired in this doc, or the hook declined.
  let cardAttrs: unknown = null;
  if (opts.cardApiKind) {
    const api = cardApiFor(opts.cardApiKind, ctx);
    if (!api && process.env.NODE_ENV !== "production") {
      // The registered-but-unwired shape, made loud instead of silent. Every
      // factory declines on a null `cardAttrs`, so the drop is a no-op rather
      // than a lossy rebuild — but a no-op drop reads as "the gesture is
      // broken," and this says why.
      console.warn(
        `[DropMode] "${opts.cardApiKind}" declares a create branch but no ` +
          `ctx.atomCards.${opts.cardApiKind} accessor is wired in this doc — ` +
          `the drop declines rather than rebuild the atom from a default. ` +
          `Wire it in EditorPane via buildInlineAtomCardApis.`,
      );
    }
    cardAttrs = api?.atomAttrsFor(id) ?? null;
  }
  return opts.createAtom({
    id,
    schema: placement.editor.schema,
    cardKey,
    ctx,
    cardAttrs: cardAttrs as CardAttrsOf<K> | null,
  });
}

/** The one lookup into the registry-keyed inline-atom ctx bag. Typed per kind
 *  so a factory's `cardAttrs` narrows to that kind's payload. */
function cardApiFor<K extends InlineAtomCardKind>(
  kind: K,
  ctx: DropCtx,
): NonNullable<DropCtx["atomCards"]>[K] | undefined {
  return ctx.atomCards?.[kind];
}

/**
 * Insert a freshly-built inline atom at `insertPos` (the "anchor the
 * unanchored" CREATE branch). Unlike the move path there is no source atom
 * to delete — the card simply had no marker yet — so this is a single insert
 * transaction. `select` mirrors the move's post-action selection ("node" =
 * NodeSelection on the new atom; "caret-after" = caret just past it). NEVER
 * `.scrollIntoView()`, matching the move helper (these atoms are
 * `selectable:false`).
 *
 * Undo-jump guard (backlog #8, create-path analogue): inline atoms are
 * `selectable:false`, so the grab gesture never rests a selection at the drop
 * point; at insert time the editor's selection is still the stale pre-gesture
 * one (often off-screen / doc-top). prosemirror-history captures the insert's
 * `selectionBefore` from that stale state, so Cmd-Z right after anchoring would
 * restore it with `scrollIntoView()` → the viewport jumps off-screen. There is
 * no "original home" for a create (the card had no marker), so the on-screen
 * target IS the insert pos: park a `TextSelection` caret there FIRST
 * (`addToHistory:false`), so `selectionBefore` lands where the atom appears and
 * undo scrolls *there*. (The MOVE path guards the same way via the original
 * atom home — see `parkCaretBeforeChange`.)
 */
function insertNewAtom(
  editor: Editor,
  insertPos: number,
  node: PMNode,
  select: "node" | "caret-after" = "node",
): void {
  // Park a caret at the insert pos so the insert's `selectionBefore` (captured
  // by prosemirror-history) is on-screen where the atom appears — see jsdoc.
  parkCaretBeforeChange(editor, insertPos);
  // container-fit-exempt: inline atom at an inline cursor (see above).
  // schema-adopt-exempt: the CREATE branch — `buildCreateNode` builds this node
  // with `placement.editor.schema`, i.e. THIS editor's own vocabulary, so there
  // is no foreign node to adopt. Nothing crosses an editor boundary here.
  const tr = editor.state.tr.insert(insertPos, node);
  try {
    tr.setSelection(
      select === "caret-after"
        ? TextSelection.create(tr.doc, insertPos + node.nodeSize)
        : NodeSelection.create(tr.doc, insertPos),
    );
  } catch {
    /* position couldn't host the selection — skip silently */
  }
  editor.view.dispatch(tr);
  editor.view.focus();
}

/**
 * Same-editor delete+insert preserving node identity. `select` picks the
 * post-move selection: "node" (default — a NodeSelection on the moved
 * atom, the legacy float-header behavior) or "caret-after" (a caret just
 * past the atom — uniform across kinds, no chrome asymmetry on the
 * `selectable:false` atoms). NEVER `.scrollIntoView()`: that would
 * resurrect the ~100px scroll-jump that `selectable:false` was added to
 * avoid (footnote.ts / citation.ts).
 *
 * Undo-jump guard (backlog #8): inline atoms are `selectable:false`, so the
 * grab gesture never rests a selection on the atom; at drop time the editor's
 * selection is stale (often doc-top). prosemirror-history captures
 * `selectionBefore` from the *pre-move* state, so Cmd-Z would restore that
 * stale doc-top caret with `scrollIntoView()` → the viewport jumps to the top.
 * Before building the move, `parkCaretBeforeChange` rests a `TextSelection` caret
 * adjacent to the atom's ORIGINAL location (`addToHistory:false`), so
 * `selectionBefore` lands at the atom's old home (on-screen) and undo scrolls
 * *there*, not to the top.
 */
function moveInlineAtomWithin(
  editor: Editor,
  node: PMNode,
  from: number,
  to: number,
  insertPos: number,
  select: "node" | "caret-after" = "node",
): void {
  // Park a caret at the atom's original home so the move's `selectionBefore`
  // (captured by prosemirror-history) is on-screen — see helper jsdoc.
  parkCaretBeforeChange(editor, from);
  const adjustedInsert = insertPos > to ? insertPos - (to - from) : insertPos;
  const tr = editor.state.tr.delete(from, to);
  // container-fit-exempt: inline atom at an inline cursor (see above).
  // schema-adopt-exempt: the SAME-EDITOR move — `resolveDrop` reaches this
  // helper only on its `move-within` branch, where target and source are the
  // one editor, so the node is native by construction and no boundary is
  // crossed. (The landed net is likewise inapplicable: this transaction deletes
  // and inserts, so its net growth is not the payload's.)
  tr.insert(adjustedInsert, node);
  try {
    tr.setSelection(
      select === "caret-after"
        ? TextSelection.create(tr.doc, adjustedInsert + node.nodeSize)
        : NodeSelection.create(tr.doc, adjustedInsert),
    );
  } catch {
    /* position couldn't host the selection — skip silently */
  }
  editor.view.dispatch(tr);
  editor.view.focus();
}

/**
 * Park a `TextSelection` caret adjacent to `pos` as a selection-only,
 * `addToHistory:false` transaction, BEFORE the structural (move or insert)
 * transaction is built/dispatched. This makes prosemirror-history capture that
 * transaction's `selectionBefore` here (on-screen) instead of the stale
 * pre-gesture selection (often off-screen / doc-top) — so Cmd-Z restores a
 * caret at `pos` and scrolls *there* rather than jumping the viewport off-screen
 * (backlog #8).
 *
 * Both inline-atom paths share this guard, anchoring at the on-screen target:
 * - MOVE (`moveInlineAtomWithin` / cross-editor): `pos` is the atom's ORIGINAL
 *   home — where it currently sits before relocating.
 * - CREATE (`insertNewAtom`, "anchor the unanchored"): there is no original home
 *   (the card had no marker), so `pos` is the INSERT position — where the new
 *   atom appears.
 *
 * Invariants (identical for both callers):
 * - MUST be a `TextSelection` caret, never a `NodeSelection`: these atoms are
 *   `selectable:false`, and a NodeSelection on one would reintroduce the
 *   ~100px scroll-jump the grab gesture deliberately avoids.
 * - `addToHistory:false` keeps this parking tr out of the undo stack, so one
 *   Cmd-Z still undoes the whole move/create in a single step.
 * - Positions are untouched (selection-only), so the caller's `from`/`to`/
 *   `insertPos` stay valid against the post-parking state.
 *
 * `TextSelection.near` resolves the nearest valid text position to `pos`,
 * tolerating atom boundaries; if no text position exists it no-ops silently.
 */
function parkCaretBeforeChange(editor: Editor, pos: number): void {
  try {
    const tr = editor.state.tr;
    const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near($pos));
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  } catch {
    /* couldn't resolve a caret near the position — skip; change still proceeds */
  }
}

/** Walk the main editor first, then every other registered editor,
 *  looking for an inline atom with the matching id. Used by the by-id
 *  (float-header) resolver only. */
function locateAtom(
  opts: Pick<InlineAtomMoveOptions, "nodeName" | "idAttr">,
  id: string | null,
  mainEditor: Editor | null,
): AtomLocation | null {
  if (!id || !opts.nodeName || !opts.idAttr) return null;
  const nodeName = opts.nodeName;
  const idAttr = opts.idAttr;
  const editors: Editor[] = [];
  if (mainEditor) editors.push(mainEditor);
  for (const e of getRegisteredEditors()) {
    if (e !== mainEditor) editors.push(e);
  }
  for (const editor of editors) {
    let found: AtomLocation | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.type.name !== nodeName) return true;
      if (node.attrs?.[idAttr] !== id) return true;
      found = { editor, node, from: pos, to: pos + node.nodeSize };
      return false;
    });
    if (found) return found;
  }
  return null;
}

function extractId(cardKey: string): string | null {
  // Colon-safe via the dual-read parser (footnote/citation card floats key on
  // `float:card:<kind>:<id>` post-flip; legacy `<prefix>:<id>` still parses).
  return parseAnyKey(cardKey)?.id ?? null;
}
