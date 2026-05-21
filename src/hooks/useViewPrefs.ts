"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "@/lib/print";
import { computeColumnSpawnRect } from "@/components/editor-layout/spawn-position";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { getWindowId } from "@/lib/multi-window/window-id";
import { publish, subscribe, type BusEvent } from "@/lib/multi-window/bus";
import { DEFAULT_OMNI_CATEGORIES, migrateOmniCategories, type OmniCategory } from "@/panels/Omni/OmniViewPanel";
import defaultPrefsJson from "./useViewPrefs.defaults.json";

/** Marginalia card kinds whose visibility is toggled from the View menu. */
export type MarginaliaType = "quote" | "note" | "archive" | "todo";
/** Heading depths 0–6, matching LaTeX (part…subparagraph). */
export type DividerLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** Heading-divider drawing width. */
export type DividerWidth = "full" | "mid" | "text";

export type PanelId = "notes" | "revisions" | "archive" | "footnotes" | "citations" | "bibliography" | "outline" | "todo" | "cutter" | "quotations" | "examples" | "search" | "wordcount" | "errors" | "blank" | "omni";

/** Card kinds whose linked-anchor highlights are togglable from the
 *  Highlights menu. Values match the prefix of `data-link-card`. */
export type HighlightType =
  | "quotation"
  | "note"
  | "todo"
  | "comment"
  | "cut";

export const ALL_HIGHLIGHT_TYPES: HighlightType[] = [
  "quotation",
  "note",
  "todo",
  "comment",
  "cut",
];
export type Side = "left" | "right";

export interface PanelPlacement {
  id: PanelId;
  side: Side;
}

export type Half = "top" | "bottom";

/** A panel can sit in the gutter dock (default) or as a free-floating
 *  window. The mode is per-panel and persists across reloads. */
export type PanelMode = "docked" | "floating";

/** One dock slot per side per half. When the side's split is off, the
 *  single slot is keyed `${side}-full`; when split, halves are
 *  `${side}-top` and `${side}-bottom`. */
export type DockSlotKey =
  | "left-full" | "left-top" | "left-bottom"
  | "right-full" | "right-top" | "right-bottom";

export function dockSlotKey(side: Side, half: Half | "full"): DockSlotKey {
  return `${side}-${half}` as DockSlotKey;
}

/** Where the floating MenuBar sits. "home" = docked in the Virgil top bar,
 *  centered over the document (the default). "free" = free-floating at a
 *  specific viewport coordinate (after the user dragged the toolbar out
 *  of the top bar). */
export type MenuLocation =
  | { kind: "home" }
  | { kind: "free"; left: number; top: number };

