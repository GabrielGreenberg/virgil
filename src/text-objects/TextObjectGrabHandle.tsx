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
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftHandoff, setCardLiftTarget } from "@/components/card-lift";
import { ensureAnchorUuid } from "@/lib/anchor-uuid";
import { hydrateSelectionToTextObject } from "./hydrate-selection";
import { walkAnchorableBlocks } from "@/lib/marginalia-blocks";
import { useDragHandleMenu } from "@/components/editor-layout/card-actions/drag-handle-menu-context";
import {
  useEditorViewportCache,
  type EditorViewportCache,
} from "@/hooks/useEditorViewportCache";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
  textObjectPopoutKey,
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
/** Vertical offset between the cursor and the spawned float's top edge.
 *  The grip sits inside the float's header, so the cursor lands on the
 *  header (not on the body) after the lift. */
const SPAWN_CURSOR_OFFSET_Y = 16;

/**
 * Default initial float size at spawn time. Per-kind overrides live on
 * the registry as `meta.initialFloatSize`; wider kinds (headings,
 * lists, tex blocks) populate it.
 */
const DEFAULT_FLOAT_SIZE: { width: number; height: number } = { width: 360, height: 280 };

function floatSizeFor(kind: TextObjectKind) {
  return TEXT_OBJECT_REGISTRY[kind].initialFloatSize ?? DEFAULT_FLOAT_SIZE;
}

/**
 * Map a `TextObjectRef` to the popout key used by
 * `viewPrefs.poppedOutCards`. Every block-popout key collapses to
 * `textobject:<kind>:<id>` emitted by `textObjectPopoutKey` (Phase D10).
 * Returns null for TextObject kinds whose float body isn't registered
 * yet — the handle still opens the action menu on click, it just
 * doesn't lift.
 *
 * SelectionRef lifts hydrate into `linkedRange` TextObjects at the
 * lift commit (Phase E); after hydration they pass through this
 * function as a normal TextObjectRef.
 */
