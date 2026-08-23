/**
 * TEXT_OBJECT_REGISTRY — single source of truth for every TextObject kind.
 *
 * Adding a new kind = one entry here + one schema-group annotation (or
 * mark spec, for range kinds). The rest of the system reads off this
 * registry: grab-handle layout, popout dispatch, drop adapters, drag-
 * menu actions, marginalia placement.
 *
 * NOT here, deliberately: the `\v*` id-marker command vocabulary that carries
 * a kind's id through the LaTeX round trip. This registry is editor-coupled
 * (TipTap `Editor`, the doc-structure bus, the drop adapters), so the parser
 * and serializer can never import it — which is why the `sourceMarker` facet
 * that used to sit here was read by nobody — from task 064 (2026-07-06) until
 * its deletion — while the round trip kept its own hardcoded copies (task 255). The markers live in
 * `src/lib/latex-markers.ts`, keyed by the entity they identify.
 *
 * SSOT sibling: `src/panels/panel-registry.ts`. (The link layer has no per-kind
 * registry — its taxonomy is the `LinkKind` union and its DOM contract is
 * `src/links/link-dom-contract.ts`; the table that used to sit beside these two
 * declared behaviour nothing read and was removed in task 202.)
 *
 * See TEXT-OBJECT-REFACTOR.md §3.
 */

