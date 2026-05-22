"use client";

/**
 * TextObjectGrabHandle — the single canonical grab handle for every
 * persistent TextObject in Virgil AND for live selections.
 *
 * Mounted once at the editor level (replaces SelectionDragHandle and the
 * per-NodeView grips that lived inside `ParagraphWithTitle` /
 * `HeadingWithLabel` / `createListTitleNodeView` / `TexBlockNodeView` /
 * `ExampleBlock`). Resolves the active TextObject (or selection) on every
 * selectionUpdate / docUpdate / scroll / mousemove, computes its
 * placement via the registry's `decorationSafety`, and dispatches the
 * click + lift gestures through the unified
 * `useDragHandleMenu` + `usePoppedCards` contexts.
 *
 * Resolution order, top to bottom (first match wins):
 *   1. Non-empty TextSelection            → `SelectionRef`
 *   2. NodeSelection on a TextObject      → `TextObjectRef` for that node
 *   3. Mouse hover over a TextObject       → `TextObjectRef` for the hover
 *      (provides discoverability for atom blocks — `texBlock`,
 *      `graphicsBlock`, `displayMath`, `latexComment`, `figureBlock` —
 *      which can't be reached by a collapsed caret)
 *   4. Collapsed caret in a sub-object    → `TextObjectRef` for the
 *      innermost sub-object (`listItem` / `exampleItem`)
 *   5. Collapsed caret in a top-level kind → `TextObjectRef` for the
 *      OUTERMOST top-level kind (so the cursor in a paragraph inside a
 *      blockquote grabs the blockquote, not the inner paragraph)
 *
 * Lift gesture spawns a popout via the legacy popout-key for kinds that
 * have an existing float component today (paragraph / heading / list /
 * texBlock / exampleBlock / linkedRange-as-selection). Other TextObject
 * kinds (`listItem`, `exampleItem`, `figureBlock`, `graphicsBlock`,
 * `displayMath`, `latexComment`, `blockquote`, `codeBlock`, `titleField`)
 * open the action menu on click but do not lift today — Phase D5 wires
 * up the unified `TextObjectFloat` body component per kind.
 *
 * Phase D10 migrates every popout key to `textobject:<kind>:<id>` via
 * `textObjectPopoutKey`. Phase E hydrates a `SelectionRef` into a
 * `linkedRange` TextObject at lift time, deleting the `selection:<id>`
 * fallback entirely.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftHandoff, setCardLiftTarget } from "@/components/card-lift";
import { registerSelectionFloat } from "@/components/selection-floats";
import { generateShortId } from "@/lib/uuid";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { useDragHandleMenu } from "@/components/editor-layout/card-actions/drag-handle-menu-context";
import {
  useEditorViewportCache,
  type EditorViewportCache,
} from "@/hooks/useEditorViewportCache";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";
import {
  BULLET_DECORATION_WIDTH,
  HANDLE_GAP,
  computeHandleLeftEdge,
} from "./handle-layout";
import type {
  SelectionRef,
  TextObjectKind,
  TextObjectRef,
} from "./types";

const LIFT_THRESHOLD = 5;
const FIRST_LINE_EPSILON = 2;
/** Vertical offset between the cursor and the spawned float's top edge.
 *  The grip sits inside the float's header, so the cursor lands on the
 *  header (not on the body) after the lift. */
const SPAWN_CURSOR_OFFSET_Y = 16;

/**
 * Per-kind initial float size at spawn time. Today's per-kind grips use
 * different defaults — paragraphs are narrow, headings/lists/tex blocks
 * are wider. The registry will absorb this in Phase D5 (alongside the
 * float-body registration); for now keep the map local.
 */
const DEFAULT_FLOAT_SIZE: { width: number; height: number } = { width: 360, height: 280 };
const PER_KIND_FLOAT_SIZE: Partial<
  Record<TextObjectKind | "selection", { width: number; height: number }>
