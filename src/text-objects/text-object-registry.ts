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
import { getSectionRangeByUuid } from "@/lib/section-range";
import {
  topLevelDropAdapter,
  listItemDropAdapter,
  exampleItemDropAdapter,
} from "./drop-adapters";
import {
  BULLET_DECORATION_WIDTH,
  EXAMPLE_ITEM_MAX_MARKER_WIDTH,
} from "./handle-layout";
import type {
  DragHandleAction,
  MoveSource,
  TextObjectKind,
  TextObjectMeta,
  TextObjectRef,
} from "./types";

// ---------------------------------------------------------------------------
// Default action set — every kind exposes the full DragHandleMenu list
// for now. The DragHandleMenu UI was a flat 9-entry list for every
// passage type before this refactor; we preserve that. Per-kind
// filtering is a one-line change here if needed later.
// ---------------------------------------------------------------------------

const ALL_ACTIONS: ReadonlyArray<DragHandleAction> = [
  "highlight",
  "note",
  "footnote",
  "citation",
  "quotation",
  "todo",
  "suggest-edit",
  "cutter",
  "archive",
];

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
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    // %!v: anchor; not a LaTeX command per se. Marker is the suffix
    // on the paragraph's last line.
    dropAdapter: topLevelDropAdapter,
  },
  heading: {
    label: "Heading",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
    // Headings move as a section, not a single node — pick up every
    // block from the heading down to the next equal-or-higher heading.
    collectMoveSource: (doc, uuid): MoveSource | null => {
      const range = getSectionRangeByUuid(doc, uuid);
      if (!range) return null;
      return { from: range.start, to: range.end, nodes: range.nodes };
    },
  },
  bulletList: {
    label: "Bullet list",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  orderedList: {
    label: "Ordered list",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  blockquote: {
    label: "Block quote",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  codeBlock: {
    label: "Code block",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  displayMath: {
    label: "Display math",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  titleField: {
    label: "Title field",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  latexComment: {
    label: "LaTeX comment",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
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
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    // texBlock uses `%!vtex:begin <uuid>` / `%!vtex:end <uuid>` comment
    // sentinels for round-trip, not a \v*id command. Left empty here
    // because the registry's sourceMarker field is the simpler
    // command-form; the sentinel pair is handled directly by the
    // parser/serializer for texBlock.
    dropAdapter: topLevelDropAdapter,
  },
  figureBlock: {
    label: "Figure",
    isSubObject: false,
    // NOT an atom — `content: "figureCaption?"` (figure-block.ts).
    // Drag-handle uses TextSelection rather than NodeSelection here.
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  graphicsBlock: {
    label: "Graphic",
    isSubObject: false,
    isAtomBlock: true,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: topLevelDropAdapter,
  },
  exampleBlock: {
    label: "Example",
    isSubObject: false,
    isAtomBlock: false,
    isRange: false,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    sourceMarker: { command: "vexid", idLength: 4 },
    dropAdapter: topLevelDropAdapter,
  },

  // ----- Sub-objects -----

  listItem: {
    label: "List item",
    isSubObject: true,
    parentKind: "bulletList",
    isAtomBlock: false,
    isRange: false,
    decorationSafety: BULLET_DECORATION_WIDTH,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    dropAdapter: listItemDropAdapter,
  },
  exampleItem: {
    label: "Example item",
    isSubObject: true,
    parentKind: "exampleBlock",
    isAtomBlock: false,
    isRange: false,
    // Strategy (a): hardcode the widest of the marker cycle. Promote
    // to `(node) => number` if shallow-depth gutter gaps look wrong.
    decorationSafety: EXAMPLE_ITEM_MAX_MARKER_WIDTH,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    sourceMarker: { command: "vxid", idLength: 4 },
    dropAdapter: exampleItemDropAdapter,
  },

  // ----- Range -----

  linkedRange: {
    label: "Linked range",
    isSubObject: false,
    isAtomBlock: false,
    isRange: true,
    decorationSafety: 0,
    floatBodyComponent: PLACEHOLDER_FLOAT_BODY,
    actions: ALL_ACTIONS,
    // Paired markers \vlid{id}…\vlidend{id} — added in Phase E
    // alongside the multi-paragraph round-trip plumbing. The simple
    // command form below names the opener; the closer is derived
    // (`<command>end`).
    sourceMarker: { command: "vlid", idLength: 4 },
    dropAdapter: topLevelDropAdapter,
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
