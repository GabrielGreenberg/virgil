/**
 * TextObject — the single canonical abstraction for every block-level
 * identity-bearing graspable unit in Virgil.
 *
 * Two families:
 *   • Persistent nodes: TipTap block-level nodes carrying a `uuid` attr;
 *     lifecycle = lifetime of the node.
 *   • Persistent ranges: backed by a `linkedAnchor` mark with an `anchorId`;
 *     lifecycle = lifetime of the mark.
 *
 * Selections are NOT TextObjects. They are gesture-input. On commit
 * (popout, anchor, drop), `hydrateSelectionToTextObject` mints a
 * `linkedRange` text-object from the selection.
 *
 * NOTE: This file is consumed by code that runs in non-DOM contexts
 * (parser, serializer, hooks). Keep it free of React imports — the
 * component types use `unknown` placeholders that are refined in the
 * registry module.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/**
 * Closed union of every TextObject kind in Virgil. Adding a kind requires
 * (a) declaring the node in the `textObject` schema group (or, for
 * `linkedRange`, the mark) and (b) adding an entry to
 * `TEXT_OBJECT_REGISTRY`. Nothing else needs touching.
 *
 * See [TEXT-OBJECT-REFACTOR.md](../../TEXT-OBJECT-REFACTOR.md) §2 for the
 * taxonomy rationale.
 *
 * Not to be confused with `EntityKind` in src/links/_shared/entity-hover.ts,
 * which is a card-kind union (anchored side). The `example` value there
 * refers to the Examples panel card kind, NOT to the `exampleBlock`
 * text-object below.
 */
export type TextObjectKind =
  // Top-level persistent nodes (13)
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "displayMath"
  | "titleField"
  | "latexComment"
  | "texBlock"
  | "figureBlock"
  | "graphicsBlock"
  | "exampleBlock"
  // Sub-objects (2)
  | "listItem"
  | "exampleItem"
  // Range (1)
  | "linkedRange";

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Reference to a TextObject. The `id` resolves to a `uuid` attr for
 * persistent-node kinds and to a `linkedAnchor.anchorId` mark id for
 * `linkedRange`.
 */
export interface TextObjectRef {
  kind: TextObjectKind;
  id: string;
}

/**
 * Reference to a live selection — gesture-input only, NOT a TextObject.
 * On commit (popout, anchor, drop), call `hydrateSelectionToTextObject`
 * to mint a `linkedRange` TextObject from it.
 */
export interface SelectionRef {
  kind: "selection";
  from: number;
  to: number;
  /** Anchor paragraph id (the paragraph containing `from`). Used for
   *  margin placement and as a recovery hint if hydration fails. */
  paragraphId: string;
}

// ---------------------------------------------------------------------------
// Drop adapter
// ---------------------------------------------------------------------------

export interface TextObjectSourceContext {
  /** For sub-objects: the kind of the source's immediate parent. A
   *  `listItem` from a `bulletList` carries `parentKind: "bulletList"`
   *  so the drop adapter wraps into a fresh `bulletList` when dropping
   *  at top level (vs. always defaulting to one of the two list kinds). */
  parentKind?: TextObjectKind;
  /** Where the drag originated. Currently informational; reserved for
   *  future drop-specific behaviors that depend on source context. */
  docContext?: "main" | "float";
}

/**
 * Target context at the drop site, classified by the parent the drop
 * would land in. The drop adapter decides whether to drop directly or
 * wrap into a fresh single-item parent of `parentKind`.
 */
export type DropTarget =
  /** Inside a parent that accepts the sub-object directly. */
  | { kind: "inside-compatible-parent"; parentKind: TextObjectKind }
  /** Inside a parent that does not accept the sub-object — must wrap. */
  | { kind: "inside-incompatible-parent"; parentKind: TextObjectKind }
  /** Top-level slot in the doc (sibling of paragraphs). */
  | { kind: "top-level" };

/**
 * The action a drop adapter resolves to. Drop machinery consumes this
 * to decide what node to insert at the drop site.
 */
export type DropAction =
  /** Drop the text-object directly (no wrapping). */
  | { kind: "drop-direct" }
  /** Wrap in a fresh single-item parent of this kind before inserting. */
  | { kind: "wrap"; parentKind: TextObjectKind };

// ---------------------------------------------------------------------------
// Transport (drag payload)
// ---------------------------------------------------------------------------

/**
 * Unified MIME for in-app TextObject transport. Replaces
 * `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` (deleted).
 *
 * The payload is JSON-serialized as the dataTransfer value.
 */
export const MIME_TEXTOBJECT = "application/x-virgil-textobject";

export interface TextObjectTransportPayload {
  kind: TextObjectKind;
  id: string;
  sourceContext: TextObjectSourceContext;
  /** Optional content snapshot at lift time. Sinks that need the content
   *  without resolving against the live editor (e.g. the Stack) read it
   *  directly. Producers fill it; passive consumers may ignore. Shape
   *  is kind-dependent — JSONContent for prose kinds, string for
   *  `texBlock`'s CodeMirror code, etc. */
  snapshot?: unknown;
}

// ---------------------------------------------------------------------------
// Float component contract (parameterized — body delegated per kind)
// ---------------------------------------------------------------------------

/**
 * Props the unified `TextObjectFloat` chrome passes to a kind-specific
 * body component. The chrome owns layout, header, popout/drop-mode
 * integration, and data attrs for hit-testing. The body owns content
 * rendering and main↔float sync (per-kind: TipTap-on-TipTap, CodeMirror,
 * slice-render, etc.).
 *
 * Chrome unified; body sync stays per-kind. Abstracting CodeMirror-vs-
 * TipTap sync would create false unification.
 */