> = {
  heading: { width: 480, height: 360 },
  bulletList: { width: 480, height: 360 },
  orderedList: { width: 480, height: 360 },
  texBlock: { width: 480, height: 280 },
  selection: { width: 360, height: 280 },
};

function floatSizeFor(kind: TextObjectKind | "selection") {
  return PER_KIND_FLOAT_SIZE[kind] ?? DEFAULT_FLOAT_SIZE;
}

/**
 * Map a `TextObjectRef | SelectionRef` to the legacy popout key shape used
 * by `viewPrefs.poppedOutCards`. Phase D10 migrates these to the unified
 * `textobject:<kind>:<id>` shape; until then, the new handle emits the
 * keys the existing float dispatcher (`floating-cards.tsx`) expects.
 *
 * Returns null for kinds that don't have a float today — the handle still
 * opens the action menu on click for those, it just doesn't lift.
 */
function legacyPopoutKey(ref: TextObjectRef | SelectionRef): string | null {
  if (ref.kind === "selection") return `selection:${generateShortId()}`;
  switch (ref.kind) {
    case "paragraph":
      return `paragraph:${ref.id}`;
    case "heading":
      return `heading:${ref.id}`;
    case "bulletList":
    case "orderedList":
      return `list:${ref.id}`;
    case "texBlock":
      return `texBlock:${ref.id}`;
    case "exampleBlock":
      return `example:${ref.id}`;
    default:
      // listItem, exampleItem, figureBlock, graphicsBlock, displayMath,
      // latexComment, blockquote, codeBlock, titleField, linkedRange —
      // no legacy float. Lift is a no-op until Phase D5 wires the
      // unified TextObjectFloat body components.
      return null;
  }
}

interface Placement {
  visible: boolean;
  /** Viewport-x of the handle's left edge. */
  left: number;
  /** Viewport-y of the handle's top edge (sticky-to-top when the source
   *  has scrolled above the viewport). */
  top: number;
  /** The resolved ref the handle represents. */
  ref: TextObjectRef | SelectionRef | null;
  /** Source paragraph's uuid (for SelectionRef supersession on the
   *  legacy `.par-drag-handle`, while it still exists). Phase D4 deletes
   *  the legacy handles; this field can go away then. */
  paragraphUuid: string | null;
  /** True iff the active range starts on the source block's first
   *  visual line — supersedes any legacy `.par-drag-handle` on that
   *  block during D2-D4 cohabitation. */
  superseded: boolean;
}

function placementsEqual(a: Placement, b: Placement): boolean {
  if (a.visible !== b.visible) return false;
  if (a.left !== b.left || a.top !== b.top) return false;
  if (a.superseded !== b.superseded) return false;
  if (a.paragraphUuid !== b.paragraphUuid) return false;
  if (refsEqual(a.ref, b.ref)) return true;
  return false;
}

function refsEqual(
  a: TextObjectRef | SelectionRef | null,
  b: TextObjectRef | SelectionRef | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "selection" && b.kind === "selection") {
    return a.from === b.from && a.to === b.to && a.paragraphId === b.paragraphId;
  }
  if (a.kind !== "selection" && b.kind !== "selection") {
    return a.id === b.id;
  }
  return false;
}

/**
 * Walk the resolved position chain for the active TextObject ref:
 *   - prefer the innermost sub-object (listItem / exampleItem)
 *   - else pick the OUTERMOST top-level kind (so blockquote wins over a
 *     paragraph inside it).
 */
function resolveTextObjectAtPos(
  editor: Editor,
  pos: number,
): TextObjectRef | null {
  const $pos = editor.state.doc.resolve(pos);
  let outermostTopLevel: TextObjectRef | null = null;
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    const name = node.type.name;
    if (!isTextObjectKind(name) || name === "linkedRange") continue;
    const id = node.attrs?.uuid as string | null;
    if (!id) continue;
    const meta = TEXT_OBJECT_REGISTRY[name];
    if (meta.isSubObject) {
      return { kind: name, id };
    }
    outermostTopLevel = { kind: name, id };
  }
  return outermostTopLevel;
}

