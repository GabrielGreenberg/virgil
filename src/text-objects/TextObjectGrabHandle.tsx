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
 * Discovery model (hover-driven, multi-level):
 *   1. Non-empty TextSelection   → one handle for the SelectionRef
 *      (text-lift gesture; hydrates to a linkedRange on lift).
 *   2. NodeSelection on a TextObject → one handle for the selected node.
 *   3. Mouse over the editor     → one handle for EVERY containing
 *      TextObject from innermost to outermost. Hovering text inside a
 *      `listItem` shows handles for both the listItem AND its parent
 *      `bulletList`. For deeper nesting (graphicsBlock inside listItem),
 *      every level gets a handle, each at its own decorationSafety indent.
 *   4. No mouse position / mouse outside editor + no handle hovered →
 *      no handles. (Cursor-based discovery is intentionally removed —
 *      the handle is a pure hover affordance, like a tooltip.)
 *
 * Mouse-leave grace: the handles are portal-rendered into document.body,
 * so moving the mouse from the editor onto a handle would fire the
 * editor's mouseleave. Handle DOM elements report their own enter/leave
 * via `mouseOverHandleRef`; the editor's leave handler defers clearing
 * `mousePosRef` until we know the mouse hasn't landed on a handle.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
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
import { computeHandleLeftEdge } from "./handle-layout";
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

/** Time after the mouse leaves the editor before handles are hidden.
 *  Long enough for the user to move from the editor onto a handle. */
const MOUSE_LEAVE_GRACE_MS = 120;

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
  /** Viewport-x of the handle's left edge. */
  left: number;
  /** Viewport-y of the handle's top edge (sticky-to-top when the source
   *  has scrolled above the viewport). */
  top: number;
  /** The resolved ref the handle represents. */
  ref: TextObjectRef | SelectionRef;
}

function placementsEqual(a: Placement, b: Placement): boolean {
  if (a.left !== b.left || a.top !== b.top) return false;
  return refsEqual(a.ref, b.ref);
}

function placementArrayEqual(a: Placement[], b: Placement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!placementsEqual(a[i], b[i])) return false;
  }
  return true;
}

function refsEqual(
  a: TextObjectRef | SelectionRef,
  b: TextObjectRef | SelectionRef,
): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "selection" && b.kind === "selection") {
    return a.from === b.from && a.to === b.to && a.paragraphId === b.paragraphId;
  }
  if (a.kind !== "selection" && b.kind !== "selection") {
    return a.id === b.id;
  }
  return false;
}

/** Stable React key for a placement's ref. */
function refKey(ref: TextObjectRef | SelectionRef): string {
  if (ref.kind === "selection") {
    return `selection:${ref.paragraphId}:${ref.from}-${ref.to}`;
  }
  return `${ref.kind}:${ref.id}`;
}

/**
 * Hit-test cache for `resolveTextObjectsAtMouse`. Per-pixel mousemove
 * inside the same DOM element cannot change the resolved ref set —
 * short-circuit by element identity. Invalidate on any doc-change
 * transaction via `invalidateMouseResolverCache`.
 */
let lastHitElement: Element | null = null;
let lastHitResult: TextObjectRef[] = [];

function invalidateMouseResolverCache(): void {
  lastHitElement = null;
  lastHitResult = [];
}

/**
 * Hit-test the mouse position against the editor's DOM to find every
 * TextObject containing the mouse, from innermost to outermost.
 *
 * Returned order:
 *   1. Atom block at `pos.inside` (if any) — innermost.
 *   2. Every ancestor along the $pos depth chain that is a TextObject
 *      with a UUID, from deepest to shallowest.
 *
 * Dedupe by id so a single atom doesn't appear twice when it's both at
 * `pos.inside` and reachable through `$pos.node(d)`.
 */
