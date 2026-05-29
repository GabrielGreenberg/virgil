/**
 * TEXT_OBJECT_REGISTRY — single source of truth for every TextObject kind.
 *
 * Adding a new kind = one entry here + one schema-group annotation (or
 * mark spec, for range kinds). The rest of the system reads off this
 * registry: grab-handle layout, popout dispatch, drop adapters, drag-
 * menu actions, source-marker round-trip, marginalia placement.
 *
 * SSOT siblings: `src/panels/panel-registry.ts`, `src/links/link-registry.ts`.
 *
 * See TEXT-OBJECT-REFACTOR.md §3.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { headingTypeName } from "@/lib/heading-types";
import {
  getSectionRangeByUuid,
  getHeadingLineRangeByUuid,
} from "@/lib/section-range";
import {
  topLevelDropAdapter,
  listItemDropAdapter,
  exampleItemDropAdapter,
} from "./drop-adapters";
import {
  BULLET_DECORATION_WIDTH,
  EXAMPLE_ITEM_HANDLE_INDENT,
} from "./handle-layout";
import type {
  ConfirmDescriptor,
  ConfirmDestructiveContext,
  DragHandleAction,
  MoveSource,
  TextObjectKind,
  TextObjectMeta,
  TextObjectRef,
} from "./types";

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
//   • PROSE_ACTIONS — full vocabulary; for text-bearing kinds.
//   • NON_PROSE_BLOCK_ACTIONS — drops F/C/E (no place to embed inline
//     insertions in non-prose blocks / structural containers).
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
  "quotation",
  "todo",
  "suggest-edit",
  "cutter",
  "duplicate",
  "archive",
  "delete",
];

const NON_PROSE_BLOCK_ACTIONS: ReadonlyArray<DragHandleAction> =
  PROSE_ACTIONS.filter(
    (a) => a !== "footnote" && a !== "citation" && a !== "suggest-edit",
  );

const TITLE_FIELD_ACTIONS: ReadonlyArray<DragHandleAction> = [
  "highlight",
  "note",
  "footnote",
  "quotation",
  "todo",
  "suggest-edit",
  "cutter",
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
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    // %!v: anchor; not a LaTeX command per se. Marker is the suffix
    // on the paragraph's last line.
    dropAdapter: topLevelDropAdapter,
    // L1 of the Lifted-Overlay refactor: paragraph drags through the
    // new two-mode gesture (ghost in editor, popout in gutter); every
    // other kind keeps the legacy instant-popout path until L3.
    liftMode: "lifted-overlay",
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("paragraph", doc, action, ctx, {
        includePreview: true,
      }),
  },
  heading: {
    label: "Heading",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: PROSE_ACTIONS,
    // L3a of the Lifted-Overlay refactor: heading drags through the
    // same two-mode gesture as paragraph (ghost in pod, popout in
    // manila). The per-level label (Chapter/Section/Subsection/…) is
    // computed below via `computeLabel` so the overlay's popout-mode
    // header matches the real popout's `setHeaderLabel` at handoff.
    liftMode: "lifted-overlay",
    // Mirror the dynamic label that `heading-body.tsx` pushes via
    // `setHeaderLabel(headingTypeName(level))` — so the overlay's
    // popout-mode header reads the same string the real popout will
    // show on release, with no visible discrepancy at handoff. Walks
    // the doc to find the heading node by uuid (cheap; called once
    // per gesture at threshold cross). Returns null if the source
    // disappeared concurrently — caller falls back to the static
    // `meta.label`.
    computeLabel: (editor, ref) => {
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
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: NON_PROSE_BLOCK_ACTIONS,
    removeOnEmptyChildren: true,
    // L3b of the Lifted-Overlay refactor: bulletList drags through the
    // same two-mode gesture as paragraph/heading (ghost in pod, popout
    // in manila; release-in-pod moves the list, release-in-manila spawns
    // the popout at the overlay's chrome-inclusive rect).
    liftMode: "lifted-overlay",
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
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 360 },
    actions: NON_PROSE_BLOCK_ACTIONS,
    removeOnEmptyChildren: true,
    // L3c of the Lifted-Overlay refactor: orderedList drags through the
    // same two-mode gesture as bulletList — its twin (same list-body
    // float). Decimal counters render in the ghost via L3b.1's
    // `.tiptap ol { list-style-type: decimal }` scope; no re-wrap via
    // L3b.3's border compensation.
    liftMode: "lifted-overlay",
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
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("block quote", doc, action, ctx),
  },
  codeBlock: {
    label: "Code block",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (doc, _uuid, action, ctx) =>
      descriptorForSimpleBlock("code block", doc, action, ctx),
  },
  displayMath: {
    label: "Display math",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // Atom blocks: always warn (can't preview a meaningful "empty"
    // state for math/figure/etc.). The hasAnchorsOrAtoms guard is
    // irrelevant — the block itself is what's at stake.
    confirmDestructive: (_doc, _uuid, action) => {
      const { verb, label } = actionVerb(action);
      return {
        title: `${verb} this math block?`,
        message: `${verb} this math block.`,
        confirmLabel: `${label} block`,
      };
    },
  },
  titleField: {
    label: "Title field",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: TITLE_FIELD_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // Delete/Archive are filtered out by TITLE_FIELD_ACTIONS, so this
    // slot is never consulted in practice. Left unset.
  },
  latexComment: {
    label: "LaTeX comment",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // Author noise, cheap to redo — never warn.
    confirmDestructive: () => null,
  },
  texBlock: {
    label: "TeX block",
    isSubObject: false,
    // Atom in the schema, but `selectable: false` — selection mechanics
    // route around it. Still classified as atom-block for grab-handle
    // positioning math.
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    initialFloatSize: { width: 480, height: 280 },
    actions: NON_PROSE_BLOCK_ACTIONS,
    // texBlock uses `%!vtex:begin <uuid>` / `%!vtex:end <uuid>` comment
    // sentinels for round-trip, not a \v*id command. Left empty here
    // because the registry's sourceMarker field is the simpler
    // command-form; the sentinel pair is handled directly by the
    // parser/serializer for texBlock.
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) => {
      const { verb, label } = actionVerb(action);
      return {
        title: `${verb} this TeX block?`,
        message: `${verb} this raw LaTeX block.`,
        confirmLabel: `${label} block`,
      };
    },
  },
  figureBlock: {
    label: "Figure",
    isSubObject: false,
    // NOT an atom — `content: "figureCaption?"` (figure-block.ts).
    // Drag-handle uses TextSelection rather than NodeSelection here.
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) => {
      const { verb, label } = actionVerb(action);
      return {
        title: `${verb} this figure?`,
        message: `${verb} this figure and its caption.`,
        confirmLabel: `${label} figure`,
      };
    },
  },
  graphicsBlock: {
    label: "Graphic",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "block-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    confirmDestructive: (_doc, _uuid, action) => {
      const { verb, label } = actionVerb(action);
      return {
        title: `${verb} this graphic?`,
        message: `${verb} this graphic.`,
        confirmLabel: `${label} graphic`,
      };
    },
  },
  exampleBlock: {
    label: "Example",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: NON_PROSE_BLOCK_ACTIONS,
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
    // popout at handoff. Spawns at authoritative source height and skips
    // FloatCard's grow burst via L3c.2's `liftMode === "lifted-overlay"`
    // gate.
    liftMode: "lifted-overlay",
    sourceMarker: { command: "vexid", idLength: 4 },
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
    isAtomBlock: false,
    isRange: false,
    decorationSafety: BULLET_DECORATION_WIDTH,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
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
    isAtomBlock: false,
    isRange: false,
    // The inner marker lives INSIDE the exampleItem's grid (unlike
    // listItem's bullet, which CSS renders outside the li content box),
    // so `decorationSafety` only needs to indent the handle into the
    // parent block's column-gap — not clear a full marker width. See
    // EXAMPLE_ITEM_HANDLE_INDENT docs in handle-layout.ts.
    decorationSafety: EXAMPLE_ITEM_HANDLE_INDENT,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: PROSE_ACTIONS,
    sourceMarker: { command: "vxid", idLength: 4 },
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
    isAtomBlock: false,
    isRange: true,
    decorationSafety: 0,
    chromeAnchor: "text-top",
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: LINKED_RANGE_ACTIONS,
    // Paired markers \vlid{id}…\vlidend{id} — added in Phase E
    // alongside the multi-paragraph round-trip plumbing. The simple
    // command form below names the opener; the closer is derived
    // (`<command>end`).
    sourceMarker: { command: "vlid", idLength: 4 },
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
 * Construct the canonical popout key for a TextObject: `textobject:<kind>:<id>`.
 * Centralized here so that callers never assemble the string by hand.
 * Phase D10 migrates legacy `paragraph:<id>` / `heading:<id>` / `list:<id>` /
 * `texBlock:<id>` / `example:<id>` / `selection:<id>` keys to this shape.
 */
export function textObjectPopoutKey(ref: TextObjectRef): string {
  return `textobject:${ref.kind}:${ref.id}`;
}

/**
 * Parse a `textobject:<kind>:<id>` popout key back into a TextObjectRef.
 * Returns null if the key doesn't match the shape or the kind is unknown.
 */
export function parseTextObjectPopoutKey(key: string): TextObjectRef | null {
  if (!key.startsWith("textobject:")) return null;
  const rest = key.slice("textobject:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const kind = rest.slice(0, sep);
  const id = rest.slice(sep + 1);
  if (!isTextObjectKind(kind) || !id) return null;
  return { kind: kind, id };
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