export interface TextObjectFloatBodyProps {
  /** The popout key, shaped `textobject:<kind>:<id>`. */
  cardKey: string;
  /** The TextObject id (uuid for persistent nodes, anchorId for
   *  linkedRange). */
  id: string;
  /** Ref to the main-editor handle (`EditorHandle`). Bodies reach into
   *  the main editor through this to read/write the source-of-truth
   *  node/range. Typed as `unknown` here to keep this module React-free;
   *  the chrome narrows it. */
  editorRef: unknown;
  /** Whether the body should render in "card context" mode — typically
   *  compact, with atom-block extensions configured for inline preview
   *  rather than full interactive nodes. Defaults to true inside floats
   *  that show a snippet of a larger doc context (e.g. heading bodies). */
  cardContext: boolean;
  /** Optional per-instance label override. Most bodies ignore this and
   *  let the chrome use the static `meta.label`; headings flip it to
   *  "Chapter" / "Section" / "Subsection" based on the underlying node's
   *  level. Pass `null` to revert to the static label. */
  setHeaderLabel: (next: string | null) => void;
}

// ---------------------------------------------------------------------------
// Registry meta
// ---------------------------------------------------------------------------

/**
 * Per-kind metadata that drives every parallel implementation through
 * this one shape. The SSOT is `TEXT_OBJECT_REGISTRY` in
 * `text-object-registry.ts`; this is the type.
 */
export interface TextObjectMeta {
  /** Display label for menus, omni, etc. */
  label: string;

  /** Sub-object kinds wrap into a fresh single-item parent when dropped
   *  outside their natural context. */
  isSubObject: boolean;
  /** For sub-objects: the parent kind they wrap into by default. For
   *  `listItem`, the source-context's parent kind (`bulletList` vs
   *  `orderedList`) overrides this. */
  parentKind?: TextObjectKind;

  /** Whether the underlying node is a ProseMirror atom — affects
   *  selection mode (NodeSelection vs TextSelection) and position math
   *  (DOM rect vs `coordsAtPos`). figureBlock is NOT an atom
   *  (`content: "figureCaption?"`); only `texBlock`/`graphicsBlock`/
   *  `displayMath`/`latexComment` are. */
  isAtomBlock: boolean;

  /** Whether this kind is a mark-backed range (only `linkedRange`). */
  isRange: boolean;

  /** Pixels reserved to the right of the grab handle for bullet/marker
   *  decoration. Most kinds: 0. `listItem`: bullet width. `exampleItem`:
   *  widest of the marker cycle (start with strategy (a); promote to
   *  `(node) => number` for live-measure strategy (b) if the visual
   *  breaks at shallow depth). See TEXT-OBJECT-REFACTOR.md §7. */
  decorationSafety: number | ((node: PMNode) => number);

  /** Float-body component for popouts. Chrome is unified via
   *  `TextObjectFloat`; body owns sync. Typed as `unknown` here to keep
   *  this module React-free; the registry module narrows it. */
  floatBodyComponent: unknown;

  /** Initial size for a freshly popped-out float, in viewport pixels.
   *  Omitted → use the DEFAULT_FLOAT_SIZE in TextObjectGrabHandle.
   *  Mostly used by wider kinds (headings, lists, tex-blocks) that
   *  want more room than a paragraph float. */
  initialFloatSize?: { width: number; height: number };

  /** DragHandleMenu actions this kind exposes. Subset of the global
   *  `DragHandleAction` union, selected per kind. */
  actions: ReadonlyArray<DragHandleAction>;

  /** LaTeX source marker (if any) carrying the id across save/reload.
   *  paragraph/heading/etc. use `%!v:` (not a command). Footnote uses
   *  `\vfid`; citation `\vcid`; exampleBlock `\vexid`; exampleItem
   *  `\vxid` (added in Phase A1); linkedRange `\vlid`/`\vlidend`
   *  (Phase E). */
  sourceMarker?: {
    command: string;
    /** Currently 4 (short-id format). Reserved field for future
     *  expansion (e.g. if a kind ever needed a different id length). */
    idLength: 4;
  };

  /** Drop adapter — given a target context plus the source's context
   *  (which kind it came from, including which parent for sub-objects),
   *  decides whether to drop directly or wrap. */
  dropAdapter: (
    sourceRef: TextObjectRef & { sourceContext: TextObjectSourceContext },
    target: DropTarget,
  ) => DropAction;

  /** Collect the doc range a move-drop should pick up. Default behavior
   *  (used when this is omitted) is "the single node whose `attrs.uuid`
   *  matches `uuid`." Headings override this to collect the entire
   *  section (heading + every block under it up to the next heading of
   *  equal or higher rank) so a section moves as a unit. Keep this
   *  function pure — it's called inside the drop spec without any
   *  view-level context. */
  collectMoveSource?: (
    doc: PMNode,
    uuid: string,
  ) => MoveSource | null;
}

/** Per-kind "what to move" payload. The drop spec deletes
 *  `[from, to)` from the source doc and re-inserts `nodes` at the
 *  target. Single-node kinds emit a one-element `nodes` array.
 *  Headings emit the whole section. */
export interface MoveSource {
  from: number;
  to: number;
  nodes: ReadonlyArray<PMNode>;
}

// ---------------------------------------------------------------------------
// DragHandleAction — re-exported from the menu module to avoid the
// circular reach (registry → menu → registry). The shape is owned by
// the menu but the registry constrains which subset each kind exposes.
// ---------------------------------------------------------------------------

export type DragHandleAction =
  | "footnote"
  | "citation"
  | "quotation"
  | "note"
  | "highlight"
  | "todo"
  | "suggest-edit"
  | "cutter"
  | "archive";