function resolveTextObjectsAtMouse(
  editor: Editor,
  clientX: number,
  clientY: number,
): TextObjectRef[] {
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit === lastHitElement) {
    return lastHitResult;
  }
  if (!hit || !editor.view.dom.contains(hit)) {
    lastHitElement = hit;
    lastHitResult = [];
    return lastHitResult;
  }
  const pos = editor.view.posAtCoords({ left: clientX, top: clientY });
  if (!pos) {
    lastHitElement = hit;
    lastHitResult = [];
    return lastHitResult;
  }

  const refs: TextObjectRef[] = [];
  const seenIds = new Set<string>();

  // Atom block at `pos.inside` — the caret can't enter atoms, so they're
  // only reachable through hover. Collect explicitly before the depth
  // walk (which still encounters them but `$pos.depth` for a position
  // inside an atom returns the atom's PARENT level, not the atom itself).
  if (pos.inside >= 0) {
    const node = editor.state.doc.nodeAt(pos.inside);
    if (node && isTextObjectKind(node.type.name) && node.type.name !== "linkedRange") {
      const id = node.attrs?.uuid as string | null;
      const meta = TEXT_OBJECT_REGISTRY[node.type.name];
      if (id && meta.isAtomBlock) {
        refs.push({ kind: node.type.name as TextObjectKind, id });
        seenIds.add(id);
      }
    }
  }

  // Walk every containing level. ProseMirror's `$pos.depth` gives us the
  // ancestor chain; iterate from innermost (depth) to outermost (0).
  const $pos = editor.state.doc.resolve(pos.pos);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    const name = node.type.name;
    if (!isTextObjectKind(name) || name === "linkedRange") continue;
    const id = node.attrs?.uuid as string | null;
    if (!id) continue;
    if (seenIds.has(id)) continue;
    refs.push({ kind: name as TextObjectKind, id });
    seenIds.add(id);
  }

  lastHitElement = hit;
  lastHitResult = refs;
  return refs;
}

/**
 * Compute placement for a single ref. Pins the handle's left edge to
 * the source block's gutter via `computeHandleLeftEdge`; pins the top
 * edge to the range's first-line top (clamped to the editor scroll
 * container's top when scrolled above the viewport).
 *
 * Returns null when the ref isn't visible (off-screen, source missing,
 * or coords lookup fails).
 */
function computePlacement(
  editor: Editor,
  cache: EditorViewportCache,
  ref: TextObjectRef | SelectionRef,
): Placement | null {
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
  if (from < 0 || blockNodePos < 0) return null;

  let fromCoords: { left: number; top: number; bottom: number };
  let toCoords: { top: number; bottom: number };
  let anchorDom: HTMLElement | null = null;
  try {
    fromCoords = editor.view.coordsAtPos(from);
    toCoords = editor.view.coordsAtPos(to);
    const dom = editor.view.nodeDOM(blockNodePos);
    if (dom instanceof HTMLElement) anchorDom = dom;
  } catch {
    return null;
  }
  if (!anchorDom) return null;

  const scrollTop = cache.scrollTop;
  const scrollBottom = cache.scrollBottom;
  // Use the anchor DOM's rect for the visibility check rather than the
  // coordsAtPos values, which return {0, 0} for some multi-line block
  // kinds (exampleBlock with deep content tree). The DOM rect is the
  // authoritative visible bounds of the block.
  const anchorRect = anchorDom.getBoundingClientRect();
  if (anchorRect.bottom < scrollTop) return null;
  if (anchorRect.top > scrollBottom) return null;

  const kind: TextObjectKind | null =
    ref.kind === "selection" ? null : ref.kind;
  const meta = kind ? TEXT_OBJECT_REGISTRY[kind] : null;
  // editorColumnLeft is the .ProseMirror element's outside-left edge —
  // the floor we clamp sub-object handles against on narrow viewports.
  // baselineInset is read from --gutter-col-handle-inset (via the
  // cache) so JS placement and CSS chrome share one source.
  const editorColumnLeft = editor.view.dom.getBoundingClientRect().left;
  const baselineInset = cache.gutterInset;
  const left = meta
    ? computeHandleLeftEdge({
        elDOM: anchorDom,
        kind: kind as TextObjectKind,
        node: editor.state.doc.nodeAt(blockNodePos) ?? undefined,
        editorColumnLeft,
        baselineInset,
        meta,
      })
    : anchorDom.getBoundingClientRect().left - baselineInset;

  // Top edge: every kind declares its vertical anchor via
  // `meta.chromeAnchor`. "text-top" measures the first glyph via Range
  // so the handle aligns with rendered text regardless of font /
  // line-height. "block-top" uses the wrapper's visual top edge — for
  // framed visual kinds (tex pod, % comment, math, graphic, figure)
  // where there's no "first line of prose" to align with.
  const anchor: "text-top" | "block-top" = meta
    ? meta.chromeAnchor
    : resolveSelectionChromeAnchor(editor, from);
  let candidateTop: number;
  if (anchor === "text-top") {
    const textTop = getTextGlyphTop(anchorDom);
    candidateTop =
      textTop != null
        ? textTop
        : fromCoords.top > 0
          ? fromCoords.top
          : anchorRect.top;
  } else {
    candidateTop = anchorRect.top;
  }
  const top = Math.max(candidateTop, scrollTop);

  return { left, top, ref };
}

