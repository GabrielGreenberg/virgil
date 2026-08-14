"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "@/lib/print";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import type { PanelKind } from "@/panels/_shared/types";
import { getWindowId } from "@/lib/multi-window/window-id";
import { publish, subscribe, type BusEvent } from "@/lib/multi-window/bus";
import { DEFAULT_OMNI_CATEGORIES, migrateOmniCategories, type OmniCategory } from "@/panels/Omni/OmniViewPanel";
import defaultPrefsJson from "./useViewPrefs.defaults.json";
import {
  REGISTRY_DEFAULTS,
  REGISTRY_GLOBAL_KEYS,
  VIEW_PREF_REGISTRY,
  type RegistryPrefs,
  type ViewPrefKey,
  type SetViewPrefKey,
  type ViewPrefMember,
  type ViewPrefDef,
} from "@/lib/view-prefs/registry";
import { migrateFloatKeys, migrateLegacyKeyToFloat } from "@/floats/float-key";
import {
  filterPlacements,
  filterOmniCategories,
  filterPrintPanels,
  clampStack,
} from "./dropUnknownPanelIds";
import { dockedSideOf } from "./view-prefs-derived";
import {
  MAX_STACK,
  MIN_BAND_PX,
  closeAllPanels as closeAllPanelsIn,
  closePanel,
  isPanelOpen,
  notePanelUse as notePanelUseIn,
  openInMode,
  placeInStack,
  undockToFloat,
} from "./view-prefs-dock";

/** Marginalia card kinds whose visibility is toggled from the View menu. */
export type MarginaliaType = "note" | "archive" | "todo" | "report";
/** Heading depths 0–6, matching LaTeX (part…subparagraph). */
export type DividerLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Heading-divider drawing width. */
export type DividerWidth = "full" | "mid" | "text";

/** Every persisted panel slot: the canonical `PanelKind` set (the registry
 *  SSOT) plus the layout-only `"blank"` sentinel. PINNED to `PanelKind` (was a
 *  hand-typed parallel union) so a panel added to / removed from the registry
 *  flows here automatically and the two can never diverge silently — the
 *  unchecked `as PanelId` casts at the `PanelKind→PanelId` boundaries in
 *  EditorPane would otherwise mask a missing member (audit-059). */
export type PanelId = PanelKind | "blank";

/** Card kinds whose linked-anchor highlights are togglable from the Highlights
 *  menu. Values match the prefix of `data-link-card`.
 *
 *  The ARRAY is the SSOT and `HighlightType` is DERIVED from it, so the two can
 *  never drift: adding a kind here flows straight into the union. The inverse
 *  shape (a hand-typed union + a `HighlightType[]`-annotated array) could not be
 *  made safe — the annotation permits a *proper subset*, so a kind added to the
 *  union while the array stayed stale would compile clean yet silently never
 *  render its highlights at the `ALL_HIGHLIGHT_TYPES` consumer (EditorLayout's
 *  `visibleHighlightKinds`). Deriving closes that omission direction for good. */
export const ALL_HIGHLIGHT_TYPES = [
  "note",
  "todo",
  "comment",
  "cut",
  "report",
] as const;
export type HighlightType = (typeof ALL_HIGHLIGHT_TYPES)[number];
export type Side = "left" | "right";

export interface PanelPlacement {
  id: PanelId;
  side: Side;
}

export type Half = "top" | "bottom";

/** A panel can sit in the gutter dock (default) or as a free-floating
 *  window. The mode is per-panel and persists across reloads. */
export type PanelMode = "docked" | "floating";

/* `MAX_STACK` (the per-side stack ceiling) and `MIN_BAND_PX` (the breathing
 * room a newcomer needs before it displaces a band) are declared by the dock
 * engine — the module that enforces them — and re-exported here for the
 * components that already import them from this module. ONE declaration: the
 * load-time `clampStack` truncation reads the same const the runtime
 * insertions do, so a future ceiling bump can't leave the loader silently
 * truncating a runtime-legal stack (task 273). */
export { MAX_STACK, MIN_BAND_PX } from "./view-prefs-dock";

/** One dock slot per band position (0 = top of the stack), up to
 *  MAX_STACK per side. Used as the `data-dock-slot` portal key so each
 *  docked FloatingPanel resolves to its band anchor in PanelColumn. */
export type DockSlotKey = `left-${number}` | `right-${number}`;

export function bandSlotKey(side: Side, index: number): DockSlotKey {
  return `${side}-${index}` as DockSlotKey;
}

/** View preferences split into a global slice (mirrored across windows) and
 *  a per-window slice. The registry-owned fields (par-titles, % comments,
 *  marginalia, highlights, dividers, bib filter) come from `RegistryPrefs`
 *  via `extends`; only the structural layout fields below are hand-authored.
 *  Add a new view toggle by adding ONE entry to `VIEW_PREF_REGISTRY`, never
 *  by hand-declaring it here. */
export interface ViewPrefs extends RegistryPrefs {
  placements: PanelPlacement[];
  /** Ordered stack of docked panels per side, top→bottom, length ≤
   *  MAX_STACK. Replaces the old activeLeft/Right + active*Bottom +
   *  dockSlots split model. The top/only panel derives as
   *  `dockStack[side][0] ?? null`. Persists per-window so the open
   *  layout survives a reload. */
  dockStack: { left: PanelId[]; right: PanelId[] };
  /** Per-panel resized band height in px. Absent ⇒ content-sized
   *  (auto-fit to the panel's content). Written when the user drags a
   *  band border; persists. Keyed by PanelId (a panel is docked at most
   *  once). */
  panelHeights: Partial<Record<PanelId, number>>;
  /** Per-side most-recently-used order, most-recent-first. The last
   *  entry still present in `dockStack[side]` is the eviction target when
   *  a new panel needs room. Session-only (recency resets with the open
   *  set on reload). */
  panelMRU: { left: PanelId[]; right: PanelId[] };
  /** Whether each side column is collapsed (hidden) without destroying
   *  its dockStack. Replaces the old `activeLeft === null` sentinel. */
  collapsedLeft: boolean;
  collapsedRight: boolean;
  /** Whether each side suppresses the omni background (a clean, empty
   *  column). Replaces the old `activeLeft === "blank"` sentinel. */
  blankLeft: boolean;
  blankRight: boolean;
  panelWidths: Record<string, number>; // keyed by `${side}`
  /** 0..1 — *editor* pane ratio when the Code pane split is engaged
   *  (split-with-code primitive). 0.55 = editor slightly wider than code.
   *  Persisted globally so the splitter feels stable across docs. */
  codePaneRatio: number;
  /** Panels currently displayed as floating windows. */
  poppedOutPanels: PanelId[];
  /** Which split half each popped-out panel came from, so un-popping
   *  restores it to the same slot instead of always the top. Entries
   *  are removed when a panel is un-popped. */
  poppedOutOrigins: Partial<Record<PanelId, Half>>;
  /** Saved position/size of each floating panel, keyed by panel id.
   *  Persisted: a panel re-opens at its last floating rect even after a
   *  reload. Cleared only when the panel is moved back to docked mode
   *  via an explicit re-dock gesture (kept across plain close so the
   *  user's pinned size sticks). */
  floatPositions: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Per-panel preferred mode. Persisted. New panels default to
   *  "docked"; switches to "floating" the first time the user undocks. */
  panelModes: Partial<Record<PanelId, PanelMode>>;
  /** Cards currently displayed as floating windows — keys shaped `${kind}:${id}`. */
  poppedOutCards: string[];
  /** Saved position/size of each floating card, keyed by card key. */
  cardFloatPositions: Record<string, { x: number; y: number; width: number; height: number }>;
  /* `showHighlights` + `hiddenHighlightTypes` are registry-owned
   *  (`VIEW_PREF_REGISTRY`, global scope) and arrive via `RegistryPrefs`. */
  /** Preferred width of the editor "page" in pixels. The page is the
   *  solid element of the layout — panels and margins flex around it to
   *  absorb window resizes. Drag on panel or zen-margin inner edges
   *  updates this pref. */
  pageWidth: number;
  /** In-editor text margins (padding inside the editor pod), in pixels.
   *  The left margin must clear the 72px marginalia margin plus an 8px
   *  breathing strip for heading fold-chevrons. Top/bottom/right floor
   *  at 24px (breathing room); all cap at 240px so the column can't
   *  collapse. Adjustable via the ViewMenu → "Margins…" mode, which
   *  renders draggable in-text guides on all four sides. */
  editorLeftMargin: number;
  editorRightMargin: number;
  editorTopMargin: number;
  editorBottomMargin: number;
  /** Last-used print options. The Print dialog reads and writes here so
   *  user choices persist across sessions. */
  printOptions: PrintOptions;
  /** When true, the Virgil bar's right-side cluster (modes, divider,
   *  Preferences/Help/Print/AI/Style/Code/Compile/PDF/Zen) collapses,
   *  leaving only the chevron toggle. Per-window. */
  topbarRightCollapsed: boolean;

