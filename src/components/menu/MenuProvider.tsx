"use client";

/**
 * `<MenuProvider>` — the headless owner of the `<Menu>` primitive
 * (design §2.1). Renders nothing visible itself; it:
 *   - creates ONE `MenuRegistry` and shares it via `MenuContext`;
 *   - owns the ONE `useFloatingMenuPosition` call (with the §3.3 `maxHeight`
 *     + `trackAnchor` additions) and merges its `ref` + `style` into the
 *     positioned container;
 *   - mounts the single dismissal effect (`useMenuDismiss`) and the keyboard
 *     controller (`useMenuKeyboard`);
 *   - portals to `document.body` (default) or docks inline (`portal={false}`,
 *     for MenuBar's stacking context);
 *   - publishes itself to `registryFor(id)` (the cross-backend seam) and, when
 *     nested inside a parent `<MenuProvider>`, auto-registers its container
 *     into the parent's click-outside exclude set (R8).
 *
 * The core supports list / grid / composite layouts NOW (the nav controller +
 * registry are layout-agnostic) so B2 (lightning) can mount a composite menu
 * without refactoring; B1 only wires a list menu (grab).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  useFloatingMenuPosition,
  type FloatingMenuPlacement,
} from "@/hooks/useFloatingMenuPosition";
import {
  MenuContext,
  MenuStackContext,
  createMenuStackController,
  useMenuStack,
  useOptionalMenuContext,
  type MenuContextValue,
  type MenuStackController,
} from "./context";
import { MenuRegistry, publishRegistry, unpublishRegistry } from "./registry";
import { useMenuDismiss } from "./useMenuDismiss";
import { useMenuKeyboard } from "./useMenuKeyboard";
import type {
  MenuDismissConfig,
  MenuLayout,
  MenuOrientation,
  MenuRole,
} from "./types";

interface AnchorRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MenuProviderProps {
  /** Stable menu id; activedescendant ids derive from it. */
  id: string;
  layout: MenuLayout;
  /** List stepping axis (opt-in). "horizontal" steps a `list` layout on
   *  Left/Right instead of Up/Down (a swatch row); default "vertical". Ignored
   *  for non-list layouts. */
  orientation?: MenuOrientation;
  /** For a VERTICAL `list` menu, intercept a plain Left/Right (otherwise inert)
   *  and hand it to the caller — e.g. ViewMenu group expand (Right) / collapse
   *  (Left). Receives the active node id. No effect on horizontal/grid/combobox. */
  onArrowHorizontal?: (dir: "left" | "right", activeId: string | null) => void;
  /** ARIA fork (§3.5). Default "menu". */
  role?: MenuRole;
  /** Anchor for positioning. A static rect or a thunk (caret-anchored). */
  anchorRect: DOMRect | AnchorRectLike | (() => DOMRect | AnchorRectLike | null);
  placements: FloatingMenuPlacement[];
  /** Distance anchor→menu. */
  gap?: number;
  /** Min viewport-edge margin. */
  margin?: number;
  /** Clamp menu height to available space + scroll (§3.3). */
  maxHeight?: boolean;
  /** RAF-coalesced scroll/resize re-anchor (§3.3). */
  trackAnchor?: () => DOMRect | AnchorRectLike | null;
  /** Portal to body (default true) or dock inline (false, MenuBar). */
  portal?: boolean;
  /** Enable the bare-key O(1) letter fast-path. */
  letterShortcuts?: boolean;
  /** Dismissal config (§3.2). */
  dismissOn?: MenuDismissConfig;
  /** Two-stage Escape interceptor: return true to consume without closing. */
  onEscape?: () => boolean;
  /** Extra click-outside exemptions (nested popovers / external inputs). */
  excludeRefs?: readonly (HTMLElement | null)[];
  /** The element whose aria-activedescendant mirrors the active node (the PM
   *  view's contentEditable, or a combobox input). */
  getActiveDescendantHost?: () => HTMLElement | null;
  /** Keyboard source: window-capture (default) or an owned input. */
  keyboardSource?: "window" | "input";
  /** Close callback. */
  onClose: () => void;
  /** ARIA label for the container. */
  ariaLabel?: string;
  /** Container style overrides (width / chrome). */
  containerStyle?: CSSProperties;
  /** Container className. */
  containerClassName?: string;
  /** The menu items (bespoke JSX + `<MenuItemsFromRegistry>` / `<MenuGrid>` /
   *  `<MenuList>`). */
  children: ReactNode;
}

const CHROME_Z = 2000;