/** Measure the top edge of the first rendered glyph of the block's
 *  CONTENT (not chrome) inside `anchorDom`. Used by
 *  chromeAnchor="text-top" so the grab handle aligns with the visible
 *  text cap-top regardless of font size or line-height.
 *
 *  Crucially: text inside a `contenteditable="false"` subtree is
 *  CHROME (the `+T` affordance, the "Section"/"Title"/"Author" pod
 *  labels, the `.par-title-add` button, etc.), NOT content. We skip
 *  those so the handle anchors to the actual paragraph/heading text
 *  rather than to the absolutely-positioned `+T` floating above the
 *  wrapper. */
function getTextGlyphTop(anchorDom: Element): number | null {
  const tw = document.createTreeWalker(anchorDom, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (!n.textContent || n.textContent.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = (n as Text).parentElement;
      if (parent && parent.closest('[contenteditable="false"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const firstText = tw.nextNode() as Text | null;
  if (!firstText) return null;
  try {
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(firstText, 1);
    const rect = range.getBoundingClientRect();
    return rect.top > 0 ? rect.top : null;
  } catch {
    return null;
  }
}

/** For SelectionRef (kind === null), resolve the containing
 *  TextObject's chromeAnchor by walking the PM ancestor chain. Selections
 *  inherently span text, so default to "text-top" when no containing
 *  TextObject resolves. */
function resolveSelectionChromeAnchor(
  editor: Editor,
  from: number,
): "text-top" | "block-top" {
  try {
    const $from = editor.state.doc.resolve(from);
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      const name = node.type.name;
      if (!isTextObjectKind(name) || name === "linkedRange") continue;
      if (!(node.attrs?.uuid as string | null)) continue;
      return TEXT_OBJECT_REGISTRY[name].chromeAnchor;
    }
  } catch {
    // fall through to default
  }
  return "text-top";
}

interface Props {
  editorRef: RefObject<Editor | null>;
}

export function TextObjectGrabHandle({ editorRef }: Props) {
  const popped = usePoppedCards();
  const [placements, setPlacements] = useState<Placement[]>([]);

  // Mouse position drives the hover-based discovery path. null when the
  // mouse hasn't moved over the editor (or has left and the grace period
  // elapsed without a handle hover).
  const mousePosRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // True while the pointer is over one of the rendered handle elements.
  // Read by the editor's mouseleave grace-period closure to decide
  // whether the leave really should clear the position.
  const mouseOverHandleRef = useRef(false);
  // Pending clear-mouse-pos timer from the editor's mouseleave. Cancelled
  // when the mouse re-enters the editor or arrives on a handle.
  const leaveTimerRef = useRef<number>(0);

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
  // Click / lift gesture
  //
  // Each rendered handle binds its own mousedown. The shared `beginGesture`
  // closes over a captured ref (one per handle), so a click/drag dispatches
  // to the right kind without consulting the resolver again.
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

  const beginGesture = useCallback((
    downEv: MouseEvent,
    handleEl: HTMLDivElement,
    startRef: TextObjectRef | SelectionRef,
  ) => {
    if (downEv.button !== 0) return;
    downEv.preventDefault();
    downEv.stopPropagation();
    const editor = editorRef.current;
    if (!editor) return;
    // For TextObjectRefs, derive the tentative popout key up front. If
    // already popped we still allow click-to-open-menu; just no lift.
    if (startRef.kind !== "selection") {
      const tentativeKey = popoutKeyForLift(startRef);
      if (tentativeKey && poppedRef.current?.isPopped(tentativeKey)) {
        // tentativeKey check below in the drag branch reuses this.
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

      let ref: TextObjectRef;
      if (startRef.kind === "selection") {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.max(0, Math.min(startRef.from, docSize));
        const safeTo = Math.max(0, Math.min(startRef.to, docSize));
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
        ref = startRef;
      }

      const { width, height } = floatSizeFor(ref.kind);
      const spawn = {
        x: Math.round(mv.clientX - width / 2),
        y: Math.round(mv.clientY - SPAWN_CURSOR_OFFSET_Y),
        width,
        height,
      };

      const cardKey = popoutKeyForLift(ref);
      if (!cardKey) {
        cleanup();
        return;
      }
      if (poppedRef.current?.isPopped(cardKey)) {
        cleanup();
        return;
      }
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
      // No drag → treat as a click and open the action menu for the
      // captured ref.
      if (!triggered) {
        const open = dragHandleMenuRef.current?.open;
        if (open) {
          if (startRef.kind !== "selection") {
            const ed = editorRef.current;
            if (ed && !startRef.id) {
              cleanup();
              return;
            }
          }
          const rect = handleEl.getBoundingClientRect();
          open(startRef, rect);
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
  }, [editorRef]);

  // Click-to-ensure-anchor-uuid fast path is wired through `beginGesture`'s
  // !startRef.id check above. Keep the import alive for clarity.
  void ensureAnchorUuid;

  // ---------------------------------------------------------------------------
  // Resolution + placement loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let prevEditor: Editor | null = null;
    let prevEditorDom: HTMLElement | null = null;
    const cleanupListeners = () => {
      if (prevEditor) {
        prevEditor.off("selectionUpdate", onSelectionUpdate);
        prevEditor.off("update", onDocUpdate);
      }
      if (prevEditorDom) {
        prevEditorDom.removeEventListener("mousemove", onMouseMove);
        prevEditorDom.removeEventListener("mouseleave", onMouseLeave);
      }
    };

    /**
     * Resolve the array of refs the schedule should render handles for.
     * Order (first match wins, except for hover which returns multiple):
     *   1. Non-empty TextSelection → [SelectionRef]
     *   2. NodeSelection on TextObject → [TextObjectRef]
     *   3. Mouse hover over editor → [innermost..outermost TextObjectRefs]
     *   4. Nothing → []
     */
    const resolveActiveRefs = (
      editor: Editor,
    ): Array<TextObjectRef | SelectionRef> => {
      const sel = editor.state.selection;
      // 1. Non-empty TextSelection — text-lift gesture.
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
          return [{
            kind: "selection",
            from: sel.from,
            to: sel.to,
            paragraphId,
          }];
        }
      }
      // 2. NodeSelection on a TextObject (atom blocks chiefly).
      if (sel instanceof NodeSelection) {
        const node = sel.node;
        const name = node.type.name;
        if (
          isTextObjectKind(name) &&
          name !== "linkedRange" &&
          (node.attrs?.uuid as string | null)
        ) {
          return [{ kind: name as TextObjectKind, id: node.attrs.uuid as string }];
        }
      }
      // 3. Mouse hover — every containing TextObject level.
      const mouse = mousePosRef.current;
      if (mouse) {
        return resolveTextObjectsAtMouse(editor, mouse.clientX, mouse.clientY);
      }
      // 4. No fallback (cursor-based discovery removed).
      return [];
    };

    const schedule = () => {
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) {
        setPlacements((p) => (p.length === 0 ? p : []));
        return;
      }
      const refs = resolveActiveRefs(editor);
      const next: Placement[] = [];
      for (const r of refs) {
        const p = computePlacement(editor, cacheRef.current, r);
        if (p) next.push(p);
      }
      setPlacements((prev) => (placementArrayEqual(prev, next) ? prev : next));
    };
    const scheduleRaf = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        schedule();
      });
    };
    scheduleRefRef.current = scheduleRaf;

    const onSelectionUpdate = () => scheduleRaf();
    const onDocUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      invalidateMouseResolverCache();
      scheduleRaf();
    };

    const ensureSubscribed = () => {
      const editor = editorRef.current;
      if (editor === subscribedEditorRef.current) return;
      cleanupListeners();
      subscribedEditorRef.current = editor;
      prevEditor = editor;
      prevEditorDom = editor?.view.dom ?? null;
      if (editor) {
        editor.on("selectionUpdate", onSelectionUpdate);
        editor.on("update", onDocUpdate);
      }
      if (prevEditorDom) {
        prevEditorDom.addEventListener("mousemove", onMouseMove);
        prevEditorDom.addEventListener("mouseleave", onMouseLeave);
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
      // Always-on tracking: hover is the primary discovery mechanism, so
      // the position must update during text selection / node selection
      // too. (The resolver prioritizes selection/node refs above hover,
      // so the array won't surprise during an active gesture.)
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = 0;
      }
      mousePosRef.current = { clientX: e.clientX, clientY: e.clientY };
      scheduleRaf();
    };
    const onMouseLeave = () => {
      // Defer the clear: the mouse may be landing on a portal-rendered
      // handle, which fires the editor's mouseleave. The handle's own
      // mouseenter cancels this timer.
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = 0;
        if (mouseOverHandleRef.current) return;
        mousePosRef.current = null;
        scheduleRaf();
      }, MOUSE_LEAVE_GRACE_MS);
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
    // DOM listeners (mousemove, mouseleave) attach via `ensureSubscribed`
    // so they re-attach if the editor instance is created late or swapped.
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
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = 0;
      }
      subscribedEditorRef.current = null;
      prevEditor = null;
      prevEditorDom = null;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      if (installSelectionChange) {
        document.removeEventListener("selectionchange", onDocSelectionChange);
      }
    };
  }, [editorRef]);

  // Recompute placement when the viewport cache version bumps (editor
  // resize, sidebar toggle).
  useEffect(() => {
    scheduleRefRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion]);

  // Per-handle mouseenter/leave so the editor's mouseleave grace knows
  // whether to defer the clear.
  const onHandleEnter = useCallback(() => {
    mouseOverHandleRef.current = true;
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = 0;
    }
  }, []);
  const onHandleLeave = useCallback(() => {
    mouseOverHandleRef.current = false;
    // Treat leaving the handle like leaving the editor — defer the
    // clear so the user can move back onto a different handle or back
    // into the editor.
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = 0;
      if (mouseOverHandleRef.current) return;
      // If the mouse is back over the editor DOM, mousemove will have
      // already restored mousePosRef. If not, clear.
      const editor = editorRef.current;
      if (!editor) return;
      const m = mousePosRef.current;
      if (m) {
        const overEditor = (() => {
          const el = document.elementFromPoint(m.clientX, m.clientY);
          return el ? editor.view.dom.contains(el) : false;
        })();
        if (overEditor) return;
      }
      mousePosRef.current = null;
      scheduleRefRef.current();
    }, MOUSE_LEAVE_GRACE_MS);
  }, [editorRef]);

  if (placements.length === 0) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {placements.map((p) => (
        <GrabHandleRender
          key={refKey(p.ref)}
          placement={p}
          onBeginGesture={beginGesture}
          onMouseEnter={onHandleEnter}
          onMouseLeave={onHandleLeave}
        />
      ))}
    </>,
    document.body,
  );
}

interface GrabHandleRenderProps {
  placement: Placement;
  onBeginGesture: (ev: MouseEvent, el: HTMLDivElement, ref: TextObjectRef | SelectionRef) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function GrabHandleRender({
  placement,
  onBeginGesture,
  onMouseEnter,
  onMouseLeave,
}: GrabHandleRenderProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const handler = (ev: MouseEvent) => {
      onBeginGesture(ev, el, placement.ref);
    };
    el.addEventListener("mousedown", handler);
    return () => {
      el.removeEventListener("mousedown", handler);
    };
  }, [placement.ref, onBeginGesture]);
  return (
    <div
      ref={elRef}
      className="text-object-grab-handle"
      style={{ position: "fixed", left: placement.left, top: placement.top }}
      title="Drag to pop out, click for actions"
      aria-hidden="true"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2" r="1.2" />
        <circle cx="7" cy="2" r="1.2" />
        <circle cx="3" cy="7" r="1.2" />
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="3" cy="12" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
      </svg>
    </div>
  );
}
