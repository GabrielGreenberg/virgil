"use client";

/**
 * LiftHost — the shared owner of the lifted-overlay ghost gesture.
 *
 * The post-threshold "lifted-overlay" core (a translucent clone of a block
 * following the cursor, flipping ghost↔popout as the cursor leaves/enters the
 * content zone) used to live entirely inside `TextObjectGrabHandle`'s
 * `beginGesture` as local React state. That made the grab handle the ONLY
 * producer — a second producer in a different subtree (the popped-out
 * text-object float's `FloatChrome` drop button — Chip 2) could not drive the
 * same ghost machinery.
 *
 * This host hoists exactly that core out:
 *   - It owns the single `overlay` React state and renders `{overlay &&
 *     <LiftedTextOverlay …/>}` once (the render moved OUT of the grab handle).
 *   - It exposes `beginLift(opts)` through context — the POST-THRESHOLD core
 *     extracted verbatim from `beginGesture`: given a resolved `TextObjectRef`
 *     + `cardKey` + `origin` + `terminalPolicy`, it resolves the anchor DOM,
 *     computes the source rect / ghost content / label / capped height via the
 *     registry hooks, starts a drop session, installs the window
 *     mousemove/mouseup/mouseleave listeners, and drives `setOverlay`.
 *   - `terminalPolicy` selects between the two terminal behaviors (see
 *     `LiftOptions` / `beginLift` below).
 *
 * KEYSTROKE SANCTITY (AGENTS.md): the host installs NO `editor.on('update' |
 * 'transaction')` subscriber. The overlay state mutates only while a lift
 * gesture is in flight (gesture-driven window listeners), so a plain keystroke
 * triggers zero work here and never re-renders the provider — `overlay` stays
 * `null` between gestures, so the provider's render output is referentially
 * stable.
 *
 * Mount point: `EditorPane`, just inside the `PoppedCardsContext.Provider`
 * (alongside `DropModeProvider` / `FloatHost`). That's the lowest common
 * ancestor that both renders `VirgilEditor` (→ `TextObjectGrabHandle`, the
 * Chip-1 consumer) AND `FloatHost` (→ `FloatWindow`/`FloatChrome`, the Chip-2
 * consumer), and where `usePoppedCards()` / `useEditorChrome()` resolve and
 * the shared `editorRef` (`innerRef`) is in scope.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/react";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
} from "@/components/drop-mode/controller";
import { removeTransientAnchor } from "@/links/links";
import { resolveDomForUuid } from "@/lib/marginalia-blocks";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { useEditorViewportCache } from "@/hooks/useEditorViewportCache";
import {
  TEXT_OBJECT_REGISTRY,
  capPopoutHeight,
} from "./text-object-registry";
import {
  FLOAT_DEFAULT_SIZE,
  CARD_FLOAT_HEADER_H,
  TEXT_FLOAT_BODY_PAD_X,
  TEXT_FLOAT_BODY_PAD_Y,
  TEXT_FLOAT_BORDER,
} from "@/floats/float-policy";
import { LiftedTextOverlay } from "./LiftedTextOverlay";
import type { TextObjectKind, TextObjectRef } from "./types";

/** Vertical offset between the cursor and the spawned float's top edge on the
 *  concurrent-delete fallback. The grip sits inside the float's header, so the
 *  cursor lands on the header (not on the body) after the lift. */
const SPAWN_CURSOR_OFFSET_Y = 16;
/** Issue-13: viewport inset for the released popout's bottom-fit clamp, so a
 *  height-capped lifted popout always lands fully on screen. Mirrors
 *  FloatingCards' auto-fit `adjustedY` margin (20) and the `innerHeight - 40`
 *  fit convention in FloatingPanel — the popout's top and bottom stay at
 *  least this far inside the viewport. */
const SPAWN_FIT_MARGIN = 20;

