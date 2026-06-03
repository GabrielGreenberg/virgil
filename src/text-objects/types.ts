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

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
// Type-only import (erased at compile time) — keeps the React-free
// runtime invariant above intact while letting `liftSourceRect` take the
// real cache type. `useEditorViewportCache` imports nothing from this
// module, so there's no cycle.
import type { EditorViewportCache } from "@/hooks/useEditorViewportCache";

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

  /** Where the grab handle's vertical anchor lands.
   *
   *  `"text-top"` — measure the first rendered glyph's top via a
   *  `Range` over the first character of the kind's text content.
   *  Aligns dots with the visible text cap-top regardless of font
   *  size / line-height, so headings at 1.75rem read the same as
   *  body at 1.05rem.
   *
   *  `"block-top"` — use the wrapper's visual top edge
   *  (`anchorDom.getBoundingClientRect().top`). For framed visual
   *  kinds (tex pod, `%` comment, math, graphic, figure) where the
   *  handle should grip the whole box, not its first text line.
   *
   *  Declared per kind so the handle "knows" where to be without
   *  per-environment patches. */
  chromeAnchor: "text-top" | "block-top";

  /** Float-body component for popouts. Chrome is unified via
   *  `TextObjectFloat`; body owns sync. Typed as `unknown` here to keep
   *  this module React-free; the registry module narrows it. */
  floatBodyComponent: unknown;

  /** Fallback spawn size, in viewport pixels, for the legacy cursor-centered
   *  popout in `TextObjectGrabHandle` — used ONLY when the lift can't capture a
   *  source rect (the source DOM vanished concurrently, or a range's mark can't
   *  be mapped). The normal lifted-overlay popout spawns at the captured source
   *  rect, not this fixed size, so this is consulted on that degenerate path
   *  alone. Omitted → use the DEFAULT_FLOAT_SIZE in TextObjectGrabHandle. Set by
   *  the wider kinds (headings, lists, tex-blocks) that want more room than a
   *  paragraph float in that fallback. */
  initialFloatSize?: { width: number; height: number };

  /** Override the static `label` per-instance based on the live node's
   *  attrs. Used by the lifted-overlay's popout-mode header so the chrome
   *  matches what the real popout will show at handoff: heading maps
   *  `node.attrs.level` to "Chapter" / "Section" / "Subsection" / …
   *  (mirroring `heading-body.tsx`'s `setHeaderLabel(headingTypeName(level))`
   *  callback). Other kinds may grow analogous needs (e.g. lists varying
   *  by bullet vs ordered). When omitted or when the return is null, the
   *  static `meta.label` wins. Called once at threshold cross by
   *  `TextObjectGrabHandle.beginGesture`; the result is passed as the
   *  overlay's `label` prop for the gesture's lifetime. Kept pure /
   *  view-free — the editor is only used to resolve the node by uuid. */
  computeLabel?: (editor: Editor, ref: TextObjectRef) => string | null;

  /** Override the lifted-overlay GHOST's content. Default (absent): the
   *  overlay shows a sanitized `anchorDom.cloneNode(true)`. `heading`
   *  overrides because its `anchorDom` is just the `<h*>` line, but the
   *  ghost must show the WHOLE SECTION (heading + body blocks) to match
   *  what a release-in-pod actually moves (`collectMoveSource`). Returns
   *  a fresh DETACHED element (the overlay sanitizes it in place — strips
   *  contenteditable/ids/state attrs); clone the live DOM, never detach
   *  it. Returns null to fall back to the default clone (heading does so
   *  for a lone section with no body blocks → byte-identical to today).
   *  Designed in L3e (texBlock's plain clone didn't need it); heading is
   *  the first consumer, L3f (linkedRange — a range extraction) the
   *  second. Resolved at the parent (`TextObjectGrabHandle`) and threaded
   *  to `LiftedTextOverlay` as a prop, so the overlay stays kind-agnostic
   *  (no registry import / no editor prop) — same pattern as L3a's
   *  `computeLabel`/`label`. `anchorDom` is `null` for a mark-backed range
   *  kind (`linkedRange`, L3f-2): it has no single anchor element, so its
   *  hook resolves the marked DOM from the editor instead. */
  renderGhost?: (
    anchorDom: HTMLElement | null,
    editor: Editor,
    ref: TextObjectRef,
  ) => HTMLElement | null;

  /** Override the source rect captured once at threshold cross for the
   *  lifted overlay. Default (absent): `anchorDom.getBoundingClientRect()`.
   *  The returned width/height size BOTH the ghost AND the released
   *  popout (one capture site feeds both); left/top set the grab offset.
   *  `heading` keeps the heading line's left/top/width (the user grabbed
   *  the heading; the section ghost grows DOWN from it, so the text
   *  top-left — hence the grab offset and L1.12 text-stays-still — is
   *  unchanged) and returns the whole section's FULL extent as the height.
   *  The general viewport-fraction cap (`POPOUT_MAX_VH`) at the single
   *  capture site in `TextObjectGrabHandle` then fits it on screen for
   *  every kind (Issue-13), so this hook no longer clamps to the visible
   *  page itself (`heading` leaves the `cache` arg unused now; it stays on
   *  the signature for L3f). Returns null to use the default (heading does
   *  so for a lone section). `linkedRange` (L3f-2) is the second consumer:
   *  it unions the marked range's client rects into a multi-line bounding
   *  box, anchored at the selection start. `anchorDom` is `null` for that
   *  mark-backed kind (no anchor element) — the hook resolves the range from
   *  the editor instead. Resolved at the parent and threaded down, like
   *  `renderGhost`. */
  liftSourceRect?: (
    anchorDom: HTMLElement | null,
    editor: Editor,
    ref: TextObjectRef,
    cache: EditorViewportCache,
  ) => { left: number; top: number; width: number; height: number } | null;

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

  /** Collect the doc range an annotation-style action (highlight, note,
   *  footnote, citation, todo, suggest-edit, cutter) should
   *  operate on. Symmetric counterpart of `collectMoveSource`: that one
   *  carries lifecycle range (whole section for headings), this carries
   *  annotation range (heading line only for headings). Default behavior
   *  (used when omitted) is the node's own content range — same fallback
   *  as `resolveRefRange`. Only `heading` overrides today; other kinds
   *  may grow scope asymmetry later (e.g. exampleBlock annotating its
   *  intro line). Pure; called from the dispatcher at click time.
   *
   *  See ACTION-MENU-DIAGNOSIS.md §6 cluster C9 + C11 — the split
   *  resolves the silent data loss where heading × Highlight wrote
   *  `\vlidend{}` inside `\section{...}` braces and stripped every
   *  other linkedAnchor pair on the next save/reload round-trip. */
  collectAnnotationRange?: (
    doc: PMNode,
    uuid: string,
  ) => MoveSource | null;

  /** When true, this kind is "structural noise" if its content becomes
   *  empty — Delete and Archive's cascade helper removes it along with
   *  its last child. True for `bulletList` / `orderedList` /
   *  `exampleBlock` (an empty list/example reads as broken; users want
   *  it gone). Not set for `blockquote` (empty blockquote can be
   *  intentional — "I'm about to type a quote here").
   *
   *  See ACTION-MENU-DIAGNOSIS.md §6 cluster C6. */
  removeOnEmptyChildren?: boolean;

  /** Optional per-kind confirm copy for destructive lifecycle actions
   *  (Delete / Archive). Heading uses this for its wide-scope section
   *  summary. Other kinds return `null` when nothing's at stake
   *  (empty paragraph with no attached anchors/atoms) and a descriptor
   *  otherwise. The dispatcher walks the outer range once to compute
   *  `hasAnchorsOrAtoms` and passes it through so the kind can decide
   *  cheaply.
   *
   *  Duplicate is NOT routed through this slot — it's non-destructive
   *  and stays heading-only via `confirmHeadingLifecycle`. */
  confirmDestructive?: (
    doc: PMNode,
    uuid: string,
    action: "archive" | "delete",
    ctx: ConfirmDestructiveContext,
  ) => ConfirmDescriptor | null;
}

/** Context passed to per-kind `confirmDestructive` so it can decide
 *  cheaply without re-walking the doc. */
export interface ConfirmDestructiveContext {
  outerRange: { from: number; to: number };
  /** True when the outer range contains at least one `linkedAnchor`
   *  mark or `footnote`/`citation` inline atom. Lets a kind skip the
   *  confirm dialog when the block is empty AND has no attached cards. */
  hasAnchorsOrAtoms: boolean;
}

/** Structural subset of `ConfirmOptions` from `ConfirmDialog.tsx`,
 *  kept React-free so this module stays import-free of UI. The
 *  dispatcher widens it to the full `ConfirmOptions` at call time. */
export interface ConfirmDescriptor {
  title?: string;
  message: string;
  tone?: "default" | "danger";
  confirmLabel?: string;
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
  | "note"
  | "highlight"
  | "todo"
  | "suggest-edit"
  | "cutter"
  | "report"
  | "duplicate"
  | "archive"
  | "delete";