import type {
  Node as PMNode,
  NodeType,
  ResolvedPos,
} from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import { headingTypeName } from "@/lib/heading-types";
import { getBus } from "@/lib/tiptap/doc-structure";
import {
  getSectionRangeByUuid,
  getHeadingLineRangeByUuid,
} from "@/lib/section-range";
import { sectionBlockDoms } from "@/lib/section-dom";
import { findLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { resolveInlineContextElement } from "@/lib/text-metrics";
import { buildFloatKey, parseAnyKey } from "@/floats/float-key";
import {
  topLevelDropAdapter,
  listItemDropAdapter,
  exampleItemDropAdapter,
  blockIntoExpexDropAdapter,
} from "./drop-adapters";
import type {
  ConfirmDescriptor,
  ConfirmDestructiveContext,
  DragHandleAction,
  MoveSource,
  TextObjectKind,
  TextObjectMeta,
  TextObjectRef,
} from "./types";

/**
 * Shared "how tall can a popout be" policy. **Relocated to the AF float
 * subsystem** (`@/floats/float-policy`) — it is a *float* policy (Issue-13),
 * consumed by both the lifted-overlay capture cap in `TextObjectGrabHandle`
 * and the instant-popout auto-fit grow cap in the float window. Re-exported
 * here so existing `text-object-registry` importers keep resolving.
 */
export { POPOUT_MAX_VH, capPopoutHeight } from "@/floats/float-policy";

// ---------------------------------------------------------------------------
// Per-kind action sets — see ACTION-MENU-DIAGNOSIS.md cluster C1.
//
// The previous default `ALL_ACTIONS` was applied uniformly to every kind,
// so the dispatcher fired for cells (e.g. `codeBlock × Footnote`,
// `titleField × Duplicate`) where the resulting insertion / mutation was
// nonsensical or corrupting. Curating the sets here is the unifying fix:
// the menu filter at `DragHandleMenu.tsx` already consults this slot, so
// disabled entries fall out for free.
//
// Three classes:
//   • PROSE_ACTIONS — full vocabulary; for kinds that HOLD PROSE. Not only the
//     text-bearing kinds whose OWN node is the textblock (paragraph / heading /
//     titleField): also the structural CONTAINERS whose body a caret can reach
//     (blockquote, the two lists, expex examples, a figure's caption). See
//     `INLINE_INSERT_ACTIONS` below for why the distinction had to be made.
//   • ATOM_BLOCK_ACTIONS — drops F/C/E for a kind with nowhere an inline
//     insert can land ANYWHERE in its subtree (a true block atom).
//   • TITLE_FIELD_ACTIONS — drops C/D/A/⌫ (title is a singleton with no
//     bibliography; the destructive cells corrupt the doc).
//   • LINKED_RANGE_ACTIONS — drops D (cloning a mark-backed range with
//     duplicated text would mint two marks pointing at the same text,
//     conflicting with the linkedAnchor's id-uniqueness invariant).
// ---------------------------------------------------------------------------

const PROSE_ACTIONS: ReadonlyArray<DragHandleAction> = [
  "highlight",
  "note",
  "footnote",
  "citation",
  "todo",
  "suggest-edit",
  "cutter",
  "report",
  "duplicate",
  "archive",
  "delete",
];

/**
 * The three card actions that do NOT act on the block — they act at an inline
 * POSITION inside it. Footnote and Citation insert an inline ATOM; Suggest-edit
 * wraps the passage in a `linkedAnchor` MARK. So their applicability is a
 * property of the TEXTBLOCK the insert lands in, which for a CONTAINER kind is
 * a DESCENDANT and not the ref's own node (task 148).
 *
 * This is the family `blockRangeAllowsAction` answers positionally, and the
 * family `ATOM_BLOCK_ACTIONS` drops. `highlight` is deliberately NOT a member
 * even though it is mark-backed: the true atom blocks KEEP it as a pinned
 * clean no-op (no text ⇒ it early-breaks), so it stays a per-KIND policy answer
 * — see the `MARKLESS_BLOCK_ACTIONS` note below.
 *
 * The dispatcher's defence-in-depth set (`CONTAINER_SENSITIVE_ACTIONS` in
 * `drag-handle-actions.ts`) is derived from this + `highlight`.
 */
export const INLINE_INSERT_ACTIONS: ReadonlySet<DragHandleAction> = new Set([
  "footnote",
  "citation",
  "suggest-edit",
]);

/**
 * A true block ATOM: nowhere in its subtree can an inline insert land, so the
 * three `INLINE_INSERT_ACTIONS` grey out. The premise is schema-checkable, and
 * CI checks it — `container-body-inline-insert.test.ts` sweeps every kind and
 * fails any whose curated set drops one of the three while the real editor
 * schema says a descendant textblock would happily host it. That leg exists
 * because this bucket was a HAND assignment stating a falsehood for four kinds:
 * `bulletList` / `orderedList` / `exampleBlock` / `figureBlock` were filed here
 * as "structural containers" though each holds prose a caret can reach, so the
 * grab bar greyed what the lightning bolt (which resolves the caret's inner
 * paragraph) enabled at the very same spot.
 */
const ATOM_BLOCK_ACTIONS: ReadonlyArray<DragHandleAction> = PROSE_ACTIONS.filter(
  (a) => !INLINE_INSERT_ACTIONS.has(a),
);

// A non-prose block whose node is `marks: ""` (`latexComment` — task 066 — and
// `codeBlock` — task 146) additionally drops `highlight`: Highlight wraps the
// live range in a `linkedAnchor` MARK, but a `marks: ""` node rejects `setMark`,
// so on a text-bearing comment / code block the action silently no-ops (a
// menu-honesty bug). Greying it makes the dead affordance visibly disabled.
// NOTE: the true atom blocks (displayMath/texBlock/graphicsBlock) KEEP highlight
// — they have no text so it clean early-breaks, a deliberate pinned no-op
// (action-coverage-assertion.test).
//
// The true selector for this set is "a text-bearing block whose PM node is
// `marks: ""`" — currently exactly `latexComment` + `codeBlock`. If a THIRD such
// kind appears, prefer deriving MARKLESS-ness from the schema's `marks` spec
// (`schema.nodes[kind].spec.marks === ""`) over hand-assigning the set, so the
// next kind can't silently regress to a dead Highlight. Not built here — two
// kinds don't yet justify the indirection.
const MARKLESS_BLOCK_ACTIONS: ReadonlyArray<DragHandleAction> =
  ATOM_BLOCK_ACTIONS.filter((a) => a !== "highlight");

const TITLE_FIELD_ACTIONS: ReadonlyArray<DragHandleAction> = [
  "highlight",
  "note",
  "footnote",
  "todo",
  "suggest-edit",
  "cutter",
  "report",
];

const LINKED_RANGE_ACTIONS: ReadonlyArray<DragHandleAction> =
  PROSE_ACTIONS.filter((a) => a !== "duplicate");

// ---------------------------------------------------------------------------
// confirmDestructive helpers
//
// Per-kind copy for Delete/Archive warning dialogs. Each helper consults
// the doc + ctx and returns a `ConfirmDescriptor` (the dispatcher
// widens it to `ConfirmOptions`), or `null` to indicate "no warning
// needed for this case." See ACTION-MENU-DIAGNOSIS.md followup B3.
//
// Tone convention: delete → "danger" (red affordance); archive →
// "default" (archived content is recoverable). The dispatcher applies
// the default tone if the descriptor doesn't set one; helpers only
// override when the kind warrants a non-default visual (e.g.
// linkedRange × delete is always danger because the underlying text
// also vanishes).
// ---------------------------------------------------------------------------

/** Action-verb word pair for use in confirm copy. */
function actionVerb(action: "archive" | "delete"): { verb: string; label: string } {
  return action === "delete"
    ? { verb: "Delete", label: "Delete" }
    : { verb: "Archive", label: "Archive" };
}

/** Truncate a snippet to a short preview suitable for inline display in
 *  confirm copy. Single-line, trimmed, ellipsis on overflow. */
function previewText(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Walk the outer range and return the inner-text content of the first
 *  matching block. Cheap: short range, single pass. */
function textInsideOuter(
  doc: PMNode,
  outerRange: { from: number; to: number },
): string {
  return doc.textBetween(outerRange.from, outerRange.to, " ").trim();
}

/** Empty-content + no-attachments shortcut. Used by simple prose kinds
 *  to skip the confirm dialog when there's nothing at stake. */
function isSilentlyDeletable(
  doc: PMNode,
  ctx: ConfirmDestructiveContext,
): boolean {
  if (ctx.hasAnchorsOrAtoms) return false;
  return textInsideOuter(doc, ctx.outerRange).length === 0;
}

/** Build a descriptor for a "simple block" kind (paragraph, blockquote,
 *  code, single-line, …). Returns null when content is empty and there
 *  are no attachments. */
function descriptorForSimpleBlock(
  kindLabel: string,
  doc: PMNode,
  action: "archive" | "delete",
  ctx: ConfirmDestructiveContext,
  opts: { includePreview?: boolean } = {},
): ConfirmDescriptor | null {
  if (isSilentlyDeletable(doc, ctx)) return null;
  const { verb, label } = actionVerb(action);
  const text = textInsideOuter(doc, ctx.outerRange);
  const preview = opts.includePreview ? previewText(text) : "";
  const previewSuffix = preview ? ` “${preview}”` : "";
  return {
    title: `${verb} this ${kindLabel}?`,
    message: `${verb} this ${kindLabel}.${previewSuffix}`,
    confirmLabel: `${label} ${kindLabel}`,
  };
}

/** Confirm descriptor for a structural-container kind (lists, example
 *  block). Reports the count of child items so the user sees the scope
 *  before confirming. Never returns null — an empty list is structural
 *  noise and the user should know they're nuking the wrapper. */
function descriptorForContainer(
  kindLabel: string,
  childTypeName: string,
  childLabelSingular: string,
  doc: PMNode,
  action: "archive" | "delete",
  ctx: ConfirmDestructiveContext,
): ConfirmDescriptor {
  const { verb, label } = actionVerb(action);
  // Count children of the matching type inside the outer range.
  let count = 0;
  doc.nodesBetween(ctx.outerRange.from, ctx.outerRange.to, (node) => {
    if (node.type.name === childTypeName) count++;
    return true;
  });
  const countText =
    count > 0 ? ` (${count} ${childLabelSingular}${count === 1 ? "" : "s"})` : "";
  return {
    title: `${verb} this ${kindLabel}?`,
    message: `${verb} this ${kindLabel}${countText}.`,
    confirmLabel: `${label} ${kindLabel}`,
  };
}

/** Build a descriptor for an "atom block" kind (displayMath, texBlock,
 *  graphicsBlock, figureBlock). Atom blocks ALWAYS warn — there's no
 *  meaningful empty state to preview, so unlike `descriptorForSimpleBlock`
 *  this never returns null and needs no `doc`/`ctx` walk. The confirm
 *  button names the kind (`${label} ${kindLabel}`), matching the file-wide
 *  convention (paragraph/list/example/heading/passage all do the same) so
 *  the dialog title and its button agree. */
function descriptorForAtomBlock(
  kindLabel: string,
  action: "archive" | "delete",
  opts: { message?: string } = {},
): ConfirmDescriptor {
  const { verb, label } = actionVerb(action);
  return {
    title: `${verb} this ${kindLabel}?`,
    message: opts.message ?? `${verb} this ${kindLabel}.`,
    confirmLabel: `${label} ${kindLabel}`,
  };
}

/** Heading × Delete/Archive: wide-scope section summary. Mirrors the
 *  pre-existing `confirmHeadingLifecycle` for these two actions; the
 *  Duplicate gate still uses that helper directly since this slot only
 *  covers destructive actions. */
function descriptorForHeading(
  doc: PMNode,
  uuid: string,
  action: "archive" | "delete",
): ConfirmDescriptor | null {
  const section = getSectionRangeByUuid(doc, uuid);
  if (!section) return null;
  const headingNode = section.nodes[0];
  const headingText = headingNode?.textContent?.trim() ?? "";
  const paragraphCount = section.nodes.filter(
    (n) => n.type.name === "paragraph",
  ).length;
  const subHeadingCount = section.nodes.filter(
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
  const { verb, label } = actionVerb(action);
  return {
    title: `${verb} the entire section?`,
    message: `This will ${verb.toLowerCase()} the entire section ${titleText}${countsText}.`,
    confirmLabel: `${label} section`,
  };
}

// ---------------------------------------------------------------------------
// Float body placeholder — registered concretely in Phase D5 (float
// collapse). Each kind plugs its existing float body in via this slot.
// Today the slot is `null`; the unified TextObjectFloat will check
// `floatBodyComponent != null` before mounting.
// ---------------------------------------------------------------------------

const PLACEHOLDER_FLOAT_BODY = null as unknown;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TEXT_OBJECT_REGISTRY: Record<TextObjectKind, TextObjectMeta> = {
  paragraph: {
    label: "Paragraph",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    // %!v: anchor; not a LaTeX command per se. Marker is the suffix
    // on the paragraph's last line.
    // Feature A1: a lifted paragraph (text) can land inside an expex example —
    // directly into an exampleItem (over an item) or wrapped in a fresh
    // exampleItem (between items). Everywhere else → drop-direct (its normal
    // top-level placement, unchanged). Shared with graphicsBlock + displayMath.
    dropAdapter: blockIntoExpexDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("paragraph", doc, action, ctx, {
        includePreview: true,
      }),
  },
  heading: {
    label: "Heading",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: PROSE_ACTIONS,
    // L3a of the Lifted-Overlay refactor: heading drags through the
    // same two-mode gesture as paragraph (ghost in pod, popout in
    // manila). The per-level label (Chapter/Section/Subsection/…) is
    // computed below via `computeLabel` so the overlay's popout-mode
    // header matches the real popout's `setHeaderLabel` at handoff.
    // Mirror the dynamic label that `heading-body.tsx` pushes via
    // `setHeaderLabel(headingTypeName(level))` — so the overlay's
    // popout-mode header reads the same string the real popout will
    // show on release, with no visible discrepancy at handoff. Walks
    // the doc to find the heading node by uuid (cheap; called once
    // per gesture at threshold cross). Returns null if the source
    // disappeared concurrently — caller falls back to the static
    // `meta.label`.
    computeLabel: (editor, ref) => {
      // Bus-first (wave 2): the structure snapshot answers uuid → pos in
      // O(1), then one nodeAt reads the level — no doc walk. The walk
      // survives only for busless editors (minimal harnesses); it would be
      // O(doc) per gesture, which is affordable but pointless when the
      // index already knows.
      const entry = getBus(editor)?.structure.blocks.get(ref.id);
      if (entry) {
        const n = editor.state.doc.nodeAt(entry.pos);
        if (n?.type.name === "heading" && n.attrs?.uuid === ref.id) {
          const level = n.attrs?.level;
          return typeof level === "number" ? headingTypeName(level) : null;
        }
      }
      let node: PMNode | null = null;
      editor.state.doc.descendants((n) => {
        if (node) return false;
        if (n.type.name === "heading" && n.attrs?.uuid === ref.id) {
          node = n;
          return false;
        }
        return true;
      });
      if (!node) return null;
      const level = (node as PMNode).attrs?.level;
      return typeof level === "number" ? headingTypeName(level) : null;
    },
    // L3-Headings: the lifted ghost shows the WHOLE SECTION, not just the
    // `<h*>` line — so it tells the truth about what a release-in-pod
    // moves (collectMoveSource = the section). Clone every section block's
    // live DOM (sectionBlockDoms = view.nodeDOM over getSectionRangeByUuid's
    // node range) into a detached `.tiptap` container; the overlay
    // sanitizes it. The container re-establishes the editor's content
    // scope (like the body's `.tiptap` does for single-block ghosts,
    // L3b.1) so the cloned blocks get their per-element rules — inter-block
    // rhythm margins (`:where(.tiptap) > :where(…)`), list markers, expex
    // grid, font-size — and `:where(.tiptap) > :first-child` zeroes the
    // heading's leading margin (matching liftSourceRect's headRect.top,
    // which excludes margin). It also resets the container to the editor
    // ROOT's base typography: the overlay root imposes the grabbed
    // heading's typography (weight/size) as the cascade base, which
    // `.tiptap p` re-sizes but does NOT re-weight, so without the reset
    // the section's body prose would inherit the heading's weight. Reading
    // the base from the live editor lets each block's per-element rule
    // (`.tiptap h2` heading, `.tiptap p` body) resolve exactly as in the
    // source — generic for any future multi-block ghost (L3f linkedRange).
    // Returns null for a lone heading (section == just the heading) so the
    // default anchorDom clone stands — no regression for an empty section.
    renderGhost: (anchorDom, editor, ref) => {
      const doms = sectionBlockDoms(editor, ref.id);
      if (doms.length <= 1) return null; // lone heading → default clone
      const container = document.createElement("div");
      container.className = "tiptap";
      const base = window.getComputedStyle(editor.view.dom);
      Object.assign(container.style, {
        fontFamily: base.fontFamily,
        fontSize: base.fontSize,
        fontWeight: base.fontWeight,
        fontStyle: base.fontStyle,
        fontVariant: base.fontVariant,
        letterSpacing: base.letterSpacing,
        color: base.color,
        textAlign: base.textAlign,
        textIndent: base.textIndent,
        textTransform: base.textTransform,
        fontFeatureSettings: base.fontFeatureSettings,
      });
      for (const dom of doms) {
        container.appendChild(dom.cloneNode(true) as HTMLElement);
      }
      return container;
    },
    // L3-Headings + Issue-13: return the WHOLE section's rect. Keep the
    // heading line's left/top/width (the user grabbed the heading; the
    // section ghost grows DOWN from it — text top-left, hence the grab
    // offset and the L1.12 text-stays-still invariant, unchanged) and
    // report the section's FULL extent as the height. The general
    // viewport-fraction cap (POPOUT_MAX_VH) now lives at the SINGLE capture
    // site in `TextObjectGrabHandle`, where it caps the captured
    // sourceHeight for EVERY lifted kind — so the ghost AND the released
    // popout fit on screen and scroll internally. That subsumes the old
    // heading-only `min(extent, visiblePage)` clamp, which was both
    // heading-scoped and chrome/position-blind (it capped to ~full viewport
    // while the spawn adds 58px of chrome and positions at the grab point →
    // overflow). heading-body is already a full-section overflow-auto view
    // (untouched). Null for a lone heading → default getBoundingClientRect.
    // (`cache` is no longer needed here; the general cap handles fitting.)
    liftSourceRect: (anchorDom, editor, ref) => {
      // `anchorDom` is non-null for element kinds; the guard satisfies the
      // now-nullable shared signature (range kinds pass null) and is inert
      // for heading, which always resolves a heading-line element.
      if (!anchorDom) return null;
      const doms = sectionBlockDoms(editor, ref.id);
      if (doms.length <= 1) return null; // lone heading → default rect
      const headRect = anchorDom.getBoundingClientRect();
      const lastBottom = doms[doms.length - 1].getBoundingClientRect().bottom;
      const sectionExtent = lastBottom - headRect.top; // scroll-invariant
      return {
        left: headRect.left,
        top: headRect.top,
        width: headRect.width,
        height: sectionExtent,
      };
    },
    dropAdapter: topLevelDropAdapter,
    // Headings move as a section, not a single node — pick up every
    // block from the heading down to the next equal-or-higher heading.
    collectMoveSource: (doc, uuid): MoveSource | null => {
      const range = getSectionRangeByUuid(doc, uuid);
      if (!range) return null;
      return { from: range.start, to: range.end, nodes: range.nodes };
    },
    // Annotation actions stay on the heading line — never extend into
    // the section body. Critical for C9 + C11: without this, highlight
    // on a heading wraps every paragraph in the section AND writes the
    // `\vlidend{}` closer inside `\section{...}` braces, corrupting the
    // LaTeX and stripping every other linkedAnchor in the doc on
    // reload.
    collectAnnotationRange: (doc, uuid): MoveSource | null => {
      const range = getHeadingLineRangeByUuid(doc, uuid);
      if (!range) return null;
      return { from: range.from, to: range.to, nodes: [range.node] };
    },
    confirmDestructive: (doc, uuid, action) =>
      descriptorForHeading(doc, uuid, action),
  },
  bulletList: {
    label: "Bullet list",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: PROSE_ACTIONS,
    removeOnEmptyChildren: true,
    // L3b of the Lifted-Overlay refactor: bulletList drags through the
    // same two-mode gesture as paragraph/heading (ghost in pod, popout
    // in manila; release-in-pod moves the list, release-in-manila spawns
    // the popout at the overlay's chrome-inclusive rect).
    // Mirror the static label `list-body.tsx` pushes via
    // `setHeaderLabel("Bullet list")` on the bulletList branch, so the
    // overlay's popout-mode header matches the real popout at handoff.
    // Constant per kind (unlike heading's level-dependent label) — pins
    // the overlay header to list-body's string regardless of `meta.label`.
    // orderedList gets its own ("Ordered list") in L3c.
    computeLabel: () => "Bullet list",
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForContainer("list", "listItem", "item", doc, action, ctx),
  },
  orderedList: {
    label: "Ordered list",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: PROSE_ACTIONS,
    removeOnEmptyChildren: true,
    // L3c of the Lifted-Overlay refactor: orderedList drags through the
    // same two-mode gesture as bulletList — its twin (same list-body
    // float). Decimal counters render in the ghost via L3b.1's
    // `.tiptap ol { list-style-type: decimal }` scope; no re-wrap via
    // L3b.3's border compensation.
    // Mirror the static label `list-body.tsx` pushes via
    // `setHeaderLabel("Ordered list")` on the orderedList branch, so the
    // overlay's popout-mode header matches the real popout at handoff.
    computeLabel: () => "Ordered list",
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForContainer(
        "numbered list",
        "listItem",
        "item",
        doc,
        action,
        ctx,
      ),
  },
  blockquote: {
    label: "Block quote",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // L3g (bodyless kinds, Chip 1): blockquote lifts through the two-mode
    // gesture into a shared SingleBlockBody float (like paragraph/heading).
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("block quote", doc, action, ctx),
  },
  codeBlock: {
    label: "Code block",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    // MARKLESS, not NON_PROSE (task 146): codeBlock's node is `marks: ""`
    // (`content: "text*"`, inherited from @tiptap/extension-code-block), the
    // IDENTICAL property that put `latexComment` on MARKLESS_BLOCK_ACTIONS in
    // task 066. It is text-bearing, so a Highlight click would PROCEED past the
    // `!text` no-op guard to `createLinkedAnchor` → `setMark("linkedAnchor")`,
    // which a `marks: ""` node rejects → the chain returns false → a dead click
    // (row enabled, nothing happens). MARKLESS_BLOCK_ACTIONS drops `highlight`
    // so the menu greys it honestly. (The true atom blocks displayMath/texBlock/
    // graphicsBlock KEEP highlight — no text ⇒ it clean early-breaks.)
    actions: MARKLESS_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // L3g (bodyless kinds, Chip 1): codeBlock lifts through the two-mode
    // gesture into the same shared SingleBlockBody float.
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("code block", doc, action, ctx),
  },
  displayMath: {
    label: "Display math",
    isSubObject: false,
    selectsAsNode: true,
    isMeaningfulBlockAtom: true,
    isRange: false,    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ATOM_BLOCK_ACTIONS,
    // Feature A1: a lifted equation (displayMath) can land inside an expex
    // example — directly into an exampleItem (over an item) or wrapped in a
    // fresh exampleItem (between items). Everywhere else → drop-direct (its
    // normal top-level placement, unchanged). Shared with paragraph +
    // graphicsBlock; the schema widen (expex.ts) routes equations through the
    // `\a` item path on the LaTeX round-trip.
    dropAdapter: blockIntoExpexDropAdapter,
    // L3h (bodyless kinds, Chip 2): displayMath lifts through the two-mode
    // gesture into a READ-ONLY SingleBlockBody float ("view & move only" —
    // decision D; the equation is edited on the page via the KaTeX popover).
    // Atom blocks: always warn (can't preview a meaningful "empty"
    // state for math/figure/etc.). The hasAnchorsOrAtoms guard is
    // irrelevant — the block itself is what's at stake.
    confirmDestructive: (_doc, _uuid, action) =>
      descriptorForAtomBlock("math block", action),
  },
  titleField: {
    label: "Title field",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: TITLE_FIELD_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // L3j (bodyless kinds, Chip 4): titleField lifts through the two-mode
    // gesture into the shared SingleBlockBody float (editable, content-bearing
    // like blockquote — the LAST prose-shaped bodyless kind). Its node was
    // promoted into the float schema (editor-extensions.ts) since it was the
    // only bodyless kind that was main-only.
    // Delete/Archive are filtered out by TITLE_FIELD_ACTIONS, so the
    // confirmDestructive slot is never consulted in practice. Left unset.
  },
  latexComment: {
    label: "LaTeX comment",
    isSubObject: false,
    // SELECTION facet: latexComment is a CONTENT-bearing block (`content:
    // "text*"`, task-017 atom→block remodel), NOT a PM atom — so it resolves to
    // an inner TEXT range / caret (a duplicated comment lands caret-ready, not
    // fully node-selected). This is the one kind where the two facets DIVERGE.
    selectsAsNode: false,
    // GATING facet: a `% comment` is STILL a meaningful block atom — it stays a
    // nonsensical heading / block-convert target, and the empty-content archive
    // bail treats it as meaningful (an empty `% ` line stays archivable).
    isMeaningfulBlockAtom: true,
    isRange: false,    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    // marks:"" → Highlight (a linkedAnchor MARK) can't apply; use the
    // highlight-less list so the dead action greys out (task 066).
    actions: MARKLESS_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // L3i (bodyless kinds, Chip 3): latexComment lifts through the two-mode
    // gesture into an EDITABLE SingleBlockBody float (decision A, "fully
    // editable, first-class"; the `%comment` round-trips on edit).
    // Author noise, cheap to redo — never warn.
    confirmDestructive: () => null,
  },
  texBlock: {
    label: "TeX block",
    isSubObject: false,
    // Atom in the schema, but `selectable: false` — selection mechanics
    // route around it. Still classified as atom-block for grab-handle
    // positioning math.
    selectsAsNode: true,
    isMeaningfulBlockAtom: true,
    isRange: false,    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 280 },
    // L3e of the Lifted-Overlay refactor: texBlock drags through the same
    // two-mode gesture as the prose/list/example kinds — but it's the one
    // CodeMirror-backed kind, so the clone strategy was the open question
    // (decision §4 *assumed* CodeMirror won't clone usefully). It does:
    // CM6 renders each line as real DOM (`.cm-line` text nodes + highlight
    // spans) and its theme/base CSS is injected as GLOBAL `<style>` tags
    // (not `.ProseMirror`/`.tiptap`-scoped), so `cloneNode(true)` of the
    // pod carries both the code text AND the pod framing into the
    // `.tiptap` ghost — no `renderGhost` fallback needed. The sanitizer
    // strips `.cm-content`'s `contenteditable="true"` (L3d.3 keeps
    // `="false"`), making the ghost a faithful static snapshot. No
    // `computeLabel`: `tex-block-body.tsx` never calls `setHeaderLabel`,
    // so the overlay's popout-mode header reads the static `meta.label`
    // ("TeX block") — matching the real popout at handoff. Spawns at the
    // source pod size; like every textobject float it skips FloatCard's
    // auto-fit grow burst (FloatingCards gates that on a non-textobject key).
    actions: ATOM_BLOCK_ACTIONS,
    // texBlock uses `%!vtex:begin <uuid>` / `%!vtex:end <uuid>` comment
    // sentinels for round-trip, not a \v*id command — so it appears in
    // neither marker table: the command-form vocabulary is
    // `src/lib/latex-markers.ts`, and the sentinel pair is handled directly
    // by the parser/serializer for texBlock.
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) =>
      descriptorForAtomBlock("TeX block", action, {
        message: `${actionVerb(action).verb} this raw LaTeX block.`,
      }),
  },
  forestBlock: {
    label: "Tree",
    isSubObject: false,
    // Atom in the schema, but `selectable: false` — selection mechanics route
    // around it, exactly as they do for its source-pod twin `texBlock`. Still
    // classified as an atom block for grab-handle positioning math.
    selectsAsNode: true,
    isMeaningfulBlockAtom: true,
    isRange: false,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 280 },
    // A framed visual kind (tex pod / math / figure), so the non-prose block-
    // atom action bucket: there is no inline position inside a tree for a
    // footnote / citation / suggest-edit to land at, and the block-range gate
    // (`blockRangeAllowsAction`) reads that bucket off this row.
    actions: ATOM_BLOCK_ACTIONS,
    // `forestBlock` round-trips as the whole `\begin{forest}…\end{forest}`
    // environment in its `source` attr plus the shared `%!v:` anchor — no
    // `\v*id` command of its own, so it appears in no marker table
    // (src/lib/latex-markers.ts) just as `texBlock` does not.
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) =>
      descriptorForAtomBlock("tree", action, {
        message: `${actionVerb(action).verb} this forest tree.`,
      }),
  },
  figureBlock: {
    label: "Figure",
    isSubObject: false,
    // NOT an atom — `content: "figureCaption?"` (figure-block.ts).
    // Drag-handle uses TextSelection rather than NodeSelection here.
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    // L3n (the FINAL kind migration): figureBlock drags through the same
    // two-mode gesture as the other kinds; its FigureBody float renders the
    // shared FigureVisual with an EDITABLE caption + read-only image (decision
    // B). NO `renderGhost`: a figure's DOM cloneNodes faithfully — the `<img
    // src>` is a string attr, so the clone reuses the warm object-URL (Issue-7b,
    // no re-decode), and every figure CSS rule is class-scoped (`.figure-*`,
    // not `.ProseMirror .figure-*`) so it reaches the `.tiptap` ghost for free;
    // the L3e.2 React-NodeView margin reset (`.lifted-text-overlay__body >
    // .react-renderer > *`) already zeros `.node-figureBlock`'s retained top
    // margin. No `computeLabel`/`liftSourceRect` — static `label: "Figure"`.
    // NOTE (task 148): figureBlock is a prose-bodied CONTAINER like the lists
    // and examples, and it stays on the reduced set anyway — its only body is
    // `figureCaption`, which `NO_INLINE_LANDING_INSIDE` refuses (writing into
    // an empty caption flips `hasCaption` and renumbers every later figure —
    // task 319). So the schema premise the CI census checks is satisfied here
    // by the landing rule rather than by the content expression, and the two
    // stay in step because both read that one set.
    actions: ATOM_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) =>
      descriptorForAtomBlock("figure", action, {
        message: `${actionVerb(action).verb} this figure and its caption.`,
      }),
  },
  graphicsBlock: {
    label: "Graphic",
    isSubObject: false,
    selectsAsNode: true,
    isMeaningfulBlockAtom: true,
    isRange: false,    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    // L3n: graphicsBlock (an atom, no caption) shares FigureBody — its float is
    // a read-only image (≈ displayMath "view & move"). Same NO-`renderGhost`
    // reasoning as figureBlock (warm `<img src>` clone + class-scoped CSS +
    // L3e.2 `.node-graphicsBlock` margin reset). Static `label: "Graphic"`.
    actions: ATOM_BLOCK_ACTIONS,
    // Feature A0/A1: a lifted picture can land inside an expex example —
    // directly into an exampleItem's content (over an item) or wrapped in a
    // fresh exampleItem (between items). Everywhere else → drop-direct (today's
    // top-level placement, unchanged). figureBlock stays on topLevelDropAdapter.
    // Shares the unified blockIntoExpex adapter with paragraph + displayMath.
    dropAdapter: blockIntoExpexDropAdapter,
    confirmDestructive: (_doc, _uuid, action) =>
      descriptorForAtomBlock("graphic", action),
  },
  exampleBlock: {
    label: "Example",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    removeOnEmptyChildren: true,
    // L3d of the Lifted-Overlay refactor: exampleBlock drags through the
    // same two-mode gesture as paragraph/heading/lists — the first
    // grid-layout kind. The expex grid (`.expex-block` columns, the `(n)`
    // marker, sub-item rows, gloss tiers) renders faithfully in the ghost
    // clone because every expex layout rule in globals.css is UNSCOPED
    // (plain `.expex-*`, not `.ProseMirror .expex-*`), so it reaches the
    // `.tiptap`-but-not-`.ProseMirror` clone for free — no scope extension
    // needed (contrast L3b.1/L3b.2, where list/whitespace rules WERE
    // `.ProseMirror`-scoped). No `computeLabel`: `example-block-body.tsx`
    // never calls `setHeaderLabel`, so the overlay's popout-mode header
    // reads the static `meta.label` ("Example") — matching the real
    // popout at handoff. Spawns at authoritative source height; like every
    // textobject float it skips FloatCard's auto-fit grow burst (FloatingCards
    // gates that on a non-textobject key).
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForContainer(
        "example",
        "exampleItem",
        "item",
        doc,
        action,
        ctx,
      ),
  },

  // ----- Sub-objects -----

  listItem: {
    label: "List item",
    isSubObject: true,
    parentKind: "bulletList",
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    // L3k (bodyless kinds, Chip 5): listItem is the FIRST sub-object to lift,
    // through the two-mode gesture into a bespoke `list-item-body` float — the
    // item wrap-seeded in its parent list, inner-targeted write-back. No
    // `computeLabel` (the body never sets a header label, so the overlay's
    // popout-mode header reads the static `meta.label` "List item").
    // Marker-rescue ghost (modeled on the heading section ghost above). The
    // default overlay clone is a BARE `<li>` — its bullet/number renders via
    // the list-style of an enclosing `<ul>`/`<ol>` (the `::marker` sits in the
    // list's left padding), so a detached `<li>` loses the marker. Clone the
    // `<li>` into a `.tiptap > ul|ol > li` container (matching the source list
    // type) so the `.tiptap ul`/`.tiptap ol` rules supply the marker + padding,
    // and reset the container to the editor ROOT's typography (like the heading
    // ghost) so the cloned prose resolves its per-element rules. Walks the doc
    // once at threshold cross (cheap; not per transaction — keystroke-sanctity
    // safe) to detect the parent list kind. The float itself renders the marker
    // for free (its `buildWrap` wrapper list provides the same context).
    renderGhost: (anchorDom, editor, ref) => {
      if (!anchorDom) return null; // sub-objects always resolve a <li> element
      let listTag: "ul" | "ol" = "ul";
      editor.state.doc.descendants((node, _pos, parent) => {
        if (node.type.name === "listItem" && node.attrs?.uuid === ref.id) {
          if (parent?.type.name === "orderedList") listTag = "ol";
          return false;
        }
        return true;
      });
      const container = document.createElement("div");
      container.className = "tiptap";
      const base = window.getComputedStyle(editor.view.dom);
      Object.assign(container.style, {
        fontFamily: base.fontFamily,
        fontSize: base.fontSize,
        fontWeight: base.fontWeight,
        fontStyle: base.fontStyle,
        fontVariant: base.fontVariant,
        letterSpacing: base.letterSpacing,
        color: base.color,
        textAlign: base.textAlign,
        textIndent: base.textIndent,
        textTransform: base.textTransform,
        fontFeatureSettings: base.fontFeatureSettings,
      });
      const list = document.createElement(listTag);
      list.appendChild(anchorDom.cloneNode(true) as HTMLElement);
      container.appendChild(list);
      return container;
    },
    dropAdapter: listItemDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("item", doc, action, ctx, {
        includePreview: true,
      }),
  },
  exampleItem: {
    label: "Example item",
    isSubObject: true,
    parentKind: "exampleBlock",
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: false,
    // Chip-2 chrome geometry: the handle hugs this item's MEASURED
    // `.expex-item-marker` (`a./b.`) left edge — `block-frame.ts`
    // `markerLeft` — one uniform gap left of it, no per-kind constant.
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    // L3l (bodyless kinds, Chip 6): exampleItem is the LAST sub-object to lift,
    // through the two-mode gesture into a bespoke `example-item-body` float —
    // the mirror of listItem one wrap level deeper (the item wrap-seeded in the
    // full `exampleBlock > exampleItemList` envelope, inner-targeted write-back
    // unwrapping two levels). No `computeLabel` (the body never sets a header
    // label, so the overlay's popout-mode header reads the static `meta.label`
    // "Example item"). NO `renderGhost`: unlike listItem (whose bare `<li>`
    // loses its CSS `::marker`), exampleItem's marker is a real
    // `.expex-item-marker` DOM child kept by the default clone, its marker+body
    // grid is self-contained on `.expex-item-row` (`.expex-item-list` is
    // `display:contents`; the `.expex-block` grid only positions the `(N)`
    // number), every expex rule is unscoped, and the overlay already supplies
    // `.tiptap` scope + reads the em-base from `getComputedStyle(anchorDom)`
    // — the L3d.2 fix written FOR `.expex-item-marker`'s `0.95em`. So the
    // default clone lays out faithfully, exactly like exampleBlock (which also
    // carries no ghost). (Wrapping in `.expex-block` without an `.expex-number`
    // sibling would squash the item into the 1.5em number column.)
    dropAdapter: exampleItemDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("example item", doc, action, ctx, {
        includePreview: true,
      }),
  },

  // ----- Range -----

  linkedRange: {
    label: "Linked range",
    isSubObject: false,
    selectsAsNode: false,
    isMeaningfulBlockAtom: false,
    isRange: true,    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: LINKED_RANGE_ACTIONS,
    // L3f-2: a plain text SELECTION is a first-class lifted-overlay grab —
    // ghost that follows the cursor, margin-release pops the bidirectional
    // linked-range float, page-release moves the text to the caret. This is
    // the FIRST mark-over-a-RANGE consumer of the two lift-overlay hooks
    // (heading was the first multi-block ELEMENT consumer). A plain grab
    // hydrates a transient, invisible `linkedAnchor` over the range
    // (hydrate-selection.ts, L3f-1); these hooks drive the ghost + source
    // rect from that mark with NO anchor element — the grab gate passes
    // `anchorDom=null` and gates the no-anchorDom overlay path tightly on
    // `isRange`. Both resolve the live DOM Range via `linkedAnchorDomRange`
    // and return null when the mark can't be mapped (concurrent edit), so
    // the gate falls back to the legacy spawn rather than mount an empty
    // ghost. (Within-text move = the `text-range-move` drop spec; the
    // between-paragraphs drop is L3f-3, out of scope.)
    // Double duty: `linkedRange` backs BOTH the transient plain-selection grab
    // (a cardless `kind:"transient"` linkedAnchor, L3f-1) AND the real
    // annotation kinds (note/highlight/cut/revision, which carry a `linkCard`).
    // The float header + the lift-overlay's popout-mode header BOTH read this
    // ONE source so a popout's label reflects the mark's TRUE nature: a plain
    // selection grab → "Text selection"; a real annotation's range → null, so
    // the chrome keeps the static `meta.label` "Linked range" (the non-goal:
    // annotations are untouched). Walks the doc for the FIRST text carrying the
    // mark (cheap; once per gesture at threshold cross, once per float mount) —
    // mirrors heading's `computeLabel` shape; `linked-range-body.tsx` pushes
    // the same value to the released float via `setHeaderLabel`.
    computeLabel: (editor, ref) => {
      let found = false;
      let label: string | null = null;
      editor.state.doc.descendants((node) => {
        if (found) return false;
        if (!node.isText) return true;
        const mark = node.marks.find(
          (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === ref.id,
        );
        if (mark) {
          found = true;
          label = mark.attrs.kind === "transient" ? "Text selection" : null;
        }
        return true;
      });
      return label;
    },
    // The ghost = the marked range EXTRACTED via `Range.cloneContents`.
    // cloneContents over a SINGLE-block inline range yields bare text / inline
    // spans WITHOUT the enclosing <p>/<h*>, so `.tiptap p` / `.tiptap h*` can't
    // size it — copy the source block's resolved typography onto a `.tiptap`
    // container so the run renders at the doc's size / weight / family /
    // line-height. A MULTI-block range is different: cloneContents keeps the
    // source blocks' WRAPPERS (`.par-title-wrapper` / `.heading-wrapper` /
    // `.display-math` …), so — exactly like the heading ghost (whose clone also
    // holds whole blocks) — the container's font-size must be the editor ROOT
    // base, NOT the prose `<p>`'s `--editor-font-size`. See the `fontSize`
    // computation below for why (selection-bug D). The overlay sanitizes the
    // returned element in place (strips contenteditable / ids / state attrs).
    renderGhost: (anchorDom, editor, ref) => {
      const resolved = linkedAnchorDomRange(editor, ref.id);
      if (!resolved) return null;
      const frag = resolved.range.cloneContents();
      const container = document.createElement("div");
      container.className = "tiptap";
      const base = window.getComputedStyle(
        blockStyleElement(editor, resolved.doc.from),
      );
      // selection-bug D: a multi-block range's cloned wrappers resolve their
      // inter-block `margin-top: var(--editor-block-gap)` (1.2em) — and any
      // em-sized inner chrome, e.g. a `displayMath`'s KaTeX — against the
      // container's font-size. The page resolves those `em`s against the editor
      // ROOT (`editor.view.dom`, = 1rem/16px), NOT the prose `<p>`'s
      // `--editor-font-size` (the shipped default is 0.95rem/15.2px). Copying
      // the inline text element's PROSE size onto the container shrank every
      // gap + display-math glyph by the prose/root ratio (MEASURED at 0.95rem:
      // paragraph gap 18.24px vs the page's 19.2px; display-math KaTeX 18.392px
      // vs 19.36px), so the drag ghost rendered tighter than the released
      // popout — a real `.tiptap` at the root base (FCU, selection-bug A) — and
      // the whole passage visibly EXPANDED on release, multi-paragraph only.
      // Mirror L3d.2 (LiftedTextOverlay): the em cascade BASE must be the editor
      // root, not the inline element. The cloned `<p>`/`<h*>` still take their
      // own prose size from `.tiptap p`/`.tiptap h*` (those rules reach the
      // clone via the `.tiptap` scope), so this fixes the wrappers' em-base
      // WITHOUT touching prose size. A SINGLE-block range clones a bare inline
      // run with no wrapper to carry those rules, so it KEEPS the inline
      // element's size (a heading run must stay heading-sized) — byte-identical
      // to the pre-D path.
      const $from = editor.state.doc.resolve(resolved.doc.from);
      const $to = editor.state.doc.resolve(
        Math.max(resolved.doc.from, resolved.doc.to - 1),
      );
      const spansMultipleBlocks = $from.index(0) !== $to.index(0);
      const fontSize = spansMultipleBlocks
        ? window.getComputedStyle(editor.view.dom).fontSize
        : base.fontSize;
      Object.assign(container.style, {
        fontFamily: base.fontFamily,
        fontSize,
        fontWeight: base.fontWeight,
        fontStyle: base.fontStyle,
        fontVariant: base.fontVariant,
        letterSpacing: base.letterSpacing,
        lineHeight: base.lineHeight,
        color: base.color,
        textAlign: base.textAlign,
        textIndent: base.textIndent,
        textTransform: base.textTransform,
        fontFeatureSettings: base.fontFeatureSettings,
      });
      container.appendChild(frag);
      return container;
    },
    // The source rect = the UNION of the marked range's client rects (one
    // rect per wrapped line), anchored at the FIRST rect's top-left (the
    // selection START, so the grab offset + the L1.12 text-stays-still
    // invariant hold). No per-hook height clamp: the general POPOUT_MAX_VH
    // cap at the single capture site in `TextObjectGrabHandle` fits a tall
    // multi-line range on screen (the float scrolls the overflow), the same
    // way it handles a tall section (Issue-13). Null when unresolved → the
    // gate falls back to the legacy spawn.
    liftSourceRect: (anchorDom, editor, ref) => {
      const resolved = linkedAnchorDomRange(editor, ref.id);
      if (!resolved) return null;
      const rects = resolved.range.getClientRects();
      if (!rects || rects.length === 0) return null;
      // Anchor the ghost at the FIRST rect's top-left (the selection START)
      // but size it to the UNION's full horizontal/vertical extent. The width
      // must be the union span (`unionRight − unionLeft`), NOT measured from
      // the start rect's left: a multi-line selection that begins mid-line has
      // a short first rect, and `unionRight − first.left` would under-size the
      // ghost so the extracted text re-wraps far narrower than the column.
      const first = rects[0];
      let unionLeft = Infinity;
      let unionRight = -Infinity;
      let unionBottom = -Infinity;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        unionLeft = Math.min(unionLeft, r.left);
        unionRight = Math.max(unionRight, r.right);
        unionBottom = Math.max(unionBottom, r.bottom);
      }
      return {
        left: first.left,
        top: first.top,
        width: Math.max(0, unionRight - unionLeft),
        height: Math.max(0, unionBottom - first.top),
      };
    },
    dropAdapter: topLevelDropAdapter,
    // Always warn — deleting a linkedRange also removes the underlying
    // text and any cards anchored on it (cross-abstraction destructive).
    confirmDestructive: (_doc, _uuid, action) => {
      const { verb, label } = actionVerb(action);
      return {
        title: `${verb} the lifted passage?`,
        message:
          action === "delete"
            ? "Delete the lifted passage. The underlying text and any cards anchored on it will also be removed."
            : "Archive the lifted passage. The underlying text and any cards anchored on it will move to the archive together.",
        confirmLabel: `${label} passage`,
        tone: action === "delete" ? "danger" : "default",
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The live DOM `Range` over a `linkedAnchor`'s marked text (L3f-2). Both the
 * `linkedRange` `renderGhost` (cloneContents) and `liftSourceRect`
 * (getClientRects) resolve it the same way: doc range (`findLinkedAnchorRange`)
 * → `view.domAtPos` endpoints → a DOM `Range`. Returns the doc range too so
 * the caller can read the source block's typography. Null when the mark is
 * unresolved or the DOM positions can't be mapped (concurrent edit) — callers
 * return null and the lift gate falls back to the legacy spawn.
 */
function linkedAnchorDomRange(
  editor: Editor,
  anchorId: string,
): { range: Range; doc: { from: number; to: number } } | null {
  const doc = findLinkedAnchorRange(editor.state.doc, anchorId);
  if (!doc) return null;
  try {
    const view = editor.view;
    const start = view.domAtPos(doc.from);
    const end = view.domAtPos(doc.to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return { range, doc };
  } catch {
    return null;
  }
}

/**
 * The element whose computed typography a `linkedRange` ghost inherits — the
 * block containing the selection start, descended to its inline-context
 * element (mirrors the overlay's L1.12 capture). cloneContents drops the
 * block wrapper, so the extracted run needs this style applied to its
 * container to render at the source's size/weight. Falls back to the editor
 * root if the position can't be resolved.
 */
function blockStyleElement(editor: Editor, pos: number): HTMLElement {
  try {
    const $pos = editor.state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 1; d--) {
      const dom = editor.view.nodeDOM($pos.before(d));
      if (dom instanceof HTMLElement) {
        return (resolveInlineContextElement(dom) as HTMLElement | null) ?? dom;
      }
    }
  } catch {
    /* fall through to the editor root */
  }
  return editor.view.dom as HTMLElement;
}

const KIND_SET = new Set<TextObjectKind>(
  Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[],
);

export function isTextObjectKind(name: string): name is TextObjectKind {
  return KIND_SET.has(name as TextObjectKind);
}

/**
 * If the node is a TextObject (its name matches a persistent-node kind),
 * return a `TextObjectRef`. Returns null for nodes that aren't in the
 * `textObject` schema group (or that lack a uuid attr).
 *
 * Range kind (`linkedRange`) is NOT resolved here — it's mark-backed.
 * Use `textObjectForLinkedAnchor` (Phase E) for that.
 */
export function textObjectForNode(node: PMNode): TextObjectRef | null {
  const name = node.type.name;
  if (!isTextObjectKind(name) || name === "linkedRange") return null;
  const id = node.attrs.uuid as string | null | undefined;
  if (!id) return null;
  return { kind: name, id };
}

/**
 * Does a block KIND's curated action set permit `action`?
 *
 * The cross-surface applicability SSOT for the GESTURE surfaces. The grab-bar
 * gates a card action via a kind-bearing `TextObjectRef` → its curated set
 * (`TEXT_OBJECT_REGISTRY[kind].actions`). The other three surfaces (slash,
 * typed `\cite{}`/`\footnote{}`, and the lightning cursor/selection probe)
 * carry a bare caret with NO kind, so they resolve the caret's CONTAINING
 * block kind and consult the SAME set here — making all four agree, so an
 * inline-atom insert (citation / footnote / suggest-edit) can never land in a
 * `titleField` / non-prose block the curated set greys out.
 *
 * A block whose PM node name IS a `TextObjectKind` twin
 * (`isTextObjectKind(node.type.name)`) resolves straight to its curated set. A
 * block with no twin (e.g. `maketitleMarker`, list/quote containers with no
 * caret of their own) has no curated policy → allow (defensive), matching the
 * historic gesture-ref default (`kindAllowsCardAction`'s cursor/selection
 * short-circuit).
 */
export function blockKindAllowsAction(
  blockNodeName: string,
  action: DragHandleAction,
): boolean {
  if (!isTextObjectKind(blockNodeName)) return true;
  return (
    TEXT_OBJECT_REGISTRY[blockNodeName].actions as ReadonlyArray<DragHandleAction>
  ).includes(action);
}

/**
 * Block subtrees an inline insert resolved from a CONTAINER must never descend
 * into. Every rule below (the gate's reachable-textblock set, the schema
 * predicate, and the landing resolver) reads this ONE set, so "where may it
 * land" and "may it land at all" can never answer differently.
 *
 * These are not schema facts — the schema hosts an atom in both of them
 * happily, which is exactly why they have to be named:
 *
 *   • `exampleGloss` — a `glossCell` is a COLUMN of an interlinear gloss, and
 *     `\gla`/`\glb`/`\glc` are measured against each other by column. An atom
 *     dropped into the last cell of the last tier changes what that column is
 *     without changing any other tier — the same silent alignment destruction
 *     `dropEmptiedSourceBlock` refuses (see AGENTS.md, "The identity half").
 *     `proseGlossRow` (the `\glft` free translation) is skipped with it: it is
 *     the gloss's own apparatus, not the example's sentence.
 *   • `figureCaption` — writing into an EMPTY caption flips the `hasCaption`
 *     provenance attr, and both figure numberers gate on that predicate
 *     (task 319), so a footnote aimed at a figure would silently renumber every
 *     later figure and every `\ref` to them. A non-empty caption is safe on
 *     that axis, but the schema-level predicate has no instance to ask — and
 *     the conservative answer is also the one the task's own scope wants:
 *     `figureBlock` is not in `DEFERRING_PARENTS` and was not part of the
 *     reported class. Stated residual: the lightning / slash surfaces still
 *     permit a footnote at a caret ALREADY INSIDE a caption (the caret seeds
 *     its own textblock, below) — the one divergence in this class 148 leaves
 *     standing, deliberately, because closing it means TIGHTENING a surface the
 *     resolved decision said to leave permissive.
 */
const NO_INLINE_LANDING_INSIDE: ReadonlySet<string> = new Set([
  "exampleGloss",
  "figureCaption",
]);

/**
 * Every textblock TYPE NAME an inline insert over `[from, to]` can reach, in
 * document order, deduplicated. Empty when the range holds no textblock at all
 * (a true block atom's node range, an empty container).
 *
 * The two seeds matter: a caret — and any range whose ends sit inside ONE
 * textblock — has nothing strictly BETWEEN its positions, so `nodesBetween`
 * alone reports nothing for the commonest case there is. A CONTAINER-level
 * position (both ends of a block ref's content range resolve to the container
 * itself, not to a textblock) contributes no seed and is answered entirely by
 * the walk over its body.
 *
 * The WALK honours `NO_INLINE_LANDING_INSIDE`; the SEEDS deliberately do not.
 * A caret the user placed inside a gloss cell or a figure caption is answered
 * by that textblock's own kind — the pre-148 behaviour, which the resolved
 * decision says to leave permissive — while a container-level range never
 * proposes one as a landing site.
 */
function inlineInsertTargets(doc: PMNode, from: number, to: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (node: PMNode) => {
    if (!node.isTextblock || seen.has(node.type.name)) return;
    seen.add(node.type.name);
    names.push(node.type.name);
  };
  push(doc.resolve(from).parent);
  push(doc.resolve(to).parent);
  if (to > from) {
    doc.nodesBetween(from, to, (node) => {
      if (NO_INLINE_LANDING_INSIDE.has(node.type.name)) return false;
      push(node);
      return true;
    });
  }
  return names;
}

/**
 * The cross-surface applicability SSOT, asked at the place the action ACTS.
 *
 * Every surface funnels here: the grab bar with a block ref's resolved range,
 * the slash / typed / lightning surfaces with a caret (`from === to`), the
 * selection menu with its live span, and the dispatcher's defence-in-depth
 * re-check with the very range it is about to splice into.
 *
 * Two rules, because the vocabulary holds two kinds of action:
 *
 *   • Everything that acts ON the block (note / todo / report / cutter /
 *     duplicate / archive / delete / highlight) is a property of the block the
 *     ref names, so it is answered from the range START's curated set —
 *     byte-identical to the pre-148 `posBlockAllowsAction`.
 *   • The `INLINE_INSERT_ACTIONS` family acts at an inline POSITION, so it is
 *     answered by the TEXTBLOCKS the range can reach, EVERY one of which must
 *     permit it — and a range that reaches none refuses. This is what closes
 *     task 148: a container's own node hosts no inline content, so asking its
 *     kind gave the grab bar a different answer from the one the lightning bolt
 *     got at a caret in the very same example, and the answer the dispatch then
 *     acted on was neither. Requiring EVERY reachable textblock (rather than
 *     just the first) is the fail-closed direction, and it retires two silent
 *     doors of its own: a selection running from prose into a `titleField` can
 *     no longer land the `\title{\cite{}}` task 061 exists to prevent, and a
 *     quote / list item whose body is a `codeBlock` can no longer take a
 *     footnote atom into a `text*` node that ProseMirror would split to fit it.
 *
 * `from`/`to` are clamped and ordered, so a stale or borderline ref can't throw.
 */
export function blockRangeAllowsAction(
  doc: PMNode,
  from: number,
  to: number,
  action: DragHandleAction,
): boolean {
  const size = doc.content.size;
  const lo = Math.max(0, Math.min(Math.min(from, to), size));
  const hi = Math.max(0, Math.min(Math.max(from, to), size));
  if (!INLINE_INSERT_ACTIONS.has(action)) {
    return blockKindAllowsAction(doc.resolve(lo).parent.type.name, action);
  }
  const targets = inlineInsertTargets(doc, lo, hi);
  if (targets.length === 0) return false;
  return targets.every((name) => blockKindAllowsAction(name, action));
}

/**
 * The position an inline insert aimed at `pos` ACTUALLY acts on — the sibling
 * of {@link blockRangeAllowsAction} on the dispatch side, so the gate and the
 * splice are answering about the same place.
 *
 * A block ref resolves to its node's CONTENT range, and the two inline-atom
 * branches collapse to that range's END to put the marker "at the end of the
 * passage". For a textblock kind that end IS a text position; for a CONTAINER
 * it is a position between block children, and nothing downstream repairs it:
 * TipTap's `setTextSelection` clamps to doc bounds only, ProseMirror's
 * `TextSelection` constructor merely `console.warn`s (once per page load), and
 * `insertContent` then asks the FITTER to make room — which does not split the
 * container but FABRICATES a trailing block to hold the atom. A grab-bar
 * footnote on a block quote appends a phantom empty paragraph inside the quote
 * containing only the marker; on a list, a phantom extra bullet; on a figure,
 * whose `figureCaption?` slot is already full, the marker ESCAPES into a new
 * top-level paragraph after the figure. Schema-valid every time, and anchored
 * to no word — which is why nothing ever failed.
 *
 * The answer is the end of the last text the container holds BEFORE this
 * position — what the branch's own comment says it wants. The search is
 * deliberately BACKWARD (forward escapes into the next sibling block) and it
 * honours `NO_INLINE_LANDING_INSIDE`, which is why it is a hand walk rather
 * than ProseMirror's `Selection.near`: `near(-1)` descends into whatever sits
 * last, and for the two shapes named in that set — an example ending in a
 * gloss, a figure whose only child is its caption — "whatever sits last" is
 * precisely where the atom must not go. A container with no safe landing
 * returns the position unchanged, inventing no new refusal here; refusing is
 * the gate's job, and the gate reads the same set.
 *
 * task 148 — the mis-landing predates it and already shipped on `blockquote` /
 * `listItem` / `exampleItem` (PROSE_ACTIONS containers all), so it is fixed for
 * them too rather than only for the kinds this task un-gates.
 */
export function inlineInsertPos(doc: PMNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if ($pos.parent.isTextblock) return clamped;
  const landed = lastLandableTextEnd(
    $pos.parent,
    $pos.start(),
    $pos.index($pos.depth),
  );
  return landed !== null && doc.resolve(landed).parent.isTextblock
    ? landed
    : clamped;
}

/**
 * The end of the last text inside `node`'s first `limit` children, skipping the
 * subtrees `NO_INLINE_LANDING_INSIDE` names. `base` is the document position of
 * `node`'s first child. Returns null when nothing landable is in range.
 */
function lastLandableTextEnd(
  node: PMNode,
  base: number,
  limit: number,
): number | null {
  let offset = 0;
  for (let i = 0; i < limit; i++) offset += node.child(i).nodeSize;
  for (let i = limit - 1; i >= 0; i--) {
    const child = node.child(i);
    offset -= child.nodeSize;
    if (NO_INLINE_LANDING_INSIDE.has(child.type.name)) continue;
    const childPos = base + offset;
    if (child.isTextblock) return childPos + 1 + child.content.size;
    if (child.isAtom || child.childCount === 0) continue;
    const inner = lastLandableTextEnd(child, childPos + 1, child.childCount);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * The caret form of {@link blockRangeAllowsAction} — a zero-width range. Used
 * by the slash / typed / lightning surfaces, whose ref is a bare caret.
 */
export function posBlockAllowsAction(
  doc: PMNode,
  pos: number,
  action: DragHandleAction,
): boolean {
  return blockRangeAllowsAction(doc, pos, pos, action);
}

/**
 * Can an inline insert of `action` land ANYWHERE in a node of type `root` —
 * read from the SCHEMA, by walking every node type the content expressions can
 * reach from `root` and asking each textblock whether it admits the payload?
 *
 * This is the premise the curated `actions` sets state per kind and cannot
 * check for themselves (the registry is editor-coupled and has no schema — see
 * the header). CI asks it of every kind: a set may drop one of the three only
 * where this returns false, or where the kind + action pair is a stated POLICY
 * exclusion. Hand-bucketing four prose-bodied containers as "structural
 * containers with no place to embed inline insertions" is precisely how task
 * 148 shipped, and this is the check that would have caught it.
 *
 * Payload per action, all schema-read: `footnote`/`citation` need a textblock
 * whose content expression admits that inline NODE (so `inline*` yes, the
 * verbatim `text*` no); `suggest-edit` needs one that admits the `linkedAnchor`
 * MARK (so a `marks: ""` node no).
 */
export function typeHostsInlineInsert(
  root: NodeType,
  action: DragHandleAction,
): boolean {
  if (!INLINE_INSERT_ACTIONS.has(action)) return true;
  const schema = root.schema;
  const atom = action === "suggest-edit" ? null : schema.nodes[action];
  const mark = action === "suggest-edit" ? schema.marks.linkedAnchor : null;
  if (action === "suggest-edit" ? !mark : !atom) return false;
  const seenTypes = new Set<string>();
  const stack: NodeType[] = [root];
  while (stack.length > 0) {
    const type = stack.pop()!;
    if (seenTypes.has(type.name)) continue;
    seenTypes.add(type.name);
    // The landing resolver will not descend here, so neither may the premise —
    // otherwise a kind whose ONLY inline-hosting descendant is off limits (a
    // `figureBlock`, whose sole child is its caption) would read as hostable
    // while every real insert refused.
    if (type !== root && NO_INLINE_LANDING_INSIDE.has(type.name)) continue;
    if (type.isTextblock) {
      const admits = atom
        ? type.contentMatch.matchType(atom) != null
        : type.inlineContent && !!mark && type.allowsMarkType(mark);
      if (admits) return true;
    }
    // Every node type this type's content expression can reach, via the
    // ContentMatch automaton's edges (the schema-level answer — no live node
    // needed, so an empty container answers the same as a populated one).
    const seenMatches = new Set<unknown>();
    const matches = [type.contentMatch];
    while (matches.length > 0) {
      const match = matches.pop()!;
      if (seenMatches.has(match)) continue;
      seenMatches.add(match);
      for (let i = 0; i < match.edgeCount; i++) {
        const edge = match.edge(i);
        stack.push(edge.type);
        matches.push(edge.next);
      }
    }
  }
  return false;
}

/**
 * Can the textblock of type `parentType` host a block-atom CHILD (example /
 * display-math / `\tex` / figure / graphics) inserted at a caret WITHOUT
 * corrupting the document? (task 147.)
 *
 * A block-atom insert at a mid-content caret can't fit into an inline-only
 * container, so ProseMirror's fitter SPLITS the container to place the atom.
 * For ordinary prose (paragraph, list item, blockquote's inner paragraph) that
 * split is harmless — two paragraphs around the atom — so those return `true`.
 * Two block families corrupt on the split and must grey the insert:
 *
 *   • MARKLESS verbatim blocks (`codeBlock`, `latexComment`) — `marks: ""`
 *     nodes whose text is literal source; a split mangles them into two blocks
 *     that BOTH serialize → structural corruption (the CONT cluster, task 146).
 *   • `titleField` — a uuid-keyed preamble SINGLETON. A split mints two
 *     `\title{}` sharing one uuid; the serializer's first-occurrence-wins dedup
 *     (`collectPreambleTitleFields`) then drops the second silently →
 *     data-loss on reload.
 *
 * Markless-ness is read from the schema (`spec.marks === ""`) so a future
 * verbatim kind is covered without editing this predicate; the titleField
 * preamble singleton is named explicitly (no schema flag distinguishes it).
 * INLINE-atom inserts (inline-math `$x$`, `\ref`) do NOT consult this gate —
 * they have their own container SSOT below (`posHostsInlineAtom`): an
 * inline atom is valid in a `titleField` but STILL corrupts the `text*`
 * verbatim blocks (codeBlock / latexComment), which admit literal text only.
 *
 * This TEXTBLOCK-only predicate catches the two families whose corruption is a
 * property of the SPLIT TEXTBLOCK ITSELF (titleField dups; markless mangles).
 * It canNOT catch a container whose editable textblock is FINE to split but
 * whose PARENT can't re-host the atom — the `figureCaption`-in-`figureBlock`
 * case (task 229). That schema-precise container question lives in
 * `posHostsBlockInsert` below, which resolves the full position.
 */
export function blockTypeHostsBlockInsert(parentType: NodeType): boolean {
  if (parentType.spec.marks === "") return false; // codeBlock / latexComment
  if (parentType.name === "titleField") return false; // preamble singleton
  return true;
}

/**
 * Resolve the textblock containing `pos` and test whether a block-atom insert
 * there is SAFE — the position-based entry point for the lightning / slash /
 * input-rule surfaces whose ref is a bare caret. `pos` is clamped into the doc
 * so a stale caret can't throw.
 *
 * Two layers, both schema-precise:
 *   1. The caret's own TEXTBLOCK must survive the split — `blockTypeHostsBlockInsert`
 *      (titleField singleton / markless verbatim).
 *   2. When the inserted block's `insertType` is known, the caret's CONTAINER
 *      must be able to host that block as a sibling of the textblock. A
 *      `figureCaption` is a fine editable textblock, but its parent `figureBlock`
 *      (`content: "figureCaption?"`, non-isolating) can host no block child — so
 *      the atom's insert splits `figureBlock` into two dup-uuid copies and the
 *      figure/caption is silently lost on reload (task 229, the unpatched member
 *      of the 147 split-corruption class). `doc` / `listItem` / `blockquote`
 *      DO host block children, so ordinary prose splits stay allowed.
 *
 * Layer 2 mirrors the heading-CONVERT twin's schema-precise parent check
 * (`action-registry.ts` `selectionCanHostHeading` — `canReplaceWith`), unifying
 * the two destructive-container surfaces onto ONE question: "can the schema
 * actually host this block here?". It is name-agnostic — any future single-slot
 * container is covered without enumerating it. It is applied only as an
 * ADDITIONAL reject (never relaxes layer 1), and the adjacent-gap `||` form
 * below never over-gates a content model that merely pins a leading paragraph
 * (e.g. `listItem` — inserting AFTER the first paragraph is valid though before
 * it is not). Callers that don't know the type (heading-convert's
 * belt-and-suspenders) omit `insertType` and get layer 1 alone.
 */
export function posHostsBlockInsert(
  doc: PMNode,
  pos: number,
  insertType?: NodeType,
): boolean {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if (!blockTypeHostsBlockInsert($pos.parent.type)) return false;
  if (insertType && $pos.depth > 0) {
    const container = $pos.node($pos.depth - 1);
    const idx = $pos.index($pos.depth - 1);
    // Can the block sit BESIDE this textblock in its container? Allow if EITHER
    // adjacent gap accepts it — a pure ProseMirror `canReplaceWith` insert
    // (from === to). Both gaps false ⇒ the atom can't land in the container ⇒
    // PM would split the container itself (the dup-uuid corruption). Erring
    // toward "allow" here is deliberate: layer 2 must never REGRESS a
    // legitimate split, only reject the genuinely unhostable ones.
    const hostable =
      container.canReplaceWith(idx, idx, insertType) ||
      container.canReplaceWith(idx + 1, idx + 1, insertType);
    if (!hostable) return false;
  }
  return true;
}

/**
 * Can the textblock of type `parentType` host an INLINE-atom child of type
 * `atomType` (inline-math `$x$`, and any future typed inline atom like `\ref`)
 * inserted at a caret WITHOUT corrupting the container? (task 150 — the inline
 * sibling of `blockTypeHostsBlockInsert`.)
 *
 * An inline atom never SPLITS an inline-hosting textblock — it lands between the
 * surrounding characters. But the MARKLESS verbatim blocks (`codeBlock`,
 * `latexComment`) declare `content: "text*"`: they admit literal text only, no
 * inline nodes. ProseMirror's fitter, unable to place the atom in `text*`, wraps
 * it in a fresh paragraph and SPLITS the verbatim block around it → the same
 * structural corruption the block gate prevents. A `titleField`
 * (`content: "inline*"`) legitimately hosts inline math and must stay allowed —
 * which is why this canNOT reuse the block gate (that greys the title too).
 *
 * The distinction is read straight from the schema: the parent's content
 * expression admits the atom iff `contentMatch.matchType(atomType)` succeeds
 * (true for `inline*`, false for `text*`). Reading the schema — not a hardcoded
 * kind list — covers any future verbatim OR inline-hosting container for free.
 *
 * PRIVATE (task 396): the type-only form answers a NARROWER question than any
 * caller wants — it cannot clamp a stale caret, and every real consumer holds a
 * position, not a parent type. Exported it was a dead SSOT (`AGENTS.md` → "A
 * registry earns its name by being read": a sibling call is not a consumer), and
 * an exported narrow twin is exactly how a call site comes to ask the smaller
 * question. `posHostsInlineAtom` below is the ONE door.
 */
function blockTypeHostsInlineAtom(
  parentType: NodeType,
  atomType: NodeType,
): boolean {
  return parentType.contentMatch.matchType(atomType) != null;
}

/**
 * **THE inline-atom container SSOT.** Resolve the node containing `pos` and
 * answer: can an inline atom of type `atomType` land here WITHOUT corrupting
 * the container? `pos` is clamped into the doc so a stale caret can't throw.
 *
 * Consumers (task 396 — before it, this had exactly ONE, which is how three
 * later surfaces inherited the retired premise that "an inline atom never
 * splits"; see `AGENTS.md` → "A registry earns its name by being read"):
 *   1. the typed `$…$` input rules (`lib/tiptap/math.ts`, task 150);
 *   2. `inlineAtomInsertApplies` — the AFFORDANCE, greying the lightning grid's
 *      `$x$` and `Cross-ref` cells (`lib/actions/action-registry.ts`);
 *   3. `insertInlineAtom` — the ONE insert DOOR, which is the only layer the
 *      deferred create-popover commit passes through (it lands at a captured
 *      `at` that no menu gate can see).
 *
 * SCOPED TO TEXTBLOCK PARENTS, and the scope is the whole precision of the
 * predicate. The corruption is a property of a TEXTBLOCK that admits text and
 * not inline nodes — ProseMirror truncates it and ejects its tail. At a
 * NON-textblock position (a top-level gap beside a block atom, a GapCursor, a
 * `posAtCoords` that landed between blocks) there is nothing to tear: measured
 * against the real stack, `tr.insert(gapPos, citation)` on
 * `[p, displayMath, p]` yields `[p, displayMath, p(citation), p]` — a fresh
 * paragraph holding the atom, nothing destroyed. Answering FALSE there would
 * refuse a benign insert (a bib-entry drop beside a figure; a footnote at a
 * GapCursor), which is a silent no-op the user cannot explain.
 *
 * Out of scope, stated because it is adjacent and NOT what this answers: a
 * `NodeSelection` handed to `insertContent` REPLACES the selected block rather
 * than wrapping beside it, which destroys that block's text. That is a
 * different API and a different question (a RANGE hazard, pre-dating this
 * predicate); it is not made better or worse here.
 */
export function posHostsInlineAtom(
  doc: PMNode,
  pos: number,
  atomType: NodeType,
): boolean {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const parent = doc.resolve(clamped).parent;
  if (!parent.isTextblock) return true; // a gap — PM wraps, nothing to corrupt
  return blockTypeHostsInlineAtom(parent.type, atomType);
}

/**
 * **THE list/quote WRAPPER container SSOT** (task 397) — the THIRD member of the
 * container family, beside `posHostsBlockInsert` (a block atom lands BESIDE the
 * caret's textblock) and `posHostsInlineAtom` (an inline atom lands INSIDE it).
 * Since task 427 it LIVES in the import-free leaf `@/lib/tiptap/wrapper-gate`
 * (beside the identity half and the whole-question door `wrapperSafeInState`),
 * because the three `.extend()`ed StarterKit factories and the card-body
 * toolbar — surfaces that fire the wrapper toggles without entering the action
 * registry — cannot import this editor-coupled module. Re-exported here so the
 * container family keeps one home for its readers.
 */
export { selectionHostsWrapper } from "@/lib/tiptap/wrapper-gate";

/**
 * Construct the canonical float key for a TextObject — the
 * `float:textobject:<kind>:<id>` grammar emitted by `buildFloatKey`
 * (the text-object sibling of `float:card:<kind>:<id>`). Centralized
 * here so that callers never assemble the string by hand.
 */
export function textObjectPopoutKey(ref: TextObjectRef): string {
  return buildFloatKey({ domain: "textobject", kind: ref.kind, id: ref.id });
}

/**
 * Parse a text-object popout key back into a TextObjectRef. **Dual-read** (the
 * phased AF flip): handles BOTH the new `float:textobject:<kind>:<id>` grammar
 * AND the legacy `textobject:<kind>:<id>` shape (pre-flip persisted keys + drags
 * still in flight). Returns null for any non-textobject / unknown-kind key.
 */
export function parseTextObjectPopoutKey(key: string): TextObjectRef | null {
  const parsed = parseAnyKey(key);
  if (!parsed || parsed.domain !== "textobject") return null;
  if (!isTextObjectKind(parsed.kind) || !parsed.id) return null;
  return { kind: parsed.kind, id: parsed.id };
}

/**
 * Register a kind's float body component. Called from the kind's body
 * module (or from Editor setup) so the body can be co-located with the
 * kind's other concerns without forcing the registry to import every
 * React component. Phase D5 wires this up.
 */
export function registerFloatBody(kind: TextObjectKind, component: unknown): void {
  TEXT_OBJECT_REGISTRY[kind].floatBodyComponent = component;
}