/** Popout chrome dimensions used by the lifted-overlay path (L1.12).
 *
 *  The lifted-overlay model treats the text content's absolute viewport
 *  position as invariant across ghost → popout overlay → real popout;
 *  chrome grows OUTWARD when modes change, the text never moves. These
 *  encode the real popout's chrome so the overlay's outer rect in popout
 *  mode and the `popOutAtRect` spawn rect can both be sized to produce a
 *  body-content rect that lands at exactly the ghost's text rect.
 *
 *  All read from float-policy (the one home for float chrome metrics) —
 *  no hand-mirrored values:
 *   - header: the `FloatChrome` `h-6` strip → CARD_FLOAT_HEADER_H
 *   - body padding: the `par-float-body` wrappers' shared
 *     TEXT_FLOAT_BODY_PAD_CLASS (px-8 py-4) → TEXT_FLOAT_BODY_PAD_X/Y
 *   - border: the `--pod-border` 1px window border → TEXT_FLOAT_BORDER
 *  (`.lifted-text-overlay__body`'s popout-mode padding rule in globals.css
 *  still mirrors the padding by hand — CSS can't import TS.) */
const POPOUT_HEADER_HEIGHT = CARD_FLOAT_HEADER_H;
const POPOUT_BODY_PADDING_X = TEXT_FLOAT_BODY_PAD_X;
const POPOUT_BODY_PADDING_Y = TEXT_FLOAT_BODY_PAD_Y;
/** Released-popout card border, one side, in px (L3b.3). The real float
 *  (`FloatingPanel` surface="card") is `box-sizing: border-box` with
 *  `border: var(--pod-border)` (1px each side), so its body content rect is
 *  `outerRect − 2*border − 2*padding` per axis — the same 1px-each-side
 *  deficit the lifted overlay has in popout mode. The `popOutAtRect` spawn
 *  below compensates so the released float's body text lands at exactly
 *  `sourceWidth × sourceHeight`, matching the ghost AND the drag-popout
 *  overlay (no re-wrap across the whole gesture). */
const POPOUT_BORDER = TEXT_FLOAT_BORDER;

/** When a button-initiated ("float") lift has no block to grab under the
 *  cursor (the cursor is on the FloatChrome drop button, not on the block),
 *  the ghost trails the cursor by this fixed top-left offset so it reads as
 *  "in your hand" rather than pinned under the pointer. Tune later (Chip 2). */
const FLOAT_GRAB_OFFSET_X = 12;
const FLOAT_GRAB_OFFSET_Y = 12;

/**
 * Default initial float size at spawn time — the subsystem-wide
 * `FLOAT_DEFAULT_SIZE` (float-policy), reshaped to the registry's
 * `{width, height}` vocabulary. Per-kind overrides live on the registry
 * as `meta.initialFloatSize`; wider kinds (headings, lists, tex blocks)
 * populate it.
 */
const DEFAULT_FLOAT_SIZE: { width: number; height: number } = {
  width: FLOAT_DEFAULT_SIZE.w,
  height: FLOAT_DEFAULT_SIZE.h,
};

function floatSizeFor(kind: TextObjectKind) {
  return TEXT_OBJECT_REGISTRY[kind].initialFloatSize ?? DEFAULT_FLOAT_SIZE;
}

/**
 * Resolve the source block's DOM element for a `TextObjectRef` — O(1) via
 * the `data-uuid` decoration (`resolveDomForUuid`), the SAME element the
 * placement path uses. The resulting element is what the lifted-overlay
 * clones at threshold cross. Returns null when the source is missing
 * (concurrent delete) or its kind no longer matches the ref — the
 * lifted-overlay gesture degrades to a popout-release at the overlay's
 * current rect in that case.
 */
function resolveAnchorDom(
  editor: Editor,
  ref: TextObjectRef,
): HTMLElement | null {
  const dom = resolveDomForUuid(editor, ref.id);
  if (!dom) return null;
  // Validate kind via the decoration attr (defends against a concurrent
  // delete + uuid reuse) — equivalent to the old `node.type.name !== ref.kind`
  // guard, without a doc walk.
  if (dom.getAttribute("data-text-object-kind") !== ref.kind) return null;
  return dom;
}

/**
 * Live state for an in-flight lifted-overlay gesture. The host holds one of
 * these as React state while the gesture is active; mutating it during the
 * gesture is done via `setOverlay({...})` so React renders the overlay with
 * the new cursor coords + mode. The `cardKey` is captured at threshold-cross
 * so `onUp` can spawn the popout without re-resolving.
 */
