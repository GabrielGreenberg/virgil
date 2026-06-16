"use client";

/**
 * The React-backend menu registry (design §2.2/§2.3). One live instance per
 * `<MenuProvider>`. Items self-register via `useMenuItem`; the registry keeps
 * an insertion-ordered map of `MenuNode`s and exposes the
 * `MenuRegistryHandle` contract the keyboard controller drives.
 *
 * Keystroke sanctity: the ordered snapshot (`items()`) is rebuilt only on a
 * REGISTRATION-VERSION bump (mount / unmount / disabled-flip / coords change),
 * never per keystroke. Subscribers (the React view + the controller) read the
 * memoized snapshot; arrowing is pure index math over it.
 *
 * `registryFor(menuId)` returns a process-global handle keyed by menu id so the
 * future PM-slash backend (Phase C) can be looked up behind the same contract.
 * For B1 only the React backend is implemented; the lookup table is the seam.
 */

import { computeNextActive, freshNavMemory, type NavMemory } from "./nav-core";
import type {
  MenuLayout,
  MenuNode,
  MenuOrientation,
  MenuRegistryHandle,
  NavDir,
} from "./types";

/** The per-item registration payload (what `useMenuItem` registers). The
 *  registry assigns `domId` + tracks the live `ref`. */
export interface MenuItemRegistration {
  id: string;
  region: MenuNode["region"];
  coords?: MenuNode["coords"];
  disabled: boolean;
  letter?: string;
  letterAliases?: string[];
  run: () => void;
}

type Listener = () => void;

/**
 * The mutable React-backend registry. NOT a React component — a plain store an
 * instance of which the provider creates and shares via context. It satisfies
 * `MenuRegistryHandle`.
 */
export class MenuRegistry implements MenuRegistryHandle {
  readonly menuId: string;
  private layout: MenuLayout;
  // List stepping axis (opt-in). Only consulted for the `list` layout; default
  // vertical so every existing vertical menu is unaffected.
  private orientation: MenuOrientation = "vertical";

  // Insertion-ordered records. A Map preserves insertion order, but bespoke
  // JSX items mount in DOM order and the registry-mapper appends in row order,
  // so we additionally sort the snapshot by a stable `order` we stamp at
  // registration (DOM order ≈ registration order for both sources).
  private records = new Map<string, MenuNode & { order: number }>();
  private nextOrder = 0;

  // Bumped on any structural change (register / unregister / disabled-flip /
  // coords change). The memoized snapshot is rebuilt only when this changes.
  private version = 0;
  private snapshot: MenuNode[] = [];
  private snapshotVersion = -1;

  private active: string | null = null;
  private mem: NavMemory = freshNavMemory();

  private listeners = new Set<Listener>();

  constructor(menuId: string, layout: MenuLayout) {
    this.menuId = menuId;
    this.layout = layout;
  }

  setLayout(layout: MenuLayout): void {
    if (this.layout === layout) return;
    this.layout = layout;
    this.bump();
  }

  /** Set the list stepping axis (opt-in horizontal for a swatch row). A no-op
   *  for non-list layouts at nav time; stored cheaply regardless. */
  setOrientation(orientation: MenuOrientation): void {
    if (this.orientation === orientation) return;
    this.orientation = orientation;
    this.bump();
  }

  domIdFor(id: string): string {
    return `${this.menuId}-item-${id}`;
  }

  // ── registration ──────────────────────────────────────────────────────────

  register(reg: MenuItemRegistration): void {
    const existing = this.records.get(reg.id);
    const order = existing ? existing.order : this.nextOrder++;
    const next: MenuNode & { order: number } = {
      id: reg.id,
      region: reg.region,
      coords: reg.coords,
      disabled: reg.disabled,
      letter: reg.letter,
      letterAliases: reg.letterAliases,
      run: reg.run,
      domId: this.domIdFor(reg.id),
      ref: existing?.ref ?? null,
      order,
    };
    // Only bump (and re-snapshot + notify) when something nav-relevant changed.
    const changed =
      !existing ||
      existing.region !== next.region ||
      existing.disabled !== next.disabled ||
      existing.coords?.row !== next.coords?.row ||
      existing.coords?.col !== next.coords?.col ||
      (existing.letter ?? "") !== (next.letter ?? "");
    this.records.set(reg.id, next);
    if (changed) this.bump();
  }