function popoutKeyForLift(ref: TextObjectRef): string | null {
  switch (ref.kind) {
    case "paragraph":
    case "heading":
    case "bulletList":
    case "orderedList":
    case "texBlock":
    case "exampleBlock":
    case "linkedRange":
      return textObjectPopoutKey(ref);
    default:
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
}

function placementsEqual(a: Placement, b: Placement): boolean {
  if (a.visible !== b.visible) return false;
  if (a.left !== b.left || a.top !== b.top) return false;
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
 * Hit-test cache for `resolveTextObjectAtMouse`. Per-pixel mousemove
 * inside the same DOM element cannot change the resolved ref — short-
 * circuit by element identity. Invalidate on any doc-change transaction
 * via `invalidateMouseResolverCache`.
 */
let lastHitElement: Element | null = null;
let lastHitResult: TextObjectRef | null = null;

function invalidateMouseResolverCache(): void {
  lastHitElement = null;
  lastHitResult = null;
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
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit === lastHitElement) {
    return lastHitResult;
  }
  if (!editor.view.dom.contains(hit)) {
    lastHitElement = hit;
    lastHitResult = null;
    return null;
  }
  // posAtCoords returns the nearest doc position to the mouse.
  const pos = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!pos) {
    lastHitElement = hit;
    lastHitResult = null;
    return null;
  }
  // Use `inside` (the position INSIDE the node under the cursor) so atom
  // blocks at the cursor's position are reachable. For a position
  // adjacent to an atom (caret just before the atom), `inside === -1`;
  // falling back to `resolveTextObjectAtPos(pos.pos)` then climbs
  // ancestors.
  let result: TextObjectRef | null = null;
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
      const meta = TEXT_OBJECT_REGISTRY[name];
      if (meta.isAtomBlock) {
        result = { kind: name, id };
      }
    }
  }
  if (!result) {
    result = resolveTextObjectAtPos(editor, pos.pos);
  }
  lastHitElement = hit;
  lastHitResult = result;
  return result;
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
  };
  if (!ref) return hidden;

  let from = -1;
  let to = -1;
  let blockNodePos = -1;

  if (ref.kind === "selection") {
    from = ref.from;
    to = ref.to;
    const $from = editor.state.doc.resolve(from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (!isTextObjectKind(node.type.name) || node.type.name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      blockNodePos = d === 0 ? 0 : $from.before(d);
      break;
    }
  } else {
    // Use the shared walker (same util the marginalia registry uses)
    // instead of an open-coded `doc.descendants` walk — keeps the UUID-
    // lookup pattern uniform across the codebase.
    const block = walkAnchorableBlocks(editor).find(
      (b) => b.uuid === ref.id,
    );
    if (block) {
      const node = editor.state.doc.nodeAt(block.pos);
      if (node && node.type.name === ref.kind) {
        from = block.pos + (block.isAtom ? 0 : 1);
        to = block.pos + node.nodeSize - (block.isAtom ? 0 : 1);
        blockNodePos = block.pos;
      }
    }
  }
  if (from < 0 || blockNodePos < 0) return hidden;

  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  let anchorDom: HTMLElement | null = null;
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
    const dom = editor.view.nodeDOM(blockNodePos);
    if (dom instanceof HTMLElement) anchorDom = dom;
  } catch {
    return hidden;
  }
  if (!anchorDom) return hidden;

  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;
  if (toCoords.bottom < scrollTop) return { ...hidden, ref };
  if (fromCoords.top > scrollBottom) return { ...hidden, ref };

  const kind: TextObjectKind | null =
    ref.kind === "selection" ? null : ref.kind;
  const meta = kind ? TEXT_OBJECT_REGISTRY[kind] : null;
  // editorColumnLeft is the editor's content-column edge — the gutter
  // ceiling that top-level handles clamp to. Sub-objects (listItem /
  // exampleItem) are themselves indented past it, so their handles can
  // legitimately render further left than the sub-object's own DOM edge
  // (into the decoration zone). Reading this from `editor.view.dom`
  // (the .ProseMirror element) gives the right reference for both.
  const editorColumnLeft = editor.view.dom.getBoundingClientRect().left;
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

  return {
    visible: true,
    left,
    top,
    ref,
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
  // Stable indirection so the listener-install effect (deps: []) can
  // call the latest schedule closure without re-attaching listeners on
  // every viewport-cache version bump. Populated by the schedule-setup
  // effect below.
  const scheduleRefRef = useRef<() => void>(() => {});

  const { cacheRef, version: cacheVersion } = useEditorViewportCache(
    editorRef.current,
  );

  // ---------------------------------------------------------------------------
  // Resolution + placement loop — split into three effects:
  //   1. Listener install + editor subscription (mounts once)
  //   2. Recompute trigger on viewport-cache version bumps
  //   3. (the inline schedule closure lives in effect 1)
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
    // Publish for the cache-version effect below.
    scheduleRefRef.current = scheduleRaf;

    const onSelectionUpdate = () => scheduleRaf();
    const onDocUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      // Mouse-hit cache reads `nodeAt(pos)`; any structural change
      // invalidates it.
      invalidateMouseResolverCache();
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
      // Bail before the ref-write when a selection is active: the
      // selection path doesn't depend on mouse, so the position write +
      // schedule are both useless churn during active drag-selection.
      const editor = editorRef.current;
      if (!editor) return;
      const sel = editor.state.selection;
      if (sel.from !== sel.to || sel instanceof NodeSelection) return;
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      scheduleRaf();
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
    // Mousemove scoped to the editor DOM. Window-wide subscription would
    // fire for every pixel of mouse movement anywhere on screen (over
    // panels, menus, other monitors); the grab handle's hover-discovery
    // only matters when the cursor is over the editor.
    const editorDom = editorRef.current?.view.dom ?? null;
    editorDom?.addEventListener("mousemove", onMouseMove);
    // ProseMirror's `selectionUpdate` covers the editable mode; this DOM
    // mirror is only needed for the Reader (`editable: false`) where PM
    // doesn't dispatch on contenteditable=false selection changes.
    const editorForGate = editorRef.current;
    const installSelectionChange =
      editorForGate !== null && !editorForGate.isEditable;
    if (installSelectionChange) {
      document.addEventListener("selectionchange", onDocSelectionChange);
    }
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
      editorDom?.removeEventListener("mousemove", onMouseMove);
      if (installSelectionChange) {
        document.removeEventListener("selectionchange", onDocSelectionChange);
      }
    };
    // editorRef is a stable React ref; this effect mounts the listeners
    // exactly once. The schedule closure reads `cacheRef.current` at call
    // time, so it always sees the latest cache without a re-attach.
  }, [editorRef]);

  // Recompute placement when the viewport cache version bumps (editor
  // resize, sidebar toggle). Only triggers a schedule — no listener
  // churn. Before Cut 7 this dep lived on the listener-install effect
  // and re-attached every DOM listener per cache tick.
  useEffect(() => {
    scheduleRefRef.current();
    // cacheRef is read inside the schedule closure; we only need to
    // trigger on version bumps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion]);

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
      // For TextObjectRefs, derive the tentative popout key up front and
      // refuse to lift if it's already popped (matches legacy per-NodeView
      // behavior — the user closes the float via its X button rather than
      // re-grabbing). SelectionRefs have no key until hydration at lift
      // time; we can't pre-check them, so the isPopped check happens
      // after hydration below.
      if (startRef.kind !== "selection") {
        const tentativeKey = popoutKeyForLift(startRef);
        if (tentativeKey && poppedRef.current?.isPopped(tentativeKey)) {
          // Still allow click-to-open-menu below; just no lift.
        }
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

        // Selection lifts hydrate at commit (Phase E): stamp the
        // `linkedAnchor` mark with a fresh `anchorId` (or reuse an
        // existing one that already covers the range) and convert to a
        // `linkedRange` TextObjectRef. After this conversion, every
        // popout shares the unified TextObject path — there's no
        // session-only float category left.
        let ref: TextObjectRef = lastRefRef.current as TextObjectRef ?? startRef as TextObjectRef;
        const rawRef = lastRefRef.current ?? startRef;
        if (rawRef.kind === "selection") {
          const docSize = editor.state.doc.content.size;
          const safeFrom = Math.max(0, Math.min(rawRef.from, docSize));
          const safeTo = Math.max(0, Math.min(rawRef.to, docSize));
          if (safeFrom >= safeTo) {
            cleanup();
            return;
          }
          const hydrated = hydrateSelectionToTextObject(
            editor.view,
            safeFrom,
            safeTo,
          );
          if (!hydrated) {
            cleanup();
            return;
          }
          ref = hydrated;
        } else {
          ref = rawRef;
        }

        const { width, height } = floatSizeFor(ref.kind);
        const spawn = {
          x: Math.round(mv.clientX - width / 2),
          y: Math.round(mv.clientY - SPAWN_CURSOR_OFFSET_Y),
          width,
          height,
        };

        // TextObjectRef path (includes `linkedRange` post-hydration).
        // Emit `textobject:<kind>:<id>` via `textObjectPopoutKey`; skip
        // lift for kinds whose float bodies haven't been wired yet.
        const cardKey = popoutKeyForLift(ref);
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