interface OverlayState {
  ref: TextObjectRef;
  cardKey: string;
  /** Null for a mark-backed range kind (`linkedRange`, L3f-2) — the overlay
   *  renders `ghostContent` (the extracted range) instead of cloning an
   *  anchor element. Non-null for every element kind. */
  anchorDom: HTMLElement | null;
  /** Overridden ghost content (L3-Headings). Resolved once at threshold
   *  cross via `meta.renderGhost?.(anchorDom, editor, ref)` — heading's
   *  whole-section clone. Null for kinds without the hook (or a lone
   *  heading), in which case the overlay clones `anchorDom`. Threaded to
   *  `LiftedTextOverlay` as a prop so the overlay stays kind-agnostic. */
  ghostContent: HTMLElement | null;
  /** Cursor offset within the source's rendered rect — fixed for the
   *  gesture's lifetime so the source visual stays "stuck" to the user's
   *  grab point. */
  grabOffsetX: number;
  grabOffsetY: number;
  /** Source rect captured ONCE at threshold-cross. */
  sourceWidth: number;
  sourceHeight: number;
  /** Live cursor coords, updated every mousemove. */
  cursorX: number;
  cursorY: number;
  /** Live chrome mode, flipped by `containsContentZone(cursor)`. */
  mode: "ghost" | "popout";
  /** Header label for the overlay's popout-mode chrome. Resolved at
   *  threshold cross via `meta.computeLabel?.(editor, ref) ?? meta.label`
   *  (L3a) so per-level / per-variant overrides (heading → "Chapter" /
   *  "Section" / "Subsection") match the real popout's
   *  `setHeaderLabel` at release handoff. Pinned for the gesture — the
   *  attrs that drove the computation can't change mid-gesture since
   *  the user holds the mouse. */
  label: string;
  /** View-toggle class tokens (dividers / hide-* / divider-width) for the
   *  overlay ROOT, so the drag ghost honors the same show/hide state the
   *  page shows. Built from `viewToggleClasses(menuBar)` — the ONE source
   *  the page column and every float body also consume (Issue-12) — and
   *  pinned at threshold cross (toggle state can't change mid-gesture since
   *  the user holds the mouse, same rationale as `label`). */
  viewToggleCls: string;
}

/**
 * The terminal behavior of a lift gesture, chosen by the producer:
 *
 *  - `"grab"` (the in-editor gutter grab handle): ghost-over-content commits a
 *    doc MOVE (`commitDropSession`); ghost-OUT-of-content enters "popout" mode
 *    and on release CANCELS the session + SPAWNS a real float at the overlay's
 *    rect (the chrome-offset math). The legacy grab-handle behavior — preserved
 *    byte-for-byte.
 *
 *  - `"float"` (the popped-out float's drop button — Chip 2): ghost-ONLY. The
 *    gesture never enters the popout terminal and never spawns a float (one is
 *    already open). Over content → `commitDropSession` (moves the block; the
 *    move spec's `postDrop: "close"` closes the originating float). Outside
 *    content / null placement → `cancelDropSession` (no-op; the existing float
 *    stays open).
 */
export type LiftTerminalPolicy = "grab" | "float";

/**
 * Options for {@link LiftHostApi.beginLift} — the POST-THRESHOLD core. The
 * producer resolves the ref (a `SelectionRef` is hydrated to a `linkedRange`
 * `TextObjectRef` first), derives the `cardKey`, and supplies the cursor
 * `origin` and the terminal `policy`.
 */
export interface LiftOptions {
  /** The resolved text object being lifted. A live selection must be
   *  hydrated to a `linkedRange` ref by the producer BEFORE calling. */
  ref: TextObjectRef;
  /** The popout key (`float:textobject:<kind>:<id>`) — produced by the
   *  caller via `popoutKeyForLift`. */
  cardKey: string;
  /** Cursor position at the moment the lift begins (viewport coords). For
   *  the grab handle this is the mousemove coords at threshold-cross; for a
   *  button-initiated float lift it's the button-press point. */
  origin: { x: number; y: number };
  /** Terminal behavior — see {@link LiftTerminalPolicy}. */
  terminalPolicy: LiftTerminalPolicy;
}

/** Context API exposed by {@link LiftHost} to its descendants. */
export interface LiftHostApi {
  /** Begin a lifted-overlay gesture from an already-resolved ref. Installs
   *  the window mousemove/mouseup/mouseleave listeners and drives the shared
   *  overlay until release. Idempotent guard: a no-op if a gesture is already
   *  in flight. */
  beginLift: (opts: LiftOptions) => void;
}