/**
 * Hit-test the mouse position against the editor's DOM to find a hovered
 * TextObject. Returns the innermost-matching node. Used as the discovery
 * path for atom blocks that the caret can't reach.
 */
function resolveTextObjectAtMouse(
  editor: Editor,
  clientX: number,
  clientY: number,
): TextObjectRef | null {
  if (!editor.view.dom.contains(document.elementFromPoint(clientX, clientY))) {
    return null;
  }
  // posAtCoords returns the nearest doc position to the mouse.
  const pos = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!pos) return null;
  // Use `inside` (the position INSIDE the node under the cursor) so atom
  // blocks at the cursor's position are reachable. For a position
  // adjacent to an atom (caret just before the atom), `inside === -1`;
  // falling back to `resolveTextObjectAtPos(pos.pos)` then climbs
  // ancestors.
  if (pos.inside >= 0) {
    const node = editor.state.doc.nodeAt(pos.inside);
    if (
      node &&
      isTextObjectKind(node.type.name) &&
      node.type.name !== "linkedRange" &&
      (node.attrs?.uuid as string | null)
    ) {
      const name = node.type.name as TextObjectKind;
      const id = node.attrs.uuid as string;
      // Prefer atom blocks at mouse position (discovery path); fall
      // through to the climb for non-atoms (the caret-based resolver
      // gives a better answer for those).
      const meta = TEXT_OBJECT_REGISTRY[name];
      if (meta.isAtomBlock) {
        return { kind: name, id };
      }
    }
  }
  return resolveTextObjectAtPos(editor, pos.pos);
}

/**
 * Compute placement for the active ref. Pins the handle's left edge to
 * the source block's gutter via `computeHandleLeftEdge`; pins the top
 * edge to the range's first-line top (clamped to the editor scroll
 * container's top when scrolled above the viewport).
 */
function computePlacement(
  editor: Editor,
  cache: EditorViewportCache,
  ref: TextObjectRef | SelectionRef | null,
): Placement {
  const hidden: Placement = {
    visible: false,
    left: 0,
    top: 0,
    ref,
    paragraphUuid: null,
    superseded: false,
  };
  if (!ref) return hidden;

  let from = -1;
  let to = -1;
  let paragraphUuid: string | null = null;
  let blockStartPos = -1;
  let blockNodePos = -1;

  if (ref.kind === "selection") {
    from = ref.from;
    to = ref.to;
    paragraphUuid = ref.paragraphId;
    // Resolve the source block for placement math (DOM rect on its
    // wrapper).
    const $from = editor.state.doc.resolve(from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      blockStartPos = $from.start(d);
      blockNodePos = d === 0 ? 0 : $from.before(d);
      break;
    }
  } else {
    // Locate the TextObject node by uuid for placement.
    editor.state.doc.descendants((node, pos) => {
      if (from >= 0) return false;
      if (
        node.type.name === ref.kind &&
        (node.attrs?.uuid as string | null) === ref.id
      ) {
        from = pos + (node.isAtom ? 0 : 1);
        to = pos + node.nodeSize - (node.isAtom ? 0 : 1);
        blockStartPos = pos + (node.isAtom ? 0 : 1);
        blockNodePos = pos;
        paragraphUuid = ref.id;
        return false;
      }
      return true;
    });
  }
  if (from < 0 || blockNodePos < 0) return hidden;

  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  let blockStartCoords: { left: number; top: number } | null = null;
  let anchorDom: HTMLElement | null = null;
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
    if (blockStartPos >= 0) {
      blockStartCoords = editor.view.coordsAtPos(blockStartPos);
    }
    const dom = editor.view.nodeDOM(blockNodePos);
    if (dom instanceof HTMLElement) anchorDom = dom;
  } catch {
    return hidden;
  }
  if (!anchorDom) return hidden;

  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;
  if (toCoords.bottom < scrollTop) return { ...hidden, ref, paragraphUuid };
  if (fromCoords.top > scrollBottom) return { ...hidden, ref, paragraphUuid };

  // Horizontal placement via the shared registry-driven layout utility.
  // For atom blocks, the anchor DOM's left edge IS the content edge
  // (there's no per-line text). For non-atoms, prefer the anchor DOM
  // rect over coordsAtPos to avoid the bullet-zone offset.
  const kind: TextObjectKind | null =
    ref.kind === "selection" ? null : ref.kind;
  const meta = kind ? TEXT_OBJECT_REGISTRY[kind] : null;
  const editorColumnLeft = anchorDom.getBoundingClientRect().left;
  const left = meta
    ? computeHandleLeftEdge({
        elDOM: anchorDom,
        kind: kind as TextObjectKind,
        node: editor.state.doc.nodeAt(blockNodePos) ?? undefined,
        editorColumnLeft,
        meta,
      })
    : editorColumnLeft - HANDLE_GAP - BULLET_DECORATION_WIDTH / 2;

  const top = Math.max(fromCoords.top, scrollTop);

  // Supersede the legacy `.par-drag-handle` on the source block when the
  // source-block's first line is the same as the active ref's top. Only
  // meaningful while the legacy handles still exist (Phase D4 deletes
  // them and this becomes a no-op).
  let superseded = false;
  if (
    paragraphUuid &&
    blockStartCoords &&
    Math.abs(fromCoords.top - blockStartCoords.top) < FIRST_LINE_EPSILON &&
    fromCoords.top >= scrollTop - FIRST_LINE_EPSILON
  ) {
    superseded = true;
  }

  return {
    visible: true,
    left,
    top,
    ref,
    paragraphUuid,
    superseded,
  };
}

