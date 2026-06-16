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
  useMenuStack,
  useOptionalMenuContext,
  type MenuContextValue,
} from "./context";
import { MenuRegistry, publishRegistry, unpublishRegistry } from "./registry";
import { useMenuDismiss } from "./useMenuDismiss";
import { useMenuKeyboard } from "./useMenuKeyboard";
import type { MenuDismissConfig, MenuLayout, MenuRole } from "./types";

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

  // ── nested-provider stack (R6) ──
  const parentStack = useMenuStack();
  const depth = parentStack.depth + 1;
  const isTop = true; // B1: single-level menus only. Phase C tracks an open-child flag.
  const stackValue = useMemo(() => ({ depth }), [depth]);

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
    ownsEscape: isTop,
  });

  // ── keyboard controller ──
  useMenuKeyboard({
    registry,
    layout,
    letterShortcuts,
    getActiveDescendantHost,
    isTop,
    source: keyboardSource,
  });

  const ctxValue = useMemo<MenuContextValue>(
    () => ({ registry, role, registerExclude }),
    [registry, role, registerExclude],
  );

  if (typeof document === "undefined") return null;

  const container = (
    <div
      ref={setContainerRef}
      role={role}
      aria-label={ariaLabel}
      className={containerClassName}
      style={{
        ...(portal ? positionStyle : { position: "relative" as const }),
        zIndex: CHROME_Z,
        ...containerStyle,
      }}
      // Opening the menu shouldn't shift the editor caret; swallow the
      // mousedown so it doesn't reach the editor / underlying selection.
      onMouseDown={(e) => e.stopPropagation()}
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