const LiftHostContext = createContext<LiftHostApi | null>(null);

/**
 * Consumer hook for the shared lift host. Returns `null` when no `LiftHost`
 * is mounted (Reader / tests that mount a producer in isolation) — callers
 * should tolerate that.
 */
export function useLiftHost(): LiftHostApi | null {
  return useContext(LiftHostContext);
}

interface Props {
  editorRef: RefObject<Editor | null>;
  children: ReactNode;
}

export function LiftHost({ editorRef, children }: Props) {
  // Lifted-overlay gesture state. Non-null while a lift drag is in flight;
  // null otherwise. All 16 graspable kinds drive this — L4a made the lift
  // gesture unconditional (no more per-kind staging).
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  // In-flight marker for the single-gesture guard. A ref (not the `overlay`
  // state) because `beginLift` is a stable `useCallback` — reading `overlay`
  // inside it would see the stale initial `null`. Set true synchronously at
  // gesture start, cleared in `cleanup`, so a second `beginLift` (e.g. the
  // float button firing while a grab is mid-flight) is correctly blocked.
  const inFlightRef = useRef(false);

  const { cacheRef } = useEditorViewportCache(editorRef.current);

  // usePoppedCards + chrome mirrored into refs so the imperative gesture can
  // read the latest value at threshold-cross / release without re-binding the
  // `beginLift` callback on every context bump (same idiom the grab handle
  // used). `beginLift` is stable (deps: editorRef + cacheRef) so a single
  // identity threads to both producers.
  const popped = usePoppedCards();
  const poppedRef = useRef(popped);
  useEffect(() => {
    poppedRef.current = popped;
  }, [popped]);

  // View-toggle classes (dividers / hide-* / divider-width) for the drag
  // ghost overlay. Built from the SAME `viewToggleClasses(menuBar)` source
  // the page column and every float body consume (Issue-12); `menuBar`
  // reaches here via `useEditorChrome()`. Mirrored into a ref so the
  // imperative lift gesture can pin the live value on the overlay at
  // threshold-cross.
  const chrome = useEditorChrome();
  const viewToggleClsRef = useRef(viewToggleClasses(chrome.menuBar));
  useEffect(() => {
    viewToggleClsRef.current = viewToggleClasses(chrome.menuBar);
  }, [chrome.menuBar]);

  const beginLift = useCallback(
    ({ ref, cardKey, origin, terminalPolicy }: LiftOptions) => {
      const editor = editorRef.current;
      if (!editor) return;
      // Guard: a single gesture at a time. `inFlightRef` is the in-flight
      // marker; bail if a gesture is already running.
      if (inFlightRef.current) return;

      // Live overlay state mirrored as a local closure variable so the
      // mousemove handler can mutate cursor / mode without a state-read
      // through React. We still call `setOverlay({...})` to publish to the
      // renderer; the local copy is the source of truth between events.
      let liveOverlay: OverlayState | null = null;

      // All 16 graspable kinds lift via the lifted-overlay gesture; L4a
      // retired the per-kind `liftMode` staging. Capture the source rect ONCE
      // (never re-read); mount the overlay; mousemove then drives cursor +
      // mode until release. Paragraph/heading/list/example/texBlock are
      // element kinds (anchorDom present); linkedRange is a mark-backed RANGE.
      const meta = TEXT_OBJECT_REGISTRY[ref.kind];
      const anchorDom = resolveAnchorDom(editor, ref);
      // L3f-2: a mark-backed RANGE kind (`linkedRange`) has no single anchor
      // element — `resolveAnchorDom` is null BY DESIGN. Instead of bailing,
      // drive the overlay from the registry hooks with `anchorDom=null`:
      // `renderGhost` extracts the marked range's DOM, `liftSourceRect` unions
      // its client rects. The element path (anchorDom present) is
      // byte-for-byte unchanged: `liftRect` still defaults to
      // `anchorDom.getBoundingClientRect()`, `ghostContent` is null unless the
      // kind defines `renderGhost`, and it never takes the range-only bail
      // clause below (isRange === false).
      const isRange = meta.isRange === true;
      // L3-Headings: two kind-agnostic registry hooks each replace one
      // hardcoded assumption about a lifted ghost — that its content is
      // exactly `anchorDom` and its rect exactly anchorDom's bounding rect.
      // `liftSourceRect` overrides the captured source rect; `renderGhost`
      // overrides the cloned content. Heading uses both (the WHOLE SECTION);
      // linkedRange uses both (the marked RANGE). Resolved HERE at the host
      // (editor / meta / ref / cache all in scope) and threaded down as props,
      // so `LiftedTextOverlay` stays kind-agnostic — no registry import, no
      // editor prop. Absent on a kind (or null for a lone heading) → the
      // defaults stand, so the prior lifted kinds are byte-identical. ONE
      // capture site: the (possibly capped) sourceHeight feeds both the ghost
      // AND the popOutAtRect spawn, so the released popout opens at the same
      // height. `liftRect` is a structural {left,top,width,height} OR a
      // DOMRect — both expose those four; read only those. For a range there
      // is no anchorDom default, so the hook must resolve (null → the bail
      // below).
      const liftRect =
        meta.liftSourceRect?.(anchorDom, editor, ref, cacheRef.current) ??
        anchorDom?.getBoundingClientRect() ??
        null;
      const ghostContent = meta.renderGhost?.(anchorDom, editor, ref) ?? null;
      if (!liftRect || (isRange && !ghostContent)) {
        // Fall back to the legacy cursor-centered spawn so the gesture still
        // produces a popout instead of silently dropping: an element whose DOM
        // vanished at threshold (decision §9 — no rect), or a range whose
        // mark/DOM couldn't be resolved (no rect, or a null ghost that would
        // mount empty). Element kinds always have a rect here, so for them
        // this is IDENTICAL to the prior `!anchorDom` bail — it only fires on
        // a concurrent delete.
        //
        // For the "float" policy a float is ALREADY open, so there is nothing
        // to spawn — bail silently (the open float stays put). Only the "grab"
        // policy spawns the legacy fallback popout.
        if (terminalPolicy === "grab") {
          const { width, height } = floatSizeFor(ref.kind);
          const legacySpawn = {
            x: Math.round(origin.x - width / 2),
            y: Math.round(origin.y - SPAWN_CURSOR_OFFSET_Y),
            width,
            height,
          };
          poppedRef.current?.popOutAtRect(cardKey, legacySpawn);
        }
        return;
      }
      // Issue-13: cap the captured source height to a viewport fraction
      // (POPOUT_MAX_VH) at this SINGLE capture site, so EVERY lifted kind's
      // ghost AND released popout fit on screen (the float body scrolls the
      // overflow). A MAX, not a floor: short content (liftRect.height < cap)
      // is unchanged. Because this one capped height feeds both the ghost
      // (overlay sized to sourceHeight) and the popOutAtRect spawn (height =
      // sourceHeight + chrome), the two stay identical — no size jump on
      // release (the L1.12 text-stays-still / chrome-grows-outward invariant
      // holds). Left/top/width untouched, so the grab offset is unchanged.
      const cappedSourceHeight = capPopoutHeight(
        liftRect.height,
        window.innerHeight,
      );
      // The grab offset is the cursor's position WITHIN the source rect. For
      // a "grab" lift the cursor is on the block (origin lands inside the
      // rect), so `origin − liftRect` is the natural in-hand offset. For a
      // "float" lift the cursor is on the FloatChrome button (NOT on the
      // block), so a derived offset would place the ghost arbitrarily far from
      // the cursor; use a small fixed top-left offset so the ghost trails the
      // cursor sensibly (tune later — Chip 2).
      const grabOffsetX =
        terminalPolicy === "float"
          ? FLOAT_GRAB_OFFSET_X
          : origin.x - liftRect.left;
      const grabOffsetY =
        terminalPolicy === "float"
          ? FLOAT_GRAB_OFFSET_Y
          : origin.y - liftRect.top;
      // The "float" policy is ghost-ONLY (never a popout terminal — a float is
      // already open), so its overlay must MOUNT in "ghost" mode regardless of
      // where the origin lands. The press origin is on the float HEADER (the
      // FloatChrome drop button), which sits OUTSIDE `.editor-pane-pod`, so
      // `containsContentZone(origin)` is false there — leaving this unguarded
      // would wrongly mount the float lift in "popout" mode, contradicting the
      // ghost-only contract (the dormant Chip-1 branch's latent bug). The
      // `onMove`/`onDocLeave`/`onUp` float branches are already policy-gated to
      // ghost-only; this closes the mount-time gap. The "grab" policy keeps
      // computing initialMode from the live hit-test exactly as before.
      const initialMode: "ghost" | "popout" =
        terminalPolicy === "float"
          ? "ghost"
          : cacheRef.current.containsContentZone(origin.x, origin.y)
            ? "ghost"
            : "popout";
      // L3a: per-instance label override via the registry. Heading maps
      // node.attrs.level → "Chapter" / "Section" / "Subsection" so the
      // overlay's popout-mode header matches the real popout at handoff
      // (rather than the static "Heading"). Other kinds either don't define
      // computeLabel or return null, in which case we fall through to
      // `meta.label`.
      const computed = meta.computeLabel?.(editor, ref) ?? null;
      const label = computed ?? meta.label;
      liveOverlay = {
        ref,
        cardKey,
        anchorDom,
        ghostContent,
        grabOffsetX,
        grabOffsetY,
        sourceWidth: liftRect.width,
        sourceHeight: cappedSourceHeight,
        cursorX: origin.x,
        cursorY: origin.y,
        mode: initialMode,
        label,
        viewToggleCls: viewToggleClsRef.current,
      };
      // Mark the gesture in-flight only now that all the bail checks have
      // passed and we're about to install listeners + mount the overlay (the
      // early `!liftRect` fallback returns above without setting this, so it
      // doesn't wedge the guard).
      inFlightRef.current = true;
      setOverlay(liveOverlay);
      // Start a drop session ALONGSIDE the overlay. `inPlace: true` skips
      // markSourceFloat (no popout exists to dim during the ghost gesture for
      // the grab path; for the float path the existing float stays visible);
      // `externalCommit: true` skips the controller's own mouseup so this
      // handler's `onUp` can decide between commit (ghost release) and cancel
      // (popout release / no-op). The controller's hit-test + Indicator render
      // run for the full gesture lifetime; in popout mode the hit-test
      // resolves to null and the Indicator hides automatically.
      beginDropSession({
        cardKey,
        origin,
        inPlace: true,
        externalCommit: true,
      });

      const onMove = (mv: MouseEvent) => {
        // Triggered + lifted-overlay path → drive overlay cursor + mode.
        if (!liveOverlay) return;
        const inContent = cacheRef.current.containsContentZone(
          mv.clientX,
          mv.clientY,
        );
        // The "float" policy is ghost-ONLY: it never enters popout terminal
        // mode (a float is already open, there's nothing to spawn). Keep the
        // ghost rendered whether or not the cursor is over content — the
        // commit/cancel decision at release reads the live hit-test, not the
        // mode. The "grab" policy flips ghost↔popout as before.
        const mode: "ghost" | "popout" =
          terminalPolicy === "float"
            ? "ghost"
            : inContent
              ? "ghost"
              : "popout";
        liveOverlay = {
          ...liveOverlay,
          cursorX: mv.clientX,
          cursorY: mv.clientY,
          mode,
        };
        setOverlay(liveOverlay);
      };

      // Document-leave forces popout mode (decision §8) — the same defensive
      // pattern the drop-mode controller uses. If the user drags off the
      // document entirely, the gesture lands as a popout at release (rather
      // than the ambiguous ghost state). The "float" policy stays ghost-only
      // (no popout terminal), so document-leave is inert for it.
      const onDocLeave = (ev: MouseEvent) => {
        if (ev.relatedTarget != null) return;
        if (!liveOverlay) return;
        if (terminalPolicy === "float") return;
        liveOverlay = { ...liveOverlay, mode: "popout" };
        setOverlay(liveOverlay);
      };

      const onUp = async (upEv: MouseEvent) => {
        if (!liveOverlay) {
          cleanup();
          return;
        }
        const {
          cardKey: liveKey,
          grabOffsetX: gx,
          grabOffsetY: gy,
          sourceWidth,
          sourceHeight,
          cursorX,
          cursorY,
          mode,
        } = liveOverlay;
        const liveRef = liveOverlay.ref;
        // Final mode read uses the up-event coords (slightly more accurate
        // than the last mousemove if the user released between frames). Falls
        // back to the live state when the up event happens to land in the same
        // zone.
        const inContentAtUp = cacheRef.current.containsContentZone(
          upEv.clientX,
          upEv.clientY,
        );

        if (terminalPolicy === "float") {
          // Ghost-ONLY policy (Chip 2): never spawns a float. Over content →
          // commit the move; the move spec's `postDrop: "close"` closes the
          // originating float. Outside content / null placement →
          // `commitDropSession` cancels the session silently (no-op move) and
          // the still-open float stays put. (commitDropSession itself bails to
          // cancel when placement is null or classifyDrop returns "no-op", so
          // we always route through it.)
          await commitDropSession();
          // L3f-2: strip the transient (cardless, invisible) anchor minted for
          // a plain selection grab now that its move committed/cancelled — see
          // the grab branch below for the full rationale. GUARDED, so a grab
          // that reused a REAL annotation's range never deletes that note.
          if (liveRef.kind === "linkedRange") {
            removeTransientAnchor(editor, liveRef.id);
          }
          liveOverlay = null;
          setOverlay(null);
          cleanup();
          return;
        }

        // terminalPolicy === "grab" — commit the popout (popout mode) or the
        // drop-mode placement (ghost mode).
        const finalMode = inContentAtUp
          ? "ghost"
          : mode === "popout"
            ? "popout"
            : "ghost";
        if (finalMode === "popout") {
          // Cancel the drop session that was started at threshold cross — the
          // gesture's terminal action is a popout spawn, not a doc move, so
          // the controller's listeners and the Indicator (already hidden in
          // popout mode because no placement resolves outside the pod) need to
          // tear down.
          cancelDropSession();
          // L1.12: spawn the real popout with chrome-inclusive coords so its
          // body-content rect (after subtracting the header height and body
          // padding) lands at exactly the text rect the overlay was holding.
          // Without this offset the popout's header eats 24px from the top of
          // the rect, the body padding eats 16/32 from each axis, and the body
          // content lands shifted (32, 40) from where the ghost's text was — a
          // visible jump on release.
          // L3b.3: also compensate the float's 1px card border on each axis
          // (box-sizing: border-box eats it from the body content area, the
          // same deficit the overlay had), so the released float's body text
          // is sourceWidth × sourceHeight — matching the ghost AND the
          // drag-popout overlay, with no re-wrap on release.
          const overlayHeight =
            sourceHeight +
            POPOUT_HEADER_HEIGHT +
            2 * POPOUT_BODY_PADDING_Y +
            2 * POPOUT_BORDER;
          // Issue-13: clamp the spawn Y so the (now height-capped) window's
          // bottom stays on screen. Mirrors FloatingCards' auto-fit
          // `adjustedY` clamp (Math.max(20, Math.min(top, innerHeight −
          // height − 20))) and the `innerHeight - 40` fit convention in
          // FloatingPanel. With sourceHeight ≤ ~55% viewport (the capture cap)
          // plus 58px chrome, a valid Y always exists; Math.max keeps the top
          // on screen if the grab point sat near the viewport bottom.
          const spawnY = Math.max(
            SPAWN_FIT_MARGIN,
            Math.min(
              Math.round(
                cursorY -
                  gy -
                  POPOUT_HEADER_HEIGHT -
                  POPOUT_BODY_PADDING_Y -
                  POPOUT_BORDER,
              ),
              window.innerHeight - SPAWN_FIT_MARGIN - overlayHeight,
            ),
          );
          const overlayRect = {
            x: Math.round(
              cursorX - gx - POPOUT_BODY_PADDING_X - POPOUT_BORDER,
            ),
            y: spawnY,
            width: sourceWidth + 2 * POPOUT_BODY_PADDING_X + 2 * POPOUT_BORDER,
            height: overlayHeight,
          };
          poppedRef.current?.popOutAtRect(liveKey, overlayRect);
        } else {
          // Ghost-mode release: commit the move via the drop-mode placement
          // engine. The session was started at threshold cross with
          // `externalCommit: true`, so it didn't install its own mouseup —
          // this handler drives the commit. If the placement is null (cursor
          // not over a block) OR the spec's classifyDrop returns "no-op"
          // (insertPos inside source), commitDropSession ends the session
          // silently with no doc change.
          await commitDropSession();
          // L3f-2: strip the transient (cardless, invisible) anchor minted for
          // a plain selection grab now that its move committed. On an actual
          // move the marked text was deleted (the mark went with it) and the
          // inserted copy was already stripped (text-range-move); on a no-op
          // drop (self-drop / no placement) the mark still sits on the source
          // range, so this removes it. GUARDED: a no-op unless the mark is
          // truly transient, so a grab that reused a REAL annotation's range
          // never deletes that note/highlight/cut/revision. (L3f-1 deferred
          // this move/cancel cleanup; popout-close is handled by the
          // `useTransientAnchorCleanup` poppedOutCards watcher.)
          if (liveRef.kind === "linkedRange") {
            removeTransientAnchor(editor, liveRef.id);
          }
        }
        liveOverlay = null;
        setOverlay(null);
        cleanup();
      };

      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.documentElement.removeEventListener("mouseleave", onDocLeave);
        // Release the single-gesture guard so the next lift can start.
        inFlightRef.current = false;
        // Defensive: if the gesture aborted mid-overlay without committing
        // (e.g. cleanup() called between threshold-cross and onUp on the
        // lifted-overlay path), clear the overlay state so it doesn't ghost on
        // screen.
        if (liveOverlay) {
          // L3f-2: cancel/abort path (Escape mid-gesture, programmatic abort)
          // for a plain selection grab — strip its transient anchor so it
          // doesn't litter. GUARDED (no-op unless truly transient), so a grab
          // that reused a real annotation never deletes it. The committed
          // (move) and popout paths already nulled `liveOverlay` before
          // calling cleanup, so they don't double-handle here: move strips via
          // the onUp branch above, popout-close via the watcher.
          if (liveOverlay.ref.kind === "linkedRange") {
            removeTransientAnchor(editor, liveOverlay.ref.id);
          }
          liveOverlay = null;
          setOverlay(null);
        }
        // Defensive: end any drop session this gesture started.
        // `cancelDropSession` is idempotent — a no-op when no session is
        // active (committed-path, instant-popout path, or short-circuit before
        // threshold cross). Catches the Escape-mid-gesture case (controller
        // cancels itself) where the gesture handler then races to cleanup with
        // the session already gone.
        cancelDropSession();
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      document.documentElement.addEventListener("mouseleave", onDocLeave);
    },
    // `beginLift` depends only on the STABLE refs it reads through
    // (`editorRef`, `cacheRef`, plus `poppedRef` / `viewToggleClsRef` /
    // `inFlightRef`, all `useRef`). The single-gesture guard reads
    // `inFlightRef.current` — a ref, NOT the `overlay` state — precisely so
    // this callback can stay stable across gestures without going stale (a
    // `useCallback` closing over `overlay` would see the initial `null`
    // forever). `setOverlay` is a stable setter. Keeping the dep list to
    // editorRef + cacheRef pins one `beginLift` identity for both producers.
    //
    // The disable also opts this component out of React Compiler's
    // `react-hooks/refs` rule (the documented coupling — see the float-body
    // convention). That's intended here: the host reads refs by design (the
    // viewport-cache `editorRef.current` arg, the `beginLiftRef`/`apiRef`
    // stable-identity wrapper), which the rule flags as "ref access during
    // render" false positives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorRef, cacheRef],
  );

  // Keep the latest `beginLift` closure in a ref, and expose a context value
  // whose identity NEVER changes — so a provider re-render (overlay state
  // change during a gesture) doesn't re-render every consumer that read the
  // API. Consumers call `host.beginLift(...)` imperatively inside an event
  // handler, so reading the latest closure through the stable wrapper is
  // correct.
  const beginLiftRef = useRef(beginLift);
  beginLiftRef.current = beginLift;
  const apiRef = useRef<LiftHostApi | null>(null);
  if (!apiRef.current) {
    apiRef.current = {
      beginLift: (opts) => beginLiftRef.current(opts),
    };
  }

  return (
    <LiftHostContext.Provider value={apiRef.current}>
      {children}
      {overlay && (
        <LiftedTextOverlay
          ref={overlay.ref}
          anchorDom={overlay.anchorDom}
          ghostContent={overlay.ghostContent}
          grabOffsetX={overlay.grabOffsetX}
          grabOffsetY={overlay.grabOffsetY}
          sourceWidth={overlay.sourceWidth}
          sourceHeight={overlay.sourceHeight}
          cursorX={overlay.cursorX}
          cursorY={overlay.cursorY}
          mode={overlay.mode}
          label={overlay.label}
          viewToggleCls={overlay.viewToggleCls}
        />
      )}
    </LiftHostContext.Provider>
  );
}