  setRef(id: string, el: HTMLElement | null): void {
    const rec = this.records.get(id);
    if (rec) rec.ref = el; // ref churn does NOT bump (not nav-structural)
  }

  /** The live element for a node id, or null. Used by the keyboard controller
   *  to scroll the active row into view (the built-in §3.5 scroll re-anchor
   *  that replaces a combobox's bespoke `scrollIntoView` effect). */
  refFor(id: string): HTMLElement | null {
    return this.records.get(id)?.ref ?? null;
  }

  unregister(id: string): void {
    if (!this.records.delete(id)) return;
    if (this.active === id) this.active = null;
    this.bump();
  }

  // ── the MenuRegistryHandle contract ─────────────────────────────────────────

  items(): MenuNode[] {
    if (this.snapshotVersion !== this.version) {
      this.snapshot = Array.from(this.records.values())
        .sort((a, b) => a.order - b.order)
        .map((rec): MenuNode => ({
          id: rec.id,
          region: rec.region,
          coords: rec.coords,
          disabled: rec.disabled,
          letter: rec.letter,
          letterAliases: rec.letterAliases,
          run: rec.run,
          domId: rec.domId,
          ref: rec.ref,
        }));
      this.snapshotVersion = this.version;
    }
    return this.snapshot;
  }

  activeId(): string | null {
    return this.active;
  }

  setActive(id: string | null): void {
    if (this.active === id) return;
    // Ignore a disabled / unknown / widget node (mouse over a greyed row keeps
    // the prior active item — matches "disabled is inert").
    if (id !== null) {
      const rec = this.records.get(id);
      if (!rec || rec.disabled || rec.region === "widget") return;
    }
    this.active = id;
    this.notify();
  }

  move(dir: NavDir): void {
    const next = computeNextActive(
      this.layout,
      this.items(),
      this.active,
      dir,
      this.mem,
      this.orientation,
    );
    if (next !== this.active) {
      this.active = next;
      this.notify();
    }
  }

  activate(): void {
    if (this.active === null) return;
    const rec = this.records.get(this.active);
    if (!rec || rec.disabled || rec.region === "widget") return;
    rec.run();
  }

  /** Activate a node by id directly (the letter fast-path / a click). No-op
   *  if missing / disabled. */
  activateById(id: string): void {
    const rec = this.records.get(id);
    if (!rec || rec.disabled || rec.region === "widget") return;
    rec.run();
  }

  // ── subscription (for the React view + controller) ──────────────────────────

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Snapshot version — a React view can `useSyncExternalStore` on this. */
  getVersion(): number {
    return this.version;
  }

  private bump(): void {
    this.version++;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// registryFor(menuId) — the cross-backend lookup seam (§2.3).
//
// A process-global table mapping a stable menu id to its live registry handle.
// The React backend registers itself here on mount; the future PM-slash
// backend (Phase C) will register a handle satisfying the SAME
// `MenuRegistryHandle` contract. Returns null when no backend is mounted for
// the id.
// ───────────────────────────────────────────────────────────────────────────

const REGISTRY_TABLE = new Map<string, MenuRegistryHandle>();

export function publishRegistry(menuId: string, handle: MenuRegistryHandle): void {
  REGISTRY_TABLE.set(menuId, handle);
}

export function unpublishRegistry(menuId: string, handle: MenuRegistryHandle): void {
  // Only clear if the published handle is still the one we own (guards a
  // remount race where a new provider already claimed the id).
  if (REGISTRY_TABLE.get(menuId) === handle) REGISTRY_TABLE.delete(menuId);
}

/** Look up the live registry handle for a menu id, or null. */
export function registryFor(menuId: string): MenuRegistryHandle | null {
  return REGISTRY_TABLE.get(menuId) ?? null;
}