  /* ── Editor decoration prefs (global; promote to defaults) ───────── */
  /*  `showMarginalia` / `hiddenMarginaliaTypes` /
   *  `showHeadingLabels` / `dividerLevels` / `dividerWidth` are all
   *  registry-owned (`VIEW_PREF_REGISTRY`, global scope) and arrive via
   *  `RegistryPrefs`. Add a new decoration toggle there, not here. */

  /** Omni-view filter chips: which card categories are enabled on each
   *  side. */
  omniCategories: Record<"left" | "right", OmniCategory[]>;
  /** Sticky "hide all cards in omni-view" toggle per side. */
  omniHideAllCards: { left: boolean; right: boolean };

  /* ── Card archive (per-card set-aside) ───────────────────────────── */

  /** Per-panel card archive VIEW mode — the View Active / View Archives / View
   *  All selector each card panel's three-dot menu gains. Absent ⇒ "active".
   *  Keyed by PanelId; per-window (a reviewer window can browse archives while a
   *  draft window stays on active). Wholly distinct from the text-object Archive
   *  PANEL. */
  cardArchiveView: Partial<Record<PanelId, "active" | "archived" | "all">>;
  /** When true, suppress the "archiving removes the footnote/citation from your
   *  text" confirm (the user ticked "don't ask again"). Per-window. */
  suppressArchiveAtomWarning: boolean;
}

/** The three card-archive view modes. */
export type CardArchiveView = "active" | "archived" | "all";

/* ── Derived read helpers (pure) ───────────────────────────────────────
 * Single implementation lives in the dependency-free leaf `view-prefs-
 * derived` (it imports ONLY types from here, so route-derivation modules
 * can pull these helpers without dragging the hook runtime + its
 * @/lib/storage chain into their graph). Re-exported here for the many
 * consumers that already import from `@/hooks/useViewPrefs`. */
export { dockedSideOf, dockStackTop, isPanelDocked } from "./view-prefs-derived";

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
// `printOptions` is filled in from DEFAULT_PRINT_OPTIONS (owned by
// print.ts) and `omniCategories` from DEFAULT_OMNI_CATEGORIES (derived
// from the panel registry) rather than duplicated into the JSON.
/** Pref keys a past build persisted for a feature that no longer exists.
 *  Deleted from the saved blob at load (see `loadPrefs`), so a stale value
 *  can neither reach the live prefs object nor round-trip back to disk.
 *
 *  - `editorSplit` / `editorSplitRatio`: the two-pane editor split. Its render
 *    site was dropped in a refactor, leaving a MenuBar toggle that flipped a
 *    persisted pref no pane read — and one click painted a permanent phantom
 *    mirror indicator on the Outline that survived reloads. Retired in task
 *    115; the machinery is parked (unmounted) in `split-editor-panes.tsx`.
 */
const RETIRED_PREF_KEYS = ["editorSplit", "editorSplitRatio"] as const;

const DEFAULT_PREFS: ViewPrefs = {
  // Registry defaults FIRST so the 8 promoted decoration/highlight fields
  // (showMarginalia, dividerLevels, …) and `bibFilter` get a value; the JSON
  // spread comes AFTER so the JSON's values for the registry keys it carries
  // win (the promotion pipeline is byte-stable against the JSON). `bibFilter`
  // is window-scoped, lives ONLY in the registry (not the JSON), so it's
  // omitted from the JSON cast below and supplied by REGISTRY_DEFAULTS.
  ...REGISTRY_DEFAULTS,
  ...(defaultPrefsJson as Omit<
    ViewPrefs,
    | "bibFilter"
    | "printOptions"
    | "omniCategories"
    | "cardArchiveView"
    | "suppressArchiveAtomWarning"
  >),
  printOptions: DEFAULT_PRINT_OPTIONS,
  omniCategories: DEFAULT_OMNI_CATEGORIES,
  cardArchiveView: {},
  suppressArchiveAtomWarning: false,
};

const LEGACY_STORAGE_KEY = "virgil-view-prefs";
const GLOBAL_STORAGE_KEY = "virgil-view-prefs/global";
const WINDOW_STORAGE_PREFIX = "virgil-view-prefs/window/";

/**
 * Keys whose values are user-level preferences and should mirror across
 * every Virgil window (theme-adjacent: highlights, print options, strip
 * placements so panel-icon order stays consistent everywhere — editor
 * windows and the Library Reader — plus the page-layout dimensions
 * users tune once and want consistent everywhere). Everything not
 * listed here is per-window — dock state, popped cards, panel widths,
 * etc. — so a draft window and a reviewer window on different monitors
 * can have totally different shapes.
 *
 * Page-layout keys (`pageWidth`, `editor{Left,Right,Top,Bottom}Margin`)
 * are global because they're the values
 * the personal-prefs promotion pipeline reads to bake into shipped
 * defaults — see `tools/promote-defaults.mjs` and the whitelist in
 * `src/lib/dev-prefs-registry.json`.
 */
/** Structural (non-registry) global keys — page geometry, strip placements,
 *  omni filters, print options. The registry-owned global keys
 *  (`showMarginalia`, `dividerLevels`, highlights, …) are appended from
 *  `REGISTRY_GLOBAL_KEYS` so "is this pref global?" is decided in ONE place
 *  (the registry's `scope` field), never re-asserted by hand here. */
export const STRUCTURAL_GLOBAL_PREF_KEYS = [
  "printOptions",
  "placements",
  "pageWidth",
  "editorLeftMargin",
  "editorRightMargin",
  "editorTopMargin",
  "editorBottomMargin",
  "codePaneRatio",
  "omniCategories",
  "omniHideAllCards",
] as const;
const GLOBAL_PREF_KEYS = [
  ...STRUCTURAL_GLOBAL_PREF_KEYS,
  ...REGISTRY_GLOBAL_KEYS,
] as const;
type GlobalPrefKey =
  | (typeof STRUCTURAL_GLOBAL_PREF_KEYS)[number]
  | (typeof REGISTRY_GLOBAL_KEYS)[number];
const GLOBAL_PREF_SET = new Set<string>(GLOBAL_PREF_KEYS);

/** The page-geometry subset of the global keys — the reading-measure prefs
 *  (page width + the four margins) the ephemeral Reader DOES want to track
 *  live. Ephemeral mode opens no full global subscription (its dock / popout /
 *  omni state is session-only and must not be reachable by peer windows), but a
 *  margin change made in the main editor SHOULD flow into an open Reader so the
 *  Reader's prose measure stays in step. This narrow set is the only thing the
 *  ephemeral subscription re-reads — never the layout keys. Numeric + value-
 *  typed so a hostile blob can't inject layout state through it. */
export const MARGIN_PREF_KEYS = [
  "pageWidth",
  "editorLeftMargin",
  "editorRightMargin",
  "editorTopMargin",
  "editorBottomMargin",
] as const;
const MARGIN_PREF_SET = new Set<string>(MARGIN_PREF_KEYS);

// The geometry keys the ephemeral Reader tracks are, by construction, a narrow
// slice of the structural globals. Prove the subset at compile time so the two
// lists can't drift; the runtime twin is pinned in view-prefs-vocab-guards.test.
type _MarginKeysAreStructural =
  (typeof MARGIN_PREF_KEYS)[number] extends (typeof STRUCTURAL_GLOBAL_PREF_KEYS)[number]
    ? true
    : never;
void (true as _MarginKeysAreStructural);

function windowStorageKey(): string {
  return WINDOW_STORAGE_PREFIX + getWindowId();
}

// ── Per-window pref garbage collection ──────────────────────────────────
// Every window/session mints a fresh window-id and writes a
// `virgil-view-prefs/window/<id>` layout key. Nothing ever removed them, so
// they accumulated without bound (hundreds observed on a dev machine after many
// restarts) — every one is JSON we keep around forever and walk on relevant
// reads. This GC bounds that growth WITHOUT risking a live window's layout:
// a recency index (`window-index`) stamps the current window alive on every
// load, and a window-pref key is dropped only once its window has gone unseen
// for `WINDOW_PREF_RETENTION_MS`. A never-indexed (legacy) key is adopted with
// a short grace so a window that simply hasn't reloaded recently survives, but
// truly-dead keys age out within ~`WINDOW_PREF_ADOPT_GRACE_MS`. Self-contained,
// runs once per window load (O(window-keys)), no multi-window coupling.
const WINDOW_INDEX_KEY = "virgil-view-prefs/window-index";
const WINDOW_PREF_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const WINDOW_PREF_ADOPT_GRACE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const WINDOW_PREF_HARD_CAP = 128; // backstop against pathological growth