export interface ViewPrefs {
  placements: PanelPlacement[];
  /** Top half (or only half when not split). */
  activeLeft: PanelId | null;
  activeRight: PanelId | null;
  /** Bottom half — null when the side is not split. */
  activeLeftBottom: PanelId | null;
  activeRightBottom: PanelId | null;
  /** Stashed panel state for restore on expand after collapse. */
  _stashedLeft?: { top: PanelId; bottom: PanelId | null } | null;
  _stashedRight?: { top: PanelId; bottom: PanelId | null } | null;
  /** 0..1 — top half height ratio when the side is split. */
  splitLeftRatio: number;
  splitRightRatio: number;
  /** Provenance of the current split. `"user"` = user clicked the
   *  split-toggle icon (persists with empty halves when one panel
   *  closes). `"auto"` = engaged automatically when a 2nd panel was
   *  opened on the side (self-disengages back to single-slot when a
   *  panel closes and only one or zero remain). `null` when not split. */
  splitLeftOrigin: "auto" | "user" | null;
  splitRightOrigin: "auto" | "user" | null;
  panelWidths: Record<string, number>; // keyed by `${side}-${panelId}`
  /** Whether the main editor is split into two panes. */
  editorSplit: boolean;
  /** 0..1 — top pane ratio when editor is split. */
  editorSplitRatio: number;
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
  /** Currently-occupied dock slots: which panel id (if any) is sitting
   *  in each slot. Session-only (cleared on reload — opening is a
   *  session gesture, not a saved layout). */
  dockSlots: Partial<Record<DockSlotKey, PanelId>>;
  /** Cards currently displayed as floating windows — keys shaped `${kind}:${id}`. */
  poppedOutCards: string[];
  /** Saved position/size of each floating card, keyed by card key. */
  cardFloatPositions: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Master switch for highlight-style decorations in the main text.
   *  When false, all per-kind highlights below are suppressed
   *  regardless of `hiddenHighlightTypes`. */
  showHighlights: boolean;
  /** Per-kind suppression — each entry hides one card-kind's highlight.
   *  Stored as an array (rather than a Set) so it round-trips through
   *  JSON. Values use the CardKind names that appear in the
   *  `data-link-card` prefix: "quotation", "note", "todo", "comment"
   *  (= revisions panel), "cut". */
  hiddenHighlightTypes: HighlightType[];
  /** Location of the floating MenuBar. Defaults to "home" (docked in the
   *  Virgil top bar, centered over the document). */
  menuLocation: MenuLocation;
  /** Preferred width of the editor "page" in pixels. The page is the
   *  solid element of the layout — panels and margins flex around it to
   *  absorb window resizes. Drag on panel or zen-margin inner edges
   *  updates this pref. */
  pageWidth: number;
  /** Preferred heights of the top and bottom gutters above/below the
   *  text page, in pixels. Window-shrink eats these first before
   *  touching the page's 400 min-height. */
  topGutter: number;
  bottomGutter: number;
  /** In-editor text margins (padding inside the editor pod), in pixels.
   *  The left margin must clear the 72px marginalia gutter plus an 8px
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

  /** Master switch for marginalia (linked-card halos in the side
   *  margins). When false, every marginalia kind is suppressed. */
  showMarginalia: boolean;
  /** Per-kind suppression for marginalia. Array form (not Set) so it
   *  round-trips through JSON. */
  hiddenMarginaliaTypes: MarginaliaType[];
  /** Show the section-indicator lozenge floating over the document. */
  showSectionIndicator: boolean;
  /** Show inline heading-kind labels next to headings (Part / Chapter /
   *  Section / …). */
  showHeadingLabels: boolean;
  /** Heading depths whose dividers (horizontal rules above the heading)
   *  are drawn. Array form (not Set) so it round-trips through JSON. */
  dividerLevels: DividerLevel[];
  /** Width policy for heading dividers. */
  dividerWidth: DividerWidth;
  /** Omni-view filter chips: which card categories are enabled on each
   *  side. */
  omniCategories: Record<"left" | "right", OmniCategory[]>;
  /** Sticky "hide all cards in omni-view" toggle per side. */
  omniHideAllCards: { left: boolean; right: boolean };
}

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
// `printOptions` is filled in from DEFAULT_PRINT_OPTIONS (owned by
// print.ts) and `omniCategories` from DEFAULT_OMNI_CATEGORIES (derived
// from the panel registry) rather than duplicated into the JSON.
const DEFAULT_PREFS: ViewPrefs = {
  ...(defaultPrefsJson as Omit<ViewPrefs, "printOptions" | "omniCategories">),
  printOptions: DEFAULT_PRINT_OPTIONS,
  omniCategories: DEFAULT_OMNI_CATEGORIES,
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
 * Page-layout keys (`pageWidth`, `editor{Left,Right,Top,Bottom}Margin`,
 * `topGutter`, `bottomGutter`) are global because they're the values
 * the personal-prefs promotion pipeline reads to bake into shipped
 * defaults — see `tools/promote-defaults.mjs` and the whitelist in
 * `src/lib/dev-prefs-registry.json`.
 */
const GLOBAL_PREF_KEYS = [
  "showHighlights",
  "hiddenHighlightTypes",
  "printOptions",
  "placements",
  "pageWidth",
  "editorLeftMargin",
  "editorRightMargin",
  "editorTopMargin",
  "editorBottomMargin",
  "topGutter",
  "bottomGutter",
  "showMarginalia",
  "hiddenMarginaliaTypes",
  "showSectionIndicator",
  "showHeadingLabels",
  "dividerLevels",
  "dividerWidth",
  "omniCategories",
  "omniHideAllCards",
] as const;
type GlobalPrefKey = (typeof GLOBAL_PREF_KEYS)[number];
const GLOBAL_PREF_SET = new Set<string>(GLOBAL_PREF_KEYS);

function windowStorageKey(): string {
  return WINDOW_STORAGE_PREFIX + getWindowId();
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
  return {
    showHighlights: p.showHighlights,
    hiddenHighlightTypes: p.hiddenHighlightTypes,
    printOptions: p.printOptions,
    placements: p.placements,
    pageWidth: p.pageWidth,
    editorLeftMargin: p.editorLeftMargin,
    editorRightMargin: p.editorRightMargin,
    editorTopMargin: p.editorTopMargin,
    editorBottomMargin: p.editorBottomMargin,
    topGutter: p.topGutter,
    bottomGutter: p.bottomGutter,
    showMarginalia: p.showMarginalia,
    hiddenMarginaliaTypes: p.hiddenMarginaliaTypes,
    showSectionIndicator: p.showSectionIndicator,
    showHeadingLabels: p.showHeadingLabels,
    dividerLevels: p.dividerLevels,
    dividerWidth: p.dividerWidth,
    omniCategories: p.omniCategories,
    omniHideAllCards: p.omniHideAllCards,
  };
}

function loadPrefs(): ViewPrefs {
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
      { key: "virgil-show-section-indicator", field: "showSectionIndicator", parse: (r) => r !== "false" },
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
    // Legacy dock-state fields kept clamped to "omni in slot": the
    // omni-side detection and marginalia connectors still read
    // activeLeft/Right to identify the omni column. Splits are off by
    // default; the new dock model can re-enable them via toggleSplit.
    //
    // Open state (poppedOutPanels, dockSlots) is session-only: a reload
    // starts with no panels open. Mode prefs (panelModes), saved float
    // rects (floatPositions), and gutter widths (panelWidths) DO persist
    // so reopening a panel restores its last mode + rect, and the
    // editor pod's surrounding gutters keep their dragged size.
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      placements: merged,
      printOptions,
      activeLeft: "omni",
      activeRight: "omni",
      activeLeftBottom: null,
      activeRightBottom: null,
      splitLeftOrigin: null,
      splitRightOrigin: null,
      _stashedLeft: null,
      _stashedRight: null,
      poppedOutPanels: [],
      poppedOutOrigins: {},
      dockSlots: {},
      panelModes: parsed.panelModes ?? {},
      floatPositions: parsed.floatPositions ?? {},
      panelWidths: parsed.panelWidths ?? {},
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useViewPrefs() {
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_PREFS);
  const initialized = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    initialized.current = true;
  }, []);

  // Listen for global pref changes published by peer windows. Re-read
  // the global slice and merge into local state. Per-window keys are
  // never broadcast — each window's layout is its own.
  useEffect(() => {
    const rereadGlobal = () => {
      try {
        const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
        if (!raw) return;
        const globalSlice = JSON.parse(raw) as Partial<ViewPrefs>;
        setPrefs((prev) => ({ ...prev, ...globalSlice }));
      } catch {
        // ignore parse failures
      }
    };
    const onEvent = (e: BusEvent) => {
      if (e.type !== "global-pref-changed") return;
      rereadGlobal();
    };
    const unsubBus = subscribe(onEvent);
    sameWindowListeners.add(rereadGlobal);
    return () => {
      unsubBus();
      sameWindowListeners.delete(rereadGlobal);
    };
  }, []);

  const persist = useCallback(
    (newPrefs: ViewPrefs, prevPrefs: ViewPrefs) => {
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
    [],
  );

  const update = useCallback((fn: (prev: ViewPrefs) => ViewPrefs) => {
    setPrefs((prev) => {
      const next = fn(prev);
      persist(next, prev);
      return next;
    });
  }, [persist]);

  /** Return a free dock slot on `side`, or null if none. Prefers `top`
   *  in split mode, falls back to `bottom`. Single-slot mode uses
   *  `${side}-full`. */
  function findOpenDockSlot(p: ViewPrefs, side: Side): DockSlotKey | null {
    const isSplit =
      side === "left" ? p.activeLeftBottom != null : p.activeRightBottom != null;
    const candidates: DockSlotKey[] = isSplit
      ? [dockSlotKey(side, "top"), dockSlotKey(side, "bottom")]
      : [dockSlotKey(side, "full")];
    for (const k of candidates) {
      if (!p.dockSlots[k]) return k;
    }
    return null;
  }

  /** Plan where `id` should land on `side`. Returns a partial state
   *  patch describing the placement, or null if no docked slot is
   *  available (caller decides: fall through to floating, or replace
   *  the canonical slot). Cases:
   *  - side already split with a free half → drop into the free half
   *  - side not split, `${side}-full` empty → drop into full
   *  - side not split, `${side}-full` occupied → auto-engage split:
   *    migrate the existing full occupant to `${side}-top`, place
   *    `id` in `${side}-bottom`, set origin "auto", ratio stays at
   *    its persisted value (default 0.5).
   *  - side already split with both halves occupied → null (no room) */
  function planSlotAssignment(
    p: ViewPrefs,
    side: Side,
    id: PanelId,
  ): Partial<ViewPrefs> | null {
    const isSplit =
      side === "left" ? p.activeLeftBottom != null : p.activeRightBottom != null;
    const fullKey = dockSlotKey(side, "full");
    const topKey = dockSlotKey(side, "top");
    const bottomKey = dockSlotKey(side, "bottom");
    if (isSplit) {
      if (!p.dockSlots[topKey]) {
        return { dockSlots: { ...p.dockSlots, [topKey]: id } };
      }
      if (!p.dockSlots[bottomKey]) {
        return { dockSlots: { ...p.dockSlots, [bottomKey]: id } };
      }
      return null;
    }
    if (!p.dockSlots[fullKey]) {
      return { dockSlots: { ...p.dockSlots, [fullKey]: id } };
    }
    // Auto-engage split: migrate existing full occupant to top, new to bottom.
    const existing = p.dockSlots[fullKey]!;
    const nextDockSlots: Partial<Record<DockSlotKey, PanelId>> = { ...p.dockSlots };
    delete nextDockSlots[fullKey];
    nextDockSlots[topKey] = existing;
    nextDockSlots[bottomKey] = id;
    return side === "left"
      ? {
          dockSlots: nextDockSlots,
          activeLeftBottom: id,
          splitLeftOrigin: "auto",
        }
      : {
          dockSlots: nextDockSlots,
          activeRightBottom: id,
          splitRightOrigin: "auto",
        };
  }

  /** When a panel closes on a split side whose origin is "auto", and
   *  one or zero panels remain on the side, collapse the split back
   *  to single-slot mode: migrate any remaining occupant to
   *  `${side}-full`, clear the bottom marker, clear the origin.
   *  User-toggled splits (origin "user") persist with empty halves —
   *  the user has to click the split toggle again to dismiss them.
   *  Returns a partial patch including the (possibly updated)
   *  dockSlots. Callers pass in their post-close dockSlots and merge
   *  the result. */
  function autoDisengageIfNeeded(
    p: ViewPrefs,
    side: Side,
    nextDockSlots: Partial<Record<DockSlotKey, PanelId>>,
  ): Partial<ViewPrefs> {
    const origin = side === "left" ? p.splitLeftOrigin : p.splitRightOrigin;
    if (origin !== "auto") return { dockSlots: nextDockSlots };
    const fullKey = dockSlotKey(side, "full");
    const topKey = dockSlotKey(side, "top");
    const bottomKey = dockSlotKey(side, "bottom");
    const top = nextDockSlots[topKey];
    const bottom = nextDockSlots[bottomKey];
    const occupiedCount = (top ? 1 : 0) + (bottom ? 1 : 0);
    if (occupiedCount >= 2) return { dockSlots: nextDockSlots };
    const remaining = top ?? bottom;
    const finalDockSlots = { ...nextDockSlots };
    delete finalDockSlots[topKey];
    delete finalDockSlots[bottomKey];
    if (remaining) finalDockSlots[fullKey] = remaining;
    return side === "left"
      ? {
          dockSlots: finalDockSlots,
          activeLeftBottom: null,
          splitLeftOrigin: null,
        }
      : {
          dockSlots: finalDockSlots,
          activeRightBottom: null,
          splitRightOrigin: null,
        };
  }

  /** True when `id` is currently open in any form (docked or floating). */
  function isPanelOpen(p: ViewPrefs, id: PanelId): boolean {
    if (p.poppedOutPanels.includes(id)) return true;
    return Object.values(p.dockSlots).includes(id);
  }

  /** Find the dock slot currently holding `id`, if any. */
  function findDockSlotForPanel(
    p: ViewPrefs,
    id: PanelId,
  ): DockSlotKey | null {
    for (const k of Object.keys(p.dockSlots) as DockSlotKey[]) {
      if (p.dockSlots[k] === id) return k;
    }
    return null;
  }

  /**
   * Open a panel in its preferred mode (docked default, or floating if
   * the user has previously undocked it). Routes strip clicks, marker
   * clicks, and programmatic opens through one entry point.
   *
   * Docked: assigns the panel to a free dock slot on `side` (top first
   * in split mode). If no slot is free, falls back to floating.
   * Floating: appends to poppedOutPanels at the saved float rect (or a
   * fresh column-spawn rect if no rect saved).
   */
  const openPanel = useCallback((id: PanelId, side?: Side) => {
    if (id === "omni" || id === "blank") return;
    update((p) => {
      if (isPanelOpen(p, id)) return p;
      const placement = p.placements.find((pl) => pl.id === id);
      const registryEntry = (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[id];
      const targetSide: Side =
        side ?? placement?.side ?? registryEntry?.defaultStripSide ?? "left";
      const mode: PanelMode = p.panelModes[id] ?? "docked";

      if (mode === "docked") {
        const plan = planSlotAssignment(p, targetSide, id);
        if (plan) {
          return { ...p, ...plan };
        }
        // Both halves of a split side are occupied — fall through to floating.
      }
      const savedRect = p.floatPositions[id];
      const rect = savedRect ?? computeColumnSpawnRect(targetSide);
      return {
        ...p,
        poppedOutPanels: [...p.poppedOutPanels, id],
        floatPositions: { ...p.floatPositions, [id]: rect },
      };
    });
  }, [update]);

  // Back-compat alias: existing call sites using `openPanelFloat` keep
  // working but now respect the panel's preferred mode (which defaults
  // to docked for never-undocked panels).
  const openPanelFloat = openPanel;

  /**
   * Force-open a panel into a dock slot, ignoring its `panelModes`
   * preference. Used by L/R strip-icon clicks: a strip click is an
   * intentional "give me this panel docked" gesture and resets the
   * panel's mode to "docked" so subsequent opens stay docked too.
   *
   * If every dock slot on the target side is occupied, the existing
   * occupant of the canonical slot (`${side}-full` when not split,
   * `${side}-top` when split) is displaced to floating so the new
   * panel can take the slot. This matches the user expectation that
   * strip clicks always land in the dock.
   */
  const openPanelDocked = useCallback((id: PanelId, side?: Side) => {
    if (id === "omni" || id === "blank") return;
    update((p) => {
      if (isPanelOpen(p, id)) return p;
      const placement = p.placements.find((pl) => pl.id === id);
      const registryEntry = (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[id];
      const targetSide: Side =
        side ?? placement?.side ?? registryEntry?.defaultStripSide ?? "left";
      const next: ViewPrefs = {
        ...p,
        panelModes: { ...p.panelModes, [id]: "docked" },
      };
      // Try the standard slot plan first — handles empty full, free
      // half in split, or auto-splits when full is occupied.
      const plan = planSlotAssignment(p, targetSide, id);
      if (plan) {
        return { ...next, ...plan };
      }
      // No room in any half (split side, both occupied) — replace the
      // canonical top slot. Replace, don't displace: the previous
      // occupant just closes (kept out of poppedOutPanels). A strip
      // click is "swap this into the dock", not "kick the other panel
      // out as a floater".
      const canonical = dockSlotKey(targetSide, "top");
      const occupant = p.dockSlots[canonical];
      return {
        ...next,
        dockSlots: { ...next.dockSlots, [canonical]: id },
        poppedOutPanels:
          occupant && occupant !== id
            ? next.poppedOutPanels.filter((x) => x !== occupant)
            : next.poppedOutPanels,
      };
    });
  }, [update]);

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
    update((p) => ({
      ...p,
      _stashedLeft: p.activeLeft ? { top: p.activeLeft, bottom: p.activeLeftBottom } : null,
      activeLeft: null,
      activeLeftBottom: null,
    }));
  }, [update]);

  const collapseRight = useCallback(() => {
    update((p) => ({
      ...p,
      _stashedRight: p.activeRight ? { top: p.activeRight, bottom: p.activeRightBottom } : null,
      activeRight: null,
      activeRightBottom: null,
    }));
  }, [update]);

  const expandLeft = useCallback(() => {
    update((p) => ({ ...p, activeLeft: "omni", activeLeftBottom: null }));
  }, [update]);

  const expandRight = useCallback(() => {
    update((p) => ({ ...p, activeRight: "omni", activeRightBottom: null }));
  }, [update]);

  /** Close any open panels and pop-outs, but leave the side columns
   *  themselves expanded (they fall back to the omni-view background).
   *  Leaves collapsed sides collapsed, and leaves the editor split alone
   *  (that has its own toggle). */
  const closeAllPanels = useCallback(() => {
    update((p) => ({
      ...p,
      activeLeft: p.activeLeft != null ? "omni" : p.activeLeft,
      activeLeftBottom: null,
      splitLeftOrigin: null,
      activeRight: p.activeRight != null ? "omni" : p.activeRight,
      activeRightBottom: null,
      splitRightOrigin: null,
      poppedOutPanels: [],
      poppedOutOrigins: {},
      poppedOutCards: [],
      dockSlots: {},
    }));
  }, [update]);

  /** Suppress omni on a side: set its top slot to the truly-blank canvas.
   *  No-op for fully-collapsed sides (`null`). */
  const setBlank = useCallback((side: Side) => {
    update((p) => {
      if (side === "left") {
        return p.activeLeft == null ? p : { ...p, activeLeft: "blank" };
      }
      return p.activeRight == null ? p : { ...p, activeRight: "blank" };
    });
  }, [update]);

  /** Restore omni on any side currently in the explicit "blank" state.
   *  Called when the user does something that should re-reveal the
   *  omni background (opens a panel, creates a card). */
  const clearBlankIfSet = useCallback(() => {
    update((p) => {
      const leftBlank = p.activeLeft === "blank";
      const rightBlank = p.activeRight === "blank";
      if (!leftBlank && !rightBlank) return p;
      return {
        ...p,
        activeLeft: leftBlank ? "omni" : p.activeLeft,
        activeRight: rightBlank ? "omni" : p.activeRight,
      };
    });
  }, [update]);

  // Strip-click toggle: open if closed, close if open. "Open" means
  // either docked or floating — closing removes the panel from its
  // current home (clears dockSlot or removes from poppedOutPanels).
  // The saved float rect persists so re-opening floating restores size.
  const togglePanel = useCallback((id: PanelId) => {
    if (id === "omni" || id === "blank") return;
    update((p) => {
      // Closing path
      if (isPanelOpen(p, id)) {
        const dockSlot = findDockSlotForPanel(p, id);
        const nextDockSlots = { ...p.dockSlots };
        if (dockSlot) delete nextDockSlots[dockSlot];
        const sideAffected: Side | null = dockSlot
          ? (dockSlot.startsWith("left") ? "left" : "right")
          : null;
        const disengagePatch = sideAffected
          ? autoDisengageIfNeeded(p, sideAffected, nextDockSlots)
          : { dockSlots: nextDockSlots };
        return {
          ...p,
          ...disengagePatch,
          poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id),
        };
      }
      // Opening path
      const placement = p.placements.find((pl) => pl.id === id);
      const registryEntry = (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[id];
      const targetSide: Side =
        placement?.side ?? registryEntry?.defaultStripSide ?? "left";
      const mode: PanelMode = p.panelModes[id] ?? "docked";

      if (mode === "docked") {
        const plan = planSlotAssignment(p, targetSide, id);
        if (plan) {
          return { ...p, ...plan };
        }
      }
      const savedRect = p.floatPositions[id];
      const rect = savedRect ?? computeColumnSpawnRect(targetSide);
      return {
        ...p,
        poppedOutPanels: [...p.poppedOutPanels, id],
        floatPositions: { ...p.floatPositions, [id]: rect },
      };
    });
  }, [update]);

  const movePanel = useCallback((id: PanelId, toSide: Side, toIndex?: number) => {
    update((p) => {
      const filtered = p.placements.filter((pl) => pl.id !== id);
      const sameItems = filtered.filter((pl) => pl.side === toSide);
      const otherItems = filtered.filter((pl) => pl.side !== toSide);
      const idx = toIndex !== undefined ? Math.min(toIndex, sameItems.length) : sameItems.length;
      sameItems.splice(idx, 0, { id, side: toSide });

      // If it was the active panel on the old side, clear it; set it active on new side
      const oldPlacement = p.placements.find((pl) => pl.id === id);
      let activeLeft = p.activeLeft;
      let activeRight = p.activeRight;
      if (oldPlacement) {
        if (oldPlacement.side === "left" && activeLeft === id) activeLeft = null;
        if (oldPlacement.side === "right" && activeRight === id) activeRight = null;
      }
      if (toSide === "left") activeLeft = id;
      else activeRight = id;

      return {
        ...p,
        placements: [...otherItems, ...sameItems],
        activeLeft,
        activeRight,
      };
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

  /**
   * Legacy split setter — kept as a shim. Splits no longer exist in the
   * always-float model, so this just opens `id` as a float on `side`.
   * `half` is ignored. "omni"/"blank"/null are no-ops.
   */
  const setActiveHalf = useCallback(
    (side: Side, _half: Half, id: PanelId | null) => {
      if (!id || id === "omni" || id === "blank") return;
      openPanelFloat(id, side);
    },
    [openPanelFloat],
  );

  /**
   * Toggle split for a side. If not currently split, splits with the
   * existing active panel as top and "blank" as bottom (or vice-versa
   * if there's no active panel). If split, collapses by keeping the
   * top half and clearing the bottom.
   */
  const toggleSplit = useCallback((side: Side) => {
    update((p) => {
      const isSplit =
        side === "left" ? p.activeLeftBottom != null : p.activeRightBottom != null;
      // Migrate dock slots so panels don't disappear across split toggles.
      // off → on: move ${side}-full's occupant to ${side}-top.
      // on → off: keep ${side}-top's occupant in ${side}-full; displace
      //          ${side}-bottom's occupant to floating.
      const fullKey = dockSlotKey(side, "full");
      const topKey = dockSlotKey(side, "top");
      const bottomKey = dockSlotKey(side, "bottom");
      const nextDockSlots: Partial<Record<DockSlotKey, PanelId>> = { ...p.dockSlots };
      let nextPopped = p.poppedOutPanels;
      let nextModes = p.panelModes;
      if (!isSplit) {
        // Splitting on
        if (nextDockSlots[fullKey]) {
          nextDockSlots[topKey] = nextDockSlots[fullKey];
          delete nextDockSlots[fullKey];
        }
      } else {
        // Splitting off
        const topOccupant = nextDockSlots[topKey];
        const bottomOccupant = nextDockSlots[bottomKey];
        delete nextDockSlots[topKey];
        delete nextDockSlots[bottomKey];
        if (topOccupant) nextDockSlots[fullKey] = topOccupant;
        if (bottomOccupant) {
          nextModes = { ...nextModes, [bottomOccupant]: "floating" };
          if (!nextPopped.includes(bottomOccupant)) {
            nextPopped = [...nextPopped, bottomOccupant];
          }
        }
      }
      const baseUpdate = {
        ...p,
        dockSlots: nextDockSlots,
        poppedOutPanels: nextPopped,
        panelModes: nextModes,
      };
      if (side === "left") {
        if (isSplit) return { ...baseUpdate, activeLeftBottom: null, splitLeftOrigin: null };
        const top = p.activeLeft ?? "omni";
        return { ...baseUpdate, activeLeft: top, activeLeftBottom: "omni", splitLeftOrigin: "user" };
      } else {
        if (isSplit) return { ...baseUpdate, activeRightBottom: null, splitRightOrigin: null };
        const top = p.activeRight ?? "omni";
        return { ...baseUpdate, activeRight: top, activeRightBottom: "omni", splitRightOrigin: "user" };
      }
    });
  }, [update]);

  const setSplitRatio = useCallback((side: Side, ratio: number) => {
    const clamped = Math.max(0.05, Math.min(0.95, ratio));
    update((p) => (side === "left"
      ? { ...p, splitLeftRatio: clamped }
      : { ...p, splitRightRatio: clamped }));
  }, [update]);

  const setEditorSplit = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    update((p) => ({ ...p, editorSplit: typeof v === "function" ? v(p.editorSplit) : v }));
  }, [update]);

  const setShowHighlights = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    update((p) => ({
      ...p,
      showHighlights: typeof v === "function" ? v(p.showHighlights) : v,
    }));
  }, [update]);

  const toggleHighlightType = useCallback((type: HighlightType) => {
    update((p) => {
      const has = p.hiddenHighlightTypes.includes(type);
      return {
        ...p,
        hiddenHighlightTypes: has
          ? p.hiddenHighlightTypes.filter((t) => t !== type)
          : [...p.hiddenHighlightTypes, type],
      };
    });
  }, [update]);

  /* ── Editor decoration setters ──────────────────────────────────── */

  const toggleMarginalia = useCallback(() => {
    update((p) => ({ ...p, showMarginalia: !p.showMarginalia }));
  }, [update]);

  const toggleMarginaliaType = useCallback((type: MarginaliaType) => {
    update((p) => {
      const has = p.hiddenMarginaliaTypes.includes(type);
      return {
        ...p,
        hiddenMarginaliaTypes: has
          ? p.hiddenMarginaliaTypes.filter((t) => t !== type)
          : [...p.hiddenMarginaliaTypes, type],
      };
    });
  }, [update]);

  const toggleSectionIndicator = useCallback(() => {
    update((p) => ({ ...p, showSectionIndicator: !p.showSectionIndicator }));
  }, [update]);

  const toggleHeadingLabels = useCallback(() => {
    update((p) => ({ ...p, showHeadingLabels: !p.showHeadingLabels }));
  }, [update]);

  const toggleDividerLevel = useCallback((level: DividerLevel) => {
    update((p) => {
      const has = p.dividerLevels.includes(level);
      return {
        ...p,
        dividerLevels: has
          ? p.dividerLevels.filter((l) => l !== level)
          : [...p.dividerLevels, level],
      };
    });
  }, [update]);

  const setDividerWidth = useCallback((w: DividerWidth) => {
    update((p) => ({ ...p, dividerWidth: w }));
  }, [update]);

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

  const setMenuLocation = useCallback((v: MenuLocation | ((prev: MenuLocation) => MenuLocation)) => {
    update((p) => ({
      ...p,
      menuLocation: typeof v === "function" ? v(p.menuLocation) : v,
    }));
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
      const dockSlot = findDockSlotForPanel(p, id);
      const nextDockSlots = { ...p.dockSlots };
      if (dockSlot) delete nextDockSlots[dockSlot];
      const sideAffected: Side | null = dockSlot
        ? (dockSlot.startsWith("left") ? "left" : "right")
        : null;
      const disengagePatch = sideAffected
        ? autoDisengageIfNeeded(p, sideAffected, nextDockSlots)
        : { dockSlots: nextDockSlots };
      return {
        ...p,
        ...disengagePatch,
        poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id),
        poppedOutOrigins: remainingOrigins,
        // floatPositions intentionally unchanged: the user's pinned size
        // sticks across close/open cycles.
      };
    });
  }, [update]);

  /**
   * Toggle a panel's open state. Mode-aware: opens via the panel's
   * preferred mode (defaults to docked).
   */
  const togglePopout = useCallback((id: PanelId) => {
    update((p) => {
      if (isPanelOpen(p, id)) {
        const dockSlot = findDockSlotForPanel(p, id);
        const nextDockSlots = { ...p.dockSlots };
        if (dockSlot) delete nextDockSlots[dockSlot];
        const sideAffected: Side | null = dockSlot
          ? (dockSlot.startsWith("left") ? "left" : "right")
          : null;
        const disengagePatch = sideAffected
          ? autoDisengageIfNeeded(p, sideAffected, nextDockSlots)
          : { dockSlots: nextDockSlots };
        return {
          ...p,
          ...disengagePatch,
          poppedOutPanels: p.poppedOutPanels.filter((x) => x !== id),
        };
      }
      const placement = p.placements.find((pl) => pl.id === id);
      const registryEntry = (PANEL_REGISTRY as Record<string, { defaultStripSide?: Side }>)[id];
      const targetSide: Side =
        placement?.side ?? registryEntry?.defaultStripSide ?? "left";
      const mode: PanelMode = p.panelModes[id] ?? "docked";
      if (mode === "docked") {
        const plan = planSlotAssignment(p, targetSide, id);
        if (plan) {
          return { ...p, ...plan };
        }
      }
      const savedRect = p.floatPositions[id];
      const rect = savedRect ?? computeColumnSpawnRect(targetSide);
      return {
        ...p,
        poppedOutPanels: [...p.poppedOutPanels, id],
        floatPositions: { ...p.floatPositions, [id]: rect },
      };
    });
  }, [update]);

  /**
   * Atomic flip from docked → floating. Called by the dock chrome's
   * drag handler the moment the cursor moves past the dock socket.
   * Updates panelModes so future opens default to floating, drops the
   * panel from its dock slot, and seeds the floating rect.
   */
  const undockPanel = useCallback(
    (id: PanelId, initialFloatRect: { x: number; y: number; width: number; height: number }) => {
      update((p) => {
        const dockSlot = findDockSlotForPanel(p, id);
        const nextDockSlots = { ...p.dockSlots };
        if (dockSlot) delete nextDockSlots[dockSlot];
        return {
          ...p,
          dockSlots: nextDockSlots,
          poppedOutPanels: p.poppedOutPanels.includes(id)
            ? p.poppedOutPanels
            : [...p.poppedOutPanels, id],
          panelModes: { ...p.panelModes, [id]: "floating" },
          floatPositions: { ...p.floatPositions, [id]: initialFloatRect },
        };
      });
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
    (id: PanelId, slotKey: DockSlotKey) => {
      update((p) => {
        // Replace, don't displace: if the slot is occupied by a different
        // panel, that panel just closes (kept out of poppedOutPanels).
        // Matches the strip-click `openPanelDocked` semantics — dropping
        // a panel onto an occupied dock is "swap this in", not "kick the
        // other panel out as a floater".
        const occupant = p.dockSlots[slotKey];
        return {
          ...p,
          dockSlots: { ...p.dockSlots, [slotKey]: id },
          poppedOutPanels: p.poppedOutPanels.filter(
            (x) => x !== id && (!occupant || x !== occupant),
          ),
          panelModes: {
            ...p.panelModes,
            [id]: "docked",
            ...(occupant && occupant !== id ? { [occupant]: "docked" } : null),
          },
        };
      });
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

  const setEditorSplitRatio = useCallback((ratio: number) => {
    update((p) => ({ ...p, editorSplitRatio: Math.max(0.15, Math.min(0.85, ratio)) }));
  }, [update]);

  const setPageWidth = useCallback((w: number) => {
    update((p) => ({ ...p, pageWidth: Math.max(400, Math.min(1600, w)) }));
  }, [update]);

  const setTopGutter = useCallback((h: number) => {
    update((p) => ({ ...p, topGutter: Math.max(0, h) }));
  }, [update]);

  const setBottomGutter = useCallback((h: number) => {
    update((p) => ({ ...p, bottomGutter: Math.max(0, h) }));
  }, [update]);

  const setEditorLeftMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorLeftMargin: Math.max(72, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setEditorRightMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorRightMargin: Math.max(24, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setEditorTopMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorTopMargin: Math.max(24, Math.min(240, Math.round(px))) }));
  }, [update]);

  const setEditorBottomMargin = useCallback((px: number) => {
    update((p) => ({ ...p, editorBottomMargin: Math.max(24, Math.min(240, Math.round(px))) }));
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

  return {
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
    setActiveHalf,
    toggleSplit,
    setSplitRatio,
    setEditorSplit,
    setEditorSplitRatio,
    setPageWidth,
    setTopGutter,
    setBottomGutter,
    setEditorLeftMargin,
    setEditorRightMargin,
    setEditorTopMargin,
    setEditorBottomMargin,
    setShowHighlights,
    toggleHighlightType,
    toggleMarginalia,
    toggleMarginaliaType,
    toggleSectionIndicator,
    toggleHeadingLabels,
    toggleDividerLevel,
    setDividerWidth,
    toggleOmniCategory,
    resetOmniSide,
    toggleOmniHideAllCards,
    setMenuLocation,
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
    setPrintOptions,
    setTopbarRightCollapsed,
  };
}