interface Props {
  editorRef: RefObject<Editor | null>;
}

export function TextObjectGrabHandle({ editorRef }: Props) {
  const popped = usePoppedCards();
  const [placement, setPlacement] = useState<Placement>({
    visible: false,
    left: 0,
    top: 0,
    ref: null,
    paragraphUuid: null,
    superseded: false,
  });

  const handleElRef = useRef<HTMLDivElement | null>(null);
  // Mouse position for hover-based resolution (atom-block discovery).
  // null until the first mousemove on the editor.
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Last-known active ref. Used by the lift gesture as the source of
  // truth (the editor's live selection may have collapsed by the time
  // the user starts dragging).
  const lastRefRef = useRef<TextObjectRef | SelectionRef | null>(null);
  // Track the editor instance currently subscribed-to so we don't double-
  // subscribe across re-renders.
  const subscribedEditorRef = useRef<Editor | null>(null);
  // RAF handle for coalescing high-frequency events (selection, doc,
  // mousemove) into one placement compute per frame.
  const rafRef = useRef<number>(0);
  // Track which paragraph (by uuid) currently has its legacy
  // `.par-drag-handle` superseded so we can restore it cleanly. Drops
  // out of the codebase in Phase D4.
  const supersededUuidRef = useRef<string | null>(null);

  const { cacheRef, version: cacheVersion } = useEditorViewportCache(
    editorRef.current,
  );

  // ---------------------------------------------------------------------------
  // Resolution + placement loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let prevEditor: Editor | null = null;
    const cleanupListeners = () => {
      if (prevEditor) {
        prevEditor.off("selectionUpdate", onSelectionUpdate);
        prevEditor.off("update", onDocUpdate);
      }
    };

    const resolveActiveRef = (
      editor: Editor,
    ): TextObjectRef | SelectionRef | null => {
      const sel = editor.state.selection;
      // 1. Non-empty TextSelection
      if (sel.from !== sel.to && !(sel instanceof NodeSelection)) {
        const $from = editor.state.doc.resolve(sel.from);
        let paragraphId: string | null = null;
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
          const uuid = node.attrs?.uuid as string | null;
          if (uuid) {
            paragraphId = uuid;
            break;
          }
        }
        if (paragraphId) {
          return {
            kind: "selection",
            from: sel.from,
            to: sel.to,
            paragraphId,
          };
        }
      }
      // 2. NodeSelection on a TextObject (e.g. atom block selected)
      if (sel instanceof NodeSelection) {
        const node = sel.node;
        const name = node.type.name;
        if (
          isTextObjectKind(name) &&
          name !== "linkedRange" &&
          (node.attrs?.uuid as string | null)
        ) {
          return { kind: name, id: node.attrs.uuid as string };
        }
      }
      // 3. Mouse hover (atom-block discovery)
      const mouse = mousePosRef.current;
      if (sel.from === sel.to && mouse) {
        const hoverRef = resolveTextObjectAtMouse(
          editor,
          mouse.clientX,
          mouse.clientY,
        );
        if (hoverRef) {
          const hoverMeta = TEXT_OBJECT_REGISTRY[hoverRef.kind];
          // Use hover only for atom blocks (their carets aren't reachable
          // by collapsed selection). Other kinds defer to the cursor-
          // based resolver below.
          if (hoverMeta.isAtomBlock) return hoverRef;
        }
      }
      // 4-5. Collapsed caret → resolve via containment
      return resolveTextObjectAtPos(editor, sel.from);
    };

    const schedule = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        lastRefRef.current = null;
        setPlacement((p) =>
          p.visible
            ? {
                visible: false,
                left: 0,
                top: 0,
                ref: null,
                paragraphUuid: null,
                superseded: false,
              }
            : p,
        );
        return;
      }
      const ref = resolveActiveRef(editor);
      const next = computePlacement(editor, cacheRef.current, ref);
      if (next.visible && next.ref) {
        lastRefRef.current = next.ref;
      } else {
        lastRefRef.current = ref;
      }
      setPlacement((prev) => (placementsEqual(prev, next) ? prev : next));
    };
    const scheduleRaf = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        schedule();
      });
    };

    const onSelectionUpdate = () => scheduleRaf();
    const onDocUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      scheduleRaf();
    };

    const ensureSubscribed = () => {
      const editor = editorRef.current;
      if (editor === subscribedEditorRef.current) return;
      cleanupListeners();
      subscribedEditorRef.current = editor;
      prevEditor = editor;
      if (editor) {
        editor.on("selectionUpdate", onSelectionUpdate);
        editor.on("update", onDocUpdate);
      }
    };

    let pollAttempts = 0;
    const poll = () => {
      ensureSubscribed();
      schedule();
      if (!editorRef.current && pollAttempts < 30) {
        pollAttempts += 1;
        window.setTimeout(poll, 50);
      }
    };
    poll();

    const onScroll = () => scheduleRaf();
    const onResize = () => scheduleRaf();
    const onMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      // Throttled — only re-compute when no selection is active (the
      // selection path doesn't depend on mouse).
      const editor = editorRef.current;
      if (!editor) return;
      const sel = editor.state.selection;
      if (sel.from === sel.to && !(sel instanceof NodeSelection)) {
        scheduleRaf();
      }
    };
    const onDocSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      // Sync PM's selection from the DOM (matches SelectionDragHandle's
      // logic for the Reader's contenteditable=false case).
      const view = editor.view;
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) {
        scheduleRaf();
        return;
      }
      const range = domSel.getRangeAt(0);
      if (range.collapsed) {
        scheduleRaf();
        return;
      }
      const dom = view.dom as Node;
      if (
        !dom.contains(range.startContainer) ||
        !dom.contains(range.endContainer)
      ) {
        return;
      }
      try {
        const a = view.posAtDOM(range.startContainer, range.startOffset, 1);
        const b = view.posAtDOM(range.endContainer, range.endOffset, -1);
        if (a < 0 || b < 0) return;
        const pmFrom = Math.min(a, b);
        const pmTo = Math.max(a, b);
        if (pmFrom === pmTo) return;
        const cur = view.state.selection;
        if (cur.from === pmFrom && cur.to === pmTo) {
          scheduleRaf();
          return;
        }
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, pmFrom, pmTo),
        );
        view.dispatch(tr);
      } catch {
        scheduleRaf();
      }
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("selectionchange", onDocSelectionChange);
    return () => {
      cleanupListeners();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      subscribedEditorRef.current = null;
      prevEditor = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("selectionchange", onDocSelectionChange);
    };
  }, [editorRef, cacheRef, cacheVersion]);

  // ---------------------------------------------------------------------------
  // Legacy `.par-drag-handle` supersession (D2-D4 cohabitation)
  // ---------------------------------------------------------------------------

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const root = editor?.view.dom as HTMLElement | undefined;
    const prev = supersededUuidRef.current;
    const nextUuid =
      placement.visible && placement.superseded ? placement.paragraphUuid : null;
    if (prev && prev !== nextUuid && root) {
      const el = root.querySelector(
        `.par-drag-handle[data-par-uuid="${prev}"]`,
      );
      if (el) el.classList.remove("is-superseded");
    }
    if (nextUuid && root) {
      const el = root.querySelector(
        `.par-drag-handle[data-par-uuid="${nextUuid}"]`,
      );
      if (el) el.classList.add("is-superseded");
    }
    supersededUuidRef.current = nextUuid;
  }, [editorRef, placement.visible, placement.superseded, placement.paragraphUuid]);

  useEffect(() => {
    const editor = editorRef.current;
    const root = editor?.view.dom as HTMLElement | undefined;
    const supersededRef = supersededUuidRef;
    return () => {
      const prev = supersededRef.current;
      if (prev && root) {
        const el = root.querySelector(
          `.par-drag-handle[data-par-uuid="${prev}"]`,
        );
        if (el) el.classList.remove("is-superseded");
      }
      supersededRef.current = null;
    };
  }, [editorRef]);

  // ---------------------------------------------------------------------------
  // Click / lift gesture
  // ---------------------------------------------------------------------------

  const poppedRef = useRef(popped);
  useEffect(() => {
    poppedRef.current = popped;
  }, [popped]);
  const dragHandleMenu = useDragHandleMenu();
  const dragHandleMenuRef = useRef(dragHandleMenu);
  useEffect(() => {
    dragHandleMenuRef.current = dragHandleMenu;
  }, [dragHandleMenu]);

  useEffect(() => {
    const handleEl = handleElRef.current;
    if (!handleEl) return;
    const onMouseDown = (downEv: MouseEvent) => {
      if (downEv.button !== 0) return;
      downEv.preventDefault();
      downEv.stopPropagation();
      const editor = editorRef.current;
      if (!editor) return;
      // Use the last-known ref so the gesture survives a brief focus
      // loss (clicking the portaled handle outside the contenteditable
      // can collapse the live selection in some browsers).
      const startRef = lastRefRef.current;
      if (!startRef) return;
      // Refuse to lift if the resolved popout is already open (matches
      // legacy per-NodeView behavior — the user closes the float via
      // its X button rather than re-grabbing).
      const tentativeKey = legacyPopoutKey(startRef);
      if (tentativeKey && poppedRef.current?.isPopped(tentativeKey)) {
        // Still allow click-to-open-menu below; just no lift.
      }
      handleEl.classList.add("is-pressed");
      const startX = downEv.clientX;
      const startY = downEv.clientY;
      let triggered = false;

      const onMove = (mv: MouseEvent) => {
        if (triggered) return;
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        if (dx * dx + dy * dy < LIFT_THRESHOLD * LIFT_THRESHOLD) return;
        triggered = true;

        const ref = lastRefRef.current ?? startRef;
        const sizeKind: TextObjectKind | "selection" =
          ref.kind === "selection" ? "selection" : ref.kind;
        const { width, height } = floatSizeFor(sizeKind);
        const spawn = {
          x: Math.round(mv.clientX - width / 2),
          y: Math.round(mv.clientY - SPAWN_CURSOR_OFFSET_Y),
          width,
          height,
        };

        if (ref.kind === "selection") {
          // Legacy selection-float path — Phase E hydrates via
          // linkedAnchor and deletes selection-floats.ts.
          const docSize = editor.state.doc.content.size;
          const safeFrom = Math.max(0, Math.min(ref.from, docSize));
          const safeTo = Math.max(0, Math.min(ref.to, docSize));
          if (safeFrom >= safeTo) {
            cleanup();
            return;
          }
          const slice = editor.state.doc.slice(safeFrom, safeTo);
          const contentJson = {
            type: "doc",
            content: [{ type: "paragraph", content: slice.content.toJSON() }],
          };
          const text = editor.state.doc.textBetween(safeFrom, safeTo, " ");
          const id = generateShortId();
          registerSelectionFloat(id, {
            range: { from: safeFrom, to: safeTo },
            contentJson,
            paragraphId: ref.paragraphId,
            text,
          });
          const cardKey = `selection:${id}`;
          setCardLiftHandoff({
            cardKey,
            clientX: mv.clientX,
            clientY: mv.clientY,
            width,
            height,
          });
          poppedRef.current?.popOutAtRect(cardKey, spawn);
          cleanup();
          return;
        }

        // TextObjectRef path. Use the legacy popout key for kinds that
        // have a float today (paragraph / heading / list / texBlock /
        // exampleBlock); skip lift for kinds without (Phase D5 wires
        // their float bodies via the registry).
        const cardKey = legacyPopoutKey(ref);
        if (!cardKey) {
          cleanup();
          return;
        }
        if (poppedRef.current?.isPopped(cardKey)) {
          cleanup();
          return;
        }
        // Best-effort: highlight the source block's wrapper before the
        // float spawns. Locate the wrapper via the editor's DOM lookup.
        const wrapperRect = handleEl.getBoundingClientRect();
        setCardLiftTarget({
          cardKey,
          rect: {
            left: wrapperRect.left,
            top: wrapperRect.top,
            width: wrapperRect.width,
            height: wrapperRect.height,
          },
        });
        window.setTimeout(() => setCardLiftTarget(null), 150);
        setCardLiftHandoff({
          cardKey,
          clientX: mv.clientX,
          clientY: mv.clientY,
          width,
          height,
        });
        poppedRef.current?.popOutAtRect(cardKey, spawn);
        cleanup();
      };

      const onUp = () => {
        // No lift — treat as a click and open the action menu.
        if (!triggered) {
          const open = dragHandleMenuRef.current?.open;
          const ref = lastRefRef.current ?? startRef;
          if (open && ref) {
            // Hydrate the source block's uuid lazily for refs whose id
            // might still be null (e.g. a fresh empty paragraph the user
            // just typed into). SelectionRefs already carry a hydrated
            // paragraphId from the resolver.
            if (ref.kind !== "selection") {
              const ed = editorRef.current;
              if (ed && !ref.id) {
                // No id resolved — skip.
                cleanup();
                return;
              }
            }
            const rect = handleEl.getBoundingClientRect();
            open(ref, rect);
          }
        }
        cleanup();
      };
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        handleEl.classList.remove("is-pressed");
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    handleEl.addEventListener("mousedown", onMouseDown);
    return () => {
      handleEl.removeEventListener("mousedown", onMouseDown);
    };
  }, [editorRef, placement.visible]);

  // Click-to-ensure-anchor-uuid fast path: when the user clicks the
  // handle on a fresh paragraph that has no uuid yet, we need to mint
  // one before the menu opens. Wire this through the same `useEffect`
  // above by checking the ref at click time. (Done inline above.)
  void ensureAnchorUuid;

  if (!placement.visible) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={handleElRef}
      className="text-object-grab-handle"
      style={{ position: "fixed", left: placement.left, top: placement.top }}
      title="Drag to pop out, click for actions"
      aria-hidden="true"
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>,
    document.body,
  );
}