function resolveRect(
  anchor: MenuProviderProps["anchorRect"],
): DOMRect | AnchorRectLike | null {
  return typeof anchor === "function" ? anchor() : anchor;
}

export function MenuProvider(props: MenuProviderProps): ReactNode {
  const {
    id,
    layout,
    orientation = "vertical",
    onArrowHorizontal,
    role = "menu",
    anchorRect,
    placements,
    gap,
    margin,
    maxHeight = false,
    trackAnchor,
    portal = true,
    letterShortcuts = false,
    dismissOn,
    onEscape,
    excludeRefs,
    getActiveDescendantHost,
    keyboardSource = "window",
    onClose,
    ariaLabel,
    containerStyle,
    containerClassName,
    children,
  } = props;

  // ── one registry per provider ──
  const [registry] = useState(() => new MenuRegistry(id, layout));
  useEffect(() => registry.setLayout(layout), [registry, layout]);
  useEffect(
    () => registry.setOrientation(orientation),
    [registry, orientation],
  );

  // ── nested-provider stack (R6) ──
  // Each provider sits one level deeper than its parent. The OUTERMOST provider
  // (parent is the -1 root sentinel → no controller yet) creates the single
  // shared `MenuStackController`; every nested provider inherits that SAME
  // instance unchanged, so the whole subtree shares one "deepest open menu"
  // source of truth.
  const parentStack = useMenuStack();
  const depth = parentStack.depth + 1;
  const [ownController] = useState<MenuStackController>(() =>
    createMenuStackController(),
  );
  const controller = parentStack.controller ?? ownController;
  const stackValue = useMemo(
    () => ({ depth, controller }),
    [depth, controller],
  );

  // Register THIS provider as open in the shared stack while it's mounted — but
  // ONLY for the window keyboard source. Input-source menus (combobox) install
  // no window listener, so they never contend for the window keydown and must
  // not push a parent window-source menu off the top while their child is open.
  // O(1): a Set add on mount + delete on unmount, off the keystroke path.
  const isWindowSource = keyboardSource === "window";
  useEffect(() => {
    if (!isWindowSource) return;
    return controller.registerOpen(depth);
  }, [controller, depth, isWindowSource]);

  // `isTop` = "this provider owns the window keydown" = a WINDOW-source provider
  // that is the deepest open window-source menu (its depth is the greatest open
  // depth). An input-source provider installs no window listener, so it is never
  // the window-keydown owner → never `isTop`. We subscribe to the controller so
  // this re-evaluates reactively when a descendant opens/closes (a single
  // boolean read in the snapshot — O(1) per change, NOT per keystroke).
  const isTop = useSyncExternalStore(
    controller.subscribe,
    () => isWindowSource && controller.topDepth() === depth,
    () => isWindowSource,
  );

  // Escape ownership is broader than window-keydown ownership: an input-source
  // combobox owns ITS OWN Escape (two-stage clear-then-close via `onEscape`)
  // even though it never owns the window keydown. The rule that scopes Escape to
  // the innermost open menu is "no window-source menu is open DEEPER than me":
  //   - window-source → `isTop` (deepest open window menu);
  //   - input-source  → no window-source descendant has pushed past my depth
  //     (`topDepth() <= depth`), preserving the single-level combobox behavior
  //     (a lone combobox with no nested window menu still dismisses on Escape).
  const ownsEscape = useSyncExternalStore(
    controller.subscribe,
    () => (isWindowSource ? controller.topDepth() === depth : controller.topDepth() <= depth),
    () => true,
  );

  // ── click-outside exclude set: caller refs + any nested provider's container ──
  const dynamicExcludes = useRef(new Set<HTMLElement>());
  const registerExclude = useCallback((el: HTMLElement | null) => {
    if (!el) return () => {};
    dynamicExcludes.current.add(el);
    return () => {
      dynamicExcludes.current.delete(el);
    };
  }, []);
  // Mirror the caller's `excludeRefs` into a ref so the STABLE `getExcludes`
  // closure (read at mousedown time by `useMenuDismiss`) always sees the latest
  // — a freshly-spawned child popover (the lightning color popover, set into
  // `excludeRefs` a render after it mounts) must be excluded immediately, not on
  // the next listener re-subscribe. Without this the dismissal effect's captured
  // closure would read a stale `excludeRefs` and self-close on a legitimate
  // click into the child (design §3.2 / R8). Updated in a layout effect (not
  // during render) so the listener reads fresh values on the next commit — the
  // same ref-sync pattern `useMenuKeyboard` uses for its options.
  const excludeRefsLatest = useRef(excludeRefs);
  useLayoutEffect(() => {
    excludeRefsLatest.current = excludeRefs;
  });
  const getExcludes = useCallback(
    () => [...(excludeRefsLatest.current ?? []), ...dynamicExcludes.current],
    [],
  );

  // Auto-register THIS container into a parent menu's exclude set (R8).
  const parentMenu = useOptionalMenuContext();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── positioning ──
  const trackThunk = useMemo(() => {
    if (trackAnchor) return trackAnchor;
    if (typeof anchorRect === "function") return anchorRect;
    return undefined;
  }, [trackAnchor, anchorRect]);
  const staticRect = useMemo(() => {
    const r = resolveRect(anchorRect);
    return r ?? null;
  }, [anchorRect]);
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect: staticRect,
    placements,
    gap,
    margin,
    maxHeight,
    trackAnchor: trackThunk,
  });

  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      positionRef(el);
    },
    [positionRef],
  );

  // ── publish to the cross-backend table (§2.3) ──
  useEffect(() => {
    publishRegistry(id, registry);
    return () => unpublishRegistry(id, registry);
  }, [id, registry]);

  // ── auto-register into the parent's exclude set on mount ──
  useEffect(() => {
    if (!parentMenu) return;
    // The container element may attach after this effect; register a tick later
    // so the ref is live.
    let cleanup = () => {};
    const t = setTimeout(() => {
      cleanup = parentMenu.registerExclude(containerRef.current);
    }, 0);
    return () => {
      clearTimeout(t);
      cleanup();
    };
  }, [parentMenu]);

  // ── dismissal ──
  useMenuDismiss({
    containerRef,
    getExcludes,
    onClose,
    escape: {
      stopPropagation: dismissOn?.escape?.stopPropagation ?? true,
      onEscape,
    },
    ownsEscape,
  });

  // ── keyboard controller ──
  // The combobox source returns `handleKeyDown` for the owned `<input>` to wire
  // onto its `onKeyDown` (§3.5); the window source returns it too but no child
  // consumes it. We expose it through context so a child input (via
  // `useMenuCombobox`) drives the controller while real focus stays in the
  // input (NO focus theft) and `aria-activedescendant` sits on the input.
  const { handleKeyDown } = useMenuKeyboard({
    registry,
    layout,
    orientation,
    onArrowHorizontal,
    letterShortcuts,
    getActiveDescendantHost,
    isTop,
    source: keyboardSource,
  });

  // The listbox container id the combobox input references via `aria-controls`
  // (§3.5). Stable + derived from the menu id so it's collision-free. Only set
  // on a `role="listbox"` menu (the combobox pattern); a `role="menu"` command
  // menu leaves the container id unset.
  const listboxId = role === "listbox" ? `${id}-listbox` : undefined;

  const ctxValue = useMemo<MenuContextValue>(
    () => ({ registry, role, registerExclude, handleKeyDown, listboxId }),
    [registry, role, registerExclude, handleKeyDown, listboxId],
  );

  if (typeof document === "undefined") return null;

  const container = (
    <div
      ref={setContainerRef}
      role={role}
      // The listbox container carries the id the combobox input's
      // `aria-controls` points at (§3.5). Command menus leave it unset.
      id={listboxId}
      aria-label={ariaLabel}
      className={containerClassName}
      style={{
        ...(portal ? positionStyle : { position: "relative" as const }),
        zIndex: CHROME_Z,
        ...containerStyle,
      }}
      // Clicking the menu must NOT blur the editor or shift its selection.
      // `preventDefault` stops the mousedown from moving DOM focus off the
      // contentEditable (the load-bearing editor-chrome convention — old
      // ActionsMenuPanel, SelectionColorPopover, SelectionActionsMenu), and
      // `stopPropagation` keeps it from reaching the editor / click-outside.
      // EXEMPT focusable form controls (a combobox filter input, the native
      // color picker) so a click INTO them still focuses them (Phase C).
      onMouseDown={(e) => {
        e.stopPropagation();
        const t = e.target as HTMLElement | null;
        if (
          !t ||
          !t.closest('input, textarea, select, [contenteditable="true"]')
        ) {
          e.preventDefault();
        }
      }}
    >
      <MenuContext.Provider value={ctxValue}>
        <MenuStackContext.Provider value={stackValue}>
          {children}
        </MenuStackContext.Provider>
      </MenuContext.Provider>
    </div>
  );

  return portal ? createPortal(container, document.body) : container;
}
