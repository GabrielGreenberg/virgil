"use client";

/**
 * The React-backend menu registry (design §2.2/§2.3). One live instance per
 * `<MenuProvider>`. Items self-register via `useMenuItem`; the registry keeps
 * an insertion-ordered map of `MenuNode`s and exposes the
 * `MenuRegistryHandle` contract the keyboard controller drives.
 *
 * Keystroke sanctity: the ordered snapshot (`items()`) is rebuilt only on a
 * REGISTRATION-VERSION bump (mount / unmount / disabled-flip / coords change),
 * never per keystroke. Its ORDER is the rows' live DOM order (task 745). Subscribers (the React view + the controller) read the
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

  // Records, keyed by item id. Nav order is READ FROM THE DOM, not stamped
  // (task 745): `items()` sorts rows by their live elements' document
  // position, so a row that mounts while the menu is open (the View menu's
  // expanded group children) or re-registers (a live disabled-flip) sits where
  // it is DRAWN, not at the end. The stamped `order` (first-registration
  // sequence, or a consumer's `setOrder`) is only the FALLBACK for a registry
  // whose rows have no connected element (a PM-backed / unit-test registry).
  private records = new Map<string, Omit<MenuNode, "ref"> & { order: number }>();
  private nextOrder = 0;

  // Live element refs, keyed by item id — the SINGLE source of truth for
  // `refFor()` (the §3.5 scroll-into-view path). Kept in a DEDICATED map, NOT
  // on the record, because a ref callback fires at COMMIT while `register` runs
  // in a passive effect that fires AFTER: seeding the ref onto the record at
  // register time would always read null (the record doesn't exist yet when
  // `setRef` first runs, and `setRef`'s stable identity means React never
  // re-invokes it). Decoupling makes ref capture order-independent. A nav-field
  // change (disabled / letter / coords) is an UPSERT through `register`, never
  // an unregister→register (see `useMenuItem`), so the ref survives it; only a
  // real unmount (`unregister`) clears the entry. `setRef` writes here
  // unconditionally and still does NOT bump the version (a ref set is not
  // nav-structural — keystroke sanctity).
  private refs = new Map<string, HTMLElement>();

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
    // No `ref` on the record — the live element lives in `this.refs` (see the
    // field comment). This keeps ref capture decoupled from register order.
    const next: Omit<MenuNode, "ref"> & { order: number } = {
      id: reg.id,
      region: reg.region,
      coords: reg.coords,
      disabled: reg.disabled,
      letter: reg.letter,
      letterAliases: reg.letterAliases,
      run: reg.run,
      domId: this.domIdFor(reg.id),
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
    // A row that turns inert while highlighted drops the highlight — the same
    // rule `setActive` applies to a pointer entering an inert row.
    if (this.active === reg.id && (next.disabled || next.region === "widget")) {
      this.active = null;
    }
    if (changed) this.bump();
  }

  setRef(id: string, el: HTMLElement | null): void {
    // Write to the dedicated refs map UNCONDITIONALLY — no `if (rec)` gate, so
    // capture no longer depends on `register` having run first (the ref
    // callback fires at commit, BEFORE register's passive effect). ref churn
    // does NOT bump (not nav-structural — keystroke sanctity).
    if (el) this.refs.set(id, el);
    else this.refs.delete(id);
  }

  /**
   * Signal that a row's VISUAL position changed without any registration
   * change, and record it as the row's fallback sort key.
   *
   * `items()` reads nav order from the DOM, but it re-sorts only on a version
   * bump. A key-stable list that REORDERS its rows without remounting (a
   * fuzzy-ranked combobox renders `key={citekey}`, so React moves the DOM nodes
   * on a re-rank with no unmount/remount) changes DOM order while no
   * registration changes — so such a consumer publishes its live index here,
   * which bumps and makes the next snapshot re-read the DOM. The index is also
   * kept as the fallback key for an element-less registry. Bumps only on an
   * actual change (idempotent → keystroke-safe) and NEVER clears `active`, so
   * the highlight survives a re-rank. Rows that only mount/unmount/flip never
   * need this — those already bump.
   */
  setOrder(id: string, order: number): void {
    const rec = this.records.get(id);
    if (!rec || rec.order === order) return;
    rec.order = order;
    this.bump();
  }

  /** The live element for a node id, or null. Used by the keyboard controller
   *  to scroll the active row into view (the built-in §3.5 scroll re-anchor
   *  that replaces a combobox's bespoke `scrollIntoView` effect). */
  refFor(id: string): HTMLElement | null {
    return this.refs.get(id) ?? null;
  }

  unregister(id: string): void {
    if (!this.records.delete(id)) return;
    this.refs.delete(id);
    if (this.active === id) this.active = null;
    this.bump();
  }

  // ── the MenuRegistryHandle contract ─────────────────────────────────────────

  items(): MenuNode[] {
    if (this.snapshotVersion !== this.version) {
      this.snapshot = this.sortedRecords().map((rec): MenuNode => ({
          id: rec.id,
          region: rec.region,
          coords: rec.coords,
          disabled: rec.disabled,
          letter: rec.letter,
          letterAliases: rec.letterAliases,
          run: rec.run,
          domId: rec.domId,
          // Cosmetic snapshot field, sourced from the refs-map SSOT. Nav never
          // reads it (only `refFor` does, live); may lag a ref set (which
          // doesn't bump the snapshot), which is fine — it's non-load-bearing.
          ref: this.refs.get(rec.id) ?? null,
        }));
      this.snapshotVersion = this.version;
    }
    return this.snapshot;
  }

  /**
   * Records in NAV order: DOM document order when every row has a connected
   * element (the React backend, always, by the time a bump is observed — refs
   * attach at commit, before the passive register effect bumps), else the
   * stamped `order` (element-less registries). All-or-nothing on purpose: a
   * comparator mixing the two keys would not be transitive.
   */
  private sortedRecords(): Array<Omit<MenuNode, "ref"> & { order: number }> {
    const recs = Array.from(this.records.values());
    const els = recs.map((rec) => this.refs.get(rec.id));
    const allLive = els.every(
      (el) => !!el && typeof el.compareDocumentPosition === "function" && el.isConnected,
    );
    if (!allLive || recs.length < 2) return recs.sort((a, b) => a.order - b.order);
    const elFor = new Map(recs.map((rec, i) => [rec.id, els[i] as HTMLElement]));
    return recs.sort((a, b) => {
      const pos = elFor.get(a.id)!.compareDocumentPosition(elFor.get(b.id)!);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return a.order - b.order;
    });
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

  /** Run the active node. Returns whether anything RAN — see the contract on
   *  `MenuRegistryHandle.activate`; the window controller consumes Enter/Space
   *  only on a true. */
  activate(): boolean {
    if (this.active === null) return false;
    return this.activateById(this.active);
  }

  /** Activate a node by id directly (the letter fast-path / a click). No-op
   *  (and `false`) if missing / disabled / a widget. */
  activateById(id: string): boolean {
    const rec = this.records.get(id);
    if (!rec || rec.disabled || rec.region === "widget") return false;
    rec.run();
    return true;
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