let windowPrefsGcRan = false;
function gcWindowPrefs(): void {
  if (windowPrefsGcRan) return;
  windowPrefsGcRan = true;
  if (typeof localStorage === "undefined") return;
  try {
    const now = Date.now();
    const currentId = getWindowId();
    let index: Record<string, number> = {};
    try {
      const raw = localStorage.getItem(WINDOW_INDEX_KEY);
      if (raw) index = JSON.parse(raw) as Record<string, number>;
    } catch {
      index = {};
    }
    if (typeof index !== "object" || index === null) index = {};
    index[currentId] = now; // stamp the live window

    // Collect window-pref keys up front (mutating localStorage mid-iteration
    // shifts indices).
    const windowKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(WINDOW_STORAGE_PREFIX)) windowKeys.push(k);
    }

    const survivors: { id: string; lastSeen: number }[] = [];
    for (const key of windowKeys) {
      const id = key.slice(WINDOW_STORAGE_PREFIX.length);
      if (id === currentId) {
        survivors.push({ id, lastSeen: now });
        continue;
      }
      if (index[id] === undefined) {
        // Legacy key with no recency record: adopt with a short grace window
        // so a real-but-idle window survives, but a dead one ages out soon.
        index[id] = now - (WINDOW_PREF_RETENTION_MS - WINDOW_PREF_ADOPT_GRACE_MS);
      }
      if (now - index[id] > WINDOW_PREF_RETENTION_MS) {
        localStorage.removeItem(key);
        delete index[id];
      } else {
        survivors.push({ id, lastSeen: index[id] });
      }
    }

    // Hard cap backstop: if still over the cap, drop the least-recently-seen
    // non-current survivors beyond it.
    if (survivors.length > WINDOW_PREF_HARD_CAP) {
      survivors
        .filter((s) => s.id !== currentId)
        .sort((a, b) => a.lastSeen - b.lastSeen)
        .slice(0, survivors.length - WINDOW_PREF_HARD_CAP)
        .forEach((s) => {
          localStorage.removeItem(WINDOW_STORAGE_PREFIX + s.id);
          delete index[s.id];
        });
    }

    // Prune index entries whose key no longer exists (keep the current window).
    for (const id of Object.keys(index)) {
      if (id === currentId) continue;
      if (localStorage.getItem(WINDOW_STORAGE_PREFIX + id) === null) delete index[id];
    }

    localStorage.setItem(WINDOW_INDEX_KEY, JSON.stringify(index));
  } catch {
    // GC is best-effort; never let it break pref loading.
  }
}

/** Same-window fan-out for global-pref changes. The BroadcastChannel
 *  bus reaches *other* windows only (its `postMessage` does not echo to
 *  the sender), so two `useViewPrefs` instances inside the same tab —
 *  e.g. EditorLayout's and the Library Reader's — would otherwise drift.
 *  Each instance subscribes here; `persist` fans out after a write. */
const sameWindowListeners = new Set<() => void>();
function notifySameWindow() {
  for (const fn of sameWindowListeners) {
    try {
      fn();
    } catch (err) {
      console.error("same-window pref listener threw", err);
    }
  }
}

function pickGlobal(p: ViewPrefs): Pick<ViewPrefs, GlobalPrefKey> {
  const out = {} as Pick<ViewPrefs, GlobalPrefKey>;
  for (const k of GLOBAL_PREF_KEYS) {
    // `k` is a GlobalPrefKey; the assignment is sound (same key on both
    // sides) but TS can't track the per-key value type through the loop, so
    // a single localized cast keeps the loop builder honest.
    (out as Record<GlobalPrefKey, unknown>)[k] = p[k];
  }
  return out;
}

/** Read-time (pre-editor) per-key migration to the `float:` grammar. Rewrites
 *  the legacy pre-D10 block prefixes to `textobject:…` first, drops the
 *  session-only `selection:`/`sel:` keys, and defers the doc-aware `list:`/
 *  `example:` keys (passed through untouched for the post-load leg). Everything
 *  else → `float:<domain>:<kind>:<id>`. Idempotent on already-`float:` keys. */
function readTimePopoutKeyToFloat(key: string): string | null {
  if (key.startsWith("paragraph:")) {
    return migrateLegacyKeyToFloat(`textobject:paragraph:${key.slice("paragraph:".length)}`);
  }
  if (key.startsWith("heading:")) {
    return migrateLegacyKeyToFloat(`textobject:heading:${key.slice("heading:".length)}`);
  }
  if (key.startsWith("texBlock:")) {
    return migrateLegacyKeyToFloat(`textobject:texBlock:${key.slice("texBlock:".length)}`);
  }
  if (key.startsWith("selection:") || key.startsWith("sel:")) return null;
  // `list:`/`example:` pass through (migrateLegacyKeyToFloat defers them);
  // every other key → `float:`.
  return migrateLegacyKeyToFloat(key);
}

/** Read + merge + migrate both pref blobs into a fully-defaulted `ViewPrefs`.
 *  Exported so the registry round-trip test can drive the real load pipeline
 *  (it was previously module-private). */
export function loadPrefs(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    // Migration: split the legacy single-blob key into per-window +
    // global on first load. The migrating window keeps the layout;
    // every other window starts fresh with default layout.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        const globalSlice: Record<string, unknown> = {};
        const windowSlice: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (GLOBAL_PREF_SET.has(k)) globalSlice[k] = v;
          else windowSlice[k] = v;
        }
        if (!localStorage.getItem(GLOBAL_STORAGE_KEY)) {
          localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(globalSlice));
        }
        if (!localStorage.getItem(windowStorageKey())) {
          localStorage.setItem(windowStorageKey(), JSON.stringify(windowSlice));
        }
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }

    // Migration: keys that used to live in their own top-level
    // localStorage entries (marginalia toggles, divider config, omni
    // filter, etc.) are now part of the global ViewPrefs blob so they
    // pick up persistence, cross-window sync, and the personal-prefs
    // promotion pipeline. Read whatever's there, fold into a shape
    // matching the new fields, and drop the legacy entries. Idempotent.
    type LegacyMigration = {
      key: string;
      field: GlobalPrefKey;
      parse: (raw: string) => unknown;
    };
    const legacyMigrations: LegacyMigration[] = [
      { key: "virgil-show-marginalia", field: "showMarginalia", parse: (r) => r !== "false" },
      {
        key: "virgil-hidden-marginalia-types",
        field: "hiddenMarginaliaTypes",
        parse: (r) => {
          const arr = JSON.parse(r);
          return Array.isArray(arr) ? arr : [];
        },
      },
      { key: "virgil-show-heading-labels", field: "showHeadingLabels", parse: (r) => r !== "false" },
      {
        key: "virgil-divider-levels",
        field: "dividerLevels",
        parse: (r) => {
          const arr = JSON.parse(r);
          return Array.isArray(arr) ? arr : [];
        },
      },
      {
        key: "virgil-divider-width",
        field: "dividerWidth",
        parse: (r) => (r === "full" || r === "mid" || r === "text" ? r : "full"),
      },
      {
        key: "virgil-omni-categories",
        field: "omniCategories",
        parse: (r) => {
          const parsed = JSON.parse(r);
          return {
            left: migrateOmniCategories(parsed?.left) ?? DEFAULT_OMNI_CATEGORIES.left,
            right: migrateOmniCategories(parsed?.right) ?? DEFAULT_OMNI_CATEGORIES.right,
          };
        },
      },
      {
        key: "virgil-omni-hide-all-cards",
        field: "omniHideAllCards",
        parse: (r) => {
          const parsed = JSON.parse(r);
          return { left: Boolean(parsed?.left), right: Boolean(parsed?.right) };
        },
      },
    ];
    const legacyGlobalPatch: Record<string, unknown> = {};
    let legacyTouched = false;
    for (const m of legacyMigrations) {
      const raw = localStorage.getItem(m.key);
      if (raw == null) continue;
      try {
        legacyGlobalPatch[m.field] = m.parse(raw);
        legacyTouched = true;
      } catch {
        // Skip corrupt entries — defaults will fill in.
      }
      localStorage.removeItem(m.key);
    }
    if (legacyTouched) {
      const cur = localStorage.getItem(GLOBAL_STORAGE_KEY);
      const next = cur ? JSON.parse(cur) : {};
      for (const [k, v] of Object.entries(legacyGlobalPatch)) {
        if (!(k in next)) next[k] = v;
      }
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(next));
    }

    const windowRaw = localStorage.getItem(windowStorageKey());
    const globalRaw = localStorage.getItem(GLOBAL_STORAGE_KEY);
    if (!windowRaw && !globalRaw) return DEFAULT_PREFS;
    const windowParsed = windowRaw ? JSON.parse(windowRaw) : {};
    const globalParsed = globalRaw ? JSON.parse(globalRaw) : {};

    // Migration: keys promoted from per-window to global (page-layout
    // dimensions like margins and pageWidth) should live in the global
    // blob. Idempotent — no-ops once the window blob is clean.
    let promotedAny = false;
    for (const k of Object.keys(windowParsed)) {
      if (GLOBAL_PREF_SET.has(k)) {
        if (!(k in globalParsed)) globalParsed[k] = windowParsed[k];
        delete windowParsed[k];
        promotedAny = true;
      }
    }
    if (promotedAny) {
      localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(globalParsed));
      localStorage.setItem(windowStorageKey(), JSON.stringify(windowParsed));
    }

    const parsed = { ...windowParsed, ...globalParsed };

    // AF popout-key migration (read-time leg). Converts every persisted key to
    // the unified `float:<domain>:<kind>:<id>` grammar, in LOCKSTEP across
    // BOTH `poppedOutCards` AND `cardFloatPositions` (the prior D10 migration
    // rewrote only the former → every saved float rect orphaned; this fixes it).
    //
    // Block-popout prefixes (`paragraph:`/`heading:`/`texBlock:`) first rewrite
    // to `textobject:…`, then to `float:textobject:…`. `selection:`/`sel:` were
    // session-only → dropped (null). `list:`/`example:` need a doc walk to
    // resolve kind, so they pass through here and the doc-aware leg
    // (`post-load-migrations`, fired once the editor mounts) converts them.
    // Idempotent: keys already `float:` pass straight through.
    if (Array.isArray(parsed.poppedOutCards)) {
      const droppedSelection = (parsed.poppedOutCards as unknown[]).filter(
        (k): k is string =>
          typeof k === "string" &&
          (k.startsWith("selection:") || k.startsWith("sel:")),
      );
      const positions =
        parsed.cardFloatPositions && typeof parsed.cardFloatPositions === "object"
          ? (parsed.cardFloatPositions as Record<string, unknown>)
          : {};
      const result = migrateFloatKeys(
        (parsed.poppedOutCards as unknown[]).filter(
          (k): k is string => typeof k === "string",
        ),
        positions,
        readTimePopoutKeyToFloat,
      );
      if (result.changed) {
        parsed.poppedOutCards = result.keys;
        parsed.cardFloatPositions = result.positions;
      }
      if (droppedSelection.length > 0) {
        console.warn(
          `[viewPrefs] AF migration dropped ${droppedSelection.length} session-only selection popout key(s): ${droppedSelection.slice(0, 3).join(", ")}${droppedSelection.length > 3 ? ", …" : ""}`,
        );
      }
    }

    // Migrate: replace old "references" panel with "citations" + "bibliography"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let placements: any[] = parsed.placements || [];
    const hasOldRef = placements.some((p: any) => p.id === "references");
    if (hasOldRef) {
      const refSide = placements.find((p: any) => p.id === "references")!.side;
      placements = placements.filter((p: any) => p.id !== "references");
      placements.push({ id: "citations", side: refSide });
      placements.push({ id: "bibliography", side: refSide });
      if (parsed.activeLeft === "references") parsed.activeLeft = "citations";
      if (parsed.activeRight === "references") parsed.activeRight = "citations";
    }
    // Migrate: replace old "comments" panel with "notes" + "revisions"
    const hasOldComments = placements.some((p: any) => p.id === "comments");
    if (hasOldComments) {
      const commentsSide = placements.find((p: any) => p.id === "comments")!.side;
      placements = placements.filter((p: any) => p.id !== "comments");
      placements.push({ id: "notes", side: commentsSide });
      placements.push({ id: "revisions", side: commentsSide });
      if (parsed.activeLeft === "comments") parsed.activeLeft = "revisions";
      if (parsed.activeRight === "comments") parsed.activeRight = "revisions";
    }
    // Migrate: standalone "suggestions" panel was folded into "revisions"
    // (suggestion cards now live alongside comment cards in one panel).
    const hasOldSuggestions = placements.some((p: any) => p.id === "suggestions");
    if (hasOldSuggestions) {
      placements = placements.filter((p: any) => p.id !== "suggestions");
      if (parsed.activeLeft === "suggestions") parsed.activeLeft = "revisions";
      if (parsed.activeRight === "suggestions") parsed.activeRight = "revisions";
    }
    // Migrate: presentation-pod panels (registry `defaultStripSide: null`,
    // e.g. "omni") must never have a side placement. A drag in an older
    // build could leave one persisted, which then leaks the panel back
    // onto the strip as a stray icon. Strip them on load.
    placements = placements.filter((p: any) => {
      // PANEL_REGISTRY is keyed by PanelKind; "blank" (a PanelId-only
      // layout slot) and unknown ids return undefined.
      const reg = (PANEL_REGISTRY as Record<string, { defaultStripSide: Side | null } | undefined>)[p.id];
      return !reg || reg.defaultStripSide !== null;
    });
    // Merge with defaults to handle new panels added in updates
    const existingIds = new Set(placements.map((p: PanelPlacement) => p.id));
    const merged = [...placements];
    for (const dp of DEFAULT_PREFS.placements) {
      if (!existingIds.has(dp.id)) merged.push(dp);
    }
    // Deep-merge printOptions so new toggles added to the schema get
    // their defaults instead of falling out when an old pref blob loads.
    const printOptions: PrintOptions = {
      ...DEFAULT_PREFS.printOptions,
      ...(parsed.printOptions ?? {}),
      elements: {
        ...DEFAULT_PREFS.printOptions.elements,
        ...(parsed.printOptions?.elements ?? {}),
      },
      panels: {
        ...DEFAULT_PREFS.printOptions.panels,
        ...(parsed.printOptions?.panels ?? {}),
      },
    };

    // Defensive unknown-id drop (THE ROOT FIX for the recurring stale-snapshot
    // incidents): subtractively scrub any panel id/key that is no longer a
    // member of its carrier's live registry SSOT, so a retired panel (e.g.
    // `quotations`) can never round-trip back through saved prefs → the
    // dev:preview snapshot → promote-defaults → shipped `*.defaults.json`.
    // Validated against the merged/effective values. placements +
    // printOptions.panels are filtered POST-merge, so even a stale entry baked
    // into DEFAULT_PREFS is scrubbed (the defaults JSON placements still lists
    // the retired `quotations` — it gets merged in then dropped here).
    // omniCategories' default is derived clean from OMNI_PANELS, so there the
    // filter guards the saved-blob path. Purely subtractive, order- and
    // side-preserving, malformed-safe; runs once per load (no per-render work).
    //   - placements          → PANEL_REGISTRY keys      (panel-registry.ts)
    //   - omniCategories       → OMNI_PANELS kinds        (panel-registry.ts)
    //   - printOptions.panels  → PRINT_PANELS keys        (lib/print.ts)
    const cleanedPlacements = filterPlacements<PanelPlacement>(merged);
    printOptions.panels = filterPrintPanels(printOptions.panels) as PrintOptions["panels"];
    const cleanedOmniCategories = filterOmniCategories(
      parsed.omniCategories ?? DEFAULT_PREFS.omniCategories,
    ) as ViewPrefs["omniCategories"];
    // Migrate the legacy ≤2-panel split model → the ordered dockStack.
    // Old persisted shape: activeLeft/Right (top/only) + active*Bottom
    // (split 2nd). New shape: dockStack (top→bottom, ≤MAX_STACK). When a
    // saved blob already carries dockStack (post-rework), clamp + use it;
    // otherwise coerce the legacy fields. Collapse/blank carry forward
    // from the old activeLeft sentinels (null = collapsed, "blank" = hidden
    // omni). The dead split keys are deleted so they never round-trip.
    const realPanel = (x: unknown): x is PanelId =>
      typeof x === "string" && x !== "omni" && x !== "blank";
    const legacyStack = (top: unknown, bottom: unknown): PanelId[] => {
      const out: PanelId[] = [];
      if (realPanel(top)) out.push(top);
      if (realPanel(bottom) && bottom !== top) out.push(bottom);
      return out;
    };
    const dockStack = clampStack(
      parsed.dockStack ?? {
        left: legacyStack(parsed.activeLeft, parsed.activeLeftBottom),
        right: legacyStack(parsed.activeRight, parsed.activeRightBottom),
      },
      // The SAME ceiling the runtime insertions enforce — never a second
      // literal (task 273).
      MAX_STACK,
    ) as ViewPrefs["dockStack"];
    const collapsedLeft = parsed.collapsedLeft ?? parsed.activeLeft === null;
    const collapsedRight = parsed.collapsedRight ?? parsed.activeRight === null;
    const blankLeft = parsed.blankLeft ?? parsed.activeLeft === "blank";
    const blankRight = parsed.blankRight ?? parsed.activeRight === "blank";
    for (const k of [
      "activeLeft", "activeRight", "activeLeftBottom", "activeRightBottom",
      "splitLeftRatio", "splitRightRatio", "splitLeftOrigin", "splitRightOrigin",
      "_stashedLeft", "_stashedRight", "dockSlots",
    ]) {
      delete (parsed as Record<string, unknown>)[k];
    }
    // Retired prefs: keys that were persisted by a past build and whose
    // FEATURE no longer exists. `loadPrefs` returns `{...DEFAULT_PREFS,
    // ...parsed}`, so without this a retired key survives as an untyped
    // member of the live prefs object and is re-serialized on every write —
    // forever, invisible to the type system, and ready to be read back with a
    // stale value by anything that reuses the name. Scrubbing here drops it
    // from the blob on the first write after upgrade.
    for (const k of RETIRED_PREF_KEYS) {
      delete (parsed as Record<string, unknown>)[k];
    }

    // Bug 5: popped-out PANELS now re-float on reload (the float rect already
    // persists via `floatPositions`; only the "is currently floating" state
    // was being dropped). Validate the stored list against the live layout so
    // a stale/retired id can never round-trip back into a float: keep only
    // real panels (not `omni`/`blank`), that survived placement cleaning
    // (`cleanedPlacements`), and are known `PANEL_REGISTRY` kinds. The MRU
    // reset below stays session-only (recency genuinely rebuilds).
    const placedIds = new Set(cleanedPlacements.map((pl) => pl.id));
    const validPanelId = (x: unknown): x is PanelId =>
      typeof x === "string" &&
      x !== "omni" &&
      x !== "blank" &&
      placedIds.has(x as PanelId) &&
      (PANEL_REGISTRY as Record<string, unknown>)[x] !== undefined;
    const survivingPoppedPanels: PanelId[] = Array.isArray(parsed.poppedOutPanels)
      ? (parsed.poppedOutPanels as unknown[]).filter(validPanelId)
      : [];
    const survivingPanelSet = new Set<PanelId>(survivingPoppedPanels);
    const survivingOrigins: ViewPrefs["poppedOutOrigins"] = {};
    if (parsed.poppedOutOrigins && typeof parsed.poppedOutOrigins === "object") {
      for (const [k, v] of Object.entries(
        parsed.poppedOutOrigins as Record<string, unknown>,
      )) {
        if (survivingPanelSet.has(k as PanelId) && (v === "top" || v === "bottom")) {
          survivingOrigins[k as PanelId] = v;
        }
      }
    }

    // Open layout (dockStack) + per-band heights (panelHeights) persist
    // per-window so a reload restores the open panels and their sizes;
    // recency (panelMRU) is session-only. Floats (poppedOutPanels) re-float
    // (validated above). panelModes / floatPositions / panelWidths persist.
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      placements: cleanedPlacements,
      printOptions,
      omniCategories: cleanedOmniCategories,
      dockStack,
      panelMRU: { left: [], right: [] },
      panelHeights:
        parsed.panelHeights && typeof parsed.panelHeights === "object"
          ? (parsed.panelHeights as ViewPrefs["panelHeights"])
          : {},
      collapsedLeft,
      collapsedRight,
      blankLeft,
      blankRight,
      poppedOutPanels: survivingPoppedPanels,
      poppedOutOrigins: survivingOrigins,
      panelModes: parsed.panelModes ?? {},
      floatPositions: parsed.floatPositions ?? {},
      panelWidths: parsed.panelWidths ?? {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Persistence mode for `useViewPrefs`.
 *  - `"global"` (default): the full localStorage round-trip + cross-window
 *    bus — the main app's behavior, unchanged.
 *  - `"ephemeral"`: in-memory only. Every setter, the stacked-panel engine,
 *    margins, popouts, and omni toggles run unchanged, but nothing reads
 *    from or writes to localStorage and no cross-window bus subscription is
 *    opened. Used by the Library Reader so its panel state is functional but
 *    session-only (it must never clobber the user's real editor layout). */
export type ViewPrefsPersistence = "global" | "ephemeral";

/** The full return shape of `useViewPrefs` — named so the shared
 *  `buildEditorPaneViewPrefs` builder (and the Reader) can type the bundle
 *  they assemble from it. Inferred from the hook so it never drifts. */
export type UseViewPrefsResult = ReturnType<typeof useViewPrefs>;

/** Seed ephemeral state from `DEFAULT_PREFS`, folding in ONLY the user's
 *  saved global page geometry + strip placements (read once, no subscribe) so
 *  the Reader opens at the same page width / margins / strip order the editor
 *  uses. Everything else (dock state, popouts, omni) starts fresh from
 *  defaults and lives in-memory. Falls back to `DEFAULT_PREFS` if the read or
 *  parse fails — never touches the per-window or legacy keys. */
function seedEphemeralPrefs(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const globalSlice = JSON.parse(raw) as Partial<ViewPrefs>;
    // Only fold in the page-geometry + placement globals as a starting point;
    // a deep merge of arbitrary global keys could re-introduce layout state we
    // intentionally want defaulted. Keep this list narrow and value-typed.
    const seed: ViewPrefs = { ...DEFAULT_PREFS };
    // Geometry fold — mirror `rereadGlobal` EXACTLY (loop `MARGIN_PREF_KEYS`) so
    // a new margin key added to that SSOT flows into BOTH the seed and the live
    // editor→Reader sync path, never one but not the other. `placements` is not
    // geometry, so it stays its own seed line below.
    for (const k of MARGIN_PREF_KEYS) {
      const v = globalSlice[k];
      if (typeof v === "number") seed[k] = v;
    }
    if (Array.isArray(globalSlice.placements)) {
      seed.placements = filterPlacements<PanelPlacement>(globalSlice.placements as PanelPlacement[]);
    }
    return seed;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useViewPrefs(opts?: {
  persistence?: ViewPrefsPersistence;
  /** EPHEMERAL-ONLY seed overrides applied ONCE at init (on top of
   *  `seedEphemeralPrefs()`). Lets a host set session-only starting state a
   *  reader wants — e.g. the Library inline reader seeds `collapsedLeft/Right:
   *  true` so the panel columns start folded in. Ignored in `global` mode (the
   *  persisted blob owns the state there). Read once by the useState initializer,
   *  so later changes to this object are inert. */
  initialOverrides?: Partial<ViewPrefs>;
}) {
  // `"global"` is the default; passing no arg is byte-identical to the prior
  // behavior. `"ephemeral"` gates off the three persistence touch-points
  // (initial load, cross-window subscribe, and `persist`) below.
  const ephemeral = opts?.persistence === "ephemeral";
  const initialOverrides = opts?.initialOverrides;
  const [prefs, setPrefs] = useState<ViewPrefs>(() =>
    // Ephemeral seeds from DEFAULT_PREFS, but folds in the user's existing
    // global page geometry / placements read ONCE at init (a pleasant
    // starting point — same page width / margins / strip order as the editor)
    // without subscribing to later changes, PLUS any `initialOverrides`. Global
    // mode starts from DEFAULT_PREFS and hydrates from localStorage in the load
    // effect below.
    ephemeral
      ? { ...seedEphemeralPrefs(), ...(initialOverrides ?? {}) }
      : DEFAULT_PREFS,
  );
  const initialized = useRef(false);
  // Deferred-persistence handoff: `update` records the change here (a pure ref
  // write) and the post-commit effect below flushes it. See the comment on
  // `update` for why persistence must NOT run inside the state updater.
  const pendingPersist = useRef<{ next: ViewPrefs; prev: ViewPrefs } | null>(
    null,
  );

  useEffect(() => {
    // (a) Initial-load-from-localStorage. Ephemeral mode skips it entirely —
    // its state was seeded in-memory from DEFAULT_PREFS (+ a one-shot global
    // geometry read) and must not be overwritten by the persisted layout.
    if (ephemeral) {
      initialized.current = true;
      return;
    }
    gcWindowPrefs(); // one-shot, module-guarded: prune stale per-window pref keys
    setPrefs(loadPrefs());
    initialized.current = true;
  }, [ephemeral]);

  // Listen for global pref changes published by peer windows. Re-read
  // the global slice and merge into local state. Per-window keys are
  // never broadcast — each window's layout is its own.
  useEffect(() => {
    // (b) Cross-window + same-window global-pref subscribe.
    //
    // Ephemeral mode (the Library Reader) opens a MARGIN-ONLY subscription: it
    // re-reads ONLY the page-geometry keys (`MARGIN_PREF_KEYS` — page width +
    // the four margins) so a margin change made in the main editor flows into
    // an open Reader and the Reader's prose measure stays in step. It still
    // never re-reads the layout keys (dock / popout / omni stay session-only)
    // and NEVER writes — this is a read-only merge of the geometry slice into
    // in-memory state. Global mode re-reads the WHOLE global slice as before.
    const rereadGlobal = () => {
      try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        if (!raw) return;
        const globalSlice = JSON.parse(raw) as Partial<ViewPrefs>;
        if (ephemeral) {
          // Pull only the value-typed numeric geometry keys; ignore everything
          // else in the blob so no layout state can leak into the Reader.
          const geo: Partial<ViewPrefs> = {};
          for (const k of MARGIN_PREF_KEYS) {
            const v = globalSlice[k];
            if (typeof v === "number") geo[k] = v;
          }
          if (Object.keys(geo).length > 0) {
            setPrefs((prev) => ({ ...prev, ...geo }));
          }
          return;
        }
        setPrefs((prev) => ({ ...prev, ...globalSlice }));
      } catch {
        // ignore parse failures
      }
    };
    const onEvent = (e: BusEvent) => {
      if (e.type !== "global-pref-changed") return;
      // Ephemeral: ignore non-geometry global changes outright so a peer's
      // dock/omni/placement change never wakes the Reader.
      if (ephemeral && !MARGIN_PREF_SET.has(e.key)) return;
      rereadGlobal();
    };
    const unsubBus = subscribe(onEvent);
    sameWindowListeners.add(rereadGlobal);
    return () => {
      unsubBus();
      sameWindowListeners.delete(rereadGlobal);
    };
  }, [ephemeral]);

  const persist = useCallback(
    (newPrefs: ViewPrefs, prevPrefs: ViewPrefs) => {
      // (c) Persist tail (localStorage.setItem + publish/notify). Ephemeral
      // mode never writes prefs to disk and never fans out to peers — the
      // setters still update in-memory state via the `update`/effect path
      // above; only this storage/notify tail is suppressed.
      if (ephemeral) return;
      try {
        const windowSlice: Record<string, unknown> = {};
        const globalSlice: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(newPrefs)) {
          if (GLOBAL_PREF_SET.has(k)) globalSlice[k] = v;
          else windowSlice[k] = v;
        }
        localStorage.setItem(windowStorageKey(), JSON.stringify(windowSlice));
        localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(globalSlice));
        // Notify peers when any global key changed. Cheap shallow
        // compare on the global keys is enough — values are JSON-serializable
        // primitives, arrays, or plain objects. We fan out twice: the bus
        // for other windows, and the same-window listeners set for sibling
        // `useViewPrefs` instances in this tab (Reader + EditorLayout).
        const newGlobal = pickGlobal(newPrefs);
        const prevGlobal = pickGlobal(prevPrefs);
        for (const k of GLOBAL_PREF_KEYS) {
          if (
            JSON.stringify(newGlobal[k]) !== JSON.stringify(prevGlobal[k])
          ) {
            publish({
              type: "global-pref-changed",
              key: k,
              value: newGlobal[k],
            });
            notifySameWindow();
            break;
          }
        }
      } catch {}
    },
    [ephemeral],
  );

  const update = useCallback((fn: (prev: ViewPrefs) => ViewPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      // DO NOT persist inside this updater. `persist` writes localStorage AND
      // notifies sibling instances via `notifySameWindow` → `rereadGlobal` →
      // a re-entrant `setPrefs`. React invokes a state updater more than once
      // per dispatch (the eager bail-out computation at dispatch time + the
      // render-phase queue replay), so persisting here fires that re-entrant
      // `setPrefs` MID-DISPATCH, prepending an update to the queue. On replay
      // the queue becomes [rereadGlobal-sets-the-new-value, toggle-applies-
      // `!value`-AGAIN], so a boolean toggle lands twice and reverts to its
      // original value — the "toggle won't stick / resets on reload" bug.
      // Instead record the change (a pure ref write, idempotent across the
      // re-invocations) and let the effect below persist it AFTER commit, where
      // a re-entrant setPrefs is harmless. Keep the batch's STARTING `prev` so
      // a multi-change batch still diffs every changed key for the peer notify.
      pendingPersist.current = {
        next,
        prev: pendingPersist.current?.prev ?? prev,
      };
      return next;
    });
  }, []);

  // Flush deferred persistence after a commit that ran an `update`. Gated on
  // the pending ref, so a plain re-render (including the one `rereadGlobal`
  // triggers) is an O(1) no-op (keystroke-sanctity safe); clearing the ref
  // BEFORE persisting breaks the persist→notify→rereadGlobal→render feedback
  // loop after exactly one pass.
  useEffect(() => {
    const pending = pendingPersist.current;
    if (!pending) return;
    pendingPersist.current = null;
    persist(pending.next, pending.prev);
  });

  /* ── Stacked-panel engine ─────────────────────────────────────────
   * The engine itself lives in `./view-prefs-dock` (pure, React-free, unit
   * -testable without rendering the hook). EVERY setter below routes its
   * dock mutation through `placeInStack` / `removeFromStack` / `closePanel`
   * / `openInMode` — none re-derives insertion, eviction or the MRU
   * coupling inline. That is the whole point of task 273, and the hook-body
   * census in `view-prefs-dock-engine.test.ts` keeps it true.
   *
   * Only side RESOLUTION stays here: it reads `placements` + the registry
   * rather than mutating dock state. */

  /** Resolve the target side for an open: explicit arg → strip placement
   *  → registry default → left. */
  function resolveSide(p: ViewPrefs, id: PanelId, side?: Side): Side {
    const placement = p.placements.find((pl) => pl.id === id);
    const registryEntry = (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[id];
    return side ?? placement?.side ?? registryEntry?.defaultStripSide ?? "left";
  }

  /**
   * Open a panel in its preferred mode (docked default, or floating if
   * the user has previously undocked it). Routes strip clicks, marker
   * clicks, and programmatic opens through one entry point.
   *
   * Docked: appends to the bottom of the target side's stack, evicting
   * the least-recently-used band if there's no room (see `placeInStack`).
   * Floating: appends to poppedOutPanels at the saved float rect (or a
   * fresh column-spawn rect if no rect saved). `freeSpacePx` is the
   * caller's one-shot measurement of the side's omni gap (docked path).
   */
  const openPanel = useCallback((id: PanelId, side?: Side, freeSpacePx?: number) => {
    if (id === "omni" || id === "blank") return;
    update((p) => {
      if (isPanelOpen(p, id)) return p;
      return openInMode(p, id, resolveSide(p, id, side), freeSpacePx);
    });
  }, [update]);

  // Back-compat alias: existing call sites using `openPanelFloat` keep
  // working but now respect the panel's preferred mode (which defaults
  // to docked for never-undocked panels).
  const openPanelFloat = openPanel;

  /**
   * Force-open a panel docked, ignoring its `panelModes` preference. Used
   * by L/R strip-icon clicks: a strip click is an intentional "give me
   * this panel docked" gesture and resets the panel's mode to "docked".
   * Appends to the bottom of the target side's stack; if the side is full
   * (no room and the newcomer doesn't fit the omni gap), the
   * least-recently-used band is closed to make room (see `placeInStack`).
   * `freeSpacePx` is the caller's one-shot measure of the side's omni gap.
   */
  const openPanelDocked = useCallback(
    (id: PanelId, side?: Side, freeSpacePx?: number) => {
      if (id === "omni" || id === "blank") return;
      update((p) => {
        if (isPanelOpen(p, id)) return p;
        return placeInStack(p, id, resolveSide(p, id, side), { freeSpacePx });
      });
    },
    [update],
  );

  // Legacy dock setters — kept as shims that route through openPanelFloat
  // so existing callers (marker clicks, search jump, command-input bridges,
  // etc.) get the new float-open behavior without per-call refactors.
  // Passing "omni"/"blank"/null is a no-op (those used to be valid dock
  // states; in the always-float model the column always shows omni).
  const setActiveLeft = useCallback((id: PanelId | null) => {
    if (!id || id === "omni" || id === "blank") return;
    openPanelFloat(id, "left");
  }, [openPanelFloat]);

  const setActiveRight = useCallback((id: PanelId | null) => {
    if (!id || id === "omni" || id === "blank") return;
    openPanelFloat(id, "right");
  }, [openPanelFloat]);

  const collapseLeft = useCallback(() => {
    update((p) => ({ ...p, collapsedLeft: true }));
  }, [update]);

  const collapseRight = useCallback(() => {
    update((p) => ({ ...p, collapsedRight: true }));
  }, [update]);

  const expandLeft = useCallback(() => {
    update((p) => ({ ...p, collapsedLeft: false }));
  }, [update]);

  const expandRight = useCallback(() => {
    update((p) => ({ ...p, collapsedRight: false }));
  }, [update]);

  /** Close any open panels and pop-outs, but leave the side columns
   *  themselves expanded (they fall back to the omni-view background).
   *  Leaves collapsed sides collapsed. */
  const closeAllPanels = useCallback(() => {
    // Panels via the engine; `poppedOutCards` is the CARD float axis, which
    // the dock engine deliberately doesn't own.
    update((p) => ({ ...closeAllPanelsIn(p), poppedOutCards: [] }));
  }, [update]);

  /** Suppress the omni background on a side (a clean, empty column).
   *  No-op for fully-collapsed sides. */
  const setBlank = useCallback((side: Side) => {
    update((p) => {
      if (side === "left") return p.collapsedLeft ? p : { ...p, blankLeft: true };
      return p.collapsedRight ? p : { ...p, blankRight: true };
    });
  }, [update]);

  /** Restore the omni background on any side currently blanked. Called
   *  when the user does something that should re-reveal omni (opens a
   *  panel, creates a card). */
  const clearBlankIfSet = useCallback(() => {
    update((p) => {
      if (!p.blankLeft && !p.blankRight) return p;
      return { ...p, blankLeft: false, blankRight: false };
    });
  }, [update]);

  // Strip-click toggle: open if closed, close if open. "Open" means
  // either docked (in a stack) or floating — closing removes the panel
  // from its stack and/or poppedOutPanels. The saved float rect persists
  // so re-opening floating restores size. `freeSpacePx` is the caller's
  // one-shot omni-gap measurement for the docked-open fit check.
  const togglePanel = useCallback(
    (id: PanelId, side?: Side, freeSpacePx?: number) => {
      if (id === "omni" || id === "blank") return;
      update((p) =>
        isPanelOpen(p, id)
          ? closePanel(p, id)
          : openInMode(p, id, resolveSide(p, id, side), freeSpacePx),
      );
    },
    [update],
  );

  const movePanel = useCallback((id: PanelId, toSide: Side, toIndex?: number) => {
    update((p) => {
      const filtered = p.placements.filter((pl) => pl.id !== id);
      const sameItems = filtered.filter((pl) => pl.side === toSide);
      const otherItems = filtered.filter((pl) => pl.side !== toSide);
      const idx = toIndex !== undefined ? Math.min(toIndex, sameItems.length) : sameItems.length;
      sameItems.splice(idx, 0, { id, side: toSide });
      let next: ViewPrefs = { ...p, placements: [...otherItems, ...sameItems] };
      // If the panel is currently docked on the OTHER side, relocate its
      // open band to the new side's stack so the band follows its icon.
      // `placeInStack` sheds the old position + its stale recency itself.
      const dockedSide = dockedSideOf(next, id);
      if (dockedSide && dockedSide !== toSide) next = placeInStack(next, id, toSide);
      return next;
    });
  }, [update]);

  const setPanelWidth = useCallback((side: Side, _id: PanelId, width: number) => {
    update((p) => ({
      ...p,
      panelWidths: { ...p.panelWidths, [side]: width },
    }));
  }, [update]);

  const getPanelWidth = useCallback((side: Side, _id: PanelId): number => {
    return prefs.panelWidths[side] || 320;
  }, [prefs.panelWidths]);

  /** Persist a per-panel band height in px (a resize). */
  const setPanelHeight = useCallback((id: PanelId, px: number) => {
    update((p) => ({
      ...p,
      panelHeights: { ...p.panelHeights, [id]: Math.max(MIN_BAND_PX, Math.round(px)) },
    }));
  }, [update]);

  /** Clear a panel's height override → back to content-sized. */
  const clearPanelHeight = useCallback((id: PanelId) => {
    update((p) => {
      if (p.panelHeights[id] == null) return p;
      const { [id]: _dropped, ...rest } = p.panelHeights;
      return { ...p, panelHeights: rest };
    });
  }, [update]);

  /** Set two adjacent bands' heights at once — a divider "trade", where
   *  the boundary between `aboveId` and `belowId` slides (the caller
   *  conserves their sum). */
  const tradePanelHeights = useCallback(
    (aboveId: PanelId, aboveH: number, belowId: PanelId, belowH: number) => {
      update((p) => ({
        ...p,
        panelHeights: {
          ...p.panelHeights,
          [aboveId]: Math.max(MIN_BAND_PX, Math.round(aboveH)),
          [belowId]: Math.max(MIN_BAND_PX, Math.round(belowH)),
        },
      }));
    },
    [update],
  );

  /** Note an interaction with a docked panel (open / click / scroll /
   *  focus) → bump it to most-recent on its side, for LRU eviction. */
  const notePanelUse = useCallback((side: Side, id: PanelId) => {
    update((p) => notePanelUseIn(p, side, id));
  }, [update]);

  /* ── The registry-driven view-pref writers (task 274) ─────────────
   *
   * THREE doors, one per `kind`, and NOTHING else writes a registry field.
   * Every pref this hook stores under `VIEW_PREF_REGISTRY` is written by key
   * through one of them, so a new toggle / enum / set pref is ONE registry row
   * with no new setter, no new prop, and no new thread through EditorLayout →
   * EditorPane → MenuBar.
   *
   * Before this, ten hand-written twins sat beside these — `toggleParTitles`,
   * `toggleLatexComments`, `toggleMarginalia`, `toggleHeadingLabels`,
   * `setShowHighlights`, `setDividerWidth`, `setBibFilter`,
   * `toggleHighlightType`, `toggleMarginaliaType`, `toggleDividerLevel` — each
   * byte-equivalent to the generic path for its `kind`, each threaded through
   * four layers by name. Nothing forced the copies to agree; the set-member
   * trio were three copies of one includes/filter/append. They are retired, and
   * `view-pref-writer-ssot.test.ts` fails any spread-update in this file that
   * names a registry key, so a twin can't quietly reappear.
   */

  /** Write any single registry field by key. Refuses keys not in
   *  `VIEW_PREF_REGISTRY` so a typo can't silently smear a non-pref field.
   *  Persistence scope is decided by the registry's `scope`. */
  const setViewPref = useCallback(
    <K extends ViewPrefKey>(key: K, value: RegistryPrefs[K]) => {
      if (!(key in VIEW_PREF_REGISTRY)) return;
      update((p) => ({ ...p, [key]: value }));
    },
    [update],
  );

  /** Flip a boolean (`kind: "toggle"`) registry field. A no-op for non-toggle
   *  keys (guards at runtime as well as in the type). */
  const toggleViewPref = useCallback(
    (key: ViewPrefKey) => {
      const def = VIEW_PREF_REGISTRY[key];
      if (!def || def.kind !== "toggle") return;
      update((p) => ({ ...p, [key]: !(p as RegistryPrefs)[key] }));
    },
    [update],
  );

  /**
   * Add/remove one member of an array (`kind: "set"`) registry field — the
   * generic form of the three set-membership togglers this replaced. A no-op
   * for non-set keys (guards at runtime as well as in the type).
   *
   * Deliberately does NOT validate `member ∈ def.members`: the registry's own
   * contract says a stored `set` value may legitimately include members the
   * MENU doesn't render (the header on `VIEW_PREF_REGISTRY` names the "report"
   * marginalia type), so a membership check would silently no-op exactly those
   * — a behaviour change wearing a guard's clothes. `members` is the render
   * vocabulary; the stored array is the value.
   */
  const toggleViewPrefMember = useCallback(
    <K extends SetViewPrefKey>(key: K, member: ViewPrefMember<K>) => {
      const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef | undefined;
      if (!def || def.kind !== "set") return;
      update((p) => {
        const list = (p as RegistryPrefs)[key] as readonly (string | number)[];
        const m = member as string | number;
        const next = list.includes(m) ? list.filter((x) => x !== m) : [...list, m];
        return { ...p, [key]: next };
      });
    },
    [update],
  );

  const toggleOmniCategory = useCallback(
    (side: "left" | "right", cat: OmniCategory) => {
      update((p) => {
        const list = p.omniCategories[side];
        const next = list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat];
        return { ...p, omniCategories: { ...p.omniCategories, [side]: next } };
      });
    },
    [update],
  );

  const resetOmniSide = useCallback((side: "left" | "right") => {
    update((p) => ({
      ...p,
      omniCategories: { ...p.omniCategories, [side]: [...DEFAULT_OMNI_CATEGORIES[side]] },
    }));
  }, [update]);

  const toggleOmniHideAllCards = useCallback((side: "left" | "right") => {
    update((p) => ({
      ...p,
      omniHideAllCards: { ...p.omniHideAllCards, [side]: !p.omniHideAllCards[side] },
    }));
  }, [update]);

  /* ── Card archive view ──────────────────────────────────────────── */

  /** Set a card panel's archive view mode (active / archived / all). */
  const setCardArchiveView = useCallback(
    (panel: PanelId, mode: CardArchiveView) => {
      update((p) => ({
        ...p,
        cardArchiveView: { ...p.cardArchiveView, [panel]: mode },
      }));
    },
    [update],
  );

  /** Persist the "don't ask again" choice for the atom-archive confirm. */
  const setSuppressArchiveAtomWarning = useCallback((v: boolean) => {
    update((p) => ({ ...p, suppressArchiveAtomWarning: v }));
  }, [update]);

  /**
   * Close a panel — works for either a docked or a floating panel.
   * Preserves panelModes[id] and floatPositions[id] so re-opening
   * restores the saved size and mode preference. Reload-clear of
   * dockSlots happens in loadPrefs, not here.
   */
  const closePopout = useCallback((id: PanelId) => {
    update((p) => {
      const { [id]: _droppedOrigin, ...remainingOrigins } = p.poppedOutOrigins;
      // `closePanel` drops the band, its recency and the float;
      // floatPositions + panelHeights intentionally unchanged (the user's
      // pinned size sticks across close/open cycles). Only the split-half
      // ORIGIN is forgotten, which is this setter's own business.
      return { ...closePanel(p, id), poppedOutOrigins: remainingOrigins };
    });
  }, [update]);

  /**
   * Toggle a panel's open state. Mode-aware: opens via the panel's
   * preferred mode (defaults to docked).
   */
  const togglePopout = useCallback((id: PanelId) => {
    update((p) =>
      isPanelOpen(p, id) ? closePanel(p, id) : openInMode(p, id, resolveSide(p, id)),
    );
  }, [update]);

  /**
   * Atomic flip from docked → floating. Called by the dock chrome's
   * drag handler the moment the cursor moves past the dock socket.
   * Updates panelModes so future opens default to floating, drops the
   * panel from its dock slot, and seeds the floating rect.
   */
  const undockPanel = useCallback(
    (id: PanelId, initialFloatRect: { x: number; y: number; width: number; height: number }) => {
      update((p) => undockToFloat(p, id, initialFloatRect));
    },
    [update],
  );

  /**
   * Atomic flip from floating → docked. Called by drag-to-redock when
   * a floating panel is released over a dock slot. Removes the panel
   * from poppedOutPanels, places it in the slot, and updates
   * panelModes so future opens default to docked.
   */
  const redockPanel = useCallback(
    (id: PanelId, side: Side, index?: number) => {
      // The SAME insertion the strip-click open takes, at the user's chosen
      // slot — so the sentinel clear (task 272: a band's portal target only
      // exists in an expanded, non-blank column, or the just-docked panel
      // renders nothing) falls out for free rather than being re-derived.
      // No `freeSpacePx`: a drag-drop has no measurement, and a deliberate
      // drop shouldn't be refused — or cost a DIFFERENT band — for
      // breathing room. Only the hard `MAX_STACK` cap evicts here.
      update((p) => placeInStack(p, id, side, { index }));
    },
    [update],
  );

  const setFloatPosition = useCallback(
    (id: PanelId, pos: { x: number; y: number; width: number; height: number }) => {
      update((p) => ({ ...p, floatPositions: { ...p.floatPositions, [id]: pos } }));
    },
    [update],
  );

  const toggleCardPopout = useCallback((key: string) => {
    update((p) => {
      const isPopped = p.poppedOutCards.includes(key);
      if (isPopped) {
        // Re-dock: forget the dragged float position so next pop spawns
        // fresh from the trigger.
        const { [key]: _droppedPos, ...remainingPositions } = p.cardFloatPositions;
        return {
          ...p,
          poppedOutCards: p.poppedOutCards.filter((x) => x !== key),
          cardFloatPositions: remainingPositions,
        };
      }
      return {
        ...p,
        poppedOutCards: [...p.poppedOutCards, key],
      };
    });
  }, [update]);

  const closeCardPopout = useCallback((key: string) => {
    update((p) => {
      const { [key]: _droppedPos, ...remainingPositions } = p.cardFloatPositions;
      return {
        ...p,
        poppedOutCards: p.poppedOutCards.filter((x) => x !== key),
        cardFloatPositions: remainingPositions,
      };
    });
  }, [update]);

  const setCardFloatPosition = useCallback(
    (key: string, pos: { x: number; y: number; width: number; height: number }) => {
      update((p) => ({ ...p, cardFloatPositions: { ...p.cardFloatPositions, [key]: pos } }));
    },
    [update],
  );

  /**
   * Apply a per-key migration to the popout keys, in LOCKSTEP across both
   * `poppedOutCards` AND `cardFloatPositions`, so a saved rect follows its key
   * to the new grammar (never orphans). `mapKey` returns the new key, or `null`
   * to drop it. No-op (no prefs write) when nothing changed. Used by the
   * doc-aware post-load leg that resolves legacy `list:`/`example:` keys to
   * `float:textobject:…` vs `float:card:example:…` using the editor doc.
   */
  const migratePoppedOutCards = useCallback(
    (mapKey: (key: string) => string | null) => {
      update((p) => {
        const result = migrateFloatKeys(
          p.poppedOutCards,
          p.cardFloatPositions,
          mapKey,
        );
        if (!result.changed) return p;
        return {
          ...p,
          poppedOutCards: result.keys,
          cardFloatPositions: result.positions,
        };
      });
    },
    [update],
  );

  const setCodePaneRatio = useCallback((ratio: number) => {
    update((p) => ({ ...p, codePaneRatio: Math.max(0.05, Math.min(0.95, ratio)) }));
  }, [update]);

  const setPageWidth = useCallback((w: number) => {
    update((p) => ({ ...p, pageWidth: Math.max(400, Math.min(1600, w)) }));
  }, [update]);

  const setEditorLeftMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorLeftMargin: Math.max(72, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setEditorRightMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorRightMargin: Math.max(24, Math.min(240, Math.round(px))) }));
  }, [update]);

  // The persist-side floors here MUST mirror the drag-side floors in
  // `MARGIN_MIN` (useMarginEdit). If they drift, a drag below the persist
  // floor commits clamped and the margin "snaps back" on the checkmark.
  // top/bottom floor at 0 (chip 9 — slider reaches the pod edge); left 72 /
  // right 24 above match `MARGIN_MIN.left/right` (chip 8). Guarded by
  // useMarginEdit-topbottom-floor.test.ts.
  const setEditorTopMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorTopMargin: Math.max(0, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setEditorBottomMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorBottomMargin: Math.max(0, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setPrintOptions = useCallback(
    (v: PrintOptions | ((prev: PrintOptions) => PrintOptions)) => {
      update((p) => ({
        ...p,
        printOptions: typeof v === "function" ? v(p.printOptions) : v,
      }));
    },
    [update],
  );

  const setTopbarRightCollapsed = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      update((p) => ({
        ...p,
        topbarRightCollapsed:
          typeof v === "function" ? v(p.topbarRightCollapsed) : v,
      }));
    },
    [update],
  );

  const leftItems = prefs.placements.filter((p) => p.side === "left");
  const rightItems = prefs.placements.filter((p) => p.side === "right");

  // Referential stability: this hook runs on every render of its host
  // (EditorLayout / the Reader). A bare object literal here would hand every
  // consumer a fresh identity on EVERY host render — including non-prefs bumps
  // (pdfStale / focus / presence) that touch none of these inputs. Downstream,
  // EditorLayout's `editorPaneViewPrefs` memo depends on this whole object, so a
  // fresh identity made it recompute every render, which cascaded into
  // EditorPane's `poppedCardsValue` memo and re-rendered every float / grab
  // handle / LiftHost consumer. Memoizing here restores the pre-refactor
  // stability: the result only changes when `prefs` does. `prefs` is the sole
  // changing input — `leftItems`/`rightItems` derive purely from it, and every
  // setter/toggle/getter below is a referentially-stable `useCallback`, so they
  // need not (and cannot meaningfully) be listed as deps.
  return useMemo(() => ({
    prefs,
    leftItems,
    rightItems,
    setActiveLeft,
    setActiveRight,
    collapseLeft,
    collapseRight,
    expandLeft,
    expandRight,
    closeAllPanels,
    setBlank,
    clearBlankIfSet,
    togglePanel,
    movePanel,
    setPanelWidth,
    getPanelWidth,
    setPanelHeight,
    clearPanelHeight,
    tradePanelHeights,
    notePanelUse,
    setCodePaneRatio,
    setPageWidth,
    setEditorLeftMargin,
    setEditorRightMargin,
    setEditorTopMargin,
    setEditorBottomMargin,
    setViewPref,
    toggleViewPref,
    toggleViewPrefMember,
    toggleOmniCategory,
    resetOmniSide,
    toggleOmniHideAllCards,
    setCardArchiveView,
    setSuppressArchiveAtomWarning,
    togglePopout,
    closePopout,
    openPanel,
    openPanelFloat,
    openPanelDocked,
    undockPanel,
    redockPanel,
    setFloatPosition,
    toggleCardPopout,
    closeCardPopout,
    setCardFloatPosition,
    migratePoppedOutCards,
    setPrintOptions,
    setTopbarRightCollapsed,
    // `prefs` is the only changing input; `leftItems`/`rightItems` derive purely
    // from it and every setter/toggle/getter is a stable `useCallback` (see the
    // block comment above the `useMemo`). The result only changes when `prefs`
    // does — listing the ~60 stable members would add noise without changing
    // behavior, so the dep list is intentionally `[prefs]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [prefs]);
}
